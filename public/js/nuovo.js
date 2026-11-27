import { $, esc, copyText } from './util.js';

const f = $('#f'), msg = $('#msg'), out = $('#out');
try { $('#pin').value = sessionStorage.getItem('hub:admin') || ''; } catch {}

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'msg'; msg.textContent = 'Creo l\'evento…';
  try {
    const pin = $('#pin').value;
    const r = await fetch('/api/events', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-pin': pin },
      body: JSON.stringify({ name: $('#name').value, date: $('#date').value, venue: $('#venue').value }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Errore');
    try { sessionStorage.setItem('hub:admin', pin); } catch {}
    msg.className = 'msg ok'; msg.textContent = 'Evento creato.';
    const base = location.origin + '/e/' + j.code + '#k=';
    const rows = [['Link per l\'agenzia', j.links.agenzia, 'Può caricare materiali e modificare tutto. È il link da dare al referente.', j.pins.agenzia],
      ['Link per noi (tecnico)', j.links.tecnico, 'Stessi permessi dell\'agenzia, più il link tecnico.', j.pins.tecnico],
      ['Link per i relatori', j.links.ospite, 'Sola lettura: programma e informazioni. Lo gira l\'agenzia.']];
    out.innerHTML = '<div class="card"><h3>Codice ' + esc(j.code) + '</h3><p>Agenzia e service entrano con il link e con il PIN: manda il PIN con un altro messaggio, non insieme al link. Il PIN si vede solo ora. Non mettere questi link in pubblico.</p>' +
      rows.map((r, i) => '<label for="l' + i + '">' + esc(r[0]) + '</label><div class="linkbox"><input id="l' + i + '" type="text" readonly value="' + esc(base + r[1]) + '"><button class="btn small" type="button" data-i="' + i + '">Copia</button></div><p class="msg" style="min-height:0;margin-top:4px;font-weight:500;color:var(--muted)">' + esc(r[2]) + '</p>' + (r[3] ? '<p class="msg" style="margin-top:2px">PIN: <b style="font-size:18px;letter-spacing:.15em">' + esc(r[3]) + '</b></p>' : '')).join('') +
      '<div class="btns"><a class="btn primary" href="' + esc(base + j.links.tecnico) + '">Apri l\'evento</a></div></div>';
    out.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await copyText($('#l' + b.dataset.i).value); b.textContent = ok ? 'Copiato' : 'Copia a mano';
      setTimeout(() => { b.textContent = 'Copia'; }, 2000);
    }));
  } catch (x) { msg.className = 'msg err'; msg.textContent = x.message; }
});
