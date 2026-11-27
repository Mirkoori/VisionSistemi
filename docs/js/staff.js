import { $, esc, dayShort, dayLong, copyText, icons, API, eventUrl } from './util.js';

/* Area riservata a noi: home a wallet con Eventi, Tools e altro. Si entra con il PIN di amministrazione. */
const app = document.getElementById('app');
const AKEY = 'hub:admin';
const getAdmin = () => { try { return sessionStorage.getItem(AKEY) || ''; } catch { return ''; } };
const setAdmin = (v) => { try { v ? sessionStorage.setItem(AKEY, v) : sessionStorage.removeItem(AKEY); } catch {} };
let events = [];

// Strumenti nostri: aggiungere qui una riga per ogni nuovo tool.
const TOOLS = [
  { name: 'Palco Timer', note: 'Timer per sala, relatore e moderatore', url: 'https://mirkoori.github.io/Timer/' },
  { name: 'PPT Cavalieri', note: 'Cavalieri elettronici: una slide per relatore dal programma', url: 'https://mirkoori.github.io/pptcavalieri/' },
  { name: 'Player Evento', note: 'Regia: materiali, tappi e output su schermi remoti', url: 'https://mirkoori.github.io/playerevento/regia1.html' },
  { name: 'Rider Evento', note: 'Scheda tecnica e rider per l\'agenzia', url: 'https://mirkoori.github.io/Rider_evento/' },
];

async function adminApi(method, body, sub = '') {
  const r = await fetch(API + '/events' + sub, { method, headers: { 'x-admin-pin': getAdmin(), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { setAdmin(''); throw Object.assign(new Error(j.error || 'PIN non corretto.'), { locked: true }); }
  if (!r.ok) throw new Error(j.error || 'Errore.');
  return j;
}

function lock(msg) {
  app.innerHTML = '<div class="hero plain"><span class="tag">Service audio video</span><h1 class="big">Hub<br>Evento</h1>' +
    '<p class="sub">Area riservata</p></div><div class="list"><form class="card" id="lf" autocomplete="off"><label for="ap">PIN di amministrazione</label>' +
    '<input type="password" id="ap" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" required><div class="btns"><button class="btn primary" type="submit">Entra</button></div>' +
    '<p class="msg' + (msg ? ' err' : '') + '" id="lm" role="status">' + esc(msg || '') + '</p></form>' +
    '<div class="card"><h3>Hai un link?</h3><p>Apri il link che ti ha mandato l\'agenzia o il service: è l\'accesso al tuo evento.</p></div></div>';
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); setAdmin($('#ap').value);
    try { events = (await adminApi('GET')).events; route(); } catch (x) { lock(x.message); }
  });
}

const hero = (color, section, title, sub, back) => '<div class="hero" style="background:' + color + '"><div class="topbar">' +
  (back ? '<button class="icon-btn" type="button" data-go="" aria-label="Indietro">' + icons.back + '</button>' : '<span class="tag">Hub Evento</span>') +
  '<span class="tag">' + esc(section) + '</span></div><h1 class="big">' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>';

function home() {
  const next = events.filter((e) => !e.purged).length;
  app.innerHTML = '<div class="hero plain"><div class="topbar"><span class="tag">Service audio video</span>' +
    '<button class="btn small" type="button" id="out">Esci</button></div><h1 class="big">Hub<br>Evento</h1><p class="sub">Tutto quello che serve al service.</p></div>' +
    '<nav class="stack">' +
    '<a class="wcard c3" href="#altro"><div class="top"><span class="n">03</span><h2>Altro</h2>' + icons.arrow + '</div><p class="s">Presto altre cose utili</p></a>' +
    '<a class="wcard c2" href="#tools"><div class="top"><span class="n">02</span><h2>Tools</h2>' + icons.arrow + '</div><p class="s">Timer · Rider · strumenti del service</p></a>' +
    '<a class="wcard c1 last" href="#eventi"><div class="top"><span class="n">01</span><h2>Eventi</h2>' + icons.arrow + '</div><p class="s">Crea un evento · programma · materiali · link</p><div class="fig">' + next + (next === 1 ? ' attivo' : ' attivi') + '</div></a></nav>';
  $('#out').addEventListener('click', () => { setAdmin(''); lock(''); });
}

function linkLine(label, url, pin, i) {
  return '<label for="L' + i + '">' + esc(label) + '</label><div class="linkbox"><input id="L' + i + '" type="text" readonly value="' + esc(url) + '"><button class="btn small" type="button" data-copy="L' + i + '">Copia</button></div>' +
    (pin ? '<p class="msg" style="margin-top:4px">PIN: <b style="font-size:17px;letter-spacing:.15em">' + esc(pin) + '</b></p>' : '');
}

