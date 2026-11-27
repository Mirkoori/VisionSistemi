// server.js — Hub Evento. Una pagina per evento, con tre tipi di accesso (link con chiave):
//   agenzia  → modifica tutto, carica e scarica i materiali
//   tecnico  → come l'agenzia (siamo noi)
//   ospite   → sola lettura: programma e informazioni, per i relatori
// Nessun framework: solo Node e busboy per i caricamenti.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import busboy from 'busboy';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const ALLOWED_EXT = new Set([
  'pptx', 'ppt', 'pps', 'ppsx', 'key', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv',
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'aif', 'aiff', 'flac',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'zip',
]);
const KINDS = ['presentazioni', 'video', 'musiche', 'tappo', 'altro'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{4,12}$/;
const EDIT_ROLES = new Set(['agenzia', 'tecnico']);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const clip = (v, n) => String(v ?? '').slice(0, n);

export function createHubServer({
  port = 3000, host = '0.0.0.0', dataDir = path.join(here, 'data'), adminPin = process.env.ADMIN_PIN || '',
  maxFileMb = Number(process.env.MAX_FILE_MB) || 500, eventQuotaMb = Number(process.env.EVENT_QUOTA_MB) || 4096,
  trustProxy = process.env.TRUST_PROXY === '1', retentionDays = Number(process.env.RETENTION_DAYS) || 30,
} = {}) {
  const uploadsDir = path.join(dataDir, 'uploads');
  const dataFile = path.join(dataDir, 'events.json');
  fs.mkdirSync(uploadsDir, { recursive: true });

  // ---- archivio su file (scrittura atomica) ----
  let events = {};
  try { events = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { events = {}; }
  let saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(events));
    fs.renameSync(tmp, dataFile);
  }
  function save() { if (!saveTimer) saveTimer = setTimeout(saveNow, 150); }

  // ---- limite ai tentativi di accesso ----
  const fails = new Map();
  function ipOf(req) {
    if (trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
    return req.socket.remoteAddress || '?';
  }
  function blocked(ip) { const r = fails.get(ip); return !!r && r.until > Date.now(); }
  function noteFail(ip) {
    const r = fails.get(ip) || { n: 0, until: 0, t: Date.now() };
    if (Date.now() - r.t > 60_000) { r.n = 0; r.t = Date.now(); }
    r.n++; if (r.n >= 20) r.until = Date.now() + 5 * 60_000;
    fails.set(ip, r);
  }

  const send = (res, code, body, headers = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(code, {
      'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'cache-control': 'no-store', ...headers,
    });
    res.end(data);
  };
  const err = (res, code, msg) => send(res, code, { error: msg });

  function readJson(req, limit = 1_000_000) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('troppo grande')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('JSON non valido')); } });
      req.on('error', reject);
    });
  }

  function roleOf(ev, req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return null;
    for (const r of ['agenzia', 'tecnico', 'ospite']) if (safeEqual(m[1], ev.tokens[r])) return r;
    return null;
  }
  const eventBytes = (ev) => ev.files.reduce((n, f) => n + f.size, 0);

  function publicEvent(ev, role) {
    const base = { code: ev.code, role, name: ev.name, date: ev.date, venue: ev.venue, program: ev.program, info: ev.info, timerUrl: ev.timerUrl };
    if (EDIT_ROLES.has(role)) {
      base.files = ev.files.map(({ id, kind, label, name, size, at }) => ({ id, kind, label, name, size, at }));
      base.usedBytes = eventBytes(ev); base.quotaBytes = eventQuotaMb * 1048576; base.maxFileBytes = maxFileMb * 1048576;
      base.links = { ospite: ev.tokens.ospite, agenzia: ev.tokens.agenzia, ...(role === 'tecnico' ? { tecnico: ev.tokens.tecnico } : {}) };
      base.expiresAt = ev.expiresAt; base.log = ev.log.slice(-15).reverse();
    }
    return base;
  }

  const pin6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const tok = () => crypto.randomBytes(16).toString('base64url');
  const today = () => new Date().toISOString().slice(0, 10);
  function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const isExpired = (ev) => ev.purged || today() > ev.expiresAt;
  function purge(ev) {
    fs.rm(path.join(uploadsDir, ev.code), { recursive: true, force: true }, () => {});
    ev.files = []; ev.purged = true; save();
  }
  function sweep() { for (const ev of Object.values(events)) if (!ev.purged && today() > ev.expiresAt) purge(ev); }
  sweep(); const sweeper = setInterval(sweep, 3600_000); sweeper.unref();
  function logAdd(ev, role, action, detail = '') {
    ev.log.push({ at: new Date().toISOString(), role, action, detail: clip(detail, 120) });
    if (ev.log.length > 200) ev.log.splice(0, ev.log.length - 200);
  }
  function pinState(ev, role, req) {
    if (role === 'ospite') return 'ok';
    const p = req.headers['x-pin'];
    if (!p) return 'missing';
    return safeEqual(p, ev.pins[role]) ? 'ok' : 'wrong';
  }

  function newCode() {
    for (;;) {
      let c = ''; for (const b of crypto.randomBytes(6)) c += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (!events[c]) return c;
    }
  }

  function handleUpload(req, res, ev, role) {
    const len = Number(req.headers['content-length'] || 0);
    if (len && eventBytes(ev) + len > eventQuotaMb * 1048576) return err(res, 413, 'Spazio dell\'evento esaurito.');
    let bb;
    try { bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxFileMb * 1048576, fields: 6, fieldSize: 2000 } }); }
    catch { return err(res, 400, 'Richiesta non valida.'); }
    const fields = {}; let done = false, tmpPath = null, meta = null, tooBig = false, bad = null;
    const fail = (c, m) => { if (done) return; done = true; if (tmpPath) fs.rm(tmpPath, { force: true }, () => {}); err(res, c, m); };
    bb.on('field', (k, v) => { fields[k] = v; });
    bb.on('file', (_n, stream, info) => {
      const orig = clip(path.basename(String(info.filename || '').replace(/\\/g, '/')), 200) || 'file';
      const ext = path.extname(orig).slice(1).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) { bad = 'Tipo di file non consentito: ' + (ext || 'senza estensione') + '.'; stream.resume(); return; }
      const id = crypto.randomBytes(8).toString('hex');
      const dir = path.join(uploadsDir, ev.code); fs.mkdirSync(dir, { recursive: true });
      tmpPath = path.join(dir, id + '.part');
      const out = fs.createWriteStream(tmpPath); let size = 0;
      stream.on('data', (c) => { size += c.length; if (eventBytes(ev) + size > eventQuotaMb * 1048576) { tooBig = 'quota'; stream.unpipe(out); out.destroy(); stream.resume(); } });
      stream.on('limit', () => { tooBig = 'file'; });
      stream.pipe(out);
      out.on('finish', () => { meta = { id, name: orig, size }; });
      out.on('error', () => {});
    });
    bb.on('error', () => fail(400, 'Caricamento interrotto.'));
    req.on('aborted', () => { if (tmpPath) fs.rm(tmpPath, { force: true }, () => {}); });
    bb.on('close', () => setTimeout(() => {
      if (done) return;
      if (bad) return fail(415, bad);
      if (tooBig === 'file') return fail(413, 'File troppo grande (massimo ' + maxFileMb + ' MB).');
      if (tooBig === 'quota') return fail(413, 'Spazio dell\'evento esaurito.');
      if (!meta) return fail(400, 'Nessun file ricevuto.');
      const final = path.join(uploadsDir, ev.code, meta.id);
      fs.renameSync(tmpPath, final); tmpPath = null; done = true;
      const kind = KINDS.includes(fields.kind) ? fields.kind : 'altro';
      const rec = { id: meta.id, kind, label: clip(fields.label, 120), name: meta.name, size: meta.size, at: new Date().toISOString() };
      ev.files.push(rec); logAdd(ev, role, 'caricato', rec.name); save();
      send(res, 201, { file: rec });
    }, 20));
    req.pipe(bb);
  }

  async function api(req, res, url) {
    const ip = ipOf(req);
    // creazione evento: solo con il PIN di amministrazione
    if (url.pathname === '/api/events' && req.method === 'POST') {
      if (!adminPin) return err(res, 503, 'Creazione eventi non attiva: manca ADMIN_PIN sul server.');
      if (blocked(ip)) return err(res, 429, 'Troppi tentativi. Riprova tra qualche minuto.');
      if (!safeEqual(req.headers['x-admin-pin'] || '', adminPin)) { noteFail(ip); return err(res, 401, 'PIN non corretto.'); }
      const b = await readJson(req);
      const code = newCode();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : '';
      events[code] = {
        code, name: clip(b.name, 120) || 'Evento senza nome', date, venue: clip(b.venue, 160),
        program: '', info: { montaggio: '', inizio: '', fine: '', referente: '', telefono: '', note: '' }, timerUrl: '',
        tokens: { agenzia: tok(), tecnico: tok(), ospite: tok() }, pins: { agenzia: pin6(), tecnico: pin6() }, files: [], log: [],
        createdAt: new Date().toISOString(), expiresAt: addDays(date || today(), date ? retentionDays : 60), purged: false,
      };
      saveNow();
      return send(res, 201, { code, links: events[code].tokens, pins: events[code].pins, expiresAt: events[code].expiresAt });
    }
    const m = /^\/api\/e\/([A-Z0-9]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!m || !CODE_RE.test(m[1])) return err(res, 404, 'Non trovato.');
    if (blocked(ip)) return err(res, 429, 'Troppi tentativi. Riprova tra qualche minuto.');
    const ev = events[m[1]]; const role = ev ? roleOf(ev, req) : null;
    if (!ev || !role) { noteFail(ip); return err(res, 401, 'Link non valido o scaduto.'); }
    const ps = pinState(ev, role, req);
    if (ps === 'missing') return send(res, 401, { error: 'Serve il PIN.', needPin: true });
    if (ps === 'wrong') { noteFail(ip); return send(res, 401, { error: 'PIN non corretto.', needPin: true }); }
    if (isExpired(ev)) { if (!ev.purged) purge(ev); return err(res, 410, 'Evento concluso: i materiali sono stati cancellati e il link non è più attivo.'); }
    const rest = m[2] || '';

    if (rest === '' && req.method === 'GET') {
      if (req.headers['x-open'] === '1') { logAdd(ev, role, 'apertura'); save(); }
      return send(res, 200, publicEvent(ev, role));
    }
    if (!EDIT_ROLES.has(role)) return err(res, 403, 'Questo link è in sola lettura.');

    if (rest === '' && req.method === 'PUT') {
      const b = await readJson(req);
      if ('name' in b) ev.name = clip(b.name, 120) || ev.name;
      if ('date' in b) ev.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : '';
      if ('venue' in b) ev.venue = clip(b.venue, 160);
      if ('program' in b) ev.program = clip(b.program, 20000);
      if (role === 'tecnico' && /^\d{4}-\d{2}-\d{2}$/.test(b.expiresAt || '')) { ev.expiresAt = b.expiresAt; logAdd(ev, role, 'scadenza', b.expiresAt); }
      if ('timerUrl' in b) ev.timerUrl = /^https?:\/\//.test(b.timerUrl || '') ? clip(b.timerUrl, 300) : '';
      if (b.info && typeof b.info === 'object') for (const k of Object.keys(ev.info)) if (k in b.info) ev.info[k] = clip(b.info[k], k === 'note' ? 2000 : 160);
      save();
      return send(res, 200, publicEvent(ev, role));
    }
    if (rest === 'rotate' && req.method === 'POST') {
      const b = await readJson(req);
      const allowed = role === 'tecnico' ? ['ospite', 'agenzia'] : ['ospite'];
      if (!allowed.includes(b.role)) return err(res, 403, 'Non puoi rigenerare questo link.');
      ev.tokens[b.role] = tok();
      let pin; if (b.role === 'agenzia') { pin = pin6(); ev.pins.agenzia = pin; }
      logAdd(ev, role, 'link rigenerato', b.role); save();
      return send(res, 200, { ...publicEvent(ev, role), newPin: pin });
    }
    if (rest === 'upload' && req.method === 'POST') return handleUpload(req, res, ev, role);
    const f = /^files\/([a-f0-9]{16})$/.exec(rest);
    if (f) {
      const i = ev.files.findIndex((x) => x.id === f[1]);
      if (i < 0) return err(res, 404, 'File non trovato.');
      const rec = ev.files[i]; const p = path.join(uploadsDir, ev.code, rec.id);
      if (req.method === 'DELETE') { fs.rm(p, { force: true }, () => {}); ev.files.splice(i, 1); logAdd(ev, role, 'eliminato', rec.name); save(); return send(res, 200, { ok: true }); }
      if (req.method === 'GET') {
        if (!fs.existsSync(p)) return err(res, 404, 'File non trovato.');
        logAdd(ev, role, 'scaricato', rec.name); save();
        res.writeHead(200, {
          'content-type': 'application/octet-stream', 'content-length': rec.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rec.name)}`,
        });
        return fs.createReadStream(p).pipe(res);
      }
    }
    return err(res, 404, 'Non trovato.');
  }

  function serveStatic(req, res, url) {
    let p = url.pathname;
    if (/^\/e\/[A-Za-z0-9]+\/?$/.test(p)) p = '/e.html';
    else if (p === '/nuovo') p = '/nuovo.html';
    else if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return err(res, 403, 'Vietato.');
    fs.readFile(file, (e, buf) => {
      if (e) return err(res, 404, 'Non trovato.');
      send(res, 200, buf, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': p.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
      else err(res, 405, 'Metodo non consentito.');
    } catch (e) { if (!res.headersSent) err(res, 400, e.message || 'Richiesta non valida.'); else res.end(); }
  });

  return {
    server, events,
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { saveNow(); server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const hub = createHubServer({ port });
  hub.listen().then((p) => {
    console.log(`Hub Evento acceso su http://localhost:${p}`);
    if (!process.env.ADMIN_PIN) console.log('Attenzione: ADMIN_PIN non impostato, la creazione di nuovi eventi è disattivata.');
  });
}
