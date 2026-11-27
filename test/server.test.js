import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHubServer } from '../server.js';

async function setup(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  const hub = createHubServer({ port: 0, host: '127.0.0.1', dataDir, adminPin: 'segreto', ...opts });
  const port = await hub.listen();
  const base = `http://127.0.0.1:${port}`;
  const pins = new Map();
  const make = async (body = { name: 'Congresso', date: new Date().toISOString().slice(0, 10), venue: 'Sala Verdi' }) => {
    const r = await fetch(base + '/api/events', { method: 'POST', headers: { 'x-admin-pin': 'segreto', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.links) { pins.set(j.links.agenzia, j.pins.agenzia); pins.set(j.links.tecnico, j.pins.tecnico); }
    return { status: r.status, ...j };
  };
  const call = (code, tok, sub = '', init = {}) => fetch(`${base}/api/e/${code}${sub}`, { ...init, headers: { authorization: 'Bearer ' + tok, ...(pins.has(tok) ? { 'x-pin': pins.get(tok) } : {}), ...(init.headers || {}) } });
  const upload = (code, tok, name, content, fields = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([content]), name);
    return call(code, tok, '/upload', { method: 'POST', body: fd });
  };
  return { hub, base, make, call, upload, pins, close: async () => { await hub.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('creare un evento richiede il PIN di amministrazione', async () => {
  const s = await setup();
  const r = await fetch(s.base + '/api/events', { method: 'POST', headers: { 'x-admin-pin': 'sbagliato' }, body: '{}' });
  assert.equal(r.status, 401);
  const ok = await s.make();
  assert.equal(ok.status, 201);
  assert.match(ok.code, /^[A-Z0-9]{6}$/);
  await s.close();
});

test('senza ADMIN_PIN la creazione è disattivata', async () => {
  const s = await setup({ adminPin: '' });
  const r = await fetch(s.base + '/api/events', { method: 'POST', headers: { 'x-admin-pin': '' }, body: '{}' });
  assert.equal(r.status, 503);
  await s.close();
});

test('i link danno ruoli diversi e l\'ospite è in sola lettura', async () => {
  const s = await setup();
  const { code, links } = await s.make();
  const ag = await (await s.call(code, links.agenzia)).json();
  assert.equal(ag.role, 'agenzia'); assert.ok(ag.links.ospite); assert.ok(!ag.links.tecnico);
  const te = await (await s.call(code, links.tecnico)).json();
  assert.equal(te.role, 'tecnico'); assert.ok(te.links.tecnico);
  const os_ = await (await s.call(code, links.ospite)).json();
  assert.equal(os_.role, 'ospite'); assert.equal(os_.files, undefined); assert.equal(os_.links, undefined);
  const put = await s.call(code, links.ospite, '', { method: 'PUT', body: JSON.stringify({ name: 'X' }), headers: { 'content-type': 'application/json' } });
  assert.equal(put.status, 403);
  assert.equal((await s.call(code, 'sbagliato')).status, 401);
  await s.close();
});

test('l\'agenzia modifica programma e informazioni', async () => {
  const s = await setup();
  const { code, links } = await s.make();
  const r = await s.call(code, links.agenzia, '', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ program: '09:00 Apertura', info: { referente: 'Laura', montaggio: '07:00' }, timerUrl: 'javascript:alert(1)' }) });
  const e = await r.json();
  assert.equal(e.program, '09:00 Apertura'); assert.equal(e.info.referente, 'Laura'); assert.equal(e.timerUrl, '');
  const g = await (await s.call(code, links.ospite)).json();
  assert.equal(g.program, '09:00 Apertura');
  await s.close();
});

test('caricamento, elenco, download e cancellazione', async () => {
  const s = await setup();
  const { code, links } = await s.make();
  const up = await s.upload(code, links.agenzia, 'slide relatore.pptx', 'contenuto', { kind: 'presentazioni', label: 'Dott. Rossi' });
  assert.equal(up.status, 201);
  const { file } = await up.json();
  assert.equal(file.kind, 'presentazioni'); assert.equal(file.size, 9);
  const list = await (await s.call(code, links.tecnico)).json();
  assert.equal(list.files.length, 1);
  const dl = await s.call(code, links.tecnico, '/files/' + file.id);
  assert.equal(dl.status, 200); assert.equal(await dl.text(), 'contenuto');
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.equal((await s.call(code, links.ospite, '/files/' + file.id)).status, 403);
  assert.equal((await s.call(code, links.agenzia, '/files/' + file.id, { method: 'DELETE' })).status, 200);
  assert.equal((await (await s.call(code, links.agenzia)).json()).files.length, 0);
  await s.close();
});

test('estensioni non consentite, file troppo grandi e ospite rifiutati', async () => {
  const s = await setup({ maxFileMb: 1 });
  const { code, links } = await s.make();
  assert.equal((await s.upload(code, links.agenzia, 'virus.exe', 'x')).status, 415);
  assert.equal((await s.upload(code, links.agenzia, 'senza_estensione', 'x')).status, 415);
  assert.equal((await s.upload(code, links.agenzia, 'grande.mp4', Buffer.alloc(1.5 * 1048576))).status, 413);
  assert.equal((await s.upload(code, links.ospite, 'a.pdf', 'x')).status, 403);
  assert.equal((await (await s.call(code, links.agenzia)).json()).files.length, 0);
  await s.close();
});

test('lo spazio dell\'evento è limitato', async () => {
  const s = await setup({ eventQuotaMb: 1 });
  const { code, links } = await s.make();
  assert.equal((await s.upload(code, links.agenzia, 'a.mp4', Buffer.alloc(700 * 1024))).status, 201);
  assert.equal((await s.upload(code, links.agenzia, 'b.mp4', Buffer.alloc(700 * 1024))).status, 413);
  await s.close();
});

test('nomi file pericolosi non escono dalla cartella', async () => {
  const s = await setup();
  const { code, links } = await s.make();
  const up = await s.upload(code, links.agenzia, '../../../etc/passwd.pdf', 'x');
  assert.equal(up.status, 201);
  const { file } = await up.json();
  assert.equal(file.name, 'passwd.pdf');
  assert.equal((await fetch(s.base + '/..%2f..%2fserver.js')).status, 404);
  assert.equal((await fetch(s.base + '/../server.js')).status, 404);
  await s.close();
});

test('dopo troppi tentativi sbagliati si viene bloccati', async () => {
  const s = await setup();
  const { code } = await s.make();
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await s.call(code, 'x' + i)).status;
  assert.equal(last, 429);
  await s.close();
});

