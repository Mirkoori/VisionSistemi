// Prepara la cartella "docs" per GitHub Pages (versione di prova senza server proprio).
// Uso: node scripts/build-pages.mjs https://PROGETTO.supabase.co/functions/v1/hub-evento
import fs from 'node:fs';
import path from 'node:path';
const api = process.argv[2];
if (!/^https:\/\/[^/]+\/functions\/v1\/hub-evento$/.test(api || '')) { console.error('Indica l\'indirizzo della funzione, per esempio https://xxxx.supabase.co/functions/v1/hub-evento'); process.exit(1); }
const out = path.resolve('docs');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync('public', out, { recursive: true });
fs.writeFileSync(path.join(out, 'config.js'), `window.HUB_API = ${JSON.stringify(api)};\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// versione negli indirizzi dei file, così il telefono non usa copie vecchie
const v = Date.now().toString(36);
for (const f of ['index.html', 'e.html']) {
  const p = path.join(out, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(src|href)="((?:js|css)\/[^"]+|config\.js)"/g, `$1="$2?v=${v}"`));
}
// pagina iniziale del sito (cartella principale): è l'app stessa, senza passaggi intermedi
const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8').replace('<head>', '<head>\n<base href="docs/">');
fs.writeFileSync('index.html', home);
fs.writeFileSync('.nojekyll', '');
console.log('Pronto in', out);
