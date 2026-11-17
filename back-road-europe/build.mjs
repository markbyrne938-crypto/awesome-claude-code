// Builds dist/index.html from data/ and src/.  Run: npm run build
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { feature, mesh, merge } from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";
import { geoConicConformal, geoPath, geoGraticule, geoContains, geoCentroid } from "d3-geo";
import wc from "world-countries";
import i18n from "i18n-iso-countries";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { COUNTRIES, SETS, CURRENCY, PARTS, PART_CAPITALS, NOT_EUROPE_NOTE, RULE } from "./data/countries.mjs";
import { CLAUSES, LETTER_T, REGIONS } from "./data/clauses.mjs";
import { loadPlaces, pickThreshold } from "./tools/gazetteer.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const rd = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const report = [];
const warn = m => report.push("WARN " + m);
const note = m => report.push("note " + m);
const SH = {};
vm.runInNewContext(rd("src/shared.js") + "\nOUT.norm=norm;OUT.core=core;OUT.keysOf=keysOf;", { OUT: SH });
const { norm, keysOf } = SH;
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

/* ---------------- projection ---------------- */
const W = 1000, MX = 330, MY = 170;
const ring = [];
for (let lon = -25; lon <= 50; lon += 2.5) ring.push([lon, 34.3]);
for (let lat = 34.3; lat <= 71.3; lat += 2) ring.push([50, lat]);
for (let lon = 50; lon >= -25; lon -= 2.5) ring.push([lon, 71.3]);
for (let lat = 71.3; lat >= 34.3; lat -= 2) ring.push([-25, lat]);
const box = { type: "MultiPoint", coordinates: ring };
const proj = geoConicConformal().parallels([40, 64]).rotate([-12.5, 0]).center([0, 52]);
proj.fitWidth(W, box);
const b0 = geoPath(proj).bounds(box);
const H = Math.ceil(b0[1][1] - b0[0][1]);
proj.fitExtent([[0, 0], [W, H]], box);
proj.clipExtent([[-MX, -MY], [W + MX, H + MY]]);
const gp = geoPath(proj).digits(1);
const XY = (lat, lon) => proj([lon, lat]).map(r1);
// The page projects coordinates itself: Lambert conformal conic, then a scale and shift fitted to d3's output.
const PROJ = (() => {
  const rad = Math.PI / 180, p0 = 40 * rad, p1 = 64 * rad, tany = y => Math.tan((Math.PI / 2 + y) / 2);
  const n = Math.log(Math.cos(p0) / Math.cos(p1)) / Math.log(tany(p1) / tany(p0)), f = Math.cos(p0) * Math.pow(tany(p0), n) / n;
  const raw = (lat, lon) => { const l = (lon - 12.5) * rad, r = f / Math.pow(tany(lat * rad), n); return [r * Math.sin(n * l), f - r * Math.cos(n * l)]; };
  const a = raw(40, -10), b = raw(65, 40), A = proj([-10, 40]), B = proj([40, 65]);
  const k = (A[0] - B[0]) / (a[0] - b[0]), tx = A[0] - k * a[0], ty = A[1] + k * a[1];
  let worst = 0;
  for (const [la, lo] of [[35, -20], [70, 30], [52, 0], [45, 45], [60, -20]]) { const r = raw(la, lo), d = proj([lo, la]); worst = Math.max(worst, Math.hypot(k * r[0] + tx - d[0], ty - k * r[1] - d[1])); }
  if (worst > 0.5) throw new Error("projection fit off by " + worst);
  return { n: +n.toFixed(10), f: +f.toFixed(10), k: +k.toFixed(6), tx: +tx.toFixed(4), ty: +ty.toFixed(4), rot: 12.5 };
})();

