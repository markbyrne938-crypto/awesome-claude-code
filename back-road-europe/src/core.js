/* ================= core: data, matching, scoring, dealing, codes ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DAY1 = Math.round(Date.UTC(2026, 10, 16) / 864e5); // route #1
const ARTIFACT_URL = "https://claude.ai/artifact/EsbgvNTWy4JKpAfLM8U9Ep";
const SECS = { std: 25, extra: 50, none: 0 };
const SLOTS = ["countries", "places", "food", "sport", "history", "culture", "science"];
let clockSkew = 0; // server mode: server time minus ours
const now = () => Date.now() + clockSkew;

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function km(a, b) {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// The calendar day in Central European time, and seconds left until the next route.
function cetNow(at = now()) {
  const o = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(at)).forEach(p => o[p.type] = +p.value);
  return { day: Math.round(Date.UTC(o.year, o.month - 1, o.day) / 864e5), left: 86400 - (o.hour * 3600 + o.minute * 60 + o.second) };
}
const routeNo = day => day - DAY1 + 1;
const dayDate = day => new Date(day * 864e5);
const hms = s => [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, "0")).join(":");

// Lambert conformal conic, matching the build's map.
function project(lat, lon) {
  const P = D.map.proj, rad = Math.PI / 180, l = (lon - P.rot) * rad, r = P.f / Math.pow(Math.tan((Math.PI / 2 + lat * rad) / 2), P.n);
  return [P.k * r * Math.sin(P.n * l) + P.tx, P.ty - P.k * (P.f - r * Math.cos(P.n * l))];
}

/* ---------- countries ---------- */
const C = {};
for (const c of D.countries) { const [x, y] = project(c.lat, c.lon); C[c.id] = { ...c, x, y }; }
const countryName = id => !id ? "" : (C[id] && ((C[id].loc && C[id].loc[LANG]) || C[id].n)) || id;
const capitalName = id => C[id] ? C[id].cap : id;

/* ---------- prompts ---------- */
const PROMPT_INDEX = new Map(D.prompts.map((p, i) => [p.id, i]));
const EXTRA = new Map(); // prompts added by the owner, from shared storage
const CACHE = new Map();
const catOf = p => p.c === "nature" || p.c === "life" ? "science" : p.c;
function getPrompt(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  const raw = PROMPT_INDEX.has(id) ? D.prompts[PROMPT_INDEX.get(id)] : EXTRA.get(id);
  if (!raw) return null;
  const P = { id, cat: catOf(raw), kind: raw.k, q: raw.q, h: raw.h, t: raw.t, tags: raw.tag || [], items: [], near: [] };
  if (raw.k === "c" || raw.k === "k") {
    for (const cc of raw.it) {
      const c = C[cc];
      P.items.push(raw.k === "c"
        ? { label: c.n, alts: [...c.alt, ...c.nat, ...Object.values(c.loc || {})], fame: c.f, cc, lat: c.lat, lon: c.lon, at: c.cap }
        : { label: c.cap, alts: c.capAlt, fame: c.f, cc, lat: c.lat, lon: c.lon, at: "" });
    }
  } else if (raw.k === "city") {
    for (const [pi, fame] of raw.it) {
      const p = D.places[pi];
      P.items.push({ label: p[0], alts: p[5] ? p[5].split("|") : [], fame, cc: p[1], lat: p[2], lon: p[3], pop: p[4], at: "" });
    }
    P.near = (raw.nm || "").split("|").filter(Boolean).map(s => { const [names, pop] = s.split("~"); const all = names.split("/"); return { label: all[0], alts: all.slice(1), pop: +pop }; });
    P.region = raw.t;
  } else {
    for (const it of raw.it) {
      const [label, alts, fame, cc, lat, lon, at] = it;
      P.items.push({ label, alts: alts ? String(alts).split("|") : [], fame: +fame || 1, cc: cc || "", lat: lat ?? null, lon: lon ?? null, at: at || "" });
    }
  }
  for (const it of P.items) if (it.lat != null) [it.x, it.y] = project(it.lat, it.lon);
  CACHE.set(id, P);
  return P;
}
const CATEGORY = {};
for (const p of D.prompts) (CATEGORY[catOf(p)] = CATEGORY[catOf(p)] || []).push(p.id);
for (const k in CATEGORY) CATEGORY[k].sort();

