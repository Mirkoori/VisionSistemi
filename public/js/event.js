import { $, esc, fmtSize, dayLong, dayShort, copyText, icons } from './util.js';

const app = document.getElementById('app');
const code = (location.pathname.split('/')[2] || '').toUpperCase();
const KEY = 'hub:' + code;
const KINDS = [['presentazioni', 'Presentazioni'], ['video', 'Video'], ['musiche', 'Musiche'], ['tappo', 'Slide tappo'], ['altro', 'Altro']];
let token = null, ev = null, kind = 'presentazioni';

try { token = localStorage.getItem(KEY); } catch {}
const hm = /(?:^|[#&])k=([^&]+)/.exec(location.hash);
if (hm) {
  token = decodeURIComponent(hm[1]);
  try { localStorage.setItem(KEY, token); } catch {}
  history.replaceState(null, '', location.pathname); // la chiave non resta nell'indirizzo
}
const canEdit = () => ev && (ev.role === 'agenzia' || ev.role === 'tecnico');

async function api(sub, init = {}) {
  const r = await fetch('/api/e/' + code + sub, { ...init, headers: { authorization: 'Bearer ' + token, ...(init.headers || {}) } });
  if (r.status === 401) { try { localStorage.removeItem(KEY); } catch {} throw Object.assign(new Error('Link non valido o scaduto.'), { auth: true }); }
  return r;
}
const putEvent = async (body) => {
  const r = await api('', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Errore');
  ev = { ...ev, ...j }; return ev;
};

function hero(color, section, title, sub, back) {
  return '<div class="hero" style="background:' + color + '"><div class="topbar">' +
    (back ? '<button class="icon-btn" type="button" data-go="" aria-label="Indietro">' + icons.back + '</button>' : '<span class="tag">Hub Evento</span>') +
    '<span class="tag">' + esc(section) + '</span></div>' +
    '<h1 class="big">' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>';
}
const roleLabel = { agenzia: 'Agenzia', tecnico: 'Service', ospite: 'Sola lettura' };

/* ---------- schermata principale ---------- */
function home() {
  const info = [ev.venue, [ev.info.inizio && 'inizio ' + ev.info.inizio, ev.info.fine && 'fine ' + ev.info.fine].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
  const cards = [];
  cards.push(['c3', '04', 'Info', 'Location · Orari · Contatti', '#info']);
  if (canEdit() || ev.timerUrl) cards.push(['c4', '03', 'Timer', 'Schermo relatore · Moderatore', '#timer']);
  if (canEdit()) cards.push(['c2', '02', 'Materiali', 'Presentazioni · Video · Musiche · Tappo' + (ev.files.length ? ' · ' + ev.files.length + ' file' : ''), '#materiali']);
  cards.push(['c1', '01', 'Programma', ev.program.trim() ? 'Interventi e orari' : 'Da inserire', '#programma', dayShort(ev.date)]);
  app.innerHTML = '<div class="hero"><div class="topbar"><span class="tag">Hub Evento</span><span class="tag">' + esc(code) + '</span></div>' +
    '<h1 class="big">' + esc(ev.name) + '</h1>' + (ev.date ? '<p class="sub">' + esc(dayLong(ev.date)) + '</p>' : '') + (info ? '<p class="sub" style="margin-top:6px;font-weight:700">' + esc(info) + '</p>' : '') +
    '<span class="role">' + roleLabel[ev.role] + '</span></div>' +
    '<nav class="stack" aria-label="Sezioni">' + cards.map((c, i) =>
      '<a class="wcard ' + c[0] + (i === cards.length - 1 ? ' last' : '') + '" href="' + c[4] + '"><div class="top"><span class="n">' + c[1] + '</span><h2>' + esc(c[2]) + '</h2>' + icons.arrow + '</div><p class="s">' + esc(c[3]) + '</p>' +
      (c[5] ? '<div class="fig">' + esc(c[5]) + '</div>' : '') + '</a>').join('') + '</nav>';
}

/* ---------- programma ---------- */
function programma() {
  const lines = ev.program.split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => {
    const m = /^(\d{1,2}[:.]\d{2})\s+(.*)$/.exec(l);
    return m ? '<div class="prog"><span class="time">' + esc(m[1].replace('.', ':')) + '</span><span>' + esc(m[2]) + '</span></div>' : '<div class="prog" style="grid-template-columns:1fr"><b>' + esc(l) + '</b></div>';
  }).join('');
  let h = hero('var(--c1)', '01 · Programma', 'Programma', ev.name, true) + '<div class="list">';
  h += '<div class="card">' + (rows || '<p class="empty">Il programma non è ancora stato inserito.</p>') + '</div>';
  if (canEdit()) h += '<div class="card"><h3>Modifica</h3><label for="prg">Una riga per voce</label><textarea id="prg" placeholder="09:00 Apertura dei lavori&#10;09:30 Relazione di apertura">' + esc(ev.program) + '</textarea>' +
    '<p>Scrivi l\'orario all\'inizio della riga (per esempio 09:30). Le righe senza orario diventano titoli.</p><div class="btns"><button class="btn primary" type="button" id="saveP">Salva</button></div><p class="msg" id="msgP" role="status"></p></div>';
  app.innerHTML = h + '</div>';
  const b = $('#saveP'); if (b) b.addEventListener('click', () => saveWith(b, $('#msgP'), () => putEvent({ program: $('#prg').value }), programma));
}

/* ---------- materiali ---------- */
function groupHtml() {
  if (!ev.files.length) return '<div class="card"><p class="empty">Nessun file caricato.</p></div>';
  return KINDS.map(([k, label]) => {
    const fs = ev.files.filter((f) => f.kind === k); if (!fs.length) return '';
    return '<p class="group">' + esc(label) + ' · ' + fs.length + '</p><div class="card">' + fs.map((f) =>
      '<div class="row"><div class="t"><b>' + esc(f.name) + '</b><small>' + esc([f.label, fmtSize(f.size), new Date(f.at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')) + '</small></div>' +
      '<div style="display:flex;gap:6px"><button class="btn small" type="button" data-dl="' + f.id + '">Scarica</button><button class="btn small danger" type="button" data-rm="' + f.id + '">Elimina</button></div></div>').join('') + '</div>';
  }).join('');
}
function materiali() {
  if (!canEdit()) { location.hash = ''; return; }
  const pct = Math.min(100, Math.round((ev.usedBytes / ev.quotaBytes) * 100));
  app.innerHTML = hero('var(--c2)', '02 · Materiali', 'Materiali', ev.name, true) + '<div class="list">' +
    '<div class="card"><h3>Carica</h3><label>Tipo</label><div class="chips" role="group" aria-label="Tipo di materiale">' +
    KINDS.map(([k, l]) => '<button class="chip" type="button" data-kind="' + k + '" aria-pressed="' + (k === kind) + '">' + esc(l) + '</button>').join('') + '</div>' +
    '<label for="lbl">Relatore o sessione (facoltativo)</label><input type="text" id="lbl" maxlength="120" placeholder="Es. Dott. Rossi, sessione 2">' +
    '<label for="fl">File</label><input type="file" id="fl" multiple>' +
    '<div class="btns"><button class="btn primary" type="button" id="up">Carica</button></div><p class="msg" id="msgU" role="status"></p>' +
    '<div class="meter" aria-hidden="true"><i style="width:' + pct + '%"></i></div><p>' + fmtSize(ev.usedBytes) + ' usati su ' + fmtSize(ev.quotaBytes) + ' · massimo ' + fmtSize(ev.maxFileBytes) + ' per file</p></div>' +
    groupHtml() + '</div>';
  app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; app.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $('#up').addEventListener('click', uploadFiles);
  app.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => download(b.dataset.dl, b)));
  app.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.arm) return remove(b.dataset.rm);
    b.dataset.arm = '1'; b.textContent = 'Conferma?';
    setTimeout(() => { delete b.dataset.arm; b.textContent = 'Elimina'; }, 4000);
  }));
}
function xhrUpload(file, label, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', '/api/e/' + code + '/upload');
    x.setRequestHeader('authorization', 'Bearer ' + token);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status === 201 ? resolve(j.file) : reject(new Error(j.error || 'Caricamento non riuscito.')); };
    x.onerror = () => reject(new Error('Connessione interrotta.'));
    const fd = new FormData(); fd.append('kind', kind); fd.append('label', label); fd.append('file', file, file.name);
    x.send(fd);
  });
}
async function uploadFiles() {
  const input = $('#fl'), msg = $('#msgU'), btn = $('#up');
  const files = [...input.files]; if (!files.length) { msg.className = 'msg err'; msg.textContent = 'Scegli almeno un file.'; return; }
  btn.disabled = true; let done = 0, failed = [];
  for (const f of files) {
    try {
      await xhrUpload(f, $('#lbl').value, (p) => { msg.className = 'msg'; msg.textContent = 'Carico ' + f.name + ' · ' + Math.round(p * 100) + '%'; });
      done++;
    } catch (e) { failed.push(f.name + ': ' + e.message); }
  }
  await reload();
  materiali();
  const m = $('#msgU');
  if (failed.length) { m.className = 'msg err'; m.textContent = (done ? done + ' caricati. ' : '') + failed.join(' · '); }
  else { m.className = 'msg ok'; m.textContent = done === 1 ? 'File caricato.' : done + ' file caricati.'; }
}
async function download(id, btn) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = '…';
  try {
    const r = await api('/files/' + id); if (!r.ok) throw new Error();
    const f = ev.files.find((x) => x.id === id);
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = f ? f.name : 'file'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch { btn.textContent = 'Errore'; setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 2000); return; }
  btn.textContent = old; btn.disabled = false;
}
async function remove(id) { await api('/files/' + id, { method: 'DELETE' }); await reload(); materiali(); }