/* ---------- contatti e invio dei messaggi ---------- */
const ROLE_NAMES = { agenzia: 'Referente agenzia', ospite: 'Relatore (sola lettura)', tecnico: 'Service' };
const fmtSent = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const openKeys = new Set(); // sezioni aperte, per non richiuderle quando la pagina si aggiorna
let sendPanel = null;       // { code, id, what } messaggio in preparazione

function linkFor(e, role) { return eventUrl(e.code) + '#k=' + e.links[role]; }
function firstName(c) { return (c.name || '').trim().split(/\s+/)[0] || ''; }
function buildMessage(e, c) {
  const hi = 'Buongiorno' + (firstName(c) ? ' ' + firstName(c) : '') + ',';
  const when = [e.date && dayLong(e.date), e.venue].filter(Boolean).join(', ');
  const title = '"' + e.name + '"' + (when ? ' (' + when + ')' : '');
  if (c.role === 'ospite') {
    return { subject: 'Programma e informazioni · ' + e.name,
      body: hi + '\nqui trovi il programma e le informazioni dell\'evento ' + title + ':\n\n' + linkFor(e, 'ospite') + '\n\nÈ un link di sola lettura, personale: ti chiedo di non inoltrarlo.\n\nService audio video' };
  }
  const extra = c.role === 'tecnico'
    ? 'Con questo link entri come service: puoi modificare il programma e caricare o scaricare i materiali.'
    : 'Qui puoi caricare il programma e i materiali dell\'evento (presentazioni, video, musiche, slide tappo) e vedere le informazioni.';
  return { subject: 'Portale evento · ' + e.name,
    body: hi + '\necco il portale per l\'evento ' + title + '.\n\nLink: ' + linkFor(e, c.role) + '\nPIN: ' + e.pins[c.role] + '\n\n' + extra + '\nApri il link e, quando il sito lo chiede, scrivi il PIN.\n\nIl link e il PIN sono personali: ti chiedo di non inoltrarli. Per i relatori usa il link in sola lettura che trovi nella scheda Info del portale.\n\nService audio video' };
}
function waNumber(phone) {
  let d = String(phone || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  return d.length <= 11 ? '39' + d : d; // numeri italiani senza prefisso
}

function contactRow(e, c) {
  const bits = [ROLE_NAMES[c.role], c.email, c.phone].filter(Boolean).join(' · ');
  const sent = c.sentLink ? 'inviato ' + fmtSent(c.sentLink) : '';
  const open = sendPanel && sendPanel.code === e.code && sendPanel.id === c.id;
  let h = '<div class="row" style="align-items:flex-start"><div class="t"><b>' + esc(c.name || c.email || c.phone) + '</b><small>' + esc(bits) + '</small>' + (sent ? '<small style="color:var(--ok);font-weight:700">' + esc(sent) + '</small>' : '') + '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn small primary" type="button" data-send="' + esc(e.code + ':' + c.id + ':link') + '">Invia</button>' +
    '<button class="btn small danger" type="button" data-cdel="' + esc(e.code + ':' + c.id) + '">×</button></div></div>';
  if (open) h += sendPanelHtml(e, c);
  return h;
}
function sendPanelHtml(e, c) {
  const m = buildMessage(e, c);
  const chans = [];
  if (c.email) chans.push('<button class="btn small primary" type="button" data-ch="mail">Email</button>');
  if (c.phone) chans.push('<button class="btn small primary" type="button" data-ch="wa">WhatsApp</button><button class="btn small" type="button" data-ch="sms">SMS</button>');
  chans.push('<button class="btn small" type="button" data-ch="copy">Copia</button><button class="btn small" type="button" data-ch="close">Chiudi</button>');
  const tip = c.role === 'ospite' ? 'Link di sola lettura: chi lo riceve vede programma e informazioni, non i file.'
    : 'Un solo messaggio con link e PIN. Se finisce a chi non doveva, rigenera il link dalla scheda Info del portale.';
  return '<div style="background:var(--bg);border-radius:16px;padding:12px;margin:8px 0 4px"><label for="sm">Messaggio (puoi modificarlo)</label>' +
    '<textarea id="sm" rows="9" style="font-size:13px">' + esc(m.body) + '</textarea><p class="msg" style="min-height:0;margin:4px 0 0;font-weight:500;color:var(--muted)">' + esc(tip) + '</p>' +
    '<div class="btns" style="margin-top:8px">' + chans.join('') + '</div><p class="msg" id="smsg" role="status"></p></div>';
}
function contactsSection(e) {
  const list = e.contacts || [];
  return '<details data-key="c:' + esc(e.code) + '"' + (openKeys.has('c:' + e.code) ? ' open' : '') + ' style="margin-top:10px"><summary style="cursor:pointer;font-weight:800;font-size:12px;letter-spacing:.06em;text-transform:uppercase">Contatti e invio (' + list.length + ')</summary>' +
    (list.length ? list.map((c) => contactRow(e, c)).join('') : '<p class="msg" style="font-weight:500;color:var(--muted)">Aggiungi i referenti: poi mandi link e PIN in un unico messaggio.</p>') +
    '<form data-cform="' + esc(e.code) + '" autocomplete="off" style="margin-top:12px"><label>Nuovo contatto</label><input type="text" name="name" maxlength="80" placeholder="Nome e cognome">' +
    '<select name="role" aria-label="Ruolo"><option value="agenzia">Referente agenzia (link + PIN)</option><option value="ospite">Relatore (sola lettura)</option><option value="tecnico">Service (link + PIN)</option></select>' +
    '<input type="email" name="email" maxlength="120" placeholder="Email"><input type="tel" name="phone" maxlength="30" placeholder="Telefono (anche WhatsApp)">' +
    '<div class="btns"><button class="btn small primary" type="submit">Aggiungi contatto</button></div><p class="msg" data-cmsg></p></form></details>';
}

function eventCard(e, n) {
  const base = eventUrl(e.code) + '#k=';
  const meta = [e.date && dayShort(e.date), e.venue].filter(Boolean).join(' · ');
  return '<div class="card"><div class="row"><div class="t"><b>' + esc(e.name) + '</b><small>' + esc(meta || 'Senza data') + ' · ' + e.files + ' file' + (e.purged ? ' · concluso' : '') + '</small></div>' +
    (e.purged ? '' : '<button class="btn small primary" type="button" data-open="' + esc(e.code) + '">Apri</button>') + '</div>' +
    contactsSection(e) +
    '<details data-key="l:' + esc(e.code) + '"' + (openKeys.has('l:' + e.code) ? ' open' : '') + ' style="margin-top:10px"><summary style="cursor:pointer;font-weight:800;font-size:12px;letter-spacing:.06em;text-transform:uppercase">Link e PIN</summary>' +
    linkLine('Agenzia', base + e.links.agenzia, e.pins.agenzia, n + 'a') + linkLine('Noi (service)', base + e.links.tecnico, e.pins.tecnico, n + 't') + linkLine('Relatori (sola lettura)', base + e.links.ospite, '', n + 'o') +
    '<p class="msg" style="font-weight:500;color:var(--muted)">Link e PIN vanno insieme nel messaggio: usa Invia dalla sezione Contatti.</p></details></div>';
}

async function saveContacts(code, mutate) {
  const e = events.find((x) => x.code === code); if (!e) return;
  const next = mutate((e.contacts || []).map((c) => ({ ...c })));
  const j = await adminApi('PUT', { contacts: next }, '/' + code);
  e.contacts = j.contacts;
}
function rerender() { // aggiorna la pagina senza perdere le sezioni aperte
  document.querySelectorAll('details[data-key]').forEach((d) => { d.open ? openKeys.add(d.dataset.key) : openKeys.delete(d.dataset.key); });
  eventi(true);
}

function eventi(keep) {
  const keepForm = keep ? ['#nn', '#nd', '#nv'].map((q) => ($(q) ? $(q).value : '')) : null;
  app.innerHTML = hero('var(--c1)', '01 · Eventi', 'Eventi', 'Un evento, un link, un portale', true) + '<div class="list">' +
    '<form class="card" id="nf" autocomplete="off"><h3>Nuovo evento</h3><label for="nn">Nome evento</label><input type="text" id="nn" required maxlength="120" placeholder="Es. Congresso regionale">' +
    '<label for="nd">Data</label><input type="date" id="nd"><label for="nv">Location</label><input type="text" id="nv" maxlength="160" placeholder="Es. Hotel, sala">' +
    '<div class="btns"><button class="btn primary" type="submit">Crea evento</button></div><p class="msg" id="nm" role="status"></p></form>' +
    (events.length ? events.map(eventCard).join('') : '<div class="card"><p class="empty">Nessun evento ancora.</p></div>') + '</div>';
  if (keepForm) { $('#nn').value = keepForm[0]; $('#nd').value = keepForm[1]; $('#nv').value = keepForm[2]; }
  $('#nf').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const m = $('#nm'); m.className = 'msg'; m.textContent = 'Creo l\'evento…';
    try {
      await adminApi('POST', { name: $('#nn').value, date: $('#nd').value, venue: $('#nv').value });
      events = (await adminApi('GET')).events;
      if (events[0]) openKeys.add('l:' + events[0].code); // il PIN appena creato si vede subito nel primo evento
      eventi();
      const mm = $('#nm'); mm.className = 'msg ok'; mm.textContent = 'Evento creato: aggiungi i contatti o copia link e PIN qui sotto.';
    } catch (x) { m.className = 'msg err'; m.textContent = x.message; if (x.locked) lock(x.message); }
  });
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await copyText($('#' + b.dataset.copy).value); b.textContent = ok ? 'Copiato' : 'Copia a mano'; setTimeout(() => { b.textContent = 'Copia'; }, 2000);
  }));
  app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const e = events.find((x) => x.code === b.dataset.open); if (!e) return;
    try { sessionStorage.setItem('hubpin:' + e.code, e.pins.tecnico); } catch {} // entriamo senza ridigitare il PIN
    location.href = eventUrl(e.code) + '#k=' + e.links.tecnico;
  }));
  // contatti: aggiunta
  app.querySelectorAll('form[data-cform]').forEach((f) => f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); const code = f.dataset.cform, m = f.querySelector('[data-cmsg]'), d = new FormData(f);
    const c = { name: String(d.get('name') || '').trim(), role: d.get('role'), email: String(d.get('email') || '').trim(), phone: String(d.get('phone') || '').trim() };
    if (!c.name && !c.email && !c.phone) { m.className = 'msg err'; m.textContent = 'Scrivi almeno un nome, un\'email o un telefono.'; return; }
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) { m.className = 'msg err'; m.textContent = 'L\'email non sembra corretta.'; return; }
    try { await saveContacts(code, (l) => [...l, c]); openKeys.add('c:' + code); rerender(); } catch (x) { m.className = 'msg err'; m.textContent = x.message; }
  }));
  app.querySelectorAll('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Elimina?'; setTimeout(() => { delete b.dataset.arm; b.textContent = '×'; }, 3000); return; }
    const [code, id] = b.dataset.cdel.split(':');
    try { await saveContacts(code, (l) => l.filter((c) => c.id !== id)); if (sendPanel && sendPanel.id === id) sendPanel = null; rerender(); } catch { b.textContent = 'Errore'; }
  }));
  app.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => {
    const [code, id, what] = b.dataset.send.split(':');
    sendPanel = sendPanel && sendPanel.code === code && sendPanel.id === id && sendPanel.what === what ? null : { code, id, what };
    openKeys.add('c:' + code); rerender();
  }));
  if (sendPanel) wirePanel();
}
function wirePanel() {
  const e = events.find((x) => x.code === sendPanel.code), c = e && (e.contacts || []).find((x) => x.id === sendPanel.id);
  if (!c) { sendPanel = null; return; }
  app.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', async () => {
    const text = $('#sm').value, m = buildMessage(e, c), msg = $('#smsg'), ch = b.dataset.ch;
    if (ch === 'close') { sendPanel = null; return rerender(); }
    if (ch === 'copy') { const ok = await copyText(text); msg.className = 'msg ' + (ok ? 'ok' : 'err'); msg.textContent = ok ? 'Messaggio copiato.' : 'Non riesco a copiare: selezionalo a mano.'; return; }
    const url = ch === 'mail' ? 'mailto:' + encodeURIComponent(c.email) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(text)
      : ch === 'wa' ? 'https://wa.me/' + waNumber(c.phone) + '?text=' + encodeURIComponent(text)
      : 'sms:' + c.phone.replace(/[^\d+]/g, '') + '?&body=' + encodeURIComponent(text);
    window.open(url, '_blank'); // subito, nel gesto dell'utente: altrimenti il telefono blocca l'apertura
    // segno l'invio come "preparato": il messaggio parte quando lo confermi nell'app di posta o di messaggi
    try { const key = 'sentLink'; const now = new Date().toISOString(); await saveContacts(e.code, (l) => l.map((x) => (x.id === c.id ? { ...x, [key]: now } : x))); } catch {}
    sendPanel = null; rerender();
  }));
}

function tools() {
  app.innerHTML = hero('var(--c2)', '02 · Tools', 'Tools', 'Gli strumenti del service', true) + '<div class="list"><div class="card">' +
    TOOLS.map((t) => '<div class="row"><div class="t"><b>' + esc(t.name) + '</b><small>' + esc(t.note) + '</small></div><a class="btn small primary" href="' + esc(t.url) + '" target="_blank" rel="noopener">Apri</a></div>').join('') + '</div></div>';
}

function altro() {
  app.innerHTML = hero('var(--c3)', '03 · Altro', 'Altro', 'Spazio per le prossime idee', true) + '<div class="list"><div class="card"><p class="empty">Qui metteremo le altre cose utili al service.</p></div></div>';
}

const routes = { eventi, tools, altro };
function route() {
  const r = location.hash.replace('#', '');
  (routes[r] || home)();
  window.scrollTo(0, 0);
}
app.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) location.hash = b.dataset.go; });
window.addEventListener('hashchange', () => { if (getAdmin()) route(); });

(async function start() {
  if (!getAdmin()) return lock('');
  try { events = (await adminApi('GET')).events; route(); } catch (x) { lock(x.message); }
})();
