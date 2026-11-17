const D = __DATA__;
const NQ = 7, SECS = 25, NCUR = 3, MX = D.MX, MY = D.MY, TZ = "Europe/Berlin", DAY1 = Date.UTC(2026, 10, 16) / 864e5;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = n => Math.round(n).toLocaleString("en-IE");
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

$("base").innerHTML =
  `<path class="grat" d="${D.grat}"/><path class="land" d="${D.land}"/><g id="vis"></g><path class="frontier" d="${D.borders}"/>` +
  D.seas.map(s => `<text class="sea-name" x="${s.x}" y="${s.y}">${esc(s.t)}</text>`).join("");

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function km(a, b) { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function coord(p) { return `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? "E" : "W"}`; }

/* ---- the clock: a new route is dealt at midnight Central European time ---- */
function cetNow() {
  const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).forEach(p => o[p.type] = +p.value);
  return { day: Math.round(Date.UTC(o.year, o.month - 1, o.day) / 864e5), left: 86400 - (o.hour * 3600 + o.minute * 60 + o.second) };
}
const hms = s => [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, "0")).join(":");

/* ---- the atlas ---- */
const C = D.c, byId = Object.fromEntries(C.map(c => [c.id, c]));
const nm = c => (c.the ? "the " : "") + c.n;
const ids = s => s.split(" ");
// How readily a country comes to mind (10 = everyone says it). Drives the rarity estimate.
const FAME = { FR: 10, DE: 10, ES: 10, IT: 10, GB: 10, IE: 9, PT: 8, NL: 8, GR: 8, RU: 8, BE: 7, CH: 7, AT: 7, SE: 7, NO: 7, DK: 7, PL: 7, UA: 7,
  FI: 6, TR: 6, IS: 6, HR: 6, CZ: 6, HU: 6, RO: 5, LU: 5, MT: 5, BG: 4, RS: 4, SK: 4, SI: 4, CY: 4, EE: 4, LV: 4, LT: 4, MC: 4, VA: 4,
  BY: 3, AL: 3, ME: 3, BA: 3, AD: 3, LI: 3, MD: 2, MK: 2, XK: 2, SM: 2 };
const EU = ids("IE PT ES FR BE NL LU DE AT IT DK SE FI EE LV LT PL CZ SK HU SI HR GR BG RO CY MT");
const NATO = ids("IS GB PT ES FR BE NL LU DE IT DK NO SE FI EE LV LT PL CZ SK HU SI HR ME AL MK GR BG RO TR");
const all = C.map(c => c.id), not = set => all.filter(i => !set.includes(i)), where = f => C.filter(f).map(c => c.id);
const NBC = c => ({ TR: 8, RU: 14, ES: 5 }[c.id] || c.nb.length);

// Each clause: [family, text after "a European country that", ids, optional question when the capital is asked for]
const CL = [
  ["eu", "is in the EU", EU], ["eu", "is not in the EU", not(EU)],
  ["euro", "uses the euro", where(c => c.cur === "Euro")], ["euro", "does not use the euro", where(c => c.cur !== "Euro")],
  ["nato", "is a member of NATO", NATO], ["nato", "is not a member of NATO", not(NATO)],
  ["land", "is landlocked", ids("LU CH AT CZ SK HU RS XK MK MD BY AD SM VA LI")],
  ["sea", "has a Mediterranean coast", ids("ES FR MC IT MT SI HR BA ME AL GR TR CY")],
  ["sea", "has a Baltic Sea coast", ids("DK DE PL LT LV EE FI SE RU")],
  ["sea", "has an Adriatic coast", ids("IT SI HR BA ME AL")],
  ["isle", "is an island nation", ids("IS IE GB MT CY")],
  ["yugo", "was part of Yugoslavia", ids("SI HR BA RS ME MK XK")],
  ["mon", "is a monarchy", ids("GB ES BE NL LU DK NO SE MC LI AD VA")],
  ["alps", "has part of the Alps", ids("FR MC IT CH LI DE AT SI")],
  ["dan", "lies on the Danube", ids("DE AT SK HU HR RS BG RO MD UA")],
  ["nord", "is a Nordic country", ids("IS NO SE FI DK")],
  ["lang", "has a Slavic language as its main language", ids("RU UA BY PL CZ SK SI HR BA RS ME MK BG")],
  ["lang", "has a Germanic language as its main language", ids("DE AT CH LI NL BE GB IE DK NO SE IS")],
  ["lang", "has a Romance language as its main language", ids("FR ES PT IT RO MD MC AD SM VA")],
  ["area", "is larger than 150,000 km²", where(c => c.area > 150)], ["area", "is larger than 400,000 km²", where(c => c.area > 400)],
  ["area", "is smaller than 15,000 km²", where(c => c.area < 15)], ["area", "is smaller than 1,000 km²", where(c => c.area < 1)],
  ["pop", "has more than 45 million people", where(c => c.pop > 45)], ["pop", "has more than 15 million people", where(c => c.pop > 15)],
  ["pop", "has more than 8 million people", where(c => c.pop > 8)], ["pop", "has fewer than 5 million people", where(c => c.pop < 5)],
  ["pop", "has fewer than 1 million people", where(c => c.pop < 1)],
  ["nb", "borders at least six countries", where(c => NBC(c) >= 6)], ["nb", "borders exactly one other country", where(c => NBC(c) === 1)],
  ["cap", "has its capital north of 55°N", where(c => c.lat > 55), "Name a European capital city north of 55°N."],
  ["cap", "has its capital south of 41°N", where(c => c.lat < 41), "Name a European capital city south of 41°N."],
  ["cap", "has its capital east of 27°E", where(c => c.lon > 27), "Name a European capital city east of 27°E."],
  ["cap", "has its capital west of the Greenwich meridian", where(c => c.lon < 0), "Name a European capital city west of the Greenwich meridian."],
];
const BORDER = C.filter(c => c.nb.length >= 3 && !["TR", "RU"].includes(c.id)).map(c => ["b" + c.id, `borders ${nm(c)}`, c.nb]);