/* ---------- matching ---------- */
const MAPS = new Map();
function promptMap(P) {
  if (MAPS.has(P.id)) return MAPS.get(P.id);
  const m = new Map();
  P.items.forEach((it, i) => { for (const n of [it.label, ...it.alts]) for (const k of keysOf(n)) if (!m.has(k)) m.set(k, i); });
  MAPS.set(P.id, m); return m;
}
let GLOBAL = null;
function globalDict() {
  if (GLOBAL) return GLOBAL;
  const m = new Map(), put = (name, e) => { for (const k of keysOf(name)) if (!m.has(k)) m.set(k, e); };
  for (const c of D.countries) for (const n of [c.n, ...c.alt, ...c.nat, ...Object.values(c.loc || {})]) put(n, { t: "country", id: c.id, name: c.n });
  for (const c of D.countries) for (const n of [c.cap, ...c.capAlt]) put(n, { t: "capital", id: c.id, name: c.cap });
  for (const [n, id] of Object.entries(D.parts)) put(n, { t: "part", id, name: n });
  for (const [n, of] of Object.entries(D.partCaps)) put(n, { t: "partcap", of, name: n });
  for (const [k, v] of Object.entries(D.world)) if (!m.has(k)) { const [cc, name] = v.split("|"); m.set(k, { t: "world", cc, name }); }
  D.places.forEach((p, i) => { for (const n of [p[0], ...(p[5] ? p[5].split("|") : [])]) put(n, { t: "place", i, name: p[0], cc: p[1], pop: p[4] }); });
  GLOBAL = m; return m;
}
function firstHit(map, keys) { for (const k of keys) if (map.has(k)) return map.get(k); return undefined; }
// Closest name within the typo allowance; null if nothing is close or two different things are equally close.
function fuzzy(key, sources) {
  const max = slack(key.length);
  if (!max) return null;
  let best = null, bestD = max + 1, tie = false;
  for (const [map, tag] of sources) for (const [k, v] of map) {
    if (Math.abs(k.length - key.length) > max) continue;
    if (k[0] !== key[0] && !(k[0] === key[1] && k[1] === key[0])) continue;
    const d = osa(key, k, max);
    if (d < bestD) { bestD = d; best = { tag, v, k }; tie = false; }
    else if (d === bestD && best && (best.tag !== tag || JSON.stringify(best.v) !== JSON.stringify(v))) tie = true;
  }
  return best && !tie ? best : null;
}
const isCountryPrompt = P => P.kind === "c" || (P.kind === "hand" && /country/i.test(P.h || ""));
// Decide what a typed answer means for this prompt. used: item keys already scored on this route.
function judge(P, text, used) {
  const keys = keysOf(text);
  if (!keys.length) return { ok: false, msg: "" };
  const pm = promptMap(P), g = globalDict();
  let idx = firstHit(pm, keys), gh = idx === undefined ? firstHit(g, keys) : undefined, typo = false, note = "";
  if (idx === undefined && gh === undefined) {
    const f = fuzzy(fold(keys[0]), [[pm, "p"], [g, "g"]]) || fuzzy(keys[0], [[pm, "p"], [g, "g"]]);
    if (f && f.tag === "p") { idx = f.v; typo = true; } else if (f) { gh = f.v; typo = true; }
  }
  const nm = s => `“${s}”`;
  if (idx === undefined && gh) {
    const hasCC = cc => P.items.findIndex(it => it.cc === cc && (P.kind !== "hand" || norm(it.label) === norm(C[cc].n)));
    if (gh.t === "part" && isCountryPrompt(P)) {
      const i = hasCC(gh.id);
      if (i >= 0) { idx = i; note = t("countedAs", { x: gh.name, c: countryName(gh.id) }); }
      else return { ok: false, msg: t("partOf", { x: gh.name, c: countryName(gh.id) }), miss: P.kind === "hand" };
    } else if (gh.t === "world") {
      return { ok: false, msg: D.notes[gh.cc] || t("notEurope", { x: gh.name }), miss: P.kind === "hand" };
    } else if (P.kind === "c") {
      if (gh.t === "country") return { ok: false, msg: t("noFit", { x: countryName(gh.id) }) };
      if (gh.t === "capital") return { ok: false, msg: t("isCapital", { x: gh.name, c: countryName(gh.id) }) };
      if (gh.t === "partcap") return { ok: false, msg: t("partCap", { x: gh.name, p: gh.of }) };
      if (gh.t === "place") return { ok: false, msg: t("isTown", { x: gh.name, c: countryName(gh.cc) }) };
    } else if (P.kind === "k") {
      if (gh.t === "capital") return { ok: false, msg: t("noFit", { x: gh.name }) };
      if (gh.t === "country") return { ok: false, msg: t("isCountry", { x: countryName(gh.id) }) };
      if (gh.t === "partcap") return { ok: false, msg: t("partCap", { x: gh.name, p: gh.of }) };
      if (gh.t === "part") return { ok: false, msg: t("partOf", { x: gh.name, c: countryName(gh.id) }) };
      if (gh.t === "place") return { ok: false, msg: t("isTownK", { x: gh.name, c: countryName(gh.cc) }) };
    } else if (P.kind === "city") {
      const near = P.near.find(n => [n.label, ...n.alts].some(a => keysOf(a).some(k => keys.includes(k))));
      if (near) return { ok: false, msg: t("tooSmall", { x: near.label, n: fmtN(near.pop), t: fmtN(P.region.n) }) };
      if (gh.t === "place") return { ok: false, msg: t("elsewhere", { x: gh.name, c: countryName(gh.cc) }), miss: true };
      if (gh.t === "country" || gh.t === "part") return { ok: false, msg: t("nameTown") };
      if (gh.t === "capital") return { ok: false, msg: t("elsewhere", { x: gh.name, c: countryName(gh.id) }), miss: true };
    } else if (isCountryPrompt(P) && gh.t === "country") {
      return { ok: false, msg: t("noFit", { x: countryName(gh.id) }), miss: true };
    }
  }
  if (idx === undefined && P.kind === "city") {
    const near = P.near.find(n => [n.label, ...n.alts].some(a => keysOf(a).some(k => keys.includes(k))));
    if (near) return { ok: false, msg: t("tooSmall", { x: near.label, n: fmtN(near.pop), t: fmtN(P.region.n) }) };
  }
  if (idx === undefined) return { ok: false, msg: t("notListed"), miss: true };
  const it = P.items[idx];
  const key = usedKey(P, it);
  if (used && used.has(key)) return { ok: false, msg: t(P.kind === "c" || P.kind === "k" ? "usedCountry" : "used", { x: P.kind === "k" ? it.label : P.kind === "c" ? countryName(it.cc) : it.label }) };
  if (typo && !note) note = t("readAs", { x: it.label });
  return { ok: true, idx, note };
}
// Countries and capitals share one key: once you've used France you can't come back with Paris.
const usedKey = (P, it) => P.kind === "c" || P.kind === "k" ? "cc:" + it.cc : "a:" + norm(it.label);

