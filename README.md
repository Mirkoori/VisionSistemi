# Hub Evento

Una pagina per ogni evento, con programma, materiali, informazioni e timer, da dare alle agenzie come valore aggiunto del service audio video. Grafica "wallet", come l'app WAOOO.

Versione di prova (0.1).

## Come funziona

Ogni evento ha un **codice** e tre **link personali**. Il link è la chiave d'accesso: chi lo ha entra, non serve altro.

| Link | Chi lo usa | Cosa può fare |
|---|---|---|
| Agenzia | il referente dell'agenzia | tutto: programma, informazioni, caricare e scaricare i materiali, vedere i link |
| Service | noi | come l'agenzia, più il link del service |
| Relatori | i relatori | sola lettura: programma e informazioni, senza materiali |

I relatori non caricano niente: l'agenzia raccoglie i materiali e può girare ai relatori il **link in sola lettura**.

Sezioni dell'evento: **Programma**, **Materiali** (presentazioni, video, musiche, slide tappo, altro), **Timer** (collegamento al timer), **Info** (location, orari, referente, link da condividere).

## Provarlo sul computer

```bash
npm install
ADMIN_PIN=prova npm start
```

Apri `http://localhost:3000/nuovo`, scrivi il PIN, crea un evento e usa i link che compaiono.

## Metterlo sul server

Serve Node.js 18 o più recente. Una cartella `data/` conserva eventi e file: va inclusa nelle copie di sicurezza.

1. Copia il progetto sul server (per esempio in `/opt/hub-evento`) ed esegui `npm install --omit=dev`.
2. Crea il file `.env` partendo da `.env.example` e scegli un `ADMIN_PIN` lungo.
3. Tieni il programma acceso con systemd (`deploy/hub-evento.service`).
4. Metti davanti un proxy con HTTPS (esempio con Caddy in `deploy/Caddyfile`; con nginx imposta `client_max_body_size` almeno come `MAX_FILE_MB`).
5. Imposta `TRUST_PROXY=1` nel `.env`, così il blocco dei tentativi sbagliati usa l'indirizzo vero del visitatore.

Variabili: `ADMIN_PIN`, `PORT`, `MAX_FILE_MB` (default 500), `EVENT_QUOTA_MB` (default 4096), `TRUST_PROXY`.

## Sicurezza

- I link contengono una chiave lunga e casuale. Il browser la toglie dall'indirizzo dopo la prima apertura e la ricorda sul dispositivo.
- Le chiavi sbagliate vengono limitate: dopo 20 tentativi in un minuto l'indirizzo è bloccato per 5 minuti.
- Solo certi tipi di file si caricano (presentazioni, video, audio, immagini, documenti, zip). I file si scaricano sempre come allegato, mai aperti dal browser.
- La creazione di eventi richiede `ADMIN_PIN`. Senza, è disattivata.

## Dati e riservatezza

Le presentazioni sono materiale riservato. Prima dell'uso vero: decidere per quanto tempo conservare i file dopo l'evento, come cancellarli, e preparare l'informativa sul trattamento dei dati. Per ora i file si eliminano a mano dalla sezione Materiali.

## Prove automatiche

```bash
npm test
```

## Cosa manca

- Timer collegato in modo automatico (per ora si incolla il link nella sezione Timer).
- Cancellazione automatica dei file dopo l'evento.
- Promemoria e controllo automatico delle slide.
- Accesso a più eventi per la stessa agenzia.
- Installazione come app dal telefono.