const POOL = [];
const add = (q, type, set, fam) => { if (set.length >= 3) POOL.push({ q, type, fam, hint: type === "c" ? "A country" : "A capital city",
  items: set.map(id => ({ label: type === "c" ? byId[id].n : byId[id].cap, cc: id, f: FAME[id] })) }); };
const famOf = f => /^b[A-Z]{2}$/.test(f) ? "border" : f; // used to keep one day's prompts varied
const both = (txt, set, capQ, fam) => { add(`Name a European country that ${txt}.`, "c", set, fam); add(capQ || `Name the capital of a European country that ${txt}.`, "k", set, fam); };
for (const [f, txt, set, capQ] of [...CL, ...BORDER]) both(txt, set, capQ, [famOf(f)]);
const pairs = (A, B) => { for (const a of A) for (const b of B) {
  if (a === b || a[0] === b[0]) continue;
  const set = a[2].filter(i => b[2].includes(i));
  if (set.length >= 3 && set.length <= 14 && set.length < Math.min(a[2].length, b[2].length)) both(`${a[1]} and ${b[1]}`, set, null, [famOf(a[0]), famOf(b[0])]);
} };
for (let i = 0; i < CL.length; i++) pairs([CL[i]], CL.slice(i + 1));
pairs(BORDER, CL.slice(0, 4));
for (const [key, label] of [["n", "country"], ["cap", "capital city"]]) {
  const by = {}; C.forEach(c => (by[c[key][0]] = by[c[key][0]] || []).push(c.id));
  for (const L in by) add(`Name a European ${label} beginning with ${L}.`, key === "n" ? "c" : "k", by[L], ["letter"]);
}

/* ---- reading what the player typed ---- */
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ı/g, "i")
  .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/&/g, "and").replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
const NAMES = { c: {}, k: {} };
C.forEach(c => { NAMES.c[norm(c.n)] = c.id; NAMES.k[norm(c.cap)] = c.id; });
const alias = (t, id, list) => list.split(",").forEach(a => NAMES[t][norm(a)] = id);
alias("c", "GB", "uk,britain,great britain,gb"); alias("c", "NL", "holland"); alias("c", "CZ", "czech republic"); alias("c", "TR", "turkey");
alias("c", "BA", "bosnia,bosnia herzegovina"); alias("c", "MK", "macedonia"); alias("c", "VA", "vatican,holy see"); alias("c", "IE", "republic of ireland,eire");
alias("k", "LU", "luxembourg"); alias("k", "UA", "kiev"); alias("k", "XK", "prishtina"); alias("k", "AD", "andorra"); alias("k", "VA", "vatican");
alias("k", "MC", "monte carlo,monaco ville"); alias("k", "CZ", "praha"); alias("k", "BE", "bruxelles"); alias("k", "RO", "bucuresti"); alias("k", "PT", "lisboa");
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
  return d[a.length][b.length]; }
function fuzzy(map, text) { // exact match first, then forgive a small typo
  const t = norm(text); if (!t) return null;
  if (t in map) return map[t];
  const slack = t.length >= 9 ? 2 : t.length >= 5 ? 1 : 0; let best = null, bd = slack + 1, tie = false;
  for (const k in map) { if (Math.abs(k.length - t.length) > slack) continue; const d = lev(t, k);
    if (d < bd) { bd = d; best = map[k]; tie = false; } else if (d === bd && map[k] !== best) tie = true; }
  return bd <= slack && !tie ? best : null;
}
const lookup = (type, text) => fuzzy(NAMES[type], text);