/* ---------- rarity and points ---------- */
// Prior share of players giving each answer: fame squared. Real answers from earlier routes pull it towards what people said.
function shares(P, snap) {
  const w = P.items.map(it => it.fame * it.fame), sum = w.reduce((a, b) => a + b, 0) || 1;
  const prior = w.map(v => v / sum);
  const s = snap && snap[P.id];
  if (!s || !s.N) return { q: prior, real: false, N: 0 };
  const K = 30;
  return { q: prior.map((p, i) => ((s.c[i] || 0) + K * p) / (s.N + K)), real: s.N >= 30, N: s.N, counts: s.c };
}
const RARITY_CACHE = new Map();
function pointsTable(P, snap) {
  const ck = P.id + "|" + JSON.stringify(snap && snap[P.id] || 0);
  if (RARITY_CACHE.has(ck)) return RARITY_CACHE.get(ck);
  const { q, real, N, counts } = shares(P, snap), n = q.length;
  const order = q.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const rank = new Array(n);
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && Math.abs(order[j + 1][0] - order[i][0]) < 1e-12) j++; const mid = (i + j) / 2; for (let k = i; k <= j; k++) rank[order[k][1]] = n > 1 ? mid / (n - 1) : 1; i = j + 1; }
  const hi = 0.30, lo = 0.004;
  const pts = q.map((v, i) => { const abs = clamp(Math.log(hi / v) / Math.log(hi / lo), 0, 1); return Math.round(15 + 85 * (0.6 * abs + 0.4 * rank[i])); });
  const out = { q, pts, real, N, counts };
  RARITY_CACHE.set(ck, out); return out;
}
const TIERS = ["none", "motorway", "main", "country", "back", "track"];
const tierOf = pts => pts == null || pts < 0 ? 0 : pts >= 95 ? 5 : pts >= 80 ? 4 : pts >= 60 ? 3 : pts >= 35 ? 2 : 1;