/* ---------- timer ---------- */
function timer() {
  let h = hero('var(--ink)', '03 · Timer', 'Timer', ev.name, true).replace('class="hero" style="background:var(--ink)"', 'class="hero" style="background:var(--ink);color:var(--card)"').replace(/stroke:var\(--ink\)/g, 'stroke:var(--card)');
  h += '<div class="list"><div class="card"><h3>Timer dell\'evento</h3>' +
    (ev.timerUrl ? '<p>Apri il timer in una nuova scheda. Sul dispositivo del relatore usa lo schermo relatore, per il moderatore la sua pagina.</p><div class="btns"><a class="btn primary" href="' + esc(ev.timerUrl) + '" target="_blank" rel="noopener">Apri il timer</a></div>' : '<p>Il timer non è ancora collegato a questo evento.</p>') + '</div>';
  if (canEdit()) h += '<div class="card"><h3>Indirizzo del timer</h3><label for="tu">Link</label><input type="url" id="tu" placeholder="https://…" value="' + esc(ev.timerUrl) + '"><div class="btns"><button class="btn primary" type="button" id="saveT">Salva</button></div><p class="msg" id="msgT" role="status"></p></div>';
  app.innerHTML = h + '</div>';
  const b = $('#saveT'); if (b) b.addEventListener('click', () => saveWith(b, $('#msgT'), () => putEvent({ timerUrl: $('#tu').value }), timer));
}