/* ---- hand-written prompts on food, sport, places and culture ---- */
const HAND = CURATED.trim().split("\n").map(line => {
  const [q, hint, dcc, list] = line.split(";"), map = {};
  const items = list.split("|").map((it, i) => { const [names, f, cc] = it.split(":"), all = names.split(",");
    all.forEach(n => map[norm(n)] = i); return { label: all[0], cc: cc === undefined ? dcc : cc, f: +f || 1 }; });
  return { q, hint, items, map };
});

/* ---- rarity: fewer people would say it, more points ---- */
const TIERS = ["No answer", "Motorway", "Main road", "Country road", "Back road", "Dirt track"], SQUARES = ["⬛", "🟦", "🟩", "🟨", "🟧", "🟫"];
const tierOf = pts => pts >= 95 ? 5 : pts >= 80 ? 4 : pts >= 60 ? 3 : pts >= 35 ? 2 : 1;
function rate(p, k) {
  const ws = p.items.map(i => i.f ** 2), hi = Math.max(...ws), lo = Math.min(...ws), sum = ws.reduce((a, b) => a + b, 0);
  return { pts: hi === lo ? 50 : Math.round(15 + 85 * (hi - ws[k]) / (hi - lo)), share: ws[k] / sum };
}
const extremes = p => { const s = p.items.slice().sort((a, b) => b.f - a.f); return [s[0].label, s[s.length - 1].label]; };
const said = i => trip[i].items[S.ans[i].k];

let S, trip, vb, legT = 1, raf;

function deal(pool, n, salt, spare = 0) { // shuffled once per cycle and dealt a slice a day, so nothing repeats within a cycle
  const idx = pool.map((_, i) => i), slot = n + spare; let cand;
  if (!S.daily) cand = shuffle(idx, rng(S.seed + salt)).slice(0, slot);
  else { const days = Math.floor(pool.length / slot), perm = shuffle(idx, rng(Math.floor(S.day / days) * 7919 + salt)), d = S.day % days; cand = perm.slice(d * slot, d * slot + slot); }
  const used = new Set(), out = [], rest = []; // prefer prompts that don't share a theme with one already picked
  for (const i of cand) { const f = pool[i].fam || [];
    if (out.length < n && !f.some(x => used.has(x))) { out.push(pool[i]); f.forEach(x => used.add(x)); } else rest.push(pool[i]); }
  return [...out, ...rest].slice(0, n);
}
function build() { trip = shuffle([...deal(HAND, NCUR, 17), ...deal(POOL, NQ - NCUR, 29, 4)], rng(S.seed + 5)); }
const score = () => S.ans.reduce((s, a) => s + a.pts, 0);
const stops = () => S.ans.map((a, i) => ({ a, it: a.k >= 0 ? said(i) : null })).filter(x => x.it && x.it.cc);
const route = () => [D.start, ...stops().map(x => byId[x.it.cc])];
const routeKm = () => route().reduce((s, p, i, a) => s + (i ? km(a[i - 1], p) : 0), 0);
function save() { if (S.daily) try { localStorage.setItem("bre-run4", JSON.stringify(S)); } catch {} }

