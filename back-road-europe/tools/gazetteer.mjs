// Turns the all-the-cities gazetteer (GeoNames, places of 1,000+ people) into the towns this game uses:
// districts of bigger cities are dropped, dependent territories are attached to their country,
// and English names are applied from data/places-en.txt.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export const TERRITORY = { IM: "GB", JE: "GB", GG: "GB", GI: "GB", FO: "DK", GL: "DK", AX: "FI", SJ: "NO" };
const KEEP = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG", "PPLS", "PPLF"]);

function km(a, b) {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// data/places-en.txt: "CC | GeoNames name = English name | other accepted names, comma separated | fame boost"
export function loadEnglish() {
  const map = new Map();
  const file = path.join(ROOT, "data/places-en.txt");
  if (!fs.existsSync(file)) return map;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim(); if (!line) continue;
    const [cc, names, alts = "", boost = ""] = line.split("|").map(s => s.trim());
    const [local, en] = names.split("=").map(s => s.trim());
    map.set(cc + "|" + local, { en: en || local, alts: alts ? alts.split(",").map(s => s.trim()).filter(Boolean) : [], boost: +boost || 0 });
  }
  return map;
}

export function loadPlaces(countryIds) {
  const want = new Set(countryIds);
  const english = loadEnglish();
  const all = require("all-the-cities")
    .filter(c => KEEP.has(c.featureCode) && (want.has(c.country) || want.has(TERRITORY[c.country])))
    .map(c => {
      const cc = want.has(c.country) ? c.country : TERRITORY[c.country];
      const e = english.get(cc + "|" + c.name);
      if (e && e.en === "-") return null;
      const parts = c.name.split(/\s*\/\s*/); // "Gasteiz / Vitoria"
      const alts = new Set([c.name, ...parts, ...(e ? e.alts : [])]);
      const en = e ? e.en : parts.length > 1 ? parts[parts.length - 1] : c.name;
      alts.delete(en);
      return { id: c.cityId, n: en, alts: [...alts], cc, terr: c.country !== cc ? c.country : "", admin: c.adminCode || "",
        code: c.featureCode, pop: c.population, lat: c.loc.coordinates[1], lon: c.loc.coordinates[0], boost: e ? e.boost : 0 };
    })
    .filter(p => p && !(p.cc === "RU" && p.lon > 60)) // European Russia only: west of the Urals
    .sort((a, b) => b.pop - a.pop);

  // Drop districts: a place close to a much bigger place (radius grows with the big place's size).
  const big = all.filter(p => p.pop >= 60000);
  const kept = [];
  for (const p of all) {
    let district = false;
    for (const q of big) {
      if (q.pop < p.pop * 3) break;
      if (q.cc !== p.cc) continue;
      const radius = 4 + 6 * Math.log10(q.pop / 100000);
      if (radius > 0 && km(p, q) < radius) { district = true; break; }
    }
    if (!district || p.code === "PPLC") kept.push(p);
  }
  const dedupe = list => { const seen = new Set(); return list.filter(p => { const k = p.cc + "|" + p.n; if (seen.has(k)) return false; seen.add(k); return true; }); };
  const out = dedupe(kept);
  out.all = dedupe(all); // districts included, for placing hand-written answers
  return out;
}

// Population thresholds that give a prompt somewhere between 15 and 45 answers.
export const STEPS = [2000, 3000, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000];
export function pickThreshold(places, lo = 15, hi = 45, target = 28) {
  let best = null;
  for (const t of STEPS) {
    const n = places.filter(p => p.pop >= t).length;
    if (n < lo || n > hi) continue;
    if (!best || Math.abs(n - target) < Math.abs(best.n - target)) best = { t, n };
  }
  return best;
}

if (process.argv[1] && process.argv[1].endsWith("gazetteer.mjs")) {
  const { COUNTRIES } = await import(path.join(ROOT, "data/countries.mjs"));
  const places = loadPlaces(COUNTRIES.map(c => c.id));
  const out = [];
  for (const c of COUNTRIES) {
    const mine = places.filter(p => p.cc === c.id);
    const pick = pickThreshold(mine);
    if (!pick) { out.push(`${c.id} (no prompt: ${mine.length} places)`); continue; }
    const list = mine.filter(p => p.pop >= pick.t / 3);
    out.push(`${c.id} >=${pick.t} n=${pick.n}: ` + list.map(p => `${p.n}${p.pop >= pick.t ? "" : "~"}`).join(", "));
  }
  const regions = { GB: ["ENG", "SCT", "WLS", "NIR"], IE: ["L", "M", "C", "U"] };
  for (const [cc, codes] of Object.entries(regions)) for (const code of codes) {
    const mine = places.filter(p => p.cc === cc && p.admin === code && !p.terr);
    const pick = pickThreshold(mine);
    out.push(`${cc}/${code} ${pick ? ">=" + pick.t + " n=" + pick.n : "none"}: ` + mine.filter(p => pick && p.pop >= pick.t / 3).map(p => p.n).join(", "));
  }
  const anchors = ["Munich", "Sevilla", "Barcelona", "Palermo", "Florence", "Rennes", "Marseille", "Napoli", "Naples", "Lyon", "Porto", "Kraków", "Glasgow", "Cork"];
  out.push("anchors: " + anchors.map(a => { const p = places.find(x => x.n === a || x.alts.includes(a)); return p ? `${a}=${p.cc}/${p.admin}` : a + "?"; }).join(" "));
  fs.writeFileSync(path.join(ROOT, "cache/city-dump.txt"), out.join("\n") + "\n");
  console.log(out.length, "lines written to cache/city-dump.txt");
}