// Paths as relative integer moves: "M10,20L11,22Z" → "m10 20 1 2z". Drops slivers under 3 points.
function compress(d) {
  if (!d) return "";
  const out = []; let cx = 0, cy = 0, sx = 0, sy = 0, sub = null;
  const flush = closed => {
    if (!sub) return;
    if (closed && sub.length < 3) { sub = null; return; }
    if (!closed && sub.length < 2) { sub = null; return; }
    let px = sub[0][0], py = sub[0][1];
    out.push("m", px - cx, py - cy); sx = px; sy = py;
    for (const [x, y] of sub.slice(1)) { out.push(x - px, y - py); px = x; py = y; }
    if (closed) { out.push("z"); cx = sx; cy = sy; } else { cx = px; cy = py; }
    sub = null;
  };
  for (const seg of d.match(/[MLZ][^MLZ]*/g)) {
    const c = seg[0];
    if (c === "Z") { flush(true); continue; }
    const [x, y] = seg.slice(1).split(",").map(v => Math.round(+v));
    if (c === "M") { flush(false); sub = [[x, y]]; continue; }
    const last = sub[sub.length - 1];
    if (last[0] !== x || last[1] !== y) sub.push([x, y]);
  }
  flush(false);
  let s = "", prevNum = false;
  for (const t of out) {
    if (typeof t === "string") { s += t; prevNum = false; continue; }
    s += (prevNum && t >= 0 ? " " : "") + t; prevNum = true;
  }
  return s;
}

/* ---------------- countries ---------------- */
const by2 = Object.fromEntries(wc.map(c => [c.cca2, c]));
const by3 = Object.fromEntries(wc.map(c => [c.cca3, c]));
const pop = {};
for (const line of rd("cache/population.csv").split(/\r?\n/).slice(1)) {
  const m = line.match(/^"?(.*?)"?,([A-Z0-9]{3}),(\d{4}),([\d.]+)$/);
  if (m && (!pop[m[2]] || +m[3] > pop[m[2]].y)) pop[m[2]] = { y: +m[3], v: +m[4] };
}
const IDS = COUNTRIES.map(c => c.id), EU_SET = new Set(IDS);
const places = loadPlaces(IDS);
const AREA_FIX = { RS: 77474 }; // world-countries counts Kosovo inside Serbia
const countries = COUNTRIES.map(c => {
  const w = by2[c.id];
  if (!w) throw new Error("no world-countries entry for " + c.id);
  const iso3 = c.id === "XK" ? "XKX" : w.cca3;
  const p = c.id === "VA" ? 0.0008 : pop[iso3] ? pop[iso3].v / 1e6 : null;
  if (p == null) warn("no population for " + c.id);
  const nbAll = (w.borders || []).map(b => b === "UNK" ? "XK" : by3[b] && by3[b].cca2).filter(Boolean);
  const capKeys = new Set([c.cap, ...c.capAlt].map(norm));
  const cap = places.find(q => q.cc === c.id && (capKeys.has(norm(q.n)) || q.alts.some(a => capKeys.has(norm(a)))))
    || places.find(q => q.cc === c.id && q.code === "PPLC");
  if (!cap) throw new Error("no capital place for " + c.id);
  const [x, y] = XY(cap.lat, cap.lon);
  return { ...c, iso3, area: AREA_FIX[c.id] || w.area, pop: p, nbAll, nb: nbAll.filter(b => EU_SET.has(b)), landlocked: !!w.landlocked,
    cur: CURRENCY[c.id] || "Euro", lat: r1(cap.lat), lon: r1(cap.lon), x, y, capPlace: cap.id };
});
const C2 = Object.fromEntries(countries.map(c => [c.id, c]));
for (const c of countries) for (const n of c.nb) if (!C2[n].nb.includes(c.id)) warn(`border not mutual ${c.id}-${n}`);
note("countries: " + countries.map(c => `${c.id} ${c.area}km² ${c.pop && c.pop.toFixed(2)}M nb=${c.nbAll.length}`).join("; "));

// Names in other languages, so "Deutschland" or "Suomi" count.
const LANGS = ["de", "fr", "es", "it", "pt", "nl", "pl", "cs", "sk", "sl", "hr", "sr", "bs", "hu", "ro", "bg", "el", "tr", "sv", "da", "nb", "nn", "fi",
  "et", "lv", "lt", "ga", "mt", "is", "sq", "mk", "uk", "be", "ru", "ca", "eu", "gl", "cy", "ka", "hy", "az", "br"];