function frame(pts) {
  const el = $("map"), AR = (el.clientWidth / el.clientHeight) || 1.1, pad = 90;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let w = Math.max(x1 - x0 + 2 * pad, (y1 - y0 + 2 * pad) * AR, 400);
  w = Math.min(w, D.W + 2 * MX, (D.H + 2 * MY) * AR);
  const h = w / AR;
  return { x: clamp((x0 + x1) / 2 - w / 2, -MX, D.W + MX - w), y: clamp((y0 + y1) / 2 - h / 2, -MY, D.H + MY - h), w, h };
}
function rest() {
  const pts = route();
  if (pts.length < 2) return frame([{ x: 90, y: 90 }, { x: D.W - 90, y: D.H - 90 }]);
  return S.phase === "end" ? frame(pts) : frame(pts.slice(-2));
}
function travel(drawLeg) {
  const to = rest(), from = vb || to, t0 = performance.now(), dur = reduced ? 0 : 1200;
  cancelAnimationFrame(raf);
  const step = now => {
    const t = dur ? clamp((now - t0) / dur, 0, 1) : 1, e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    vb = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), w: lerp(from.w, to.w, e), h: lerp(from.h, to.h, e) };
    legT = drawLeg ? e : 1; draw();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  step(t0);
}
function draw() {
  const k = vb.w / ($("map").clientWidth || 600);
  $("svg").setAttribute("viewBox", `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);
  const pts = route(), tiers = stops().map(x => tierOf(x.a.pts)), r = pts.length - 1, moving = legT < 1 && r > 0;
  const line = pts.slice(0, moving ? r : r + 1).map(p => `${p.x},${p.y}`);
  let head = null;
  if (moving) { const a = pts[r - 1], b = pts[r]; head = { x: lerp(a.x, b.x, legT), y: lerp(a.y, b.y, legT) }; line.push(`${head.x.toFixed(1)},${head.y.toFixed(1)}`); }
  const lbl = (p, t) => { const left = p.x > vb.x + vb.w * 0.72;
    return `<text class="lbl" x="${p.x + (left ? -11 : 11) * k}" y="${p.y + k}" font-size="${13 * k}" stroke-width="${3.5 * k}" text-anchor="${left ? "end" : "start"}">${esc(t)}</text>`; };
  const dot = (p, c, rad) => `<circle class="dot ${c}" cx="${p.x}" cy="${p.y}" r="${rad * k}"/>`;
  let h = `<polyline class="casing" points="${line.join(" ")}"/><polyline class="centre" points="${line.join(" ")}"/>`;
  h += dot(D.start, "home", 5) + lbl(D.start, D.start.p);
  const seen = new Set();
  for (let i = 1; i <= (moving ? r - 1 : r); i++) { h += dot(pts[i], "t" + tiers[i - 1], 6.5); if (!seen.has(pts[i].id)) h += lbl(pts[i], pts[i].cap); seen.add(pts[i].id); }
  if (moving) h += dot(head, "car", 5.5);
  $("dyn").innerHTML = h;
}

function tick() {
  const now = cetNow(), stale = S.daily && S.day !== now.day;
  $("mode").textContent = (S.daily ? `Route #${S.day - DAY1 + 1}${stale ? " (earlier)" : ""}` : "Practice drive") + ` · next in ${hms(now.left)}`;
  const btn = $("today"); if (btn) btn.hidden = !(stale || !S.daily);
  if (S.phase === "ask") {
    const left = Math.max(0, S.deadline - Date.now());
    const bar = $("bar"); if (bar) { bar.firstElementChild.style.width = (left / (SECS * 10)).toFixed(1) + "%"; bar.classList.toggle("low", left < 8000); $("secs").textContent = Math.ceil(left / 1000) + "s"; }
    const sec = Math.ceil(left / 1000); if (sec !== lastSec) { lastSec = sec; if (sec > 0 && sec <= 5) snd("tick"); }
    if (!left) { S.ans.push({ k: -1, pts: 0, share: 0 }); S.phase = "shown"; save(); snd("out"); render(); }
  }
}
function renderChrome() {
  $("stops").innerHTML = Array.from({ length: NQ }, (_, i) =>
    `<li class="${i < S.ans.length ? "t" + (S.ans[i].k >= 0 ? tierOf(S.ans[i].pts) : 0) : i === S.idx && S.phase !== "intro" ? "now" : ""}"></li>`).join("");
  $("odo").innerHTML = String(score()).padStart(3, "0").split("").map(d => `<b>${d}</b>`).join("") + "<i>pts</i>";
  const it = S.phase === "shown" && S.ans[S.idx].k >= 0 ? said(S.idx) : null, c = it && it.cc ? byId[it.cc] : null;
  $("tagL").textContent = S.phase === "end" ? "Route complete" : S.phase === "intro" ? "Start: Dublin" : `Stop ${String(S.idx + 1).padStart(2, "0")} / ${String(NQ).padStart(2, "0")}`;
  $("tagR").textContent = S.phase === "end" ? `${fmt(routeKm())} km driven` : c ? `Leg ${fmt(km(route().slice(-2)[0], c))} km` : "";
  $("vis").innerHTML = stops().map(x => D.shapes[x.it.cc] ? `<path class="vis t${tierOf(x.a.pts)}" d="${D.shapes[x.it.cc]}"/>` : "").join("");
  $("tagB").textContent = c ? (trip[S.idx].map ? `${it.label} → ${c.cap}, ${c.n}` : `${c.cap}, ${c.n} · ${coord(c)}`) : "";
}
const sign = (tag, body) => `<section class="sign"><div class="sign-inner"><span class="eroad">${tag}</span>${body}</div></section>`;
const col = body => `<div style="display:flex;flex-direction:column;gap:14px">${body}</div>`;

function render(how) { // how: "leg" draws the new leg, "pan" just moves the map, falsy redraws in place
  const was = document.body.classList.contains("playing"), playing = S.phase === "ask" || S.phase === "shown";
  document.body.classList.toggle("playing", playing); if (was !== playing && !how) how = "pan"; // the map is shorter on phones while you type
  renderChrome();
  if (how) travel(how === "leg"); else draw();
  const p = trip[S.idx], tag = `E ${String(S.idx + 1).padStart(2, "0")}`;
  if (S.phase === "intro") {
    $("stage").innerHTML = col(sign(S.daily ? (S.day === cetNow().day ? "Today's route" : `Route #${S.day - DAY1 + 1}`) : "Practice drive", `<h2 class="q">Seven prompts. Every one has several right answers. Find the one nobody else thinks of.</h2>`) + `
      <ul class="rules">
        <li>You get ${SECS} seconds per prompt. Type any answer that fits; wrong tries cost nothing.</li>
        <li>The less obvious your answer, the more it scores, up to 100 points a stop.</li>
        <li>Each answer drives you on to the capital of the country it belongs to.</li>
      </ul>
      <div class="legend">${[1, 2, 3, 4, 5].map(t => `<span class="chip t${t}">${TIERS[t]}</span>`).join("")}</div>
      <div><button class="go" id="begin">Start the clock</button></div>`);
    $("begin").focus({ preventScroll: true });
  } else if (S.phase === "ask") {
    $("stage").innerHTML = col(sign(tag, `<h2 class="q">${esc(p.q)}</h2>`) + `
      <div class="clock"><div class="bar" id="bar"><i></i></div><span class="secs" id="secs"></span></div>
      <form class="ask" id="ask" autocomplete="off"><input id="answer" type="text" aria-label="Your answer" placeholder="${esc(p.hint)}" autocapitalize="words" spellcheck="false" enterkeyhint="go"><button class="go" id="submit">Go</button></form>
      <p class="msg" id="msg" aria-live="polite"></p>
      <p class="note" id="tries">${p.items.length} answers count.</p>`);
    lastSec = -1;
    $("answer").focus({ preventScroll: true });
  } else if (S.phase === "shown") {
    const a = S.ans[S.idx], ok = a.k >= 0, [common, rare] = extremes(p), t = ok ? tierOf(a.pts) : 0;
    const pct = a.share * 100, share = pct < 1 ? "Fewer than 1 in 100" : `Roughly ${Math.round(pct)} in 100`;
    $("stage").innerHTML = col(sign(tag, `<h2 class="q">${esc(p.q)}</h2>`) + `
      <div class="res t${t}">
        <div class="res-top"><span class="res-name">${ok ? flag(said(S.idx).cc) + esc(said(S.idx).label) : "Out of time"}</span><span class="res-pts" id="pts">+${a.pts}</span></div>
        <div><span class="chip">${TIERS[t]}</span></div>
        <p>${ok ? `${share} players would say this, by our estimate. ` : ""}${p.items.length} answers count. The obvious one was ${esc(common)}; among the rarest was ${esc(rare)}.</p>
        <div><div class="strip" aria-hidden="true">${p.items.map((_, i) => `<i class="${i === a.k ? "me" : ""}" style="left:${Math.max(0, (rate(p, i).pts - 15) / 85 * 100).toFixed(1)}%"></i>`).join("")}</div>
        <div class="strip-ends"><span>Obvious</span><span>Rare</span></div></div>
        <details class="all"><summary>See all ${p.items.length} answers</summary><div class="legend">${p.items.map((it, i) => ({ it, i, pts: rate(p, i).pts })).sort((x, y) => x.pts - y.pts)
          .map(x => `<span class="chip t${tierOf(x.pts)} ${x.i === a.k ? "mine" : ""}">${esc(x.it.label)} · ${x.pts}</span>`).join("")}</div></details>
      </div>
      <div><button class="go" id="next">${S.idx === NQ - 1 ? "Finish" : "Drive on"}</button></div>`);
    $("next").focus({ preventScroll: true }); countUp($("pts"), a.pts, "+");
  } else renderEnd();
  tick();
}

function submit() {
  const p = trip[S.idx], box = $("answer"), text = box.value.trim(), say = m => { $("msg").textContent = m; tried.push(text); $("tries").textContent = "Tried: " + tried.slice(-6).join(", ");
    box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake"); snd("bad"); box.select(); };
  if (S.phase !== "ask" || !text) return;
  let k;
  if (p.map) { k = fuzzy(p.map, text);
    if (k == null) k = fuzzy(p.map, text.replace(/^(lake|lago di|lago|mount|mt\.?|county|co\.?|fc|isle of|river|the)\s+/i, "").replace(/\s+(line|island|islands|sea|ocean|mountains|lake|fc|airport|city|river)$/i, ""));
    if (k == null) return say("That isn't on the list for this one. Try another."); }
  else {
    const id = lookup(p.type, text), other = lookup(p.type === "c" ? "k" : "c", text);
    if (!id) return say(other ? (p.type === "c" ? "That's a city. Name the country." : "That's a country. Name its capital.") : "That isn't a place on this map. Try another.");
    k = p.items.findIndex(i => i.cc === id);
    if (k < 0) return say(`${p.type === "c" ? byId[id].n : byId[id].cap} doesn't fit this one. Try another.`);
  }
  S.ans.push({ k, ...rate(p, k) }); S.phase = "shown"; save(); snd("good", tierOf(S.ans[S.idx].pts)); render(said(S.idx).cc ? "leg" : null);
}
function next() {
  if (S.phase !== "shown") return;
  S.idx++; S.phase = S.idx >= NQ ? "end" : "ask"; S.deadline = Date.now() + SECS * 1000; tried = [];
  if (S.phase === "end") { record(); snd("done"); } save(); render(S.phase === "end" ? "pan" : null);
}
function newTrip(daily, seed, rival, past) {
  const day = daily && past ? past : cetNow().day; tried = [];
  S = { seed: daily ? day : seed || (Math.random() * 2 ** 31) | 0, day, daily, idx: 0, ans: [], phase: "intro", deadline: 0, rival: rival || "" };
  build(); vb = null; render("pan");
}

/* ---- two players: a live scoreboard where the page can store scores, and result codes everywhere else ---- */
let db = null, me = null, board = [], names = {};
const code = () => `BRE-${S.daily ? "D" : "P"}${S.seed.toString(36)}-${S.ans.map(a => a.k < 0 ? "zz" : a.k.toString(36).padStart(2, "0")).join("")}`;
function parse(text) {
  const m = new RegExp(`BRE-([DP])([0-9a-z]+)-([0-9a-z]{${NQ * 2}})(?![0-9a-z])`, "i").exec(text || ""); if (!m) return null;
  return { daily: m[1].toUpperCase() === "D", seed: parseInt(m[2].toLowerCase(), 36), ks: m[3].toLowerCase().match(/../g).map(x => x === "zz" ? -1 : parseInt(x, 36)) };
}
const mine = c => !!c && c.daily === S.daily && c.seed === S.seed;
const theirs = c => c.ks.map((k, i) => k >= 0 && k < trip[i].items.length ? { k, ...rate(trip[i], k) } : { k: -1, pts: 0, share: 0 });
function renderVersus() {
  const el = $("versus"); if (!el || S.phase !== "end") return;
  const rivals = [], seen = new Set([code()]);
  const take = (text, name) => { const c = parse(text); if (!mine(c)) return; const key = c.ks.join(); if (seen.has(key)) return; seen.add(key); rivals.push({ name, ans: theirs(c) }); };
  if (S.daily) board.filter(b => b.id !== me).forEach(b => take(String(b.code || ""), names[b.id] || "Another player"));
  take(S.rival, "Your friend");
  const you = score(), cell = (p, a) => { const t = a.k >= 0 ? tierOf(a.pts) : 0;
    return `<span class="vs-cell"><b>${a.k >= 0 ? esc(p.items[a.k].label) : "—"}</b><span class="chip t${t}">${a.pts}</span></span>`; };
  const rows = S.daily && S.day === cetNow().day ? board.map(b => { const c = parse(String(b.code || "")); return mine(c) ? { id: b.id, pts: theirs(c).reduce((x, a) => x + a.pts, 0) } : null; }).filter(Boolean) : [];
  const table = rows.length > 1 ? `<section class="vs"><h3>Today's table</h3>${rows.sort((a, b) => b.pts - a.pts).map((r, i) =>
    `<div class="vs-cell"><b>${i + 1}. ${r.id === me ? "You" : esc(names[r.id] || "Another player")}</b><span class="k">${r.pts}</span></div>`).join("")}</section>` : "";
  el.innerHTML = table + (rivals.map(r => { const them = r.ans.reduce((x, a) => x + a.pts, 0), d = you - them;
    return `<section class="vs">
      <h3>${d > 0 ? `You win by ${d}` : d < 0 ? `${esc(r.name)} wins by ${-d}` : "Dead heat"}</h3>
      <div class="vs-head"><span>You · ${you}</span><span>${esc(r.name)} · ${them}</span></div>
      ${trip.map((p, i) => `<div class="vs-q">${esc(p.q)}</div><div class="vs-row">${cell(p, S.ans[i])}${cell(p, r.ans[i])}</div>`).join("")}
    </section>`; }).join("") ||
    `<p class="note">${db && S.daily ? "Nobody else has finished this route yet. Their score will appear here when they do." : "To compare with a friend, send them your result, then paste theirs in the box below."}</p>`);
}
function post() { // put today's finished route on the shared scoreboard
  if (!db || !me || !S || !S.daily || S.phase !== "end" || S.posted || S.day !== cetNow().day) return;
  S.posted = true;
  db.doc("scores/" + me).set({ day: S.day, code: code(), pts: score() }).then(save, () => { S.posted = false; });
}
async function connect() {
  const [d, u] = await Promise.all([window.claude?.use?.("db"), window.claude?.use?.("user")].map(p => Promise.resolve(p).catch(() => null)));
  if (!d) return;
  db = d; me = u ? await u.id() : null; post(); renderVersus();
  db.collection("scores").where("day", "==", cetNow().day).onSnapshot(snap => {
    board = snap.docs.map(x => ({ id: x.id, ...x.data() })).slice(0, 20); renderVersus();
    if (u) u.profiles(board.map(b => b.id)).then(ps => { for (const id in ps) names[id] = ps[id].name; renderVersus(); });
  }, () => {});
}
$("rival").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("code").value, c = parse(text), say = m => { $("rmsg").textContent = m; };
  if (!c) return say("That doesn't look like a result code. It starts with BRE-.");
  if (mine(c)) { S.rival = text; save(); renderVersus(); $("code").value = "";
    return say(S.phase === "end" ? "Added. The comparison is above." : "Saved. You'll see how you compare when you finish."); }
  if (c.daily) return say("That code is from a different day's route.");
  newTrip(false, c.seed, text); $("code").value = ""; say("Loaded your friend's practice route. Finish it to see how you compare.");
});

