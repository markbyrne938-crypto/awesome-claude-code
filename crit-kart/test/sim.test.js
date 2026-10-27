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
for (const ftp of [150, 330]) for (const [cat, info] of Object.entries(C.RIVAL_CATS)) {
  const track = C.buildTrack(C.COURSES[0]), pace = ftp * info.factor;
  const race = new C.Race({ track, laps: 8, mass: 84, pace, difficulty: 1 });
  let t = 0;
  while (race.state !== 'finished' && t < 1800) { race.update(1 / 30, { power: ftp, steer: bot(race), use: false }); race.events.length = 0; t += 1 / 30; }
  const rivals = race.results().filter((r) => !r.isPlayer), avg = rivals.reduce((a, r) => a + r.avgPower, 0) / rivals.length;
  const ratio = avg / pace;
  assert.ok(ratio > 0.97 && ratio < 1.12, `FTP ${ftp} cat ${cat}: rivals averaged ${avg.toFixed(0)} W = ${(avg / ftp).toFixed(2)}x FTP (pace ${pace.toFixed(0)})`);
  if (ftp === 330) console.log(`FTP ${ftp} Cat ${cat} ${info.name}: rivals avg ${avg.toFixed(0)} W = ${(avg / ftp).toFixed(2)} x FTP`);
}
assert.deepStrictEqual(['D', 'C', 'B', 'A'].map((c) => C.riderCategory({ D: 2.0, C: 2.8, B: 3.5, A: 4.4 }[c])), ['D', 'C', 'B', 'A']);
console.log('category checks ok');

// Riders pass through each other: no lateral shove when stacked, and overlapping rivals turn see-through
{
  const race = new C.Race({ track: C.buildTrack(C.COURSES[0]), laps: 2, mass: 84, pace: 200, difficulty: 1 });
  race.state = 'racing'; race.time = 0;
  const [a, b] = race.riders.filter((r) => !r.isPlayer);
  for (const r of race.riders) { r.s = 300; r.x = 0; r.v = 8; }
  for (const r of [a, b]) r.s = 100 + (r === b ? 0.3 : 0);
  a.x = 0.05; b.x = 0.05; a.ai.lane = b.ai.lane = 0.05; a.ai.phase = b.ai.phase = 0; a.ai.f = b.ai.f = 1; a.ai.sloppy = b.ai.sloppy = false;
  for (let i = 0; i < 10; i++) race.update(1 / 30, { power: 200, steer: 0, use: false });
  assert.ok(Math.abs(a.x - b.x) < 0.02, 'stacked riders are not pushed apart (identical riders stay together)');
  assert.ok(a.ghost < 0.95 && b.ghost < 0.95, 'overlapping rivals turn translucent');
  console.log('pass-through checks ok (ghost alpha', a.ghost.toFixed(2) + ')');
}

