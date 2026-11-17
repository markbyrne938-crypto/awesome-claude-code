// Name matching shared by the build and the page. Plain script: no imports, no exports.

// Words that don't decide which place you mean: "Lake Garda" and "Garda" are the same answer.
const GENERIC = new Set(["the", "of", "lake", "lago", "lac", "loch", "lough", "mount", "monte", "mont", "river", "rio", "isle", "island",
  "islands", "isles", "isla", "isola", "ile", "fc", "cf", "afc", "ac", "sc", "sv", "fk", "cd", "ud", "ssc", "as", "ss", "club", "line"]);

function wordsOf(s) {
  s = String(s).toLowerCase()
    .replace(/ł/g, "l").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ı/g, "i").replace(/ß/g, "ss").replace(/æ/g, "ae")
    .replace(/œ/g, "oe").replace(/þ/g, "th").replace(/ð/g, "d").replace(/ħ/g, "h").replace(/ə/g, "a").replace(/ŋ/g, "ng")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/['’‘`ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return [];
  return s.split(" ").map(w => w === "st" || w === "sankt" ? "saint" : w === "ste" ? "sainte" : w === "mt" ? "mount" : w);
}
// The exact key: "The Hague" → "hague", "St. Gallen" → "saintgallen".
function norm(s) { const w = wordsOf(s); return (w.length > 1 && w[0] === "the" ? w.slice(1) : w).join(""); }
// The key without generic words: "Lake Como" → "como", "AC Milan" → "milan".
function core(s) { return wordsOf(s).filter(w => !GENERIC.has(w)).join(""); }
// German umlaut spellings: "Muenchen" and "München" meet at "munchen".
function fold(k) { return k.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u"); }
function keysOf(s) {
  const out = new Set();
  for (const k of [norm(s), core(s)]) if (k) { out.add(k); out.add(fold(k)); }
  return [...out];
}

// Optimal string alignment distance (typos, missing letters, swapped neighbours), giving up past max.
function osa(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let prev2 = null, prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[m];
}
// How many slips a typed name may have: none for short names, one for most, two for long ones.
function slack(len) { return len <= 4 ? 0 : len <= 9 ? 1 : 2; }