/* ---------- info ---------- */
const INFO_FIELDS = [['montaggio', 'Inizio montaggio', 'time'], ['inizio', 'Inizio evento', 'time'], ['fine', 'Fine evento', 'time'], ['referente', 'Referente', 'text'], ['telefono', 'Telefono', 'tel']];
function linkRow(label, note, tok) {
  const url = location.origin + '/e/' + code + '#k=' + tok;
  return '<label>' + esc(label) + '</label><div class="linkbox"><input type="text" readonly value="' + esc(url) + '" aria-label="' + esc(label) + '"><button class="btn small" type="button" data-copy="' + esc(url) + '">Copia</button></div><p style="margin-top:4px;font-size:12px">' + esc(note) + '</p>';
}
function info() {
  const i = ev.info;
  let h = hero('var(--c3)', '04 · Info', 'Info', ev.name, true) + '<div class="list">';
  if (canEdit()) {
    h += '<div class="card"><h3>Dettagli</h3><label for="n">Nome evento</label><input type="text" id="n" maxlength="120" value="' + esc(ev.name) + '">' +
      '<label for="d">Data</label><input type="date" id="d" value="' + esc(ev.date) + '"><label for="v">Location</label><input type="text" id="v" maxlength="160" value="' + esc(ev.venue) + '">' +
      INFO_FIELDS.map(([k, l, t]) => '<label for="i_' + k + '">' + l + '</label><input type="' + t + '" id="i_' + k + '" maxlength="160" value="' + esc(i[k]) + '">').join('') +
      '<label for="i_note">Note</label><textarea id="i_note" style="min-height:90px">' + esc(i.note) + '</textarea>' +
      '<div class="btns"><button class="btn primary" type="button" id="saveI">Salva</button></div><p class="msg" id="msgI" role="status"></p></div>';
    h += '<div class="card"><h3>Condividi</h3><p>Chi ha un link può entrare. Per i relatori usa quello in sola lettura.</p>' +
      linkRow('Link per i relatori', 'Sola lettura: programma e informazioni.', ev.links.ospite) +
      linkRow('Link per l\'agenzia', 'Può caricare e modificare. Non girarlo ai relatori.', ev.links.agenzia) +
      (ev.links.tecnico ? linkRow('Link per il service', 'Solo per noi.', ev.links.tecnico) : '') + '</div>';
  } else {
    const rows = [['Data', dayLong(ev.date)], ['Location', ev.venue], ['Montaggio', i.montaggio], ['Inizio', i.inizio], ['Fine', i.fine], ['Referente', i.referente], ['Telefono', i.telefono], ['Note', i.note]].filter((r) => r[1]);
    h += '<div class="card">' + (rows.length ? '<dl class="kv">' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>' : '<p class="empty">Nessuna informazione inserita.</p>') + '</div>';
  }
  app.innerHTML = h + '</div>';
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await copyText(b.dataset.copy); b.textContent = ok ? 'Copiato' : 'Copia a mano'; setTimeout(() => { b.textContent = 'Copia'; }, 2000);
  }));
  const s = $('#saveI');
  if (s) s.addEventListener('click', () => saveWith(s, $('#msgI'), () => {
    const inf = {}; INFO_FIELDS.forEach(([k]) => { inf[k] = $('#i_' + k).value; }); inf.note = $('#i_note').value;
    return putEvent({ name: $('#n').value, date: $('#d').value, venue: $('#v').value, info: inf });
  }, info));
}

