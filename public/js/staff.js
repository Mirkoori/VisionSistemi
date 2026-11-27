import { $, esc, dayShort, copyText, icons, API, eventUrl } from './util.js';

/* Area riservata a noi: home a wallet con Eventi, Tools e altro. Si entra con il PIN di amministrazione. */
const app = document.getElementById('app');
const AKEY = 'hub:admin';
const getAdmin = () => { try { return sessionStorage.getItem(AKEY) || ''; } catch { return ''; } };
const setAdmin = (v) => { try { v ? sessionStorage.setItem(AKEY, v) : sessionStorage.removeItem(AKEY); } catch {} };
let events = [];

// Strumenti nostri: aggiungere qui una riga per ogni nuovo tool.
const TOOLS = [
  { name: 'Palco Timer', note: 'Timer per sala, relatore e moderatore', url: 'https://mirkoori.github.io/timer/' },
  { name: 'Rider Evento', note: 'Scheda tecnica e rider per l\'agenzia', url: 'https://mirkoori.github.io/Rider_evento/' },
];

async function adminApi(method, body) {
  const r = await fetch(API + '/events', { method, headers: { 'x-admin-pin': getAdmin(), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
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

function eventCard(e, n) {
  const base = eventUrl(e.code) + '#k=';
  const meta = [e.date && dayShort(e.date), e.venue].filter(Boolean).join(' · ');
  return '<div class="card"><div class="row"><div class="t"><b>' + esc(e.name) + '</b><small>' + esc(meta || 'Senza data') + ' · ' + e.files + ' file' + (e.purged ? ' · concluso' : '') + '</small></div>' +
    (e.purged ? '' : '<button class="btn small primary" type="button" data-open="' + esc(e.code) + '">Apri</button>') + '</div>' +
    '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:800;font-size:12px;letter-spacing:.06em;text-transform:uppercase">Link e PIN</summary>' +
    linkLine('Agenzia', base + e.links.agenzia, e.pins.agenzia, n + 'a') + linkLine('Noi (service)', base + e.links.tecnico, e.pins.tecnico, n + 't') + linkLine('Relatori (sola lettura)', base + e.links.ospite, '', n + 'o') +
    '<p class="msg" style="font-weight:500;color:var(--muted)">Manda il PIN in un messaggio separato dal link.</p></details></div>';
}

function eventi() {
  app.innerHTML = hero('var(--c1)', '01 · Eventi', 'Eventi', 'Un evento, un link, un portale', true) + '<div class="list">' +
    '<form class="card" id="nf" autocomplete="off"><h3>Nuovo evento</h3><label for="nn">Nome evento</label><input type="text" id="nn" required maxlength="120" placeholder="Es. Congresso regionale">' +
    '<label for="nd">Data</label><input type="date" id="nd"><label for="nv">Location</label><input type="text" id="nv" maxlength="160" placeholder="Es. Hotel, sala">' +
    '<div class="btns"><button class="btn primary" type="submit">Crea evento</button></div><p class="msg" id="nm" role="status"></p></form>' +
    (events.length ? events.map(eventCard).join('') : '<div class="card"><p class="empty">Nessun evento ancora.</p></div>') + '</div>';
  $('#nf').addEventListener('submit', async (e) => {
    e.preventDefault(); const m = $('#nm'); m.className = 'msg'; m.textContent = 'Creo l\'evento…';
    try {
      await adminApi('POST', { name: $('#nn').value, date: $('#nd').value, venue: $('#nv').value });
      events = (await adminApi('GET')).events; eventi();
      const d = $('details'); if (d) d.open = true; // il PIN appena creato si vede nel primo evento
      const mm = $('#nm'); mm.className = 'msg ok'; mm.textContent = 'Evento creato: copia link e PIN qui sotto.';
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