/* ---------- dealing ---------- */
function conflicts(P, chosen) { return chosen.some(o => o.tags.some(tg => P.tags.includes(tg) && tg !== "towns")); }
// Each slot cycles through its own shuffled list, so nothing in a slot repeats until the whole slot has been used.
function dayRoute(day, overrides = []) {
  const d = day - DAY1, chosen = [];
  for (const slot of SLOTS) {
    const own = overrides.find(o => catOf({ c: o.c }) === slot && o.day === day);
    if (own && getPrompt(own.id)) { chosen.push(getPrompt(own.id)); continue; }
    const ids = CATEGORY[slot] || [], n = ids.length;
    if (!n) continue;
    const cycle = Math.floor(Math.max(0, d) / n), pos = ((d % n) + n) % n;
    const perm = shuffle(ids, rng(hashStr(slot) ^ (cycle * 7919 + 17)));
    let pick = null;
    for (let j = 0; j < n && !pick; j++) { const P = getPrompt(perm[(pos + j) % n]); if (P && !conflicts(P, chosen)) pick = P; }
    if (pick) chosen.push(pick);
  }
  return order7(chosen, day).map(P => P.id);
}
function practiceRoute(seed) {
  const r = rng(seed), chosen = [];
  for (const slot of SLOTS) {
    const ids = shuffle(CATEGORY[slot] || [], r);
    const P = ids.map(getPrompt).find(P => P && !conflicts(P, chosen));
    if (P) chosen.push(P);
  }
  return order7(chosen, seed).map(P => P.id);
}
// Mixed order each day, but countries never first: the first stop teaches the format best with a hand-written prompt.
function order7(list, seed) {
  const out = shuffle(list, rng(hashStr("order") ^ seed));
  if (out[0] && out[0].cat === "countries" && out.length > 1) out.push(out.shift());
  return out;
}