test('i dati restano dopo un riavvio', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  const a = createHubServer({ port: 0, host: '127.0.0.1', dataDir, adminPin: 'p' });
  const pa = await a.listen();
  const r = await (await fetch(`http://127.0.0.1:${pa}/api/events`, { method: 'POST', headers: { 'x-admin-pin': 'p' }, body: JSON.stringify({ name: 'Persistente' }) })).json();
  await a.close();
  const b = createHubServer({ port: 0, host: '127.0.0.1', dataDir, adminPin: 'p' });
  const pb = await b.listen();
  const e = await (await fetch(`http://127.0.0.1:${pb}/api/e/${r.code}`, { headers: { authorization: 'Bearer ' + r.links.agenzia, 'x-pin': r.pins.agenzia } })).json();
  assert.equal(e.name, 'Persistente');
  await b.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

test('agenzia e service hanno bisogno anche del PIN, i relatori no', async () => {
  const s = await setup();
  const { code, links, pins } = await s.make();
  assert.match(pins.agenzia, /^\d{6}$/);
  const bare = (tok, pin) => fetch(`${s.base}/api/e/${code}`, { headers: { authorization: 'Bearer ' + tok, ...(pin ? { 'x-pin': pin } : {}) } });
  const no = await bare(links.agenzia); assert.equal(no.status, 401); assert.equal((await no.json()).needPin, true);
  const wrong = await bare(links.agenzia, '000000'); assert.equal(wrong.status, 401); assert.equal((await wrong.json()).needPin, true);
  assert.equal((await bare(links.agenzia, pins.tecnico)).status, 401); // il PIN del service non apre il link dell'agenzia
  assert.equal((await bare(links.agenzia, pins.agenzia)).status, 200);
  assert.equal((await bare(links.ospite)).status, 200);
  await s.close();
});

test('rigenerare il link annulla quello vecchio', async () => {
  const s = await setup();
  const { code, links } = await s.make();
  const old = links.ospite;
  const r = await s.call(code, links.agenzia, '/rotate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'ospite' }) });
  assert.equal(r.status, 200);
  const fresh = (await r.json()).links.ospite;
  assert.notEqual(fresh, old);
  assert.equal((await s.call(code, old)).status, 401);
  assert.equal((await s.call(code, fresh)).status, 200);
  // l'agenzia non può rigenerare il proprio link né quello del service
  for (const role of ['agenzia', 'tecnico']) assert.equal((await s.call(code, links.agenzia, '/rotate', { method: 'POST', body: JSON.stringify({ role }) })).status, 403);
  // il service può rigenerare l'agenzia e ottiene un nuovo PIN
  const t = await s.call(code, links.tecnico, '/rotate', { method: 'POST', body: JSON.stringify({ role: 'agenzia' }) });
  const j = await t.json(); assert.match(j.newPin, /^\d{6}$/);
  assert.equal((await s.call(code, links.agenzia)).status, 401);
  await s.close();
});

test('dopo la scadenza i file sono cancellati e il link non vale più', async () => {
  const s = await setup();
  const { code, links } = await s.make({ name: 'Passato', date: '2020-01-01' });
  const ev = s.hub.events[code];
  assert.equal(ev.expiresAt, '2020-01-31');
  // evento scaduto fin dall'inizio: la prima richiesta lo cancella
  ev.files.push({ id: 'aaaaaaaaaaaaaaaa', kind: 'altro', label: '', name: 'x.pdf', size: 1, at: new Date().toISOString() });
  const r = await s.call(code, links.agenzia);
  assert.equal(r.status, 410);
  assert.equal(ev.files.length, 0); assert.equal(ev.purged, true);
  assert.equal((await s.call(code, links.ospite)).status, 410);
  assert.equal((await s.call(code, 'sbagliato')).status, 401);
  await s.close();
});

test('solo il service può spostare la scadenza e l\'attività viene registrata', async () => {
  const s = await setup();
  const { code, links } = await s.make();
  const put = (tok, body) => s.call(code, tok, '', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const before = (await (await s.call(code, links.agenzia)).json()).expiresAt;
  await put(links.agenzia, { expiresAt: '2099-01-01' });
  assert.equal((await (await s.call(code, links.agenzia)).json()).expiresAt, before);
  await put(links.tecnico, { expiresAt: '2099-01-01' });
  assert.equal((await (await s.call(code, links.agenzia)).json()).expiresAt, '2099-01-01');
  await s.upload(code, links.agenzia, 'a.pdf', 'x');
  const log = (await (await s.call(code, links.tecnico)).json()).log;
  assert.ok(log.some((l) => l.action === 'caricato' && l.detail === 'a.pdf' && l.role === 'agenzia'));
  await s.close();
});

test('l\'elenco eventi è solo per chi ha il PIN di amministrazione', async () => {
  const s = await setup();
  try {
    await s.make({ name: 'Uno', date: '2027-03-18' });
    const no = await fetch(s.base + '/api/events', { headers: { 'x-admin-pin': 'sbagliato' } });
    assert.equal(no.status, 401);
    const ok = await fetch(s.base + '/api/events', { headers: { 'x-admin-pin': 'segreto' } });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.events.length, 1);
    assert.equal(j.events[0].name, 'Uno');
    assert.ok(j.events[0].links.agenzia && j.events[0].pins.tecnico);
    const r = await fetch(s.base + '/nuovo', { redirect: 'manual' });
    assert.equal(r.status, 302);
  } finally { await s.close(); }
});

test('caricamento in tre passi: indirizzo, invio del file, conferma', async () => {
  const s = await setup();
  try {
    const r = await s.make(); const tok = r.links.agenzia;
    const j = (res) => res.json();
    const bad = await s.call(r.code, tok, '/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'virus.exe', size: 10 }) });
    assert.equal(bad.status, 415);
    const u = await j(await s.call(r.code, tok, '/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'slide.pptx', size: 5 }) }));
    assert.match(u.url, /^\/api\/put\//);
    // senza aver inviato il file la conferma fallisce
    const early = await s.call(r.code, tok, '/upload-done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: u.id, name: 'slide.pptx', kind: 'presentazioni' }) });
    assert.equal(early.status, 400);
    const put = await fetch(s.base + u.url, { method: 'PUT', body: 'ciao!' });
    assert.equal(put.status, 200);
    const done = await s.call(r.code, tok, '/upload-done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: u.id, name: 'slide.pptx', kind: 'presentazioni', label: 'Rossi' }) });
    assert.equal(done.status, 201);
    const ev = await j(await s.call(r.code, tok));
    assert.equal(ev.files.length, 1); assert.equal(ev.files[0].size, 5);
    // un identificativo inventato non carica nulla
    const fake = await fetch(s.base + '/api/put/0123456789abcdef', { method: 'PUT', body: 'x' });
    assert.equal(fake.status, 404);
    // l'ospite non può chiedere di caricare
    const g = await s.call(r.code, r.links.ospite, '/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'a.pdf', size: 1 }) });
    assert.equal(g.status, 403);
  } finally { await s.close(); }
});

test('file del programma: lo carica l\'agenzia, lo vedono tutti, il nuovo sostituisce il vecchio', async () => {
  const s = await setup();
  try {
    const r = await s.make(); const tok = r.links.agenzia;
    const postJson = (t, sub, body) => s.call(r.code, t, sub, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const send = async (name, content) => {
      const u = await (await postJson(tok, '/upload-url', { name, size: content.length, kind: 'programma' })).json();
      await fetch(s.base + u.url, { method: 'PUT', body: content });
      return postJson(tok, '/upload-done', { id: u.id, name, kind: 'programma' });
    };
    // un file che non si può aprire come programma è rifiutato
    assert.equal((await postJson(tok, '/upload-url', { name: 'musica.mp3', size: 5, kind: 'programma' })).status, 415);
    assert.equal((await send('programma.pdf', '%PDF-1 uno')).status, 201);
    const ospite = await (await s.call(r.code, r.links.ospite)).json();
    assert.equal(ospite.programFile.name, 'programma.pdf');
    assert.equal(ospite.files, undefined); // i relatori non vedono l'elenco dei file
    const view = await s.call(r.code, r.links.ospite, '/program-file');
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'application/pdf');
    assert.match(view.headers.get('content-disposition'), /^inline/);
    assert.equal(await view.text(), '%PDF-1 uno');
    // gli altri file restano riservati
    const other = await (await postJson(tok, '/upload-url', { name: 'slide.pptx', size: 1 })).json();
    await fetch(s.base + other.url, { method: 'PUT', body: 'x' });
    const done = await (await postJson(tok, '/upload-done', { id: other.id, name: 'slide.pptx', kind: 'presentazioni' })).json();
    assert.equal((await s.call(r.code, r.links.ospite, '/files/' + done.file.id)).status, 403);
    // un nuovo programma sostituisce il vecchio
    assert.equal((await send('nuovo.png', 'PNGDATA')).status, 201);
    const ag = await (await s.call(r.code, tok)).json();
    assert.equal(ag.files.filter((f) => f.kind === 'programma').length, 1);
    assert.equal(ag.programFile.name, 'nuovo.png');
    assert.equal((await s.call(r.code, r.links.ospite, '/program-file')).headers.get('content-type'), 'image/png');
  } finally { await s.close(); }
});

test('contatti dell\'evento: solo con il PIN di amministrazione e mai visibili a link e relatori', async () => {
  const s = await setup();
  try {
    const r = await s.make();
    const put = (pin, contacts) => fetch(`${s.base}/api/events/${r.code}`, { method: 'PUT', headers: { 'x-admin-pin': pin, 'content-type': 'application/json' }, body: JSON.stringify({ contacts }) });
    assert.equal((await put('sbagliato', [])).status, 401);
    const ok = await put('segreto', [
      { name: 'Anna Rossi', role: 'agenzia', email: 'anna@agenzia.it', phone: '+39 333 1234567' },
      { name: 'Dott. Bianchi', role: 'strano', email: 'b@x.it', phone: 'abc333' },
      { name: '', email: '', phone: '' },
    ]);
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.contacts.length, 2); // il contatto vuoto sparisce
    assert.equal(j.contacts[1].role, 'agenzia'); // un ruolo sconosciuto non passa
    assert.equal(j.contacts[1].phone, '333'); // dal telefono restano solo cifre e simboli
    assert.match(j.contacts[0].id, /^[a-f0-9]{8}$/);
    const list = await (await fetch(s.base + '/api/events', { headers: { 'x-admin-pin': 'segreto' } })).json();
    assert.equal(list.events[0].contacts.length, 2);
    for (const tok of [r.links.agenzia, r.links.tecnico, r.links.ospite]) {
      const ev = await (await s.call(r.code, tok)).json();
      assert.equal(ev.contacts, undefined);
    }
    assert.equal((await fetch(`${s.base}/api/events/ZZZZZZ`, { method: 'PUT', headers: { 'x-admin-pin': 'segreto' }, body: '{}' })).status, 404);
  } finally { await s.close(); }
});