function shareText() {
  return `Back Road Europe ${S.daily ? "#" + (S.day - DAY1 + 1) : "(practice)"}\n${score()}/${NQ * 100} pts\n` + S.ans.map(a => SQUARES[a.k >= 0 ? tierOf(a.pts) : 0]).join("") + `\nCompare with me: ${code()}`;
}
function renderEnd() {
  const sc = score(), verdict = sc >= 560 ? "You drove the whole continent without touching a motorway." :
    sc >= 420 ? "Mostly back roads. Well off the beaten track." : sc >= 260 ? "A fair mix of main roads and side roads." : "You stuck to the motorways. Tomorrow, take a turn-off.";
  $("stage").innerHTML = col(sign("Journey's end", `<p class="big"><span id="bigpts">${sc}</span> <small>of ${NQ * 100} pts &nbsp;·&nbsp; ${fmt(routeKm())} km</small></p><p class="verdict">${verdict}${S.daily && streak() > 1 ? ` You are on a ${streak()}-day streak.` : ""}</p>`) + `
      <div id="versus"></div>
      <ol class="itin">${trip.map((p, i) => { const a = S.ans[i], t = a.k >= 0 ? tierOf(a.pts) : 0; return `<li>
        <span class="pq">${esc(p.q)}</span>
        <span class="c">${a.k >= 0 ? flag(said(i).cc) + esc(said(i).label) : "—"}</span>
        <span class="right"><span class="chip t${t}">${TIERS[t]}</span><span class="k">${a.pts}</span></span></li>`; }).join("")}</ol>
      <div class="row">
        <button class="go" id="copy">Copy result and code</button>
        <button class="go" id="today" hidden>Play today's route</button>
        <button class="go alt" id="again">Practice drive</button>
      </div>
      <textarea id="sharebox" hidden readonly rows="4"></textarea>`);
  $("rmsg").textContent = ""; countUp($("bigpts"), sc, "");
  renderVersus(); post();
}

