# Versione di prova su Supabase (senza server proprio)

- `functions/hub-evento/index.ts`: la funzione che fa tutti i controlli (link, PIN, ruoli, scadenza, registro, file).
- Tabelle `hub_events` e `hub_config` (RLS attiva, nessuna policy: ci arriva solo la funzione) e bucket privato `hub-evento`.
- PIN di amministrazione: segreto `ADMIN_PIN` della funzione, oppure (prova) la riga `admin_pin_sha256` di `hub_config` con l'hash SHA-256 del PIN.
- Pagine: `node scripts/build-pages.mjs https://PROGETTO.supabase.co/functions/v1/hub-evento` crea la cartella `dist`, da pubblicare su GitHub Pages.

Limiti del piano gratuito: file da 50 MB al massimo, 1 GB in tutto, progetto messo in pausa dopo una settimana senza uso.
Per l'uso vero conviene il server proprio (README principale).
