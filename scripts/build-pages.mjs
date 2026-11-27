// Prepara la cartella "dist" per GitHub Pages (versione di prova senza server proprio).
// Uso: node scripts/build-pages.mjs https://PROGETTO.supabase.co/functions/v1/hub-evento
import fs from 'node:fs';
import path from 'node:path';
const api = process.argv[2];
if (!/^https:\/\/[^/]+\/functions\/v1\/hub-evento$/.test(api || '')) { console.error('Indica l\'indirizzo della funzione, per esempio https://xxxx.supabase.co/functions/v1/hub-evento'); process.exit(1); }
const out = path.resolve('dist');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync('public', out, { recursive: true });
fs.writeFileSync(path.join(out, 'config.js'), `window.HUB_API = ${JSON.stringify(api)};\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Pronto in', out);