$("stage").addEventListener("submit", e => { e.preventDefault(); submit(); });
$("stage").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "begin") { S.phase = "ask"; S.deadline = Date.now() + SECS * 1000; tried = []; save(); beep(660, 0.12); render(); }
  else if (b.id === "next") next();
  else if (b.id === "again") newTrip(false);
  else if (b.id === "today") start({});
  else if (b.id === "copy") {
    const txt = shareText(), fallback = () => { const s = $("sharebox"); s.hidden = false; s.value = txt; s.select(); };
    try { navigator.clipboard.writeText(txt).then(() => { b.textContent = "Copied"; }, fallback); } catch { fallback(); }
  }
});
addEventListener("resize", () => { if (S) { cancelAnimationFrame(raf); vb = rest(); legT = 1; draw(); } });

$("note").textContent = `${fmt(HAND.length + POOL.length)} prompts in the bank: ${HAND.length} hand-written on food, sport, places and culture, and ${fmt(POOL.length)} on countries and capitals. Seven are dealt every day at midnight Central European time, the same for everyone. Rarity is an estimate of how many players would give each answer, fixed in advance.`;

/* ---- small pleasures: flags, counting up, sound ---- */
let tried = [], lastSec = -1, AC = null, muted = false;
try { muted = localStorage.getItem("bre-mute") === "1"; } catch {}
const flag = cc => cc ? String.fromCodePoint(...[...cc].map(ch => 0x1F1A5 + ch.charCodeAt(0))) + " " : "";
function countUp(el, to, pre) {
  if (!el || reduced || !to) return; const t0 = performance.now();
  const step = now => { const t = Math.min(1, (now - t0) / 600); el.textContent = pre + Math.round(to * (1 - (1 - t) ** 3)); if (t < 1 && el.isConnected) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function beep(f, d, when = 0, type = "sine", vol = 0.08) {
  if (muted) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + when;
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d); } catch {}
}
function snd(kind, tier = 1) {
  if (kind === "tick") beep(880, 0.06, 0, "square", 0.03);
  else if (kind === "bad") beep(160, 0.12, 0, "sawtooth", 0.05);
  else if (kind === "out") { beep(220, 0.2, 0, "sawtooth", 0.05); beep(150, 0.35, 0.18, "sawtooth", 0.05); }
  else if (kind === "good") [0, 4, 7, 12, 16].slice(0, tier).forEach((x, i) => beep(440 * 2 ** (x / 12), 0.18, i * 0.09)); // rarer answers ring higher
  else if (kind === "done") [0, 4, 7, 12].forEach((x, i) => beep(523 * 2 ** (x / 12), 0.3, i * 0.12));
}
const muteLabel = () => { $("mute").textContent = muted ? "Sound off" : "Sound on"; $("mute").setAttribute("aria-pressed", String(!muted)); };
$("mute").addEventListener("click", () => { muted = !muted; try { localStorage.setItem("bre-mute", muted ? "1" : "0"); } catch {} muteLabel(); beep(660, 0.1); });
muteLabel();

