// Back Road Europe, standalone: serves the game and its shared data. Node 18 or later, no other dependencies.
//   npm run build && npm start        (PORT=8080, DB_PATH=server/db.json, OWNER_IDS=u_a,u_b optional)
//
// What it adds over the artifact version:
// - Anyone with the link can play and post to the tables; accounts are kept on the device with a token.
// - The server keeps the clock: it starts each prompt, records each answer when it arrives, and refuses late ones.
// - It judges each typed answer and works out the points itself, from its own copy of the game code (dist/engine.js),
//   so a modified page can't post a better score. Results it didn't see played count as "played later".
// - Today's answers are never sent to other players until the route closes; future scheduled prompts are sent only to the owner.
// - Rarity is counted from every checked answer on earlier routes, frozen once per day so everyone is scored the same way.
// - Leagues with join codes, a live room for duels, and a calendar reminder (api/reminder.ics).
// The first account created is the owner (missing-answer log and prompt scheduling), unless OWNER_IDS says otherwise.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +(process.env.PORT || 8080);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "server/db.json");
const OWNER_IDS = (process.env.OWNER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const GRACE_MS = 2000; // network slack on top of the time limit
const SECS = { std: 25, extra: 50, none: 0 };
const SHOW_DAYS = 35; // how far back the tables reach
const KEEP_DAYS = 400;

/* ---------- the game's own code: data, matching, dealing, scoring ---------- */
function loadEngine() {
  const ctx = vm.createContext({ matchMedia: () => ({ matches: false }), document: {}, window: {}, location: {}, navigator: {}, TextEncoder, TextDecoder, console, ENGINE: null });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "dist/engine.js"), "utf8"), ctx, { filename: "engine.js" });
  return ctx.ENGINE;
}
const E = loadEngine();
const today = () => E.cetNow(Date.now()).day;

/* ---------- storage: one JSON file, written atomically ---------- */
let db = { users: {}, tokens: {}, state: {}, results: {}, runs: {}, rarity: {}, misses: {}, bank: {}, leagues: {}, rev: 0 };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, "utf8")) }; }
catch (e) { if (e.code !== "ENOENT") { console.error(`Can't read ${DB_PATH}: ${e.message}. Fix or move it; not starting, so it isn't overwritten.`); process.exit(1); } }
let saveTimer = 0;
function flush() { clearTimeout(saveTimer); saveTimer = 0; fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); fs.writeFileSync(DB_PATH + ".tmp", JSON.stringify(db)); fs.renameSync(DB_PATH + ".tmp", DB_PATH); }
const save = () => { if (!saveTimer) saveTimer = setTimeout(flush, 300); };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { if (saveTimer) flush(); process.exit(0); });

function syncBank() { // owner-scheduled prompts join the engine's prompt list
  for (const b of Object.values(db.bank)) { E.EXTRA.set(b.id, { id: b.id, c: b.c, k: "hand", q: b.q, h: b.h, it: b.it, tag: b.tag || [] }); E.CACHE.delete(b.id); E.MAPS.delete(b.id); }
  E.RARITY_CACHE.clear();
}
syncBank();
const overrides = () => Object.values(db.bank).filter(b => b.day && b.id).map(b => ({ id: b.id, c: b.c, day: b.day }));
const officialRoute = day => E.dayRoute(day, overrides());

/* ---------- rarity: checked answers from earlier routes ---------- */
function countAnswers(day, pids) {
  const want = new Set(pids), out = {};
  for (const days of Object.values(db.results)) for (const [d, e] of Object.entries(days)) {
    if (+d >= day || !e.verified || !e.ans || !e.pids) continue;
    e.pids.forEach((pid, i) => { const k = e.ans[i]; if (!want.has(pid) || k == null || k < 0) return; const s = out[pid] = out[pid] || { N: 0, c: {} }; s.N++; s.c[k] = (s.c[k] || 0) + 1; });
  }
  for (const p of pids) out[p] = out[p] || { N: 0, c: {} };
  return out;
}
function frozenRarity(day, pids) { // the first request each day fixes the counts for that day
  if (day > today()) return countAnswers(day, pids); // today's answers are still coming in
  const snap = db.rarity[day] = db.rarity[day] || {}, missing = pids.filter(p => !snap[p]);
  if (missing.length) { Object.assign(snap, countAnswers(day, missing)); save(); }
  return Object.fromEntries(pids.map(p => [p, snap[p]]));
}
function scoreRun(run) {
  const s = E.summarise({ pids: run.pids, ans: run.ans.map((k, i) => ({ k, ms: run.ms[i] })), rare: frozenRarity(run.day, run.pids) });
  return { pts: s.pts, tiers: s.tiers, ms: s.ms };
}