// Steering off (auto-follow): stays on the road, dodges obstacles, passes cleanly when stronger, finishes by power
{
  const FTP = 250;
  const runAuto = (mult) => {
    const race = new C.Race({ track: C.buildTrack(C.COURSES[0]), laps: 4, mass: 84, pace: FTP, difficulty: 1, autoSteer: true });
    for (const b of race.boxes) { b.active = false; b.respawn = 1e9; } // no items: results then depend only on power and steering, not on weapon luck
    const p = race.player; let t = 0, n = 0, scrape = 0, maxX = 0, other = 0, passes = 0, clean = 0;
    const prev = new Map(race.riders.map((o) => [o, o.s - p.s]));
    while (race.state !== 'finished' && t < 1200) {
      race.update(1 / 30, { power: FTP * mult, steer: 0, use: false }); t += 1 / 30;
      for (const e of race.events) if (e.type === 'obstacle' && e.rider.isPlayer && e.kind !== 'bump') other++;
      race.events.length = 0;
      if (race.state === 'racing' && !p.finished) { n++; if (p.scrape > 0) scrape++; maxX = Math.max(maxX, Math.abs(p.x)); }
      for (const o of race.riders) { if (o === p) continue; const d = o.s - p.s, pd = prev.get(o); if (pd > 0 && d <= 0 && race.state === 'racing' && race.time > 12) { passes++; if (Math.abs(o.x - p.x) > 0.2) clean++; } prev.set(o, d); } // (ignore the packed standing start)
    }
    return { place: race.results().find((r) => r.isPlayer).place, scrape: scrape / n, maxX, other, passes, clean };
  };
  const strong = runAuto(1.3), weak = runAuto(0.85);
  assert.ok(strong.maxX < 1.15 && weak.maxX < 1.15, 'auto-steer stays on the road');
  assert.ok(strong.scrape < 0.02 && weak.scrape < 0.02, 'auto-steer does not grind along the walls');
  assert.ok(strong.other <= 2 && weak.other <= 2, 'auto-steer dodges cones, barrels and potholes');
  assert.ok(strong.place < weak.place && strong.place <= 3, 'finishing position follows power');
  // no steering input and auto-steer OFF is hopeless: this is why the option exists
  const lost = new C.Race({ track: C.buildTrack(C.COURSES[0]), laps: 2, mass: 84, pace: FTP, difficulty: 1, autoSteer: false });
  let t = 0, scr = 0, n = 0; while (lost.state !== 'finished' && t < 600) { lost.update(1 / 30, { power: FTP, steer: 0, use: false }); lost.events.length = 0; t += 1 / 30; if (lost.state === 'racing') { n++; if (lost.player.scrape > 0) scr++; } }
  assert.ok(scr / n > 0.3, 'without steering the rider ends up scraping the barriers');
  console.log(`auto-steer race checks ok (1.3x FTP: P${strong.place}; 0.85x: P${weak.place})`);

  // Deterministic scenarios on a clear straight: follow a slower wheel, or a weaker rider is held in the draft; a stronger one passes
  const scenario = (power) => {
    const race = new C.Race({ track: C.buildTrack(C.COURSES[0]), laps: 3, mass: 84, pace: 200, difficulty: 1, autoSteer: true, rubber: false });
    for (const b of race.boxes) { b.active = false; b.respawn = 1e9; }
    race.state = 'racing'; race.time = 0;
    const p = race.player, lead = race.riders.find((r) => !r.isPlayer);
    for (const r of race.riders) if (r !== p && r !== lead) { r.s = 5000; r.x = 0; r.v = 10; r.ai.f = 0.3; r.finished = true; } // park the others out of the way
    lead.s = 30; lead.x = 0.1; lead.v = 9; lead.ai.f = 0.5; lead.ai.lane = 0.1; lead.ai.sloppy = false;
    p.s = 24; p.x = 0.1; p.v = 9;
    let minSep = 9, passedAt = null, draftT = 0, n = 0, maxGap = 0;
    for (let i = 0; i < 30 * 40; i++) {
      race.update(1 / 30, { power, steer: 0, use: false }); race.events.length = 0;
      const d = lead.s - p.s;
      if (d > -0.5 && d < 0.5) minSep = Math.min(minSep, Math.abs(lead.x - p.x));
      if (passedAt === null && d < -3) passedAt = race.time;
      if (passedAt === null) { n++; if (p.draft > 0.15) draftT++; maxGap = Math.max(maxGap, d); }
    }
    return { passedAt, minSep, draftFrac: draftT / Math.max(1, n), maxGap };
  };
  const weakS = scenario(75), strongS = scenario(330);
  assert.ok(strongS.passedAt !== null && strongS.minSep > 0.25, `stronger rider passes with room to spare (lateral gap ${strongS.minSep.toFixed(2)})`);
  assert.ok(weakS.passedAt === null && weakS.draftFrac > 0.4, `weaker rider stays on the wheel in the draft (drafting ${(100 * weakS.draftFrac).toFixed(0)}% of the time)`);
  console.log(`auto-steer scenarios ok (strong passed at ${strongS.passedAt.toFixed(1)}s with ${strongS.minSep.toFixed(2)} lateral gap; weak drafted ${(100 * weakS.draftFrac).toFixed(0)}%)`);
}

// Heart rate + cadence sensors (standard Bluetooth profiles)
{
  const dv = (a) => new DataView(Uint8Array.from(a).buffer);
  assert.strictEqual(C.parseHeartRate(dv([0x00, 142])).bpm, 142);
  assert.strictEqual(C.parseHeartRate(dv([0x01, 0x2c, 0x01])).bpm, 300); // 16-bit format
  assert.deepStrictEqual(C.parseCsc(dv([0x02, 0x10, 0x00, 0x00, 0x04])), { crankRevs: 16, crankTime: 1024 });
  const cc = new C.CadenceCalc(); let t = 0, last = null;
  for (let i = 0; i < 6; i++) { last = cc.update({ crankRevs: (65534 + i) % 65536, crankTime: (i * 683) % 65536 }, t); t += 667; } // 90 rpm across both counter rollovers
  assert.ok(Math.abs(last - 90) < 1, 'cadence from crank events, with rollover');
  for (let i = 0; i < 5; i++) { last = cc.update({ crankRevs: 3, crankTime: 3415 }, t); t += 700; }
  assert.strictEqual(Math.round(last), 0, 'cadence drops to 0 when the cranks stop');
  console.log('sensor parser checks ok');
}