/* ---------- result codes and challenge links ---------- */
// c2-<D|P><day or seed>-<mode>-<prompt ids>-<answers>-<times>-<name>-<check>; letters, digits and hyphens only.
const B36 = n => Math.max(0, Math.round(n)).toString(36);
function nameTo36(s) { return Array.from(new TextEncoder().encode(String(s || "").slice(0, 20))).map(b => b.toString(36).padStart(2, "0")).join(""); }
function nameFrom36(s) { try { const b = (s.match(/../g) || []).map(x => parseInt(x, 36)); return new TextDecoder().decode(new Uint8Array(b)); } catch { return ""; } }
function makeCode(run, name) {
  const head = (run.type === "daily" || run.type === "archive" ? "D" + B36(run.day) : "P" + B36(run.seed)) + "-" + (run.mode || "std")[0];
  const ids = run.pids.map(id => id.padStart(7, "0")).join("");
  const ans = run.ans.map(a => a.k < 0 ? "zz" : B36(a.k).padStart(2, "0")).join("");
  const ms = run.ans.map(a => B36(Math.min(1295, Math.round((a.ms || 0) / 100))).padStart(2, "0")).join("");
  const body = ["c2", head, ids, ans, ms, nameTo36(name) || "0"].join("-");
  return body + "-" + (hashStr(body) % 1679616).toString(36).padStart(4, "0");
}
function parseCode(text) {
  const m = /c2-([DP])([0-9a-z]+)-([sen])-([0-9a-z]{7,})-([0-9a-z]{2,})-([0-9a-z]{2,})-([0-9a-z]+)-([0-9a-z]{4})/i.exec(String(text || ""));
  if (!m) return null;
  const body = m[0].slice(0, m[0].lastIndexOf("-"));
  const ok = (hashStr(body.toLowerCase()) % 1679616).toString(36).padStart(4, "0") === m[8].toLowerCase();
  const pids = m[4].toLowerCase().match(/.{7}/g).map(s => s.replace(/^0+(?=.)/, ""));
  const n = pids.length, ans = m[5].toLowerCase().match(/../g), ms = m[6].toLowerCase().match(/../g);
  if (!ans || ans.length !== n || !ms || ms.length !== n) return null;
  return { type: m[1].toUpperCase() === "D" ? "daily" : "practice", day: m[1].toUpperCase() === "D" ? parseInt(m[2], 36) : null, seed: m[1].toUpperCase() === "P" ? parseInt(m[2], 36) : null,
    mode: { s: "std", e: "extra", n: "none" }[m[3].toLowerCase()], pids, ans: ans.map((a, i) => ({ k: a === "zz" ? -1 : parseInt(a, 36), ms: parseInt(ms[i], 36) * 100 })),
    name: m[7] === "0" ? "" : nameFrom36(m[7].toLowerCase()), verified: ok, code: m[0] };
}
const shareLink = code => (window.BRE_SERVER ? location.origin + location.pathname : ARTIFACT_URL) + "#" + code;

/* ---------- a finished run, summarised ---------- */
function summarise(run) {
  const rows = run.pids.map((id, i) => {
    const P = getPrompt(id), a = run.ans[i] || { k: -1, ms: 0 };
    if (!P) return { P: null, a, pts: 0, tier: 0 };
    const tab = pointsTable(P, run.rare), pts = a.k >= 0 ? tab.pts[a.k] : 0;
    return { P, a, it: a.k >= 0 ? P.items[a.k] : null, pts, tier: a.k >= 0 ? tierOf(pts) : 0, share: a.k >= 0 ? tab.q[a.k] : 0, real: tab.real, N: tab.N, count: tab.counts ? tab.counts[a.k] || 0 : 0 };
  });
  const pts = rows.reduce((s, r) => s + r.pts, 0), ms = run.ans.reduce((s, a) => s + (a.ms || 0), 0);
  return { rows, pts, ms, tiers: rows.map(r => r.tier).join(""), rare: rows.filter(r => r.tier >= 4).length };
}
// Head to head: points, then more back roads and dirt tracks, then the faster total time.
function compareRuns(a, b) { return a.pts - b.pts || a.rare - b.rare || b.ms - a.ms; }
