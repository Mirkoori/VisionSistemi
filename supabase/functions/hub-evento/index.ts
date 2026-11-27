// Hub Evento su Supabase: stessa logica del server Node (ruoli, PIN, scadenza, registro), senza server proprio.
// Dati in public.hub_events (JSON per evento), file nel bucket privato "hub-evento".
// Questa funzione fa tutti i controlli: le pagine statiche non hanno alcun potere da sole.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BUCKET = "hub-evento";
const ADMIN_PIN = Deno.env.get("ADMIN_PIN") || "";
const MAX_FILE_MB = Number(Deno.env.get("MAX_FILE_MB")) || 50;
const QUOTA_MB = Number(Deno.env.get("EVENT_QUOTA_MB")) || 200;
const RETENTION_DAYS = Number(Deno.env.get("RETENTION_DAYS")) || 30;
const ALLOWED_EXT = new Set(["pptx","ppt","pps","ppsx","key","pdf","doc","docx","xls","xlsx","txt","csv","mp4","mov","m4v","avi","mkv","wmv","webm","mp3","wav","m4a","aac","aif","aiff","flac","png","jpg","jpeg","gif","webp","zip"]);
const KINDS = ["presentazioni", "video", "musiche", "tappo", "altro", "programma"];
// il programma si vede nel browser: PDF, foto o un documento Word (che si scarica)
const PROG_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp", "gif", "doc", "docx"]);
const VIEWABLE = new Set(["pdf", "png", "jpg", "jpeg", "webp", "gif"]);
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-Z0-9]{4,12}$/;
const EDIT = new Set(["agenzia", "tecnico"]);
const CONTACT_ROLES = ["agenzia", "ospite", "tecnico"];
const INFO_DEFAULT: Record<string, string> = { indirizzo: "", mappa: "", montaggio: "", inizio: "", fine: "", referente: "", telefono: "", note: "" };
const isoOrEmpty = (v: unknown) => (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(String(v || "")) ? String(v) : "");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-pin, x-open, x-admin-pin",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-max-age": "86400",
};
const json = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const err = (code: number, msg: string) => json(code, { error: msg });
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

async function sha(s: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)))); }
async function safeEqual(a: string, b: string) {
  const x = await sha(a), y = await sha(b); let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function randBytes(n: number) { return crypto.getRandomValues(new Uint8Array(n)); }
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const tok = () => b64url(randBytes(16));
const pin6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
const today = () => new Date().toISOString().slice(0, 10);
function addDays(iso: string, n: number) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// limite ai tentativi sbagliati (per istanza: basta per una prova)
const fails = new Map<string, { n: number; until: number; t: number }>();
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "?").split(",")[0].trim();
const blocked = (ip: string) => { const r = fails.get(ip); return !!r && r.until > Date.now(); };
function noteFail(ip: string) {
  const r = fails.get(ip) || { n: 0, until: 0, t: Date.now() };
  if (Date.now() - r.t > 60_000) { r.n = 0; r.t = Date.now(); }
  r.n++; if (r.n >= 20) r.until = Date.now() + 5 * 60_000;
  fails.set(ip, r);
}

// deno-lint-ignore no-explicit-any
type Ev = any;
async function load(code: string): Promise<Ev | null> {
  const { data } = await sb.from("hub_events").select("data").eq("code", code).maybeSingle();
  return data ? data.data : null;
}
async function save(ev: Ev) { await sb.from("hub_events").upsert({ code: ev.code, data: ev, updated_at: new Date().toISOString() }); }
const eventBytes = (ev: Ev) => ev.files.reduce((n: number, f: Ev) => n + f.size, 0);
const isExpired = (ev: Ev) => ev.purged || today() > ev.expiresAt;
function logAdd(ev: Ev, role: string, action: string, detail = "") {
  ev.log.push({ at: new Date().toISOString(), role, action, detail: clip(detail, 120) });
  if (ev.log.length > 200) ev.log.splice(0, ev.log.length - 200);
}
async function purge(ev: Ev) {
  const { data } = await sb.storage.from(BUCKET).list(ev.code, { limit: 1000 });
  if (data?.length) await sb.storage.from(BUCKET).remove(data.map((f) => `${ev.code}/${f.name}`));
  ev.files = []; ev.purged = true; await save(ev);
}