/* ---- your record, kept in this browser ---- */
function hist() { try { return JSON.parse(localStorage.getItem("bre-hist")) || {}; } catch { return {}; } }
function record() {
  if (!S.daily) return; const h = hist(); if (h[S.day]) return;
  h[S.day] = { pts: score(), t: S.ans.map(a => a.k >= 0 ? tierOf(a.pts) : 0) };
  try { localStorage.setItem("bre-hist", JSON.stringify(h)); } catch {}
}
function streak() { const h = hist(), today = cetNow().day; let d = h[today] ? today : today - 1, n = 0; while (h[d]) { n++; d--; } return n; }
function dialog(html) { const d = $("dlg"); $("dlgBody").innerHTML = html; if (!d.open) d.showModal(); }
$("dlgClose").addEventListener("click", () => $("dlg").close());
$("help").addEventListener("click", () => dialog(`<h2>How to play</h2>
  <ul class="rules">
    <li>Each route has ${NQ} prompts, and every prompt has several right answers.</li>
    <li>You get ${SECS} seconds to type one. Wrong tries cost nothing, so keep going until one counts.</li>
    <li>The fewer people who would think of your answer, the more it scores: 15 points for the obvious one, up to 100 for the rarest.</li>
    <li>Each answer drives you to the capital of the country it belongs to and colours that country on the map.</li>
    <li>Everyone gets the same route each day. A new one is dealt at midnight Central European time.</li>
    <li>To play someone, send them your result code when you finish, or paste theirs into the box under the game.</li>
  </ul>
  <div class="legend">${[1, 2, 3, 4, 5].map(t => `<span class="chip t${t}">${TIERS[t]}</span>`).join("")}</div>`));
