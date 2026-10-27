// Ride export: a Garmin .fit activity file (virtual ride, laps, session, optional virtual GPS/altitude) and a tiny ZIP writer.
// No dependencies. The FIT layout follows the public FIT protocol (header, definition + data messages, CRC-16).
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});

  // ---------- CRC ----------
  const CRC16 = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  function crc16(bytes, crc = 0) {
    for (const b of bytes) {
      let tmp = CRC16[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC16[b & 0xf];
      tmp = CRC16[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC16[(b >> 4) & 0xf];
    }
    return crc;
  }
  let crc32Table = null;
  function crc32(bytes) {
    if (!crc32Table) { crc32Table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc32Table[n] = c >>> 0; } }
    let c = 0xffffffff; for (const b of bytes) c = crc32Table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
  }

  // ---------- FIT ----------
  const FIT_EPOCH = Date.UTC(1989, 11, 31, 0, 0, 0) / 1000;
  const fitTime = (ms) => Math.round(ms / 1000 - FIT_EPOCH);
  const TYPES = { enum: { id: 0x00, size: 1, inv: 0xff }, uint8: { id: 0x02, size: 1, inv: 0xff }, uint16: { id: 0x84, size: 2, inv: 0xffff }, sint32: { id: 0x85, size: 4, inv: 0x7fffffff }, uint32: { id: 0x86, size: 4, inv: 0xffffffff }, uint32z: { id: 0x8c, size: 4, inv: 0 }, string: { id: 0x07, size: 1, inv: 0 } };
  const semicircles = (deg) => Math.round((deg * 2147483648) / 180);

  // Message layouts: [field number, base type, (size for strings)]
  const MSG = {
    file_id: { num: 0, local: 0, fields: [[0, 'enum'], [1, 'uint16'], [2, 'uint16'], [3, 'uint32z'], [4, 'uint32'], [8, 'string', 16]] },
    event: { num: 21, local: 1, fields: [[253, 'uint32'], [0, 'enum'], [1, 'enum'], [4, 'uint8']] },
    record: { num: 20, local: 2, fields: [[253, 'uint32'], [0, 'sint32'], [1, 'sint32'], [2, 'uint16'], [3, 'uint8'], [4, 'uint8'], [5, 'uint32'], [6, 'uint16'], [7, 'uint16'], [73, 'uint32'], [78, 'uint32']] },
    lap: { num: 19, local: 3, fields: [[253, 'uint32'], [254, 'uint16'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [3, 'sint32'], [4, 'sint32'], [5, 'sint32'], [6, 'sint32'], [7, 'uint32'], [8, 'uint32'], [9, 'uint32'], [13, 'uint16'], [14, 'uint16'], [15, 'uint8'], [16, 'uint8'], [17, 'uint8'], [18, 'uint8'], [19, 'uint16'], [20, 'uint16'], [21, 'uint16'], [22, 'uint16'], [24, 'enum'], [25, 'enum'], [39, 'enum']] },
    session: { num: 18, local: 4, fields: [[253, 'uint32'], [254, 'uint16'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [3, 'sint32'], [4, 'sint32'], [5, 'enum'], [6, 'enum'], [7, 'uint32'], [8, 'uint32'], [9, 'uint32'], [11, 'uint16'], [14, 'uint16'], [15, 'uint16'], [16, 'uint8'], [17, 'uint8'], [18, 'uint8'], [19, 'uint8'], [20, 'uint16'], [21, 'uint16'], [22, 'uint16'], [23, 'uint16'], [25, 'uint16'], [26, 'uint16'], [34, 'uint16'], [35, 'uint16'], [36, 'uint16'], [45, 'uint16']] },
    activity: { num: 34, local: 5, fields: [[253, 'uint32'], [0, 'uint32'], [1, 'uint16'], [2, 'enum'], [3, 'enum'], [4, 'enum'], [5, 'uint32']] },
  };
  const SPORT_CYCLING = 2, SUBSPORT_VIRTUAL = 58, EV_TIMER = 0, EV_LAP = 9, EV_SESSION = 8, EV_ACTIVITY = 26, ET_START = 0, ET_STOP = 1, ET_STOP_ALL = 4;

  class Out {
    constructor() { this.b = []; }
    u8(v) { this.b.push(v & 0xff); }
    u16(v) { this.u8(v); this.u8(v >> 8); }
    u32(v) { v = v >>> 0; this.u8(v); this.u8(v >>> 8); this.u8(v >>> 16); this.u8(v >>> 24); }
  }
  function defMsg(o, m) { o.u8(0x40 | m.local); o.u8(0); o.u8(0); o.u16(m.num); o.u8(m.fields.length); for (const [n, t, size] of m.fields) { o.u8(n); o.u8(size || TYPES[t].size); o.u8(TYPES[t].id); } }
  function dataMsg(o, m, v) {
    o.u8(m.local);
    for (const [n, t, size] of m.fields) {
      const val = v[n], T = TYPES[t];
      if (t === 'string') { const bytes = Array.from(unescape(encodeURIComponent(String(val || '')))).map((c) => c.charCodeAt(0)).slice(0, size - 1); for (let i = 0; i < size; i++) o.u8(bytes[i] || 0); continue; }
      const x = val === undefined || val === null || Number.isNaN(val) ? T.inv : Math.round(val);
      if (T.size === 1) o.u8(x); else if (T.size === 2) o.u16(x); else o.u32(x);
    }
  }

  // activity: { startMs, name, samples:[{t,power,cadence,hr,speed,dist,alt,lat,lon}], laps:[...], session:{...} } -> Uint8Array
  function encodeFit(a) {
    const o = new Out(), t0 = a.startMs, ts = (sec) => fitTime(t0 + sec * 1000);
    const S = a.session, hasPos = a.samples.some((s) => s.lat !== undefined);
    defMsg(o, MSG.file_id); dataMsg(o, MSG.file_id, { 0: 4, 1: 255, 2: 1, 3: (t0 >>> 0) % 4294967295 || 1, 4: ts(0), 8: a.name || 'Crit Kart' });
    defMsg(o, MSG.event); dataMsg(o, MSG.event, { 253: ts(0), 0: EV_TIMER, 1: ET_START, 4: 0 });
    defMsg(o, MSG.record);
    for (const s of a.samples) {
      dataMsg(o, MSG.record, { 253: ts(s.t), 0: hasPos ? semicircles(s.lat) : undefined, 1: hasPos ? semicircles(s.lon) : undefined, 2: (s.alt + 500) * 5, 3: s.hr || undefined, 4: s.cadence === undefined ? undefined : Math.min(254, s.cadence),
        5: s.dist * 100, 6: Math.min(65534, s.speed * 1000), 7: s.power, 73: s.speed * 1000, 78: (s.alt + 500) * 5 });
    }
    defMsg(o, MSG.event); dataMsg(o, MSG.event, { 253: ts(S.elapsed), 0: EV_TIMER, 1: ET_STOP_ALL, 4: 0 });
    defMsg(o, MSG.lap);
    a.laps.forEach((l, i) => dataMsg(o, MSG.lap, { 253: ts(l.end), 254: i, 0: EV_LAP, 1: ET_STOP, 2: ts(l.start), 3: hasPos ? semicircles(l.lat0) : undefined, 4: hasPos ? semicircles(l.lon0) : undefined, 5: hasPos ? semicircles(l.lat1) : undefined, 6: hasPos ? semicircles(l.lon1) : undefined,
      7: l.time * 1000, 8: l.time * 1000, 9: l.dist * 100, 13: l.avgSpeed * 1000, 14: l.maxSpeed * 1000, 15: l.avgHr || undefined, 16: l.maxHr || undefined, 17: l.avgCad, 18: l.maxCad, 19: l.avgPower, 20: l.maxPower, 21: l.ascent, 22: l.descent, 24: 2, 25: SPORT_CYCLING, 39: SUBSPORT_VIRTUAL }));
    defMsg(o, MSG.session);
    dataMsg(o, MSG.session, { 253: ts(S.elapsed), 254: 0, 0: EV_SESSION, 1: ET_STOP, 2: ts(0), 3: hasPos ? semicircles(a.samples[0].lat) : undefined, 4: hasPos ? semicircles(a.samples[0].lon) : undefined, 5: SPORT_CYCLING, 6: SUBSPORT_VIRTUAL,
      7: S.elapsed * 1000, 8: S.timer * 1000, 9: S.dist * 100, 11: S.calories, 14: S.avgSpeed * 1000, 15: S.maxSpeed * 1000, 16: S.avgHr || undefined, 17: S.maxHr || undefined, 18: S.avgCad, 19: S.maxCad, 20: S.avgPower, 21: S.maxPower, 22: S.ascent, 23: S.descent,
      25: 0, 26: a.laps.length, 34: S.np, 35: S.tss === undefined ? undefined : S.tss * 10, 36: S.if_ === undefined ? undefined : S.if_ * 1000, 45: S.ftp });
    defMsg(o, MSG.activity); dataMsg(o, MSG.activity, { 253: ts(S.elapsed), 0: S.timer * 1000, 1: 1, 2: 0, 3: EV_ACTIVITY, 4: ET_STOP, 5: ts(S.elapsed) - new Date(t0).getTimezoneOffset() * 60 });
    const data = Uint8Array.from(o.b);
    const h = new Out(); h.u8(14); h.u8(0x20); h.u16(2140); h.u32(data.length); for (const c of '.FIT') h.u8(c.charCodeAt(0));
    const hdr = Uint8Array.from(h.b); h.u16(crc16(hdr));
    const body = Uint8Array.from(h.b.concat(Array.from(data)));
    const file = new Uint8Array(body.length + 2); file.set(body); const crc = crc16(body); file[body.length] = crc & 0xff; file[body.length + 1] = crc >> 8;
    return file;
  }

  // ---------- activity summary from 1 Hz samples ----------
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  function normalizedPower(power) {
    if (power.length < 30) return Math.round(mean(power));
    const roll = []; let sum = 0;
    for (let i = 0; i < power.length; i++) { sum += power[i]; if (i >= 30) sum -= power[i - 30]; if (i >= 29) roll.push(sum / 30); }
    return Math.round(Math.pow(mean(roll.map((v) => Math.pow(v, 4))), 0.25));
  }
  // Virtual GPS: fictional spots in open ocean (no real place), like a virtual world's map. The loop follows the course's shape.
  const BASES = { meadow: [-38.0, -140.0], candy: [-34.0, -125.0], neon: [-42.0, -150.0], city: [-30.0, -135.0] };
  function positionAt(track, s, baseLL) {
    const N = track.N, f = ((((s / track.length) % 1) + 1) % 1) * N, i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, t = f - Math.floor(f), m = track.map;
    const x = (m[i0][0] * (1 - t) + m[i1][0] * t) * 4, y = (m[i0][1] * (1 - t) + m[i1][1] * t) * 4; // map units are 4 m segments
    const lat = baseLL[0] + (-y) / 111320, lon = baseLL[1] + x / (111320 * Math.cos((baseLL[0] * Math.PI) / 180));
    return [lat, lon];
  }

  // raw: { startMs, samples:[{t,power,cadence,hr,speed,dist,s}], lapEnds:[sample index], track, ftp, course, includeMap }
  function buildActivity(raw) {
    const track = raw.track, base = BASES[track.def.id] || [-35, -140], base0 = 20;
    const samples = raw.samples.map((s) => {
      const out = { t: s.t, power: Math.round(s.power), cadence: s.cadence ? Math.round(s.cadence) : 0, hr: s.hr ? Math.round(s.hr) : 0, speed: s.speed, dist: s.dist, alt: base0 + track.elevationAt(s.s) };
      if (raw.includeMap) { const [la, lo] = positionAt(track, s.s, base); out.lat = la; out.lon = lo; }
      return out;
    });
    const ascentOf = (a) => { let up = 0, dn = 0; for (let i = 1; i < a.length; i++) { const d = a[i].alt - a[i - 1].alt; if (d > 0) up += d; else dn -= d; } return [Math.round(up), Math.round(dn)]; };
    const stats = (arr) => ({ avgPower: Math.round(mean(arr.map((x) => x.power))), maxPower: Math.max(0, ...arr.map((x) => x.power)), avgCad: Math.round(mean(arr.filter((x) => x.cadence).map((x) => x.cadence))), maxCad: Math.max(0, ...arr.map((x) => x.cadence)),
      avgHr: Math.round(mean(arr.filter((x) => x.hr).map((x) => x.hr))), maxHr: Math.max(0, ...arr.map((x) => x.hr)), maxSpeed: Math.max(0, ...arr.map((x) => x.speed)) });
    // laps: boundaries are sample indices (end exclusive); the remainder after the last boundary is a final lap
    const bounds = [0, ...raw.lapEnds.filter((i) => i > 0 && i < samples.length), samples.length].filter((v, i, arr) => i === 0 || v > arr[i - 1]);
    const laps = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const seg = samples.slice(bounds[i], bounds[i + 1]); if (!seg.length) continue;
      const [asc, desc] = ascentOf(seg), st = stats(seg), time = seg.length, dist = seg[seg.length - 1].dist - (bounds[i] > 0 ? samples[bounds[i] - 1].dist : 0);
      laps.push(Object.assign({ start: seg[0].t, end: seg[seg.length - 1].t + 1, time, dist, avgSpeed: dist / time, ascent: asc, descent: desc,
        lat0: seg[0].lat, lon0: seg[0].lon, lat1: seg[seg.length - 1].lat, lon1: seg[seg.length - 1].lon }, st));
    }
    const power = samples.map((s) => s.power), np = normalizedPower(power), st = stats(samples), [asc, desc] = ascentOf(samples), time = samples.length, dist = samples.length ? samples[samples.length - 1].dist : 0;
    const ftp = raw.ftp, ifv = ftp ? np / ftp : undefined, tss = ftp ? (time * np * ifv) / (ftp * 3600) * 100 : undefined;
    const session = Object.assign({ elapsed: time, timer: time, dist, calories: Math.round(mean(power) * time / 1000), avgSpeed: dist / Math.max(1, time), ascent: asc, descent: desc, np, ftp, if_: ifv, tss }, st);
    return { startMs: raw.startMs, name: `Crit Kart ${track.def.name}`, samples, laps, session };
  }

  // ---------- ZIP (store only) ----------
  function zip(files) {
    const out = [], central = []; let offset = 0;
    const w16 = (a, v) => a.push(v & 0xff, (v >> 8) & 0xff), w32 = (a, v) => { v >>>= 0; a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
    const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = Array.from(unescape(encodeURIComponent(f.name))).map((c) => c.charCodeAt(0)), crc = crc32(f.data), size = f.data.length;
      const lh = []; w32(lh, 0x04034b50); w16(lh, 20); w16(lh, 0x0800); w16(lh, 0); w16(lh, dosTime); w16(lh, dosDate); w32(lh, crc); w32(lh, size); w32(lh, size); w16(lh, name.length); w16(lh, 0);
      out.push(Uint8Array.from(lh), Uint8Array.from(name), f.data);
      const ch = []; w32(ch, 0x02014b50); w16(ch, 20); w16(ch, 20); w16(ch, 0x0800); w16(ch, 0); w16(ch, dosTime); w16(ch, dosDate); w32(ch, crc); w32(ch, size); w32(ch, size); w16(ch, name.length); w16(ch, 0); w16(ch, 0); w16(ch, 0); w16(ch, 0); w32(ch, 0); w32(ch, offset);
      central.push(Uint8Array.from(ch), Uint8Array.from(name));
      offset += lh.length + name.length + size;
    }
    const csize = central.reduce((n, a) => n + a.length, 0), end = []; w32(end, 0x06054b50); w16(end, 0); w16(end, 0); w16(end, files.length); w16(end, files.length); w32(end, csize); w32(end, offset); w16(end, 0);
    const parts = out.concat(central, [Uint8Array.from(end)]), total = parts.reduce((n, a) => n + a.length, 0), res = new Uint8Array(total); let p = 0;
    for (const a of parts) { res.set(a, p); p += a.length; }
    return res;
  }

  // ---------- recorder: 1 Hz samples of the player's race ----------
  class Recorder {
    constructor() { this.reset(); }
    reset() { this.samples = []; this.lapEnds = []; this.startMs = null; this.s0 = null; this.acc = { t: 0, p: 0, c: 0, cw: 0, h: 0, hw: 0 }; }
    // call every frame while racing: p = player rider, inputs = { power, cadence, hr }
    tick(dt, p, inputs) {
      if (this.s0 === null) { this.s0 = p.s; this.startMs = Date.now(); }
      const a = this.acc; a.t += dt; a.p += inputs.power * dt; if (inputs.cadence > 0) { a.c += inputs.cadence * dt; a.cw += dt; } if (inputs.hr > 0) { a.h += inputs.hr * dt; a.hw += dt; }
      if (a.t >= 1) {
        this.samples.push({ t: this.samples.length, power: a.p / a.t, cadence: a.cw > 0 ? a.c / a.cw : 0, hr: a.hw > 0 ? a.h / a.hw : 0, speed: p.v, dist: Math.max(0, p.s - this.s0), s: Math.max(0, p.s) });
        this.acc = { t: 0, p: 0, c: 0, cw: 0, h: 0, hw: 0 };
      }
    }
    lap() { this.lapEnds.push(this.samples.length); }
  }

  C.fit = { encode: encodeFit, crc16, MSG, TYPES };
  C.buildActivity = buildActivity;
  C.normalizedPower = normalizedPower;
  C.zip = zip;
  C.crc32 = crc32;
  C.Recorder = Recorder;
})();