async function saveWith(btn, msg, fn, rerender) {
  btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Salvo…';
  try { await fn(); rerender(); const m = document.querySelector('.msg[role=status]'); if (m) { m.className = 'msg ok'; m.textContent = 'Salvato.'; } }
  catch (e) { msg.className = 'msg err'; msg.textContent = e.message || 'Errore'; btn.disabled = false; }
}

/* ---------- avvio e routing ---------- */
const routes = { programma, materiali, timer, info };
function render() {
  if (!ev) return;
  document.title = ev.name + ' · Hub Evento';
  const r = location.hash.slice(1);
  if (routes[r]) { routes[r](); window.scrollTo(0, 0); } else home();
}
app.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) location.hash = b.dataset.go; });
window.addEventListener('hashchange', render);
async function reload() {
  const r = await api(''); const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Errore'); ev = j;
}
function locked(msg) {
  app.innerHTML = '<div class="lock"><h1>Hub Evento</h1><p>' + esc(msg) + '</p><p>Chiedi all\'agenzia o al service di mandarti di nuovo il link dell\'evento.</p></div>';
}
(async () => {
  if (!token) return locked('Per aprire questo evento serve il suo link personale.');
  try { await reload(); render(); } catch (e) { locked(e.auth ? 'Questo link non è valido o è scaduto.' : (e.message || 'Impossibile caricare l\'evento.')); }
})();