$("stats").addEventListener("click", () => {
  const h = hist(), days = Object.keys(h).map(Number), today = cetNow().day, n = days.length;
  const sum = days.reduce((x, d) => x + h[d].pts, 0), best = Math.max(0, ...days.map(d => h[d].pts));
  const tc = [0, 0, 0, 0, 0, 0]; days.forEach(d => (h[d].t || []).forEach(t => tc[t]++)); const mx = Math.max(1, ...tc);
  let routes = "";
  for (let d = today; d >= Math.max(DAY1, today - 13); d--) routes += `<li><span class="c">Route #${d - DAY1 + 1}${d === today ? " (today)" : ""}</span>` +
    (h[d] ? `<span class="k">${h[d].pts} pts</span>` : S.daily && S.day === d && S.phase !== "intro" ? `<span class="k">In progress</span>` : `<button class="go alt sm" data-day="${d}">Play</button>`) + "</li>";
  dialog(`<h2>Your record</h2>
    <div class="stats">${[["Played", n], ["Average", n ? Math.round(sum / n) : 0], ["Best", best], ["Day streak", streak()]].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <h3>Roads taken</h3>${[5, 4, 3, 2, 1, 0].map(t => `<div class="dist"><span class="chip t${t}">${TIERS[t]}</span><div class="bar"><i class="t${t}" style="width:${(tc[t] / mx * 100).toFixed(0)}%;background:var(--tc)"></i></div><span class="k">${tc[t]}</span></div>`).join("")}
    <h3>Routes from the last two weeks</h3><ol class="itin arch">${routes}</ol>
    <p class="note">Your record is kept in this browser only.</p>`);
});
$("dlgBody").addEventListener("click", e => {
  const b = e.target.closest("button[data-day]"); if (!b) return;
  $("dlg").close(); const d = +b.dataset.day; if (d === cetNow().day) start({}); else newTrip(true, null, null, d);
});

function start(saved) {
  const today = cetNow().day, ok = s => s && s.seed != null && Array.isArray(s.ans) && s.phase && s.ans.every(a => a && typeof a.k === "number");
  let s = ok(saved) ? saved : null;
  if (!s) try { const t = JSON.parse(localStorage.getItem("bre-run4")); if (ok(t) && t.day === today) s = t; } catch {}
  if (s) { S = s; build(); vb = null; render("pan"); } else newTrip(true);
}
setInterval(() => S && tick(), 200);
connect();
window.claude?.hot?.snapshot?.(() => S);
window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
