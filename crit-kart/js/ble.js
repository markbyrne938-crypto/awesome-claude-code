// Bluetooth LE layer: smart trainer power (FTMS / Cycling Power) + Zwift Ride controls.
// Uses the Web Bluetooth API (Chrome / Edge on desktop or Android, served from https or localhost).
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});

  const UUID = {
    CPS: 0x1818,
    CPS_MEASUREMENT: 0x2a63,
    FTMS: 0x1826,
    FTMS_INDOOR_BIKE: 0x2ad2,
    FTMS_CONTROL_POINT: 0x2ad9,
    // Zwift Ride / Play / Click controllers (reverse-engineered by the community, not an official API)
    ZWIFT_RIDE: '0000fc82-0000-1000-8000-00805f9b34fb',
    ZWIFT_ASYNC: '00000002-19ca-4651-86e5-fa29dcdd09d1',
    ZWIFT_SYNC_RX: '00000003-19ca-4651-86e5-fa29dcdd09d1',
    ZWIFT_SYNC_TX: '00000004-19ca-4651-86e5-fa29dcdd09d1',
  };

  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Parsers (pure functions, unit tested in test/parsers.test.js) ----

  // FTMS Indoor Bike Data (0x2AD2). Fields appear in a fixed order gated by the flags word.
  function parseFtmsBikeData(dv) {
    const flags = dv.getUint16(0, true);
    let o = 2;
    const out = {};
    if (!(flags & 0x0001)) { out.speedKmh = dv.getUint16(o, true) * 0.01; o += 2; } // bit0 = "more data", inverted
    if (flags & 0x0002) o += 2; // average speed
    if (flags & 0x0004) { out.cadence = dv.getUint16(o, true) * 0.5; o += 2; }
    if (flags & 0x0008) o += 2; // average cadence
    if (flags & 0x0010) o += 3; // total distance
    if (flags & 0x0020) o += 2; // resistance level
    if (flags & 0x0040) { out.power = dv.getInt16(o, true); o += 2; }
    return out;
  }

  // Cycling Power Measurement (0x2A63): flags(u16), power(s16), then optional fields.
  function parseCyclingPower(dv) {
    const flags = dv.getUint16(0, true);
    const out = { power: dv.getInt16(2, true) };
    let o = 4;
    if (flags & 0x0001) o += 1; // pedal power balance
    if (flags & 0x0004) o += 2; // accumulated torque
    if (flags & 0x0010) o += 6; // wheel revolution data
    if (flags & 0x0020) { out.crankRevs = dv.getUint16(o, true); out.crankTime = dv.getUint16(o + 2, true); }
    return out;
  }

  function readVarint(b, i) {
    let r = 0, mul = 1;
    while (i < b.length) {
      const x = b[i++];
      r += (x & 0x7f) * mul;
      if (!(x & 0x80)) break;
      mul *= 128;
    }
    return [r, i];
  }

  // Minimal protobuf reader: varints and length-delimited fields only.
  function parseProto(b) {
    const out = [];
    let i = 0;
    while (i < b.length) {
      let tag;
      [tag, i] = readVarint(b, i);
      const f = Math.floor(tag / 8), w = tag & 7;
      if (w === 0) { let v; [v, i] = readVarint(b, i); out.push({ f, w, v }); }
      else if (w === 2) { let len; [len, i] = readVarint(b, i); out.push({ f, w, bytes: b.subarray(i, i + len) }); i += len; }
      else if (w === 1) i += 8;
      else if (w === 5) i += 4;
      else break;
    }
    return out;
  }

  const zigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

  // Zwift Ride controller notification. Layout (community reverse engineering, treat as best effort):
  //   byte0 = message type (0x23 = key pad status), rest = protobuf
  //   field 1 = button bitmap, repeated length-delimited fields = analog entries {1: location, 2: sint value}
  // Anything unrecognised is returned in `fields` so the debug panel can show it.
  function decodeZwiftMessage(bytes) {
    const type = bytes[0];
    let fields = [];
    try { fields = parseProto(bytes.subarray(1)); } catch (e) { /* ignore malformed */ }
    const msg = { type, buttonMap: null, analog: [], fields };
    for (const fl of fields) {
      if (fl.f === 1 && fl.w === 0 && msg.buttonMap === null) msg.buttonMap = fl.v >>> 0;
      else if (fl.w === 2) {
        try {
          const sub = parseProto(fl.bytes);
          const loc = sub.find((s) => s.f === 1 && s.w === 0);
          const val = sub.find((s) => s.f === 2 && s.w === 0);
          if (loc) msg.analog.push({ loc: loc.v, val: val ? zigzag(val.v) : 0 });
        } catch (e) { /* ignore */ }
      }
    }
    return msg;
  }

  // ---- Trainer link ----

  class TrainerLink {
    constructor(cb) { this.cb = cb; this.queue = Promise.resolve(); this.lastGrade = null; this.lastGradeAt = 0; this.canControl = false; this.lastCrank = null; }

    async connect() {
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [UUID.FTMS] }, { services: [UUID.CPS] }],
        optionalServices: [UUID.FTMS, UUID.CPS],
      });
      this.device = dev;
      dev.addEventListener('gattserverdisconnected', () => { this.canControl = false; this.cb.onStatus('Trainer disconnected'); this.cb.onDisconnect && this.cb.onDisconnect(); });
      await this.attach();
    }

    // Re-open the GATT connection to the already-chosen device (no chooser needed).
    async reconnect() {
      if (!this.device) throw new Error('No trainer selected yet');
      this.lastGrade = null; this.lastCrank = null;
      await this.attach();
    }

    async attach() {
      const dev = this.device;
      const server = await dev.gatt.connect();
      let mode = null;
      try {
        const svc = await server.getPrimaryService(UUID.FTMS);
        const bike = await svc.getCharacteristic(UUID.FTMS_INDOOR_BIKE);
        bike.addEventListener('characteristicvaluechanged', (e) => {
          const d = parseFtmsBikeData(e.target.value);
          if (d.power != null) this.cb.onData(d);
        });
        await bike.startNotifications();
        mode = 'FTMS';
        try {
          this.cp = await svc.getCharacteristic(UUID.FTMS_CONTROL_POINT);
          await this.cp.startNotifications();
          await this.write([0x00]); // request control
          await sleep(250);
          await this.write([0x07]); // start / resume
          this.canControl = true;
        } catch (e) { this.cb.onStatus('Connected (power only, no resistance control)'); }
      } catch (e) {
        const svc = await server.getPrimaryService(UUID.CPS);
        const ch = await svc.getCharacteristic(UUID.CPS_MEASUREMENT);
        ch.addEventListener('characteristicvaluechanged', (ev) => {
          const d = parseCyclingPower(ev.target.value);
          if (d.crankRevs != null) {
            if (this.lastCrank) {
              const dr = (d.crankRevs - this.lastCrank.r + 65536) % 65536;
              const dt = ((d.crankTime - this.lastCrank.t + 65536) % 65536) / 1024;
              if (dt > 0) d.cadence = (dr / dt) * 60;
            }
            this.lastCrank = { r: d.crankRevs, t: d.crankTime };
          }
          this.cb.onData(d);
        });
        await ch.startNotifications();
        mode = 'Cycling Power';
      }
      this.cb.onStatus(`${dev.name || 'Trainer'} connected (${mode}${this.canControl ? ' + resistance' : ''})`);
    }

    write(bytes) {
      const p = this.queue.then(async () => {
        const buf = new Uint8Array(bytes);
        if (this.cp.writeValueWithResponse) await this.cp.writeValueWithResponse(buf); else await this.cp.writeValue(buf);
      });
      this.queue = p.catch(() => {});
      return p;
    }

    // FTMS "Set Indoor Bike Simulation Parameters": the trainer then feels the gradient like the game does.
    setGrade(percent) {
      if (!this.canControl) return;
      const now = performance.now();
      if (this.lastGrade !== null && Math.abs(percent - this.lastGrade) < 0.3 && now - this.lastGradeAt < 3000) return;
      if (now - this.lastGradeAt < 700) return;
      this.lastGrade = percent; this.lastGradeAt = now;
      const g = Math.max(-1000, Math.min(2000, Math.round(percent * 100)));
      const dv = new DataView(new ArrayBuffer(7));
      dv.setUint8(0, 0x11);
      dv.setInt16(1, 0, true);       // wind speed
      dv.setInt16(3, g, true);       // grade, 0.01 %
      dv.setUint8(5, 40);            // crr 0.0040
      dv.setUint8(6, 51);            // cw 0.51 kg/m
      this.write(new Uint8Array(dv.buffer)).catch(() => {});
    }

    disconnect() { try { this.device && this.device.gatt.disconnect(); } catch (e) { /* ignore */ } }
  }

  // ---- Zwift Ride controller link ----

  class ZwiftRideLink {
    constructor(cb) { this.cb = cb; }

    async connect() {
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [UUID.ZWIFT_RIDE] }],
        optionalServices: [UUID.ZWIFT_RIDE],
      });
      this.device = dev;
      dev.addEventListener('gattserverdisconnected', () => { this.cb.onStatus('Controller disconnected'); this.cb.onDisconnect && this.cb.onDisconnect(); });
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService(UUID.ZWIFT_RIDE);
      const chars = {};
      for (const [k, u] of [['async', UUID.ZWIFT_ASYNC], ['tx', UUID.ZWIFT_SYNC_TX], ['rx', UUID.ZWIFT_SYNC_RX]]) {
        try { chars[k] = await svc.getCharacteristic(u); } catch (e) { this.cb.onRaw(`missing characteristic ${k}`); }
      }
      const onNotify = (name) => (e) => {
        const u8 = new Uint8Array(e.target.value.buffer.slice(e.target.value.byteOffset, e.target.value.byteOffset + e.target.value.byteLength));
        this.cb.onRaw(`${name}: ${hex(u8)}`);
        if (name === 'async') { this.gotAsync = true; this.cb.onMessage(decodeZwiftMessage(u8)); }
      };
      for (const k of ['async', 'tx']) {
        if (!chars[k]) continue;
        chars[k].addEventListener('characteristicvaluechanged', onNotify(k));
        try { await chars[k].startNotifications(); } catch (e) { this.cb.onRaw(`notify ${k} failed: ${e.message}`); }
      }
      // Handshake: the device stays quiet until it receives "RideOn". Some firmwares want extra bytes after it,
      // so if nothing arrives we retry with the variants seen in the wild and say so in the log.
      const write = async (bytes) => {
        if (!chars.rx) return;
        const u8 = new Uint8Array(bytes);
        try { if (chars.rx.writeValueWithResponse) await chars.rx.writeValueWithResponse(u8); else await chars.rx.writeValue(u8); }
        catch (e) { this.cb.onRaw(`handshake write failed: ${e.message}`); }
      };
      const rideOn = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e];
      this.gotAsync = false;
      await write(rideOn);
      const variants = [[...rideOn, 0x01, 0x02], [...rideOn, 0x01, 0x04]];
      variants.forEach((v, i) => setTimeout(() => {
        if (this.gotAsync || !dev.gatt.connected) return;
        this.cb.onRaw(`no data yet, retrying handshake variant ${i + 1}`); write(v);
      }, 2500 * (i + 1)));
      this.cb.onStatus(`${dev.name || 'Zwift controller'} connected`);
    }

    disconnect() { try { this.device && this.device.gatt.disconnect(); } catch (e) { /* ignore */ } }
  }

  Object.assign(C, { UUID, parseFtmsBikeData, parseCyclingPower, parseProto, decodeZwiftMessage, TrainerLink, ZwiftRideLink, hexBytes: hex });
})();
