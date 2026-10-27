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

// Physics: ~200 W flat should be ~33-35 km/h
for (const def of C.COURSES) {
  const track = C.buildTrack(def);
  assert.ok(Math.abs(track.ys[track.N]) < 1e-6, 'elevation loop closes');
  const race = new C.Race({ track, laps: 12, mass: 84, pace: 230, difficulty: 1 });
  let t = 0, pT = null, laps = [];
  while (race.state !== 'finished' && t < 1500) {
    race.update(1 / 30, { power: 250, steer: Math.max(-1, Math.min(1, -race.player.x * 3)), use: false }); t += 1 / 30;
    if (race.player.finished && pT === null) pT = race.time;
    for (const e of race.events) if (e.type === 'lap') laps.push(e); race.events.length = 0;
    for (const r of race.riders) assert.ok(Number.isFinite(r.s) && Number.isFinite(r.v) && Math.abs(r.x) <= 1.3 + 1e-9);
  }
  const res = race.results();
  console.log(`${def.id}: lap ${track.length.toFixed(0)} m, player 12 laps in ${(pT / 60).toFixed(1)} min, place ${res.find(r => r.isPlayer).place}, hazards ${race.hazards.length}`);
  assert.strictEqual(laps.length, 12, 'one lap event per completed lap'); assert.ok(laps.slice(0, 11).every((l) => l.lapTime > 20 && !l.final) && laps[11].final);
  assert.ok(pT > 8 * 60 && pT < 14 * 60, 'race length ~10 min');
}
console.log('all ok');
for (const def of C.COURSES) { const t = C.buildTrack(def); console.log(def.id, 'est 12 laps @250W', (C.estimateLapTime(t, 250, 84) * 12 / 60).toFixed(1), 'min'); }