/* ---------- what others may see ---------- */
function publicResults(me) {
  const now = today(), from = now - SHOW_DAYS;
  const out = [];
  for (const [id, days] of Object.entries(db.results)) {
    const recent = Object.entries(days).filter(([d]) => +d >= from);
    if (!recent.length) continue;
    out.push({ id, name: (db.users[id] || {}).name || "", days: Object.fromEntries(recent.map(([d, e]) => [d, { ...e, ans: +d < now || id === me.id ? e.ans : null }])) });
  }
  return out;
}
const bankFor = me => Object.values(db.bank).filter(b => me.owner || !b.day || b.day <= today());
function weekStart(day) { return day - ((new Date(day * 864e5).getUTCDay() + 6) % 7); }
function leagueTable(L) {
  const from = weekStart(today());
  return L.members.map(id => {
    const mine = Object.entries(db.results[id] || {}).filter(([d, e]) => +d >= from && !e.late);
    return { id, name: (db.users[id] || {}).name || "", pts: mine.reduce((s, [, e]) => s + e.pts, 0), n: mine.length };
  }).sort((a, b) => b.pts - a.pts);
}

/* ---------- live room for duels, by polling; kept in memory ---------- */
const presence = new Map();

/* ---------- calendar reminder ---------- */
function ics(base, hour) {
  const d = new Date(today() * 864e5).toISOString().slice(0, 10).replace(/-/g, ""), hh = String(hour).padStart(2, "0");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Back Road Europe//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:daily-route-" + hh + "@back-road-europe", "DTSTAMP:" + stamp, `DTSTART;TZID=Europe/Berlin:${d}T${hh}0000`, "DURATION:PT10M", "RRULE:FREQ=DAILY",
    "SUMMARY:Back Road Europe", "DESCRIPTION:Today's route is ready: seven new prompts. " + base, "URL:" + base,
    "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", "DESCRIPTION:Today's route is ready", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

/* ---------- housekeeping ---------- */
function prune() {
  const now = today();
  for (const k of Object.keys(db.runs)) if (db.runs[k].day < now - 2) delete db.runs[k];
  for (const d of Object.keys(db.rarity)) if (+d < now - 130) delete db.rarity[d];
  for (const days of Object.values(db.results)) for (const d of Object.keys(days)) if (+d < now - KEEP_DAYS) delete days[d];
  save();
}
prune(); setInterval(prune, 3600e3).unref();

/* ---------- HTTP ---------- */
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
let pageCache = null;
function page() {
  if (!pageCache) {
    const html = fs.readFileSync(path.join(ROOT, "dist/index.html"), "utf8");
    pageCache = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script>window.BRE_SERVER=1</script><style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${html}</body></html>`;
  }
  return pageCache;
}
const SEC_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...SEC_HEADERS, ...extra }); res.end(body === undefined ? "" : JSON.stringify(body)); };
const readBody = (req, max = 300000) => new Promise((ok, bad) => {
  let s = "";
  req.setEncoding("utf8");
  req.on("data", c => { s += c; if (s.length > max) { bad(Object.assign(new Error("too big"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(Object.assign(new Error("bad json"), { status: 400 })); } });
  req.on("error", bad);
});
const hits = new Map();
function limited(key, max, windowMs) { const t = Date.now(), list = (hits.get(key) || []).filter(x => t - x < windowMs); list.push(t); hits.set(key, list); return list.length > max; }
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 3600e3) hits.delete(k); }, 600e3).unref();
const userOf = req => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ""); return m && db.tokens[m[1]] ? db.users[db.tokens[m[1]]] : null; };
const clean = (s, n = 20) => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, n);
const isPid = id => typeof id === "string" && id.length <= 40 && !!E.getPrompt(id);

async function handle(req, res) {
  const url = new URL(req.url, "http://x"), p = url.pathname, ip = req.socket.remoteAddress || "";
  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "no-cache", ...SEC_HEADERS });
    return res.end(page());
  }
  if (p === "/healthz") return json(res, 200, { ok: true, day: today() });
  if (p === "/favicon.ico") { res.writeHead(204); return res.end(); }
  if (!p.startsWith("/api/")) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
  const route = p.slice(5);
  if (limited("ip:" + ip, 400, 10000)) return json(res, 429, { error: "slow down" });

  if (route === "hello") return json(res, 200, { now: Date.now(), day: today() });
  if (route === "reminder.ics") {
    const hour = Math.min(22, Math.max(5, Math.round(+url.searchParams.get("h") || 9)));
    const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0], base = `${proto}://${req.headers.host}/`;
    res.writeHead(200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": "attachment; filename=back-road-europe.ics", ...SEC_HEADERS });
    return res.end(ics(base, hour));
  }
  const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : {};

  if (route === "login" && req.method === "POST") {
    let id = typeof body.token === "string" && db.tokens[body.token];
    if (!id) {
      if (limited("new:" + ip, 30, 3600e3)) return json(res, 429, { error: "too many new accounts" });
      id = "u_" + crypto.randomBytes(9).toString("base64url");
      const token = crypto.randomBytes(24).toString("base64url");
      const first = !Object.keys(db.users).length && !OWNER_IDS.length;
      db.tokens[token] = id; db.users[id] = { id, name: clean(body.name), token, owner: first, at: Date.now() };
      if (first) console.log(`Owner account created: ${id}`);
      save();
    }
    const u = db.users[id];
    if (body.name && clean(body.name) !== u.name) { u.name = clean(body.name); db.rev++; save(); }
    return json(res, 200, { id, token: u.token, name: u.name, owner: !!u.owner || OWNER_IDS.includes(id) });
  }

  const me = userOf(req);
  if (!me) return json(res, 401, { error: "sign in first" });
  me.owner = !!me.owner || OWNER_IDS.includes(me.id);
  if (limited("u:" + me.id, 100, 10000)) return json(res, 429, { error: "slow down" });

  if (route === "state") {
    if (req.method === "GET") return json(res, 200, db.state[me.id] || null);
    if (req.method === "PUT") { db.state[me.id] = body; save(); return json(res, 204); }
  }

  // Today's route, one prompt at a time: the server starts each clock and records each answer as it arrives.
  if (route === "start" && req.method === "POST") {
    const day = +body.day, idx = +body.idx;
    if (day !== today()) return json(res, 409, { error: "not today's route" });
    const key = me.id + "|" + day;
    const run = db.runs[key] = db.runs[key] || { day, pids: officialRoute(day), mode: body.mode in SECS ? body.mode : "std", ans: [], ms: [], at: [] };
    if (!(idx >= 0 && idx < run.pids.length) || idx !== run.ans.length) return json(res, 409, { error: idx < run.ans.length ? "already answered" : "out of order", pids: run.pids, done: run.ans.length });
    if (!run.at[idx]) { run.at[idx] = Date.now(); save(); }
    const secs = SECS[run.mode];
    return json(res, 200, { deadline: secs ? run.at[idx] + secs * 1000 : 0, pids: run.pids, mode: run.mode });
  }
  if (route === "answer" && req.method === "POST") {
    const day = +body.day, idx = +body.idx, run = db.runs[me.id + "|" + day];
    if (!run || !run.at[idx] || idx !== run.ans.length) return json(res, 409, { error: "not started" });
    const secs = SECS[run.mode], ms = Date.now() - run.at[idx];
    if (body.timeout || (secs && ms > secs * 1000 + GRACE_MS)) {
      run.ans[idx] = -1; run.ms[idx] = secs ? secs * 1000 : ms; save();
      return json(res, 200, { ok: false, k: -1, late: true });
    }
    const P = E.getPrompt(run.pids[idx]);
    const used = new Set(run.ans.map((k, i) => { const Q = E.getPrompt(run.pids[i]); return k >= 0 && Q ? E.usedKey(Q, Q.items[k]) : null; }).filter(Boolean));
    const v = E.judge(P, clean(body.text, 80), used);
    if (!v.ok) return json(res, 422, { ok: false });
    run.ans[idx] = v.idx; run.ms[idx] = ms; save();
    return json(res, 200, { ok: true, k: v.idx, ms });
  }
  if (route === "result" && req.method === "POST") {
    const day = +body.day, mine = db.results[me.id] = db.results[me.id] || {}, had = mine[day];
    if (!(day >= 0 && day <= today())) return json(res, 400, { error: "bad day" });
    const run = db.runs[me.id + "|" + day];
    if (run && run.ans.length === run.pids.length) {
      if (had && had.verified) return json(res, 409, { error: "already played" });
      const s = scoreRun(run);
      mine[day] = { ...s, mode: run.mode, late: false, pids: run.pids, ans: run.ans, verified: true, at: Date.now() };
    } else {
      // Not seen played here (an earlier route, or the connection dropped): kept, but as "played later", outside the tables.
      if (had) return json(res, 409, { error: "already played" });
      const pids = Array.isArray(body.pids) ? body.pids.filter(isPid).slice(0, 10) : [];
      const ans = day < today() && Array.isArray(body.ans) ? body.ans.slice(0, pids.length).map(k => Number.isInteger(k) && k >= -1 && k < 1000 ? k : -1) : null;
      mine[day] = { pts: Math.max(0, Math.min(700, Math.round(+body.pts) || 0)), tiers: String(body.tiers || "").replace(/[^0-5]/g, "").slice(0, 7), ms: Math.max(0, +body.ms || 0),
        mode: body.mode in SECS ? body.mode : "std", late: true, pids, ans, verified: false, at: Date.now() };
    }
    db.rev++; save();
    const e = mine[day];
    return json(res, 200, { pts: e.pts, tiers: e.tiers, verified: e.verified, late: e.late });
  }
  if (route === "reveal") return json(res, 204); // answers show by themselves once a route closes
  if (route === "results" && req.method === "GET") {
    const tag = `W/"${db.rev}-${today()}-${me.id}-${Object.keys(db.bank).length}"`;
    if (req.headers["if-none-match"] === tag) { res.writeHead(304, { etag: tag }); return res.end(); }
    return json(res, 200, { results: publicResults(me), bank: bankFor(me) }, { "cache-control": "no-cache", etag: tag });
  }
  if (route === "rarity" && req.method === "GET") {
    const day = +url.searchParams.get("day"), pids = (url.searchParams.get("pids") || "").split(",").filter(isPid).slice(0, 10);
    if (!(day >= 0 && day <= today() + 1)) return json(res, 400, { error: "bad day" });
    return json(res, 200, frozenRarity(day, pids));
  }
  if (route === "miss" && req.method === "POST") {
    const m = db.misses[me.id] = db.misses[me.id] || { items: {} };
    for (const [pid, list] of Object.entries(body.batch || {}).slice(0, 20)) if (isPid(pid) && Array.isArray(list)) m.items[pid] = [...new Set([...(m.items[pid] || []), ...list.map(s => clean(s, 60)).filter(Boolean)])].slice(-30);
    m.at = Date.now(); save(); return json(res, 204);
  }
  if (route === "misses" && req.method === "GET") return me.owner ? json(res, 200, Object.values(db.misses)) : json(res, 403, { error: "owner only" });
  if (route === "bank" && req.method === "POST") {
    if (!me.owner) return json(res, 403, { error: "owner only" });
    const b = body;
    if (!/^[a-z0-9_-]{1,40}$/i.test(b.id || "") || !["countries", "places", "food", "sport", "history", "culture", "nature", "life"].includes(b.c) || !Array.isArray(b.it) || b.it.length < 4 || b.it.length > 400)
      return json(res, 400, { error: "bad prompt" });
    db.bank[b.id] = { id: b.id, day: Number.isInteger(b.day) ? b.day : null, c: b.c, k: "hand", q: clean(b.q, 200), h: clean(b.h, 60), it: b.it, tag: [] };
    syncBank(); db.rev++; save(); return json(res, 204);
  }
  if (route.startsWith("bank/") && req.method === "DELETE") {
    if (!me.owner) return json(res, 403, { error: "owner only" });
    delete db.bank[decodeURIComponent(route.slice(5))]; syncBank(); db.rev++; save(); return json(res, 204);
  }
  if (route === "leagues" && req.method === "GET") return json(res, 200, Object.values(db.leagues).filter(L => L.members.includes(me.id)).map(L => ({ name: L.name, code: L.code, table: leagueTable(L) })));
  if (route === "leagues" && req.method === "POST") {
    if (Object.values(db.leagues).filter(L => L.by === me.id).length >= 20) return json(res, 429, { error: "too many leagues" });
    const code = crypto.randomBytes(4).toString("hex");
    db.leagues[code] = { code, name: clean(body.name, 30) || "League", by: me.id, members: [me.id] }; save();
    return json(res, 200, { code });
  }
  if (route === "leagues/join" && req.method === "POST") {
    const L = db.leagues[String(body.code || "").trim().toLowerCase()];
    if (!L) return json(res, 404, { error: "no such league" });
    if (!L.members.includes(me.id)) { if (L.members.length >= 500) return json(res, 409, { error: "league full" }); L.members.push(me.id); save(); }
    return json(res, 204);
  }
  if (route === "room" && req.method === "POST") {
    const raw = JSON.stringify(body.presence || {});
    presence.set(me.id, { at: Date.now(), presence: raw.length < 2000 ? body.presence || {} : {} });
    const t = Date.now(), peers = [];
    for (const [id, v] of presence) { if (t - v.at > 8000) { presence.delete(id); continue; } peers.push({ peer: "peer-" + id, by: id, isMe: id === me.id, sameTab: id === me.id, presence: v.presence, kind: "viewer", guest: false }); }
    return json(res, 200, { peers: peers.slice(-60) });
  }
  json(res, 404, { error: "no such route" });
}

const server = http.createServer((req, res) => handle(req, res).catch(e => { if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : "server error" }); if (!e.status) console.error(e); }));
server.listen(PORT, () => console.log(`Back Road Europe on http://localhost:${PORT} (data in ${DB_PATH})`));