// Rivals tire, then sprint: power fades through the race, jumps in the final few hundred metres, and the player gets bell/sprint calls
{
  const race = new C.Race({ track: C.buildTrack(C.COURSES[0]), laps: 8, mass: 84, pace: 250, difficulty: 1, rubber: false });
  for (const b of race.boxes) { b.active = false; b.respawn = 1e9; }
  const ais = race.riders.filter((r) => !r.isPlayer), early = [], late = [], sprint = []; let t = 0, bell = 0, spr = 0, sprintFlag = 0;
  while (race.state !== 'finished' && t < 1800) {
    race.update(1 / 30, { power: 260, steer: bot(race), use: false }); t += 1 / 30;
    for (const e of race.events) { if (e.type === 'bell') bell++; if (e.type === 'sprint') spr++; } race.events.length = 0;
    for (const r of ais) { const pr = r.s / race.total, togo = race.total - r.s; if (r.finished) continue;
      if (pr > 0.15 && pr < 0.4) early.push(r.power); else if (pr > 0.65 && pr < 0.9) late.push(r.power); if (togo < 120 && togo > 20) sprint.push(r.power); if (r.status === 'SPRINT') sprintFlag++; }
  }
  const m = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(m(late) < m(early) * 0.99, `rivals fade (early ${m(early).toFixed(0)} W -> late ${m(late).toFixed(0)} W)`);
  assert.ok(m(sprint) > m(late) * 1.2, `rivals sprint (late ${m(late).toFixed(0)} W -> sprint ${m(sprint).toFixed(0)} W)`);
  assert.ok(sprintFlag > 0, 'sprinting rivals are flagged for the HUD');
  assert.strictEqual(bell, 1, 'bell lap announced once'); assert.strictEqual(spr, 1, 'sprint called once');
  console.log(`tire + sprint checks ok (early ${m(early).toFixed(0)} W, late ${m(late).toFixed(0)} W, sprint ${m(sprint).toFixed(0)} W)`);
}

// City course: traffic exists, behaves, and can (occasionally) hit riders
{
  const def = C.COURSES.find((c) => c.id === 'city'); assert.ok(def, 'city course exists');
  const track = C.buildTrack(def);
  assert.ok(track.traffic.parked.length >= 6 && track.traffic.moving.length >= 2 && track.traffic.junctions.length >= 1, 'parked cars, moving traffic and a junction');
  assert.ok(Math.abs(track.ys[track.N]) < 1e-6, 'city loop closes');
  const race = new C.Race({ track, laps: 8, mass: 84, pace: 230, difficulty: 1, autoSteer: true });
  const kinds = { player: 0, rivals: 0 }; let crossings = 0, horns = 0, doors = 0, t = 0, maxVeh = 0;
  while (race.state !== 'finished' && t < 1500) {
    race.update(1 / 30, { power: 230, steer: 0, use: false }); t += 1 / 30; maxVeh = Math.max(maxVeh, race.vehicles.length);
    for (const e of race.events) { if (e.type === 'vehicle') kinds[e.rider.isPlayer ? 'player' : 'rivals']++; if (e.type === 'crossing') crossings++; if (e.type === 'horn') horns++; if (e.type === 'door') doors++; }
    race.events.length = 0;
    for (const r of race.riders) assert.ok(Number.isFinite(r.s) && Number.isFinite(r.x) && Number.isFinite(r.v), 'finite rider state');
    for (const v of race.vehicles) assert.ok(Number.isFinite(v.s) && Number.isFinite(v.x), 'finite vehicle state');
  }
  assert.ok(crossings >= 10 && horns >= 10, 'cross traffic keeps coming');
  assert.ok(maxVeh <= 20, 'vehicle count stays bounded');
  assert.ok(kinds.player <= 16, `riders mostly avoid traffic (player hit ${kinds.player}x in 8 laps)`);
  // a rider driven straight into a parked SUV is hit and slowed
  const r2 = new C.Race({ track, laps: 3, mass: 84, pace: 230, difficulty: 1 }); r2.state = 'racing'; r2.time = 0;
  const car = r2.vehicles.find((v) => v.mode === 'parked'); const p = r2.player;
  for (const o of r2.riders) if (o !== p) { o.s = 3000; o.finished = true; }
  p.s = car.s - 8; p.x = car.x; p.v = 10; let hit = false;
  for (let i = 0; i < 90 && !hit; i++) { r2.update(1 / 30, { power: 250, steer: 0, use: false }); for (const e of r2.events) if (e.type === 'vehicle' && e.rider === p) hit = true; r2.events.length = 0; }
  assert.ok(hit && (p.stun > 0 || p.pend > 0 || p.v < 9), 'riding into a parked SUV hurts');
  console.log(`city traffic checks ok (player hit ${kinds.player}x, rivals ${kinds.rivals}x, ${crossings} crossings, ${doors} doors opened, <= ${maxVeh} vehicles)`);
}