for (const l of ["en", ...LANGS]) i18n.registerLocale(require(`i18n-iso-countries/langs/${l}.json`));
const taken = new Map(); // key → country id, English names first
for (const c of countries) for (const n of [c.n, ...c.alt]) for (const k of keysOf(n)) taken.set(k, c.id);
for (const c of countries) {
  const extra = new Set();
  for (const l of LANGS) {
    const names = [i18n.getName(c.id, l, { select: "official" })].filter(Boolean);
    for (const n of names) {
      if (!n || /[^\p{Script=Latin}\s\-'’.()]/u.test(n)) continue; // Latin script only; Cyrillic and Greek forms are not typed here
      const k = norm(n); if (!k || k.length < 3) continue;
      if (taken.has(k) && taken.get(k) !== c.id) continue;
      taken.set(k, c.id); extra.add(n);
    }
  }
  c.native = [...extra].filter(n => !c.alt.includes(n) && norm(n) !== norm(c.n));
}

// Everything outside our 50, so "Australia" gets "isn't in Europe" instead of being read as a typo.
const world = {};
for (const w of wc) {
  if (EU_SET.has(w.cca2) || w.cca2 === "XK") continue;
  const names = new Set([w.name.common, w.name.official]);
  for (const n of i18n.getName(w.cca2, "en", { select: "all" }) || []) names.add(n);
  for (const n of names) { const k = norm(n); if (k && !taken.has(k)) world[k] = w.cca2 + "|" + w.name.common; }
}
const notes = Object.fromEntries(Object.entries(NOT_EUROPE_NOTE));

/* ---------------- map ---------------- */
const topo = simplify(presimplify(JSON.parse(JSON.stringify(require("world-atlas/countries-50m.json")))), 0.0004);
const feats = feature(topo, topo.objects.countries).features;
const ccn = Object.fromEntries(countries.map(c => [String(by2[c.id].ccn3 || "").padStart(3, "0"), c.id]));
const idOf = f => f.properties.name === "Kosovo" ? "XK" : f.properties.name === "N. Cyprus" ? "CY" : ccn[String(f.id || "").padStart(3, "0")] || null;
const crimea = feats.find(f => idOf(f) === "UA");
note("Simferopol inside Ukraine's shape: " + (crimea && geoContains(crimea, [34.1, 44.95])));
const geomsBy = {};
topo.objects.countries.geometries.forEach((g, i) => { const id = idOf(feats[i]); (geomsBy[id || "_"] = geomsBy[id || "_"] || []).push(g); });
const geoms = {};
for (const c of countries) { const g = geomsBy[c.id]; if (!g) { warn("no shape for " + c.id); continue; } geoms[c.id] = merge(topo, g); }
// Natural Earth draws Crimea inside Russia; this game follows the internationally recognised border.
{
  const inCrimea = poly => geoContains({ type: "Polygon", coordinates: poly }, [34.1, 44.95]);
  const moved = geoms.RU.coordinates.filter(inCrimea);
  if (moved.length) {
    geoms.RU = { type: "MultiPolygon", coordinates: geoms.RU.coordinates.filter(p => !inCrimea(p)) };
    geoms.UA = { type: "MultiPolygon", coordinates: [...(geoms.UA.type === "Polygon" ? [geoms.UA.coordinates] : geoms.UA.coordinates), ...moved] };
    note("Crimea moved to Ukraine: " + moved.length + " polygon(s)");
  }
}
const shapes = Object.fromEntries(Object.entries(geoms).map(([id, g]) => [id, compress(gp(g))]));
const other = compress(gp(merge(topo, geomsBy._ || [])));
const gid = g => idOf(feats[topo.objects.countries.geometries.indexOf(g)]);
const pairIs = (a, b, x, y) => (gid(a) === x && gid(b) === y) || (gid(a) === y && gid(b) === x);
const mainBorders = mesh(topo, topo.objects.countries, (a, b) => a !== b && !pairIs(a, b, "CY", "CY") && !pairIs(a, b, "RU", "UA"));
const ruUa = mesh(topo, topo.objects.countries, (a, b) => pairIs(a, b, "RU", "UA"));
ruUa.coordinates = ruUa.coordinates.filter(line => Math.max(...line.map(p => p[1])) > 46.5); // drop the line across the Crimean isthmus
const borders = compress(gp({ type: "GeometryCollection", geometries: [mainBorders, ruUa] }));
const geo = f => JSON.parse(rd("cache/" + f + ".geojson")).features;
const inView = g => { let ok = false; const walk = c => { if (typeof c[0] === "number") { if (c[0] > -30 && c[0] < 60 && c[1] > 32 && c[1] < 73) ok = true; } else c.forEach(walk); }; walk(g.coordinates); return ok; };
const rivers = compress(gp({ type: "FeatureCollection", features: geo("ne_50m_rivers_lake_centerlines").filter(f => f.geometry && inView(f.geometry)) }));
const lakes = compress(gp({ type: "FeatureCollection", features: geo("ne_50m_lakes").filter(f => f.geometry && inView(f.geometry)) }));
const RANGE_NAMES = { "Alps": 1, "Pyrenees": 1, "Carpathian Mountains": 1, "Caucasus Mountains": 1, "Scandinavian Mountains": 1, "Dinaric Alps": 2, "Balkan Mountains": 2,
  "Apennines": 2, "Appennino Ligure": 0, "Cantabrian Mountains": 2, "Sierra Nevada": 3, "Tatra Mountains": 3, "Pindus": 2, "Southern Carpathians": 0, "Jura Mountains": 3,
  "Vosges Mountains": 3, "Ardennes": 3, "Harz": 3, "Sudetes": 3, "Ore Mountains": 3, "Cambrian Mountains": 3, "Pontic Mountains": 2, "Taurus mountains": 2, "Lesser Caucasus": 2, "Sierra Morena": 3 };
const ranges = geo("ne_10m_geography_regions_polys").filter(f => f.geometry && inView(f.geometry) && /Range/.test(f.properties.FEATURECLA))
  .map(f => { const n = f.properties.NAME_EN; const [lon, lat] = geoCentroid(f); const [x, y] = XY(lat, lon); return { d: compress(gp(f)), n: RANGE_NAMES[n] ? n.replace(" mountains", " Mountains") : "", k: RANGE_NAMES[n] || 3, x, y }; })
  .filter(r => r.d);
const SEAS = [["Atlantic Ocean", -17, 47, 1], ["North Sea", 3.2, 56.4, 2], ["Norwegian Sea", 2, 67, 2], ["Barents Sea", 40, 71, 2], ["Baltic Sea", 19.3, 56.3, 2],
  ["Mediterranean Sea", 5.5, 37.8, 1], ["Black Sea", 34, 43.3, 2], ["Bay of Biscay", -5, 45.4, 3], ["Adriatic Sea", 15.8, 42.9, 3], ["Aegean Sea", 25, 38.8, 3],
  ["Tyrrhenian Sea", 12, 40, 3], ["Ionian Sea", 18.5, 38.2, 3], ["Irish Sea", -5, 53.7, 3], ["Caspian Sea", 50.5, 42.5, 2], ["Celtic Sea", -8, 50.8, 3],
  ["Gulf of Bothnia", 20.5, 62.5, 3], ["Balearic Sea", 2.2, 40.3, 3], ["English Channel", -2.5, 50.1, 3], ["Sea of Azov", 36.5, 46.1, 3], ["Ligurian Sea", 8.7, 43.6, 3]];
const seas = SEAS.map(([t, lon, lat, k]) => { const [x, y] = XY(lat, lon); return { t, x, y, k }; });
const grat = compress(gp(geoGraticule().step([10, 10])()));
const map = { W, H, MX, MY, shapes, other, borders, rivers, lakes, ranges, seas, grat };
note(`map bytes: shapes ${Object.values(shapes).join("").length} other ${other.length} borders ${borders.length} rivers ${rivers.length} lakes ${lakes.length} ranges ${ranges.reduce((s, r) => s + r.d.length, 0)}`);

/* ---------------- places table ---------------- */
const placeIdx = new Map(); const PL = [];
function usePlace(p) {
  if (placeIdx.has(p.id)) return placeIdx.get(p.id);
  const alts = p.alts.filter(a => norm(a) !== norm(p.n));
  PL.push([p.n, p.cc, r2(p.lat), r2(p.lon), +p.pop.toPrecision(2), ...(alts.length ? [alts.join("|")] : [])]);
  placeIdx.set(p.id, PL.length - 1); return PL.length - 1;
}
const placeByKey = new Map();
for (const p of places.all) for (const n of [p.n, ...p.alts]) { const k = p.cc + "|" + norm(n); if (!placeByKey.has(k) || placeByKey.get(k).pop < p.pop) placeByKey.set(k, p); }
function findPlace(name, cc) {
  const k = norm(name);
  if (cc && placeByKey.has(cc + "|" + k)) return placeByKey.get(cc + "|" + k);
  for (const id of IDS) if (placeByKey.has(id + "|" + k)) return placeByKey.get(id + "|" + k);
  return null;
}

/* ---------------- prompts ---------------- */
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const prompts = [];
const ids = new Set();
function addPrompt(p) {
  p.id = hash(p.q); if (ids.has(p.id)) { warn("duplicate prompt " + p.q); return; } ids.add(p.id);
  if (p.q.length > 95) warn(`long prompt (${p.q.length}): ${p.q}`);
  prompts.push(p);
}

// 1. Countries and capitals, generated from the sets above.
const members = {};
const setOf = s => s.split(" ");
for (const [k, s] of Object.entries(SETS)) members[k] = setOf(s);
members.noteu = IDS.filter(i => !members.eu.includes(i));
members.noeuro = IDS.filter(i => !members.euro.includes(i));
members.nonato = IDS.filter(i => !members.nato.includes(i));
members.noschengen = IDS.filter(i => !members.schengen.includes(i));
members.landlocked = countries.filter(c => c.landlocked).map(c => c.id);
members.republic = IDS.filter(i => !members.monarchy.includes(i));
for (const f of ["germanic", "romance", "slavic"]) members[f] = countries.filter(c => c.fam === f).map(c => c.id);
members.big = countries.filter(c => c.area > 200000).map(c => c.id);
members.small = countries.filter(c => c.area < 30000).map(c => c.id);
members.tiny = countries.filter(c => c.area < 1000).map(c => c.id);
members.pop40 = countries.filter(c => c.pop > 40).map(c => c.id);
members.pop10 = countries.filter(c => c.pop > 10).map(c => c.id);
members.pop3 = countries.filter(c => c.pop < 3).map(c => c.id);
members.nb6 = countries.filter(c => c.nbAll.length >= 6).map(c => c.id);
members.nb1 = countries.filter(c => c.nbAll.length === 1).map(c => c.id);
members.north55 = countries.filter(c => c.lat > 55).map(c => c.id);
members.south41 = countries.filter(c => c.lat < 41).map(c => c.id);
members.east27 = countries.filter(c => c.lon > 27).map(c => c.id);
for (const c of countries) if (c.nb.length >= 4 && !["RU", "TR"].includes(c.id)) members["B_" + c.id] = c.nb;
for (const [k, v] of Object.entries(members)) note(`set ${k} (${v.length}): ${v.join(" ")}`);

const isB = k => k.startsWith("B_");
const CAP_OK = new Set(["eu", "noteu", "euro", "noeuro", "landlocked", "monarchy", "yugo", "ussr", "danube", "med", "baltic", "eet", "alps"]);
const theme = k => isB(k) ? "border" : CLAUSES[k] ? CLAUSES[k].theme : k;
const clauseText = (k, lang = "en") => isB(k) ? CLAUSES._border[lang].replace("{c}", C2[k.slice(2)].n) : CLAUSES[k][lang];
for (const [k, set] of Object.entries(members)) {
  if (set.length < 6 || set.length > 30) continue;
  const def = CLAUSES[k] || (isB(k) ? CLAUSES._border : null);
  if (!def) { warn("no wording for set " + k); continue; }
  const name = isB(k) ? C2[k.slice(2)].n : "";
  if (!def.capOnly) addPrompt({ c: "countries", k: "c", q: (def.q || `Name a European country that ${clauseText(k)}.`).replace("{c}", name), h: "country", t: { a: k }, it: set, tag: [theme(k)] });
  if (def.capOnly || (CAP_OK.has(k) || isB(k)) && set.length <= 20) addPrompt({ c: "countries", k: "k", q: (def.cap || `Name the capital of a European country that ${clauseText(k)}.`).replace("{c}", name), h: "capital", t: { a: k, cap: 1 }, it: set, tag: [theme(k), "capital"] });
}
const DULL = new Set(["republic", "schengen", "noschengen", "pop10", "small", "big"]);
const pairable = Object.keys(members).filter(k => (CLAUSES[k] && !CLAUSES[k].capOnly) || isB(k));
const perClause = {}; let pairs = 0;
for (let i = 0; i < pairable.length; i++) for (let j = i + 1; j < pairable.length; j++) {
  const a = pairable[i], b = pairable[j];
  if (theme(a) === theme(b) || (DULL.has(a) && DULL.has(b)) || (perClause[a] || 0) >= 3 || (perClause[b] || 0) >= 3) continue;
  const set = members[a].filter(x => members[b].includes(x));
  if (set.length < 6 || set.length > 10 || set.length >= members[a].length - 1 || set.length >= members[b].length - 1) continue;
  const q = `Name a European country that ${clauseText(a)} and ${clauseText(b)}.`;
  if (q.length > 76) continue;
  addPrompt({ c: "countries", k: "c", q, h: "country", t: { a, b }, it: set, tag: [theme(a), theme(b)] });
  perClause[a] = (perClause[a] || 0) + 1; perClause[b] = (perClause[b] || 0) + 1; pairs++;
}
note("two-condition prompts: " + pairs);
// Letter windows.
for (const [field, kind] of [["n", "c"], ["cap", "k"]]) {
  const sorted = [...countries].sort((a, b) => a[field].localeCompare(b[field]));
  const letters = [...new Set(sorted.map(c => c[field][0].toUpperCase()))].sort();
  let i = 0;
  while (i < letters.length) { // consecutive windows of 8 to 12 answers, no overlaps
    let j = i, set = [];
    while (j < letters.length) {
      set = sorted.filter(c => { const L = c[field][0].toUpperCase(); return L >= letters[i] && L <= letters[j]; }).map(c => c.id);
      if (set.length >= 8) break; j++;
    }
    if (set.length < 8 || set.length > 13) { i = j + 1; continue; }
    const q = LETTER_T.en[kind].replace("{a}", letters[i]).replace("{b}", letters[j]);
    addPrompt({ c: "countries", k: kind, q, h: kind === "c" ? "country" : "capital", t: { L: [letters[i], letters[j]] }, it: set, tag: ["letters"] });
    i = j + 1;
  }
}
{
  const ia = countries.filter(c => /ia$/.test(c.n)).map(c => c.id);
  addPrompt({ c: "countries", k: "c", q: "Name a European country whose English name ends in -ia.", h: "country", t: { ia: 1 }, it: ia, tag: ["letters"] });
  const land = countries.filter(c => /lands?$/.test(c.n)).map(c => c.id);
  if (land.length >= 5) addPrompt({ c: "countries", k: "c", q: "Name a European country whose English name ends in -land or -lands.", h: "country", t: { land: 1 }, it: land, tag: ["letters"] });
}

// 2. Towns and cities from the gazetteer: by country, and by region for a few.
const CITY_FAME = (list, p) => {
  const lo = Math.log(list[list.length - 1].pop), hi = Math.log(list[0].pop);
  const base = hi > lo ? 1 + 8 * (Math.log(p.pop) - lo) / (hi - lo) : 5;
  return Math.min(10, Math.round((base + p.boost + (p.code === "PPLC" ? 1 : 0)) * 10) / 10);
};
function cityPrompt(region, list, tVals) {
  const pick = pickThreshold(list);
  if (!pick) { note("no city prompt for " + region.en); return; }
  const T = pick.t, ok = list.filter(p => p.pop >= T * 0.85), near = list.filter(p => p.pop >= T / 3 && p.pop < T * 0.85).slice(0, 40);
  const n = T.toLocaleString("en-GB");
  addPrompt({ c: "places", k: "city", q: `Name a town or city in ${region.en} with over ${n} people.`, h: "town", t: { city: region.key, n: T },
    it: ok.map(p => [usePlace(p), CITY_FAME(ok, p)]), nm: near.map(p => [p.n, ...p.alts.filter(a => norm(a) !== norm(p.n))].join("/") + "~" + (+p.pop.toPrecision(2))).join("|"), tag: ["towns", region.cc] });
}
for (const c of countries) {
  if (["VA", "MC", "SM", "LI", "AD"].includes(c.id)) continue;
  cityPrompt({ en: (c.the ? "the " : "") + c.n, key: c.id, cc: c.id }, places.filter(p => p.cc === c.id && !p.terr), {});
}
for (const r of REGIONS) cityPrompt({ en: r.en, key: r.key, cc: r.cc }, places.filter(p => p.cc === r.cc && !p.terr && r.admin.includes(p.admin)), {});
{
  const big = places.filter(p => p.pop >= 1000000 && !p.terr);
  addPrompt({ c: "places", k: "city", q: "Name a European city with over a million people.", h: "town", t: { million: 1 },
    it: big.map(p => [usePlace(p), CITY_FAME(big, p)]), nm: places.filter(p => p.pop >= 500000 && p.pop < 850000 && !p.terr).map(p => p.n + "~" + (+p.pop.toPrecision(2))).join("|"), tag: ["towns", "big"] });
}

// 3. Hand-written prompts.
const CATS = ["places", "food", "sport", "history", "culture", "nature", "life"];
let unresolved = 0, resolvedAuto = 0, hinted = 0;
for (const file of fs.readdirSync(path.join(ROOT, "data/prompts")).filter(f => f.endsWith(".txt")).sort()) {
  const text = rd("data/prompts/" + file).split("\n");
  let cur = null;
  const done = () => {
    if (!cur) return;
    if (cur.it.length < 4) warn(`fewer than 4 answers: ${cur.q}`);
    const seen = new Map();
    cur.it.forEach((it, i) => { for (const n of [it[0], ...(it[1] ? it[1].split("|") : [])]) for (const k of keysOf(n)) { if (seen.has(k) && seen.get(k) !== i) warn(`"${n}" clashes with "${cur.it[seen.get(k)][0]}" in: ${cur.q}`); seen.set(k, i); } });
    addPrompt(cur); cur = null;
  };
  for (const raw of text) {
    const line = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("=")) {
      done();
      const [cat, q, hint, cc = "", tags = ""] = line.slice(1).split("|").map(s => s.trim());
      if (!CATS.includes(cat)) warn(`unknown category ${cat} in ${file}`);
      cur = { c: cat, k: "hand", q, h: hint, cc, it: [], tag: tags ? tags.split(",").map(s => s.trim()) : [] };
      continue;
    }
    if (!cur) continue;
    for (const tok of line.split(" | ").map(s => s.trim()).filter(Boolean)) {
      const [left, where] = tok.split("@").map(s => s.trim());
      const [namesPart, fameS, ccS] = left.split(":").map(s => s.trim());
      const names = namesPart.split(" / ").map(s => s.trim()).filter(Boolean);
      const fame = fameS ? +fameS : 1;
      if (!(fame > 0 && fame <= 10)) warn(`bad fame "${tok}" in ${cur.q}`);
      const cc = ccS === undefined || ccS === "" ? cur.cc : ccS === "-" ? "" : ccS;
      if (!cc && ccS !== "-") warn(`no country for "${names[0]}" in: ${cur.q} (mark answers outside Europe with :-)`);
      if (cc && !C2[cc]) warn(`unknown country ${cc} in ${cur.q}`);
      let lat = null, lon = null, at = "";
      if (where) {
        const m = where.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
        if (m) { lat = +m[1]; lon = +m[2]; hinted++; }
        else {
          const p = findPlace(where, cc);
          if (p) { lat = p.lat; lon = p.lon; at = p.n; hinted++; } else { warn(`place "${where}" not found (${names[0]}, ${cur.q})`); }
        }
      } else if (cc) {
        let p = null;
        for (const n of names) { p = findPlace(n, cc); if (p && p.cc === cc) break; p = null; }
        if (p) { lat = p.lat; lon = p.lon; at = p.n; resolvedAuto++; }
      }
      if (lat == null && cc) { lat = C2[cc].lat; lon = C2[cc].lon; at = C2[cc].cap; unresolved++; }
      if (!cc) { lat = lon = null; at = ""; } // outside Europe: no stop on the map
      const item = [names[0], names.slice(1).join("|"), fame, cc, lat == null ? null : r2(lat), lon == null ? null : r2(lon), at && norm(at) !== norm(names[0]) ? at : ""];
      while (item.length > 4 && (item[item.length - 1] === "" || item[item.length - 1] == null)) item.pop();
      cur.it.push(item);
    }
  }
  done();
}
note(`hand-written answers: ${hinted} placed by hint, ${resolvedAuto} placed by name, ${unresolved} at the capital`);

/* ---------------- report and page ---------------- */
const count = {}; for (const p of prompts) count[p.c] = (count[p.c] || 0) + 1;
note("prompts by category: " + JSON.stringify(count) + " total " + prompts.length);
const D = {
  v: new Date().toISOString().slice(0, 10), rule: RULE, map: { ...map, proj: PROJ },
  countries: countries.map(c => ({ id: c.id, n: c.n, the: c.the || 0, cap: c.cap, f: c.fame, lat: c.lat, lon: c.lon, area: c.area, pop: c.pop && Math.round(c.pop * 1000) / 1000,
    nb: c.nb, nbAll: c.nbAll.length, cur: c.cur, fam: c.fam, tz: c.tz, alt: c.alt, nat: c.native, capAlt: c.capAlt })),
  places: PL, prompts, world, notes, parts: PARTS, partCaps: PART_CAPITALS, clauses: CLAUSES, letterT: LETTER_T, regions: REGIONS.map(r => ({ key: r.key, cc: r.cc, names: r.names, en: r.en })),
};
const page = rd("src/page.html");
const css = (await esbuild.transform(rd("src/style.css"), { loader: "css", minify: true })).code;
const order = ["shared.js", "i18n.js", "core.js", "map.js", "net.js", "ui.js", "multi.js", "main.js"];
const src = order.map(f => rd("src/" + f)).join("\n;\n");
const dev = process.argv.includes("--dev");
const js = dev ? src : (await esbuild.transform(src, { loader: "js", minify: true, target: "es2020" })).code;
const html = page.replace("/*STYLE*/", css).replace("/*DATA*/", "const D=" + JSON.stringify(D) + ";").replace("/*CODE*/", () => js);
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "dist/index.html"), html);
fs.writeFileSync(path.join(ROOT, "dist/report.txt"), report.join("\n") + "\n");
const kb = n => (n / 1024).toFixed(0) + " KB";
console.log(`dist/index.html ${kb(html.length)} (data ${kb(JSON.stringify(D).length)}, code ${kb(js.length)}, css ${kb(css.length)}); ${prompts.length} prompts ${JSON.stringify(count)}; ${report.filter(r => r.startsWith("WARN")).length} warnings → dist/report.txt`);
