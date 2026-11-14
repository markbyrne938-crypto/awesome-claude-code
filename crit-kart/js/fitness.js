// Training numbers: time in power zones, best efforts, energy, training load, and a small ride history with weekly totals.
// Pure functions (no DOM, no storage) so they run under node for the tests; main.js does the saving.
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});

  // Upper bounds as a fraction of FTP (same zones the HUD colours use).
  const ZONE_TOPS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5, Infinity];
  const ZONE_LABELS = ['Z1 Recovery', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO2 max', 'Z6 Anaerobic', 'Z7 Sprint'];
  const EFFORTS = [[5, '5 s'], [30, '30 s'], [60, '1 min'], [300, '5 min'], [1200, '20 min']];
  const DAY = 86400000;

  const zoneIndex = (watts, ftp) => { const r = watts / ftp; for (let i = 0; i < ZONE_TOPS.length; i++) if (r < ZONE_TOPS[i]) return i; return ZONE_TOPS.length - 1; };

  // Seconds spent in each zone, from a one-sample-per-second power log.
  function zoneTimes(log, ftp) {
    const out = ZONE_TOPS.map(() => 0);
    if (ftp > 0) for (const w of log) out[zoneIndex(w, ftp)]++;
    return out;
  }

  // Best average power over a window of n seconds (0 when the ride is shorter than the window).
  function bestAverage(log, n) {
    if (log.length < n) return 0;
    let sum = 0, best = 0;
    for (let i = 0; i < log.length; i++) { sum += log[i]; if (i >= n) sum -= log[i - n]; if (i >= n - 1) best = Math.max(best, sum / n); }
    return best;
  }

  // Everything the results screen shows about the effort. `np` comes from the FIT exporter's normalized power.
  function summarize(log, ftp, np) {
    const secs = log.length, total = log.reduce((a, b) => a + b, 0), avg = secs ? total / secs : 0;
    const kj = total / 1000; // 1 W for 1 s = 1 J of work at the pedals
    const n = np || avg, ifv = ftp ? n / ftp : 0;
    const bests = {}; for (const [w] of EFFORTS) { const b = bestAverage(log, w); if (b > 0) bests[w] = Math.round(b); }
    return {
      secs, avg, np: n, kj,
      kcal: kj / 4.184 / 0.24, // food energy burned: the body is roughly 24 % efficient on a bike
      if_: ifv, tss: ftp ? (secs * n * ifv) / (ftp * 3600) * 100 : 0,
      zones: zoneTimes(log, ftp), bests,
    };
  }

  // A plain-language read of the session from where the time went.
  function sessionNote(sum) {
    if (!sum.secs) return '';
    const z = sum.zones, t = sum.secs, hard = (z[4] + z[5] + z[6]) / t, thr = z[3] / t, easy = (z[0] + z[1]) / t;
    if (hard > 0.25) return 'A hard one: lots of time above threshold. Good for top-end fitness; take an easier day next.';
    if (thr + hard > 0.5) return 'Solid threshold work: this is the kind of riding that raises your FTP.';
    if (easy > 0.6) return 'Mostly easy riding: good for recovery and base fitness.';
    return 'A steady tempo ride: good all-round aerobic work.';
  }

  const dayOf = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

  // history: [{ t, course, courseName, laps, place, field, secs, avg, np, kj, tss, bests }] oldest first
  function weekly(history, now) {
    const from = dayOf(now) - 6 * DAY, wk = history.filter((h) => h.t >= from);
    const days = new Set(history.map((h) => dayOf(h.t)));
    let streak = 0, d = dayOf(now);
    if (!days.has(d)) d -= DAY; // today not ridden yet: the streak still stands if yesterday was
    while (days.has(d)) { streak++; d = dayOf(d - DAY / 2); } // (half a day back, then snap to midnight: safe across clock changes)
    const sum = (k) => wk.reduce((a, h) => a + (h[k] || 0), 0);
    return { rides: wk.length, secs: sum('secs'), kj: sum('kj'), tss: sum('tss'), streak, total: history.length };
  }

  // Best efforts and best race times so far (the entries in `history`).
  function records(history) {
    const power = {}, course = {};
    for (const h of history) {
      for (const [w, v] of Object.entries(h.bests || {})) if (!power[w] || v > power[w]) power[w] = v;
      const key = `${h.course}:${h.laps}`;
      if (h.finished && (!course[key] || h.secs < course[key])) course[key] = h.secs;
    }
    return { power, course };
  }

  // What this ride improved on, compared with the history before it.
  function newRecords(history, entry) {
    const rec = records(history), out = [];
    for (const [w, label] of EFFORTS) { const v = entry.bests && entry.bests[w]; if (v && rec.power[w] && v > rec.power[w]) out.push(`Best ${label} power: ${v} W (was ${rec.power[w]} W)`); }
    const key = `${entry.course}:${entry.laps}`;
    if (entry.finished && rec.course[key] && entry.secs < rec.course[key]) out.push(`Fastest ${entry.courseName} (${entry.laps} laps)`);
    return out;
  }

  C.fitness = { ZONE_TOPS, ZONE_LABELS, EFFORTS, zoneIndex, zoneTimes, bestAverage, summarize, sessionNote, weekly, records, newRecords };
})();