function publicEvent(ev: Ev, role: string) {
  const pf = ev.files.find((f: Ev) => f.kind === "programma");
  const base: Ev = { code: ev.code, role, name: ev.name, date: ev.date, venue: ev.venue, program: ev.program, info: { ...INFO_DEFAULT, ...ev.info }, timerUrl: ev.timerUrl,
    programFile: pf ? { id: pf.id, name: pf.name, size: pf.size, at: pf.at } : null };
  if (EDIT.has(role)) {
    base.files = ev.files.map(({ id, kind, label, name, size, at }: Ev) => ({ id, kind, label, name, size, at }));
    base.usedBytes = eventBytes(ev); base.quotaBytes = QUOTA_MB * 1048576; base.maxFileBytes = MAX_FILE_MB * 1048576;
    base.links = { ospite: ev.tokens.ospite, agenzia: ev.tokens.agenzia, ...(role === "tecnico" ? { tecnico: ev.tokens.tecnico } : {}) };
    base.expiresAt = ev.expiresAt; base.log = ev.log.slice(-15).reverse();
    base.directUpload = true;
  }
  return base;
}

async function adminOk(req: Request, ip: string): Promise<Response | null> {
  if (blocked(ip)) return err(429, "Troppi tentativi. Riprova tra qualche minuto.");
  const given = req.headers.get("x-admin-pin") || "";
  let ok = false;
  if (ADMIN_PIN) ok = await safeEqual(given, ADMIN_PIN);
  else {
    const { data } = await sb.from("hub_config").select("value").eq("key", "admin_pin_sha256").maybeSingle();
    ok = !!data && given.length > 0 && await safeEqual(hex(await sha(given)), data.value);
  }
  if (!ok) { noteFail(ip); return err(401, "PIN non corretto."); }
  return null;
}
// deno-lint-ignore no-explicit-any
function cleanContacts(list: any) {
  // deno-lint-ignore no-explicit-any
  return (Array.isArray(list) ? list : []).slice(0, 30).map((c: any) => ({
    id: /^[a-f0-9]{8}$/.test(c?.id || "") ? c.id : hex(randBytes(4)),
    name: clip(c?.name, 80), agency: clip(c?.agency, 80).trim(), role: CONTACT_ROLES.includes(c?.role) ? c.role : "agenzia",
    email: clip(c?.email, 120).trim(), phone: clip(c?.phone, 30).replace(/[^\d+()\- ]/g, "").trim(),
    sentLink: isoOrEmpty(c?.sentLink), sentPin: isoOrEmpty(c?.sentPin),
    // deno-lint-ignore no-explicit-any
  })).filter((c: any) => c.name || c.email || c.phone);
}
async function readJson(req: Request) { try { return await req.json(); } catch { return {}; } }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/(functions\/v1\/)?hub-evento/, "") || "/";
    const ip = ipOf(req);

    const ce = /^\/events\/([A-Z0-9]+)$/.exec(path);
    if (ce && req.method === "PUT") { // contatti dell'evento: solo per noi
      const bad = await adminOk(req, ip); if (bad) return bad;
      const target = await load(ce[1]); if (!target) return err(404, "Evento non trovato.");
      const b = await readJson(req);
      target.contacts = cleanContacts(b.contacts); await save(target);
      return json(200, { contacts: target.contacts });
    }
    if (path === "/events" && (req.method === "GET" || req.method === "POST")) {
      const bad = await adminOk(req, ip); if (bad) return bad;
      if (req.method === "GET") {
        const { data } = await sb.from("hub_events").select("data");
        const all: Ev[] = (data || []).map((r) => r.data);
        for (const ev of all) if (!ev.purged && today() > ev.expiresAt) await purge(ev);
        const list = all.map((e) => ({ code: e.code, name: e.name, date: e.date, venue: e.venue, files: e.files.length, expiresAt: e.expiresAt, purged: !!e.purged, createdAt: e.createdAt, links: e.tokens, pins: e.pins, contacts: e.contacts || [], info: { ...INFO_DEFAULT, ...e.info } }))
          .sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
        return json(200, { events: list });
      }
      const b = await readJson(req);
      let code = "";
      for (let tries = 0; tries < 20; tries++) {
        code = ""; for (const x of randBytes(6)) code += CODE_ALPHABET[x % CODE_ALPHABET.length];
        if (!(await load(code))) break;
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : "";
      const ev: Ev = {
        code, name: clip(b.name, 120) || "Evento senza nome", date, venue: clip(b.venue, 160),
        program: "", info: { ...INFO_DEFAULT }, timerUrl: "",
        tokens: { agenzia: tok(), tecnico: tok(), ospite: tok() }, pins: { agenzia: pin6(), tecnico: pin6() }, files: [], log: [], contacts: [],
        createdAt: new Date().toISOString(), expiresAt: addDays(date || today(), date ? RETENTION_DAYS : 60), purged: false,
      };
      await save(ev);
      return json(201, { code, links: ev.tokens, pins: ev.pins, expiresAt: ev.expiresAt });
    }

    const m = /^\/e\/([A-Z0-9]+)(?:\/(.*))?$/.exec(path);
    if (!m || !CODE_RE.test(m[1])) return err(404, "Non trovato.");
    if (blocked(ip)) return err(429, "Troppi tentativi. Riprova tra qualche minuto.");
    const ev = await load(m[1]);
    let role: string | null = null;
    const bm = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
    if (ev && bm) for (const r of ["agenzia", "tecnico", "ospite"]) if (await safeEqual(bm[1], ev.tokens[r])) { role = r; break; }
    if (!ev || !role) { noteFail(ip); return err(401, "Link non valido o scaduto."); }
    if (role !== "ospite") {
      const p = req.headers.get("x-pin");
      if (!p) return json(401, { error: "Serve il PIN.", needPin: true });
      if (!(await safeEqual(p, ev.pins[role]))) { noteFail(ip); return json(401, { error: "PIN non corretto.", needPin: true }); }
    }
    if (isExpired(ev)) { if (!ev.purged) await purge(ev); return err(410, "Evento concluso: i materiali sono stati cancellati e il link non è più attivo."); }
    const rest = m[2] || "";

    if (rest === "" && req.method === "GET") {
      if (req.headers.get("x-open") === "1") { logAdd(ev, role, "apertura"); await save(ev); }
      return json(200, publicEvent(ev, role));
    }
    if (rest === "program-file" && req.method === "GET") {
      const rec = ev.files.find((f: Ev) => f.kind === "programma");
      if (!rec) return err(404, "Nessun file del programma.");
      const ext = (rec.name.split(".").pop() || "").toLowerCase();
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(`${ev.code}/${rec.id}`, 120, VIEWABLE.has(ext) ? undefined : { download: rec.name });
      if (error || !data) return err(404, "File non trovato.");
      logAdd(ev, role, "programma aperto", rec.name); await save(ev);
      return json(200, { url: data.signedUrl, name: rec.name });
    }
    if (!EDIT.has(role)) return err(403, "Questo link è in sola lettura.");

    if (rest === "" && req.method === "PUT") {
      const b = await readJson(req);
      if ("name" in b) ev.name = clip(b.name, 120) || ev.name;
      if ("date" in b) ev.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : "";
      if ("venue" in b) ev.venue = clip(b.venue, 160);
      if ("program" in b) ev.program = clip(b.program, 20000);
      if (role === "tecnico" && /^\d{4}-\d{2}-\d{2}$/.test(b.expiresAt || "")) { ev.expiresAt = b.expiresAt; logAdd(ev, role, "scadenza", b.expiresAt); }
      if ("timerUrl" in b) ev.timerUrl = /^https?:\/\//.test(b.timerUrl || "") ? clip(b.timerUrl, 300) : "";
      if (b.info && typeof b.info === "object") for (const k of Object.keys(INFO_DEFAULT)) if (k in b.info) ev.info[k] = k === "mappa" && b.info[k] && !/^https?:\/\//.test(String(b.info[k]).trim()) ? "" : clip(String(b.info[k]).trim(), k === "note" ? 2000 : k === "mappa" ? 400 : 160);
      await save(ev);
      return json(200, publicEvent(ev, role));
    }
    if (rest === "rotate" && req.method === "POST") {
      const b = await readJson(req);
      const allowed = role === "tecnico" ? ["ospite", "agenzia"] : ["ospite"];
      if (!allowed.includes(b.role)) return err(403, "Non puoi rigenerare questo link.");
      ev.tokens[b.role] = tok();
      let pin: string | undefined; if (b.role === "agenzia") { pin = pin6(); ev.pins.agenzia = pin; }
      logAdd(ev, role, "link rigenerato", b.role); await save(ev);
      return json(200, { ...publicEvent(ev, role), newPin: pin });
    }

    // caricamento in due passi: la funzione dà un indirizzo firmato, il browser invia il file direttamente allo Storage
    if (rest === "upload-url" && req.method === "POST") {
      const b = await readJson(req);
      const name = clip(String(b.name || "").split(/[\\/]/).pop(), 200) || "file";
      const ext = (name.split(".").pop() || "").toLowerCase();
      if (!name.includes(".") || !ALLOWED_EXT.has(ext)) return err(415, "Tipo di file non consentito: " + (name.includes(".") ? ext : "senza estensione") + ".");
      if (b.kind === "programma" && !PROG_EXT.has(ext)) return err(415, "Per il programma servono un PDF, una foto o un documento Word.");
      const size = Number(b.size) || 0;
      if (size > MAX_FILE_MB * 1048576) return err(413, `File troppo grande (massimo ${MAX_FILE_MB} MB in questa versione di prova).`);
      if (eventBytes(ev) + size > QUOTA_MB * 1048576) return err(413, "Spazio dell'evento esaurito.");
      const id = hex(randBytes(8));
      const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(`${ev.code}/${id}`);
      if (error || !data) return err(500, "Impossibile preparare il caricamento.");
      return json(200, { id, url: data.signedUrl });
    }
    if (rest === "upload-done" && req.method === "POST") {
      const b = await readJson(req);
      if (!/^[a-f0-9]{16}$/.test(b.id || "")) return err(400, "Richiesta non valida.");
      const name = clip(String(b.name || "").split(/[\\/]/).pop(), 200) || "file";
      const ext = (name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return err(415, "Tipo di file non consentito.");
      if (ev.files.some((f: Ev) => f.id === b.id)) return json(200, { ok: true });
      const { data: objs } = await sb.storage.from(BUCKET).list(ev.code, { search: b.id, limit: 5 });
      const obj = objs?.find((o) => o.name === b.id);
      if (!obj) return err(400, "Il file non è arrivato.");
      const size = Number(obj.metadata?.size ?? obj.metadata?.contentLength ?? 0);
      if (size > MAX_FILE_MB * 1048576 || eventBytes(ev) + size > QUOTA_MB * 1048576) {
        await sb.storage.from(BUCKET).remove([`${ev.code}/${b.id}`]);
        return err(413, "File troppo grande o spazio esaurito.");
      }
      const kind = KINDS.includes(b.kind) ? b.kind : "altro";
      if (kind === "programma") {
        if (!PROG_EXT.has(ext)) { await sb.storage.from(BUCKET).remove([`${ev.code}/${b.id}`]); return err(415, "Per il programma servono un PDF, una foto o un documento Word."); }
        const old = ev.files.filter((f: Ev) => f.kind === "programma");
        if (old.length) await sb.storage.from(BUCKET).remove(old.map((f: Ev) => `${ev.code}/${f.id}`));
        ev.files = ev.files.filter((f: Ev) => f.kind !== "programma");
      }
      const rec = { id: b.id, kind, label: clip(b.label, 120), name, size, at: new Date().toISOString() };
      ev.files.push(rec); logAdd(ev, role, kind === "programma" ? "programma caricato" : "caricato", name); await save(ev);
      return json(201, { file: rec });
    }

    const f = /^files\/([a-f0-9]{16})$/.exec(rest);
    if (f) {
      const i = ev.files.findIndex((x: Ev) => x.id === f[1]);
      if (i < 0) return err(404, "File non trovato.");
      const rec = ev.files[i];
      if (req.method === "DELETE") {
        await sb.storage.from(BUCKET).remove([`${ev.code}/${rec.id}`]);
        ev.files.splice(i, 1); logAdd(ev, role, "eliminato", rec.name); await save(ev);
        return json(200, { ok: true });
      }
      if (req.method === "GET") {
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(`${ev.code}/${rec.id}`, 120, { download: rec.name });
        if (error || !data) return err(404, "File non trovato.");
        logAdd(ev, role, "scaricato", rec.name); await save(ev);
        return json(200, { url: data.signedUrl, name: rec.name });
      }
    }
    return err(404, "Non trovato.");
  } catch (e) {
    console.error(e);
    return err(500, "Errore del server.");
  }
});
