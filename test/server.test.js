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
  const make = async (body = { name: 'Congresso', date: '2026-11-14', venue: 'Sala Verdi' }) => {
    const r = await fetch(base + '/api/events', { method: 'POST', headers: { 'x-admin-pin': 'segreto', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const call = (code, tok, sub = '', init = {}) => fetch(`${base}/api/e/${code}${sub}`, { ...init, headers: { authorization: 'Bearer ' + tok, ...(init.headers || {}) } });
  const upload = (code, tok, name, content, fields = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([content]), name);
    return call(code, tok, '/upload', { method: 'POST', body: fd });
  };
  return { hub, base, make, call, upload, close: async () => { await hub.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
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
  const e = await (await fetch(`http://127.0.0.1:${pb}/api/e/${r.code}`, { headers: { authorization: 'Bearer ' + r.links.agenzia } })).json();
  assert.equal(e.name, 'Persistente');
  await b.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});
