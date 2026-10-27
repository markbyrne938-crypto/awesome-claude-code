// Run with: node test/sim.test.js
const assert = require('assert');
require('../js/ble.js'); require('../js/course.js'); require('../js/sim.js');
const C = globalThis.Crit;

// FTMS Indoor Bike Data: flags 0x0044 = speed present (bit0=0), cadence (bit2), power (bit6)
{
  const dv = new DataView(new ArrayBuffer(8));
  dv.setUint16(0, 0x0044, true); dv.setUint16(2, 3250, true); dv.setUint16(4, 180, true); dv.setInt16(6, 245, true);
  const d = C.parseFtmsBikeData(dv);
  assert.strictEqual(d.power, 245); assert.strictEqual(d.cadence, 90); assert.ok(Math.abs(d.speedKmh - 32.5) < 1e-9);
}
// Cycling Power Measurement
{
  const dv = new DataView(new ArrayBuffer(4)); dv.setUint16(0, 0, true); dv.setInt16(2, 310, true);
  assert.strictEqual(C.parseCyclingPower(dv).power, 310);
}
// Zwift message decode: type 0x23, field1 = button map, field 3 = {1: loc, 2: zigzag(-35)=69}
{
  const msg = C.decodeZwiftMessage(Uint8Array.from([0x23, 0x08, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x1a, 0x04, 0x08, 0x02, 0x10, 0x45]));
  assert.strictEqual(msg.buttonMap, 0xffffffff); assert.deepStrictEqual(msg.analog, [{ loc: 2, val: -35 }]);
}

// A simple test rider: holds the centre line but dodges cones, barrels and potholes like a human would.
function bot(race) {
  const p = race.player, L = race.length, lim = race.track.wallsAt(p.s) ? 0.75 : 1;
  let tx = 0;
  for (const o of race.track.obstacles) {
    if (o.type === 'bump' || o.down) continue;
    const d = ((o.s - p.s) % L + L) % L;
    if (d > 0 && d < 22 && Math.abs(o.x - p.x) < 0.3) { tx = o.x + (o.x > 0 ? -0.5 : 0.5); break; }
  }
  tx = Math.max(-lim, Math.min(lim, tx));
  return Math.max(-1, Math.min(1, (tx - p.x) * 3));
}

// Physics: ~200 W flat should be ~33-35 km/h
for (const def of C.COURSES) {
  const track = C.buildTrack(def);
  assert.ok(Math.abs(track.ys[track.N]) < 1e-6, 'elevation loop closes');
  const nLaps = Math.round(12 * (def.lapScale || 1)); const race = new C.Race({ track, laps: nLaps, mass: 84, pace: 230, difficulty: 1 });
  let t = 0, pT = null, laps = [];
  while (race.state !== 'finished' && t < 1500) {
    race.update(1 / 30, { power: 250, steer: bot(race), use: false }); t += 1 / 30;
    if (race.player.finished && pT === null) pT = race.time;
    for (const e of race.events) if (e.type === 'lap') laps.push(e); race.events.length = 0;
    for (const r of race.riders) assert.ok(Number.isFinite(r.s) && Number.isFinite(r.v) && Math.abs(r.x) <= 1.3 + 1e-9);
  }
  const res = race.results();
  console.log(`${def.id}: lap ${track.length.toFixed(0)} m, player ${nLaps} laps in ${(pT / 60).toFixed(1)} min, place ${res.find(r => r.isPlayer).place}, hazards ${race.hazards.length}`);
  assert.strictEqual(laps.length, nLaps, 'one lap event per completed lap'); assert.ok(laps.slice(0, nLaps - 1).every((l) => l.lapTime > 20 && !l.final) && laps[nLaps - 1].final);
  assert.ok(pT > 8 * 60 && pT < 14 * 60, 'race length 8-14 min at 250 W');
}
console.log('all ok');
for (const def of C.COURSES) { const t = C.buildTrack(def); console.log(def.id, 'est 12 laps @250W', (C.estimateLapTime(t, 250, 84) * Math.round(12 * (def.lapScale || 1)) / 60).toFixed(1), 'min'); }

// Rival pace must follow the user's FTP and the chosen category (average rival power / FTP, 3-lap races)
for (const ftp of [150, 250, 330]) for (const [cat, info] of Object.entries(C.RIVAL_CATS)) {
  const track = C.buildTrack(C.COURSES[0]), pace = ftp * info.factor;
  const race = new C.Race({ track, laps: 3, mass: 84, pace, difficulty: 1 });
  let t = 0;
  while (race.state !== 'finished' && t < 600) { race.update(1 / 30, { power: ftp, steer: bot(race), use: false }); race.events.length = 0; t += 1 / 30; }
  const rivals = race.results().filter((r) => !r.isPlayer), avg = rivals.reduce((a, r) => a + r.avgPower, 0) / rivals.length;
  const ratio = avg / pace;
  assert.ok(ratio > 0.97 && ratio < 1.07, `FTP ${ftp} cat ${cat}: rivals averaged ${avg.toFixed(0)} W = ${(avg / ftp).toFixed(2)}x FTP (pace ${pace.toFixed(0)})`);
  if (ftp === 250) console.log(`FTP ${ftp} Cat ${cat} ${info.name}: rivals avg ${avg.toFixed(0)} W = ${(avg / ftp).toFixed(2)} x FTP`);
}
assert.deepStrictEqual(['D', 'C', 'B', 'A'].map((c) => C.riderCategory({ D: 2.0, C: 2.8, B: 3.5, A: 4.4 }[c])), ['D', 'C', 'B', 'A']);
console.log('category checks ok');
