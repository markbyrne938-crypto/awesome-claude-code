// Race simulation: rider physics (power -> speed), drafting, AI, item boxes and weapons. No rendering here.
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});

  const G = 9.81, RHO = 1.2, CRR = 0.004, EFF = 0.975, CDA = 0.32;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  const ITEMS = {
    banana: { name: 'Banana Peel', desc: 'Drop it behind you' },
    rocket: { name: 'Bidon Bomb', desc: 'Homes in on the rider ahead' },
    boost: { name: 'Energy Gel', desc: '+45% power for 5s' },
    shield: { name: 'Bubble Shield', desc: 'Blocks the next hit' },
    golden: { name: 'Golden Bidon', desc: 'Hits the race leader' },
  };

  // Rival categories: how hard the other riders ride, as a fraction of YOUR FTP (their pace is also varied +-4 % per rider,
  // and they attack now and then, so the bunch averages a little above the base figure).
  const RIVAL_CATS = {
    D: { name: 'Social', factor: 0.85, blurb: 'a relaxed group ride' },
    C: { name: 'Steady', factor: 0.93, blurb: 'a bit under your FTP' },
    B: { name: 'Even match', factor: 1.0, blurb: 'at or just above your FTP' },
    A: { name: 'Hard', factor: 1.08, blurb: 'clearly above your FTP' },
  };
  const rivalPreview = (ftp, cat) => { const base = ftp * RIVAL_CATS[cat].factor; return { base, lo: base * 0.96, avg: base * 1.02, hi: base * 1.07 }; };
  // Zwift-style racing category from your W/kg
  const riderCategory = (wkg) => (wkg >= 4.0 ? 'A' : wkg >= 3.2 ? 'B' : wkg >= 2.5 ? 'C' : 'D');

  const AI_RIDERS = [
    ['Tina Turbo', '#ff4d6d'], ['Sir Spokes', '#4dabf7'], ['Pedro Pedal', '#ffa94d'], ['Cadence Kate', '#b197fc'],
    ['Wattson', '#51cf66'], ['Chain Reaction', '#ffd43b'], ['Gear-ge', '#3bc9db'],
  ];

  class Rider {
    constructor(name, color, isPlayer) {
      this.name = name; this.color = color; this.isPlayer = isPlayer;
      this.s = 0; this.x = 0; this.v = 0; this.power = 0; this.pw = 0; this.steer = 0; this.lean = 0;
      this.item = null; this.stun = 0; this.boost = 0; this.shield = 0; this.invuln = 0; this.draft = 0;
      this.finished = false; this.finishTime = null; this.lap = 1; this.phase = Math.random() * 6; this.grade = 0;
      this.vehLast = -1; this.vehT = -9; this.vx = 0; this.pend = 0; this.rpm = 0; this.cadence = 0; this.cadF = 0.94 + Math.random() * 0.12; this.ghost = 1; this.status = ''; this.pSum = 0; this.pT = 0; this.hop = 0; this.wobble = 0; this.scrape = 0; this.obsLast = -1; this.obsT = -9;
      this.ai = null;
    }
  }

  class Race {
    // opts: track, laps, mass (rider+bike, kg), pace (watts for an average AI rider), difficulty (0.8..1.2)
    constructor(opts) {
      this.track = opts.track; this.laps = opts.laps; this.mass = opts.mass; this.pace = opts.pace; this.diff = opts.difficulty || 1; this.rubber = opts.rubber !== false;
      this.autoSteer = !!opts.autoSteer;      // steering off: the player's rider follows the wheel ahead and overtakes when faster
      this.autoItems = opts.autoItems !== false; // with auto-steer on, also use items automatically
      this.length = this.track.length; this.total = this.laps * this.length;
      this.time = -4; this.state = 'countdown'; this.events = []; this.hazards = []; this.projectiles = [];
      this.riders = [];
      const player = new Rider('You', '#ff5fa2', true);
      this.player = player;
      const aiList = AI_RIDERS.slice();
      const slots = 8;
      const playerSlot = 7; // back of the grid: all seven rivals start ahead and in view
      for (let i = 0; i < slots; i++) {
        let r;
        if (i === playerSlot) r = player;
        else { const [n, c] = aiList.shift(); r = new Rider(n, c, false); const stamina = rand(0.8, 1.2); r.ai = { f: rand(0.96, 1.04), lane: rand(-0.6, 0.6), itemT: 0, attackT: rand(15, 40), attacking: 0, phase: Math.random() * 6, sloppy: Math.random() < 0.3,
          stamina, fade: 0.10 - 0.07 * (stamina - 0.8) / 0.4, wMax: 16000 * rand(0.8, 1.3), sprintStart: rand(160, 320), sprintMult: rand(1.3, 1.7), sprinting: false }; r.ai.wBal = r.ai.wMax; }
        const row = Math.floor(i / 2), col = i % 2;
        r.s = -(row * 2.8 + 1.5); r.x = col ? 0.35 : -0.35;
        this.riders.push(r);
      }
      this.boxes = [];
      for (const s of this.track.boxRows) for (const x of [-0.5, 0, 0.5]) this.boxes.push({ s, x, active: true, respawn: 0 });
      this.finishCountdown = null;
      this.vehicles = []; this.nextVid = 1;
      const spec = this.track.traffic || { parked: [], moving: [], junctions: [] };
      for (const q of spec.parked) this.vehicles.push(this.makeVehicle(Object.assign({ mode: 'parked' }, q)));
      for (const q of spec.moving) this.vehicles.push(this.makeVehicle(Object.assign({ mode: 'traffic' }, q)));
      this.junctions = spec.junctions.map((j) => ({ s: j.s, timer: rand(6, 11), active: null }));
    }

    makeVehicle(o) {
      return { id: this.nextVid++, mode: o.mode, type: o.type, color: o.color, s: o.s, x: o.x, laneX: o.x, vs: o.vs || 0, vx: o.vx || 0, door: !!o.door, doorT: 0, pullOut: !!o.pullOut,
        state: 'idle', timer: 0, blink: false, phase: 'lane', phT: rand(8, 18), swerveDir: 0 };
    }

    emit(type, data) { this.events.push(Object.assign({ type }, data)); }

    rank(r) { let k = 0; for (const o of this.riders) if (this.progress(o) > this.progress(r)) k++; return k; }
    progress(r) { return r.finished ? this.total + 1e6 - r.finishTime : r.s; }
    sorted() { return this.riders.slice().sort((a, b) => this.progress(b) - this.progress(a)); }

    update(dt, input) {
      this.time += dt;
      if (this.state === 'countdown' && this.time >= 0) { this.state = 'racing'; this.emit('go', {}); }
      const racing = this.state !== 'countdown';
      const p = this.player;
      p.power = input.power; p.cadence = input.cadence || 0;
      p.steer = this.autoSteer ? this.autoSteerFor(p, dt) : input.steer;

      for (const r of this.riders) {
        if (!r.isPlayer) this.updateAI(r, dt);
        if (r.isPlayer && input.use) this.useItem(r);
        if (r.isPlayer && this.autoSteer && this.autoItems && racing && r.item) this.autoUseItem(r, dt, r._itemSt || (r._itemSt = { itemT: rand(1.5, 3.5) }));
        this.stepRider(r, dt, racing);
      }
      this.updateWorld(dt);
      if (!p.finished && p.s >= this.total) { /* handled in stepRider */ }
      if (p.finished && this.finishCountdown === null) this.finishCountdown = 14;
      if (this.finishCountdown !== null) {
        this.finishCountdown -= dt;
        if (this.finishCountdown <= 0 || this.riders.every((r) => r.finished)) this.state = 'finished';
      }
    }

    stepRider(r, dt, racing) {
      r.stun = Math.max(0, r.stun - dt); r.boost = Math.max(0, r.boost - dt);
      r.shield = Math.max(0, r.shield - dt); r.invuln = Math.max(0, r.invuln - dt);
      // low-pass filter power a little so trainer jitter doesn't show up in the game
      r.pw += (r.power - r.pw) * (1 - Math.exp(-dt / 0.5));
      if (!racing) { r.lean = 0; return; }

      // drafting
      let best = 0;
      for (const o of this.riders) {
        if (o === r) continue;
        const d = o.s - r.s;
        if (d > 0.4 && d < 9 && Math.abs(o.x - r.x) < 0.3) best = Math.max(best, (1 - d / 9) * (1 - 0.5 * Math.abs(o.x - r.x) / 0.3));
      }
      r.draft += (best - r.draft) * Math.min(1, dt * 4);

      if (!r.finished) { r.pSum += r.pw * dt; r.pT += dt; }
      const grade = this.track.gradeAt(r.s); r.grade = grade;
      const theta = Math.atan(grade);
      let P = r.pw * (r.boost > 0 ? 1.45 : 1);
      let brake = 0;
      if (r.stun > 0) { P = 0; brake = 250; }
      const off = Math.abs(r.x) > 1 ? 0.03 : 0;
      const m = this.mass + 2;
      const cda = CDA * (1 - 0.38 * r.draft);
      const F = (P * EFF) / Math.max(r.v, 1.2)
        - (m * G * ((CRR + off) * Math.cos(theta) + Math.sin(theta)) + 0.5 * RHO * cda * r.v * r.v + brake);
      r.v = Math.max(0, r.v + (F / m) * dt);
      if (r.pend > 0) { const take = r.pend * Math.min(1, dt * 7); r.v = Math.max(0, r.v - take); r.pend -= take; } // impacts bleed speed over ~0.2 s instead of cutting it
      r.s += r.v * dt;
      const rpmT = r.pw < 15 || r.v < 0.5 ? 0 : (r.cadence > 0 ? r.cadence : clamp((58 + r.pw * 0.14 + r.v * 1.2) * r.cadF, 50, 105));
      r.rpm += (rpmT - r.rpm) * Math.min(1, dt * 3);
      r.phase += (r.rpm / 60) * Math.PI * 2 * dt;

      // lateral
      const k = Math.min(1, r.v / 4);
      const w = this.track.widthAt(r.s), walled = this.track.wallsAt(r.s);
      const push = this.track.curveAt(r.s) * 0.045 * Math.pow(r.v / 10, 2);
      // lateral motion has inertia: the bike leans in first, then moves over (response time ~0.18 s), rather than snapping sideways
      r.vx += ((r.steer * 0.9 * k) / w - r.vx) * Math.min(1, dt * 5.5);
      r.x += (r.vx - push / w) * dt;
      r.scrape = Math.max(0, r.scrape - dt);
      if (walled) {
        const lim = 0.97;
        if (Math.abs(r.x) > lim) { if (r.x * r.vx > 0) r.vx = 0; r.x = clamp(r.x, -lim, lim); r.v = Math.max(0, r.v - 6 * dt); r.scrape = 0.25; } // grinding along the barrier
      } else r.x = clamp(r.x, -1.3, 1.3);
      r.lean += (clamp(r.vx, -1, 1) - r.lean) * Math.min(1, dt * 6);

      // No rider-to-rider collisions (as in Zwift): riders pass straight through each other.
      // Overlapping rivals turn slightly see-through so a crowded start or a pass stays readable.
      let overlap = false;
      if (!r.isPlayer) for (const o of this.riders) if (o !== r && Math.abs(o.s - r.s) < 1.6 && Math.abs(o.x - r.x) < 0.2) { overlap = true; break; }
      r.ghost += ((overlap ? 0.62 : 1) - r.ghost) * Math.min(1, dt * 8);

      r.lap = clamp(Math.floor(Math.max(0, r.s) / this.length) + 1, 1, this.laps);
      if (!r.finished && r.s >= this.total) {
        r.finished = true; r.finishTime = this.time;
        this.emit('finish', { rider: r, place: this.riders.filter((o) => o.finished).length });
      }
      if (r.isPlayer) {
        if (!this._bell && r.lap === this.laps && this.laps > 1) { this._bell = true; this.emit('bell', {}); }
        if (!this._sprintCall && this.total - r.s < 300) { this._sprintCall = true; this.emit('sprint', {}); }
        const lapNow = Math.floor(Math.max(0, r.s) / this.length);
        if (r._lapSeen === undefined) { r._lapSeen = lapNow; r._lapStart = 0; }
        else if (lapNow > r._lapSeen && lapNow > 0) {
          this.emit('lap', { lap: Math.min(lapNow + 1, this.laps), lapTime: this.time - r._lapStart, final: lapNow >= this.laps });
          r._lapSeen = lapNow; r._lapStart = this.time;
        }
      }
    }

    hitObstacle(r, o) {
      const kind = o.type;
      if (kind === 'bump') {
        r.pend += r.v * (1 - clamp(1 - 0.05 - r.v * 0.006, 0.78, 0.95)); r.hop = 0.35;
        this.emit('obstacle', { rider: r, kind });
      } else if (kind === 'cone') {
        r.pend += r.v * 0.35; r.wobble = 0.7; o.down = true; o.downT = this.time;
        this.emit('obstacle', { rider: r, kind });
      } else if (kind === 'pothole') {
        r.pend += r.v * 0.22; r.wobble = 0.5; r.hop = 0.2;
        this.emit('obstacle', { rider: r, kind });
      } else if (kind === 'barrel') {
        o.down = true; o.downT = this.time;
        this.emit('obstacle', { rider: r, kind });
        this.hit(r, 1.0, 'barrel');
      }
    }

    // ---- traffic ----
    updateVehicles(dt) {
      const L = this.length, wrap = (d) => ((d % L) + L * 1.5) % L - L / 2;
      const racing = this.state === 'racing';
      let moving = 0; for (const v of this.vehicles) if (v.mode === 'traffic') moving++;
      for (const v of this.vehicles) {
        if (v.mode === 'parked') {
          if (v.door && v.doorT > 0) v.doorT -= dt; // an opened door swings shut again
          else if (v.door && racing && v.state === 'idle') { // a driver checks their mirror too late
            for (const r of this.riders) { const d = wrap(v.s - r.s); if (!r.finished && d > 0 && d < 9 && Math.abs(r.x - Math.sign(v.x) * 0.62) < 0.4 && Math.random() < dt * 0.3) { v.doorT = 1.8; this.emit('door', { vehicle: v }); break; } }
          }
          if (v.pullOut && racing && v.state === 'idle' && moving < 5) {
            for (const r of this.riders) { const d = wrap(v.s - r.s); if (!r.finished && d > 5 && d < 24) { v.state = 'signal'; v.timer = 0.9; this.emit('horn', { vehicle: v }); break; } }
          }
          if (v.state === 'signal') { v.blink = true; v.timer -= dt; if (v.timer <= 0) v.state = 'pull'; }
          else if (v.state === 'pull') {
            v.blink = false; v.vs = Math.min(5.6, v.vs + 3 * dt); v.s += v.vs * dt; v.x += (v.x > 0 ? -1 : 1) * 0.55 * dt;
            if (Math.abs(v.x) < 0.5) { v.mode = 'traffic'; v.laneX = v.x > 0 ? 0.5 : -0.5; v.phase = 'lane'; v.phT = rand(8, 16); moving++; }
          }
        } else if (v.mode === 'traffic') {
          v.s += v.vs * dt;
          // keeps its lane, but now and then drifts toward the middle of the road (indicating first)
          v.phT -= dt;
          // a driver only drifts when the road beside them is empty
          const alongside = this.riders.some((r) => { const d = wrap(v.s - r.s); return !r.finished && d > -14 && d < 10; });
          if (v.phase === 'lane' && v.phT <= 0 && !alongside) { v.phase = 'signal'; v.phT = 0.9; v.blink = true; this.emit('horn', { vehicle: v }); }
          else if (v.phase === 'lane' && v.phT <= 0) v.phT = 1.5;
          else if (v.phase === 'signal' && v.phT <= 0) { v.phase = 'in'; v.phT = 2.4; }
          else if (v.phase === 'in' && v.phT <= 0) { v.phase = 'lane'; v.phT = rand(14, 26); v.blink = false; }
          const tx = v.phase === 'in' ? v.laneX * 0.3 : v.laneX, ox = v.x; // drifts part of the way toward the middle, never across it
          v.x += clamp(tx - v.x, -0.6 * dt, 0.6 * dt); v.vx = (v.x - ox) / dt;
        }
      }
      // cross traffic at junctions
      for (const j of this.junctions) {
        if (!j.active) {
          j.timer -= dt;
          if (j.timer <= 0 && racing) {
            const side = Math.random() < 0.5 ? -1 : 1, v = this.makeVehicle({ mode: 'cross', type: Math.random() < 0.45 ? 'suv' : Math.random() < 0.5 ? 'van' : 'sedan', color: C.CAR_COLORS[Math.floor(Math.random() * C.CAR_COLORS.length)], s: j.s, x: side * 2.3, vx: -side * 1.25 });
            this.vehicles.push(v); j.active = v; j.timer = rand(11, 18); this.emit('crossing', { s: j.s });
            const lead = this.player.s; if (wrap(j.s - lead) > 0 && wrap(j.s - lead) < 140) this.emit('horn', { vehicle: v });
          }
        } else { const v = j.active; v.x += v.vx * dt; if (Math.abs(v.x) > 2.5) { this.vehicles.splice(this.vehicles.indexOf(v), 1); j.active = null; } }
      }
      // collisions with riders
      if (!racing) return;
      const VT = C.VEHICLE_TYPES;
      for (const r of this.riders) {
        if (r.finished || r.invuln > 0) continue;
        const w = this.track.widthAt(r.s), halfRoad = 4.5 * w;
        for (const v of this.vehicles) {
          const d = wrap(v.s - r.s); if (Math.abs(d) > 4) continue;
          const T = VT[v.type]; let hit = null;
          const halfLong = v.mode === 'cross' ? T.wid * halfRoad + 0.5 : T.len / 2 + 0.5, halfLat = v.mode === 'cross' ? T.len / 2 / halfRoad + 0.06 : T.wid + 0.07;
          if (Math.abs(d) < halfLong && Math.abs(v.x - r.x) < halfLat) hit = 'vehicle';
          else if (v.doorT > 0.1 && Math.abs(d) < 1.2 && Math.abs(v.x - Math.sign(v.x) * 0.38 - r.x) < 0.14) hit = 'door';
          if (!hit || (r.vehLast === v.id && this.time - r.vehT < 2.2)) continue;
          r.vehLast = v.id; r.vehT = this.time;
          const secs = hit === 'door' ? 0.8 : v.type === 'sedan' ? 1.1 : 1.5;
          r.pend += r.v * 0.45; r.vx += (r.x >= v.x ? 1 : -1) * 1.5;
          this.emit('vehicle', { rider: r, vehicle: v, kind: hit });
          this.hit(r, secs, 'vehicle');
        }
      }
    }

    updateObstacles(dt) {
      const obs = this.track.obstacles, L = this.length, R = C.OBSTACLE_RADIUS;
      for (const o of obs) if (o.down && o.type !== 'pothole' && this.time - o.downT > 25) o.down = false;
      for (const r of this.riders) {
        r.hop = Math.max(0, r.hop - dt); r.wobble = Math.max(0, r.wobble - dt);
        if (r.finished || this.state === 'countdown') continue;
        for (let i = 0; i < obs.length; i++) {
          const o = obs[i];
          if (o.down && o.type !== 'bump' && o.type !== 'pothole') continue;
          const d = ((o.s - r.s) % L + L * 1.5) % L - L / 2;
          if (Math.abs(d) > 0.9) continue;
          if (o.type !== 'bump' && Math.abs(o.x - r.x) > R[o.type]) continue;
          if (r.obsLast === i && this.time - r.obsT < 1.5) continue;
          r.obsLast = i; r.obsT = this.time;
          this.hitObstacle(r, o);
        }
      }
    }

    updateWorld(dt) {
      this.updateVehicles(dt);
      this.updateObstacles(dt);
      for (const b of this.boxes) { if (!b.active) { b.respawn -= dt; if (b.respawn <= 0) b.active = true; } }
      for (const r of this.riders) {
        if (r.item || r.finished) continue;
        for (const b of this.boxes) {
          if (!b.active) continue;
          const d = ((b.s - r.s) % this.length + this.length * 1.5) % this.length - this.length / 2;
          if (Math.abs(d) < 1.6 && Math.abs(b.x - r.x) < 0.2) {
            b.active = false; b.respawn = 6;
            r.item = this.rollItem(r);
            this.emit('pickup', { rider: r, item: r.item });
            break;
          }
        }
      }
      // hazards
      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const h = this.hazards[i]; h.age += dt;
        let hit = false;
        for (const r of this.riders) {
          if (r === h.owner && h.age < 1.2) continue;
          if (r.invuln > 0) continue;
          const d = ((h.s - r.s) % this.length + this.length * 1.5) % this.length - this.length / 2;
          if (Math.abs(d) < 1.4 && Math.abs(h.x - r.x) < 0.17) { this.hit(r, 1.3, 'banana'); hit = true; break; }
        }
        if (hit || h.age > 40) this.hazards.splice(i, 1);
      }
      // projectiles
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i]; const t = pr.target;
        pr.age += dt;
        pr.s += (Math.max(t.v, 6) + (pr.kind === 'golden' ? 16 : 10)) * dt;
        pr.x += (t.x - pr.x) * Math.min(1, dt * 3);
        if (pr.s >= t.s - 0.3 || pr.age > 25) {
          if (pr.s >= t.s - 0.3) this.hit(t, pr.kind === 'golden' ? 2.6 : 2.0, pr.kind);
          this.projectiles.splice(i, 1);
        }
      }
    }

    hit(r, secs, source) {
      if (r.finished) return;
      if (r.shield > 0) { r.shield = 0; r.invuln = 1; this.emit('blocked', { rider: r }); return; }
      r.stun = secs; r.invuln = secs + 1.5;
      this.emit('hit', { rider: r, source });
    }

    rollItem(r) {
      const rf = this.riders.length > 1 ? this.rank(r) / (this.riders.length - 1) : 0.5; // 0 leader .. 1 last
      const lerp = (a, b) => a + (b - a) * rf;
      const w = { banana: lerp(4, 1), shield: lerp(3, 1), boost: lerp(2, 3), rocket: lerp(2, 3), golden: rf > 0.55 ? lerp(0, 3) : 0 };
      let tot = 0; for (const k in w) tot += w[k];
      let x = Math.random() * tot;
      for (const k in w) { x -= w[k]; if (x <= 0) return k; }
      return 'banana';
    }

    leader() { return this.sorted()[0]; }

    useItem(r) {
      if (!r.item || r.stun > 0 || r.finished) return false;
      const kind = r.item;
      if (kind === 'banana') this.hazards.push({ s: r.s - 3, x: r.x, age: 0, owner: r });
      else if (kind === 'boost') r.boost = 5;
      else if (kind === 'shield') r.shield = 10;
      else if (kind === 'rocket' || kind === 'golden') {
        let target = null;
        if (kind === 'golden') { const l = this.leader(); if (l !== r) target = l; }
        else { let bd = 1e9; for (const o of this.riders) { const d = o.s - r.s; if (d > 0.5 && d < bd && !o.finished) { bd = d; target = o; } } }
        if (!target) { if (r.isPlayer) this.emit('notarget', {}); return false; }
        this.projectiles.push({ s: r.s + 1.5, x: r.x, target, kind, age: 0, owner: r });
        if (target.isPlayer) this.emit('incoming', { kind });
      }
      r.item = null;
      this.emit('use', { rider: r, item: kind });
      return true;
    }

    updateAI(r, dt) {
      const a = r.ai, t = this.time, p = this.player;
      if (this.state === 'countdown') { r.power = 0; return; }
      const grade = this.track.gradeAt(r.s), progress = clamp(r.s / this.total, 0, 1), togo = this.total - r.s;
      // Pacing: a touch fresh at the start, then fading over the race (stamina decides how much). `cp` is what they can sustain right now.
      const cp0 = this.pace * a.f * this.diff, cp = cp0 * (1.06 - a.fade * progress);
      let w = cp * (1 + clamp(grade * 3, -0.2, 0.25));
      w *= 1 + 0.04 * Math.sin(t * 0.7 + a.phase);
      // Attacks need a reserve (W'): they drain it, easy riding refills it slowly, and an empty reserve means a tired rider.
      a.attackT -= dt;
      if (a.attacking > 0) { a.attacking -= dt; w *= 1.25; if (a.attacking <= 0) a.attackT = rand(30, 60); }
      else if (a.attackT <= 0 && a.wBal > 0.6 * a.wMax) a.attacking = rand(5, 9);
      else if (a.attackT <= 0) a.attackT = rand(8, 15);
      const over = w - cp;
      a.wBal = clamp(a.wBal - (over > 0 ? over * dt : over * dt * 0.3), 0, a.wMax);
      if (a.wBal <= 0 && over > 0) { w = cp * 0.96; a.attacking = 0; }
      // The finish: everyone who can goes for it. A rider with energy left sprints hard; an empty one barely lifts.
      if (!a.sprinting && togo < a.sprintStart && this.state === 'racing') a.sprinting = true;
      if (a.sprinting && !r.finished) {
        const left = clamp(0.35 + 0.65 * (a.wBal / a.wMax), 0.35, 1);
        w = cp * (1 + (a.sprintMult - 1) * left);
      }
      r.status = a.sprinting && !r.finished ? 'SPRINT' : a.attacking > 0 ? 'ATTACK' : (a.wBal < 0.2 * a.wMax || a.fade * progress > 0.05) && progress > 0.25 ? 'TIRED' : '';
      const gap = r.s - p.s;
      // optional rubber band (small, so rival power stays tied to your FTP): ease off when far ahead, chase a little when dropped
      if (this.rubber && !a.sprinting) { if (gap > 80) w *= 1 - clamp((gap - 80) / 400, 0, 0.06); else if (gap < -80) w *= 1 + clamp((-gap - 80) / 400, 0, 0.08); }
      r.power = Math.max(0, w);

      // steering: lane + box seeking + hazard dodging
      let tx = a.lane + 0.15 * Math.sin(t * 0.5 + a.phase);
      if (!r.item) {
        let bd = 70, bx = null;
        for (const b of this.boxes) {
          if (!b.active) continue;
          const d = ((b.s - r.s) % this.length + this.length) % this.length;
          if (d > 2 && d < bd) { bd = d; bx = b.x; }
        }
        if (bx !== null) tx = bx;
      }
      for (const h of this.hazards) {
        const d = ((h.s - r.s) % this.length + this.length) % this.length;
        if (d > 0 && d < 28 && Math.abs(h.x - r.x) < 0.32) { tx = h.x + (h.x > 0 ? -0.55 : 0.55); break; }
      }
      for (const o of this.track.obstacles) {
        if (o.type === 'bump' || o.down) continue;
        const d = ((o.s - r.s) % this.length + this.length) % this.length;
        if (d > 0 && d < 26 && Math.abs(o.x - r.x) < 0.3 && !(a.sloppy && ((o.s * 7) | 0) % 2)) { tx = o.x + (o.x > r.x || (o.x === r.x && o.x > 0) ? -0.5 : 0.5); break; }
      }
      if (!(a.sloppy && Math.random() < 0.002)) tx = this.avoidVehicles(r, tx);
      const lim = this.track.wallsAt(r.s) ? 0.78 : 1.1;
      tx = clamp(tx, -lim, lim);
      a.txs = a.txs === undefined ? tx : a.txs + (tx - a.txs) * Math.min(1, dt * 3.5); // ease lane changes
      r.steer = clamp((a.txs - r.x) * 3, -1, 1);

      if (r.item) this.autoUseItem(r, dt, a);
    }

    // Steer around traffic: deal with the nearest vehicle ahead (or alongside), pass on the side facing the middle of the road,
    // and keep the gap until we're clear of it. Cross traffic can't be dodged sideways.
    avoidVehicles(r, tx) {
      const L = this.length, VT = C.VEHICLE_TYPES; let best = null, bd = 34;
      for (const v of this.vehicles) {
        if (v.mode === 'cross') continue;
        const d = ((v.s - r.s) % L + L * 1.5) % L - L / 2, T = VT[v.type];
        if (d > -(T.len / 2 + 2) && d < bd) { bd = d; best = v; }
      }
      if (!best) return tx;
      const T = VT[best.type], ttc = Math.max(0, bd) / Math.max(0.5, r.v - best.vs), xAt = best.x + (best.vx || 0) * Math.min(ttc, 1.5), need = T.wid + 0.22;
      if (Math.abs(xAt - r.x) > need + 0.3 && Math.abs(xAt - tx) > need) return tx; // already clear
      const left = xAt - (need + 0.1), right = xAt + (need + 0.1), pref = xAt >= 0 ? left : right, alt = xAt >= 0 ? right : left;
      return Math.abs(pref) <= 0.9 ? pref : alt;
    }

    // Sensible automatic item use, shared by the AI and by a player with steering/items on auto.
    autoUseItem(r, dt, st) {
      st.itemT -= dt;
      if (st.itemT > 0) return;
      st.itemT = rand(1, 3);
      const kind = r.item;
      const behind = this.riders.some((o) => { const d = r.s - o.s; return d > 1 && d < 30; });
      const ahead = this.riders.some((o) => { const d = o.s - r.s; return d > 1 && d < 200; });
      if ((kind === 'banana' && behind) || (kind === 'rocket' && ahead) || kind === 'boost' || kind === 'shield' || (kind === 'golden' && this.leader() !== r)) this.useItem(r);
    }

    // Steering for a rider who can't steer. Sit in the wheel of the rider ahead (that's where the draft is); if we're going
    // faster than them, pull out to the freer side and pass, then pick up the next wheel. Always dodge obstacles and grab
    // boxes that don't cost us the draft.
    autoSteerFor(r, dt = 1 / 60) {
      const L = this.length, lim = this.track.wallsAt(r.s) ? 0.75 : 0.95, st = r._auto || (r._auto = { ot: null });
      // the wheel to follow: close ahead AND close to our line (a rider two lanes over is no use for the draft)
      let lead = st.lead && !st.lead.finished && st.lead.s - r.s > 0.3 && st.lead.s - r.s < 30 ? st.lead : null, bd = lead ? lead.s - r.s : 30, bestScore = lead ? bd + 14 * Math.abs(lead.x - r.x) - 4 : 1e9; // sticky: keep the current leader unless a clearly better one appears
      for (const o of this.riders) { if (o === r || o.finished) continue; const d = o.s - r.s; if (d <= 0.3 || d >= 30) continue; const sc = d + 14 * Math.abs(o.x - r.x); if (sc < bestScore) { bestScore = sc; lead = o; bd = d; } }
      st.lead = lead;
      let tx = 0;
      if (st.ot) { // finish the pass we started
        const t = st.ot.rider, d = t.s - r.s;
        if (d < -3 || d > 40) st.ot = null; else tx = t.x + st.ot.side * 0.5;
      }
      if (!st.ot && lead) {
        const closing = r.v - lead.v;
        // clearly faster: pull out early. Only slightly faster (we just creep up in the draft): stay tucked in until we're nearly on their wheel.
        const trigger = closing > 0.6 ? clamp(3 + 3 * closing, 3, 10) : 1.8;
        if (bd < trigger && closing > 0.05) {
          let side = lead.x > 0.1 ? -1 : lead.x < -0.1 ? 1 : (r.x >= lead.x ? 1 : -1); // toward the middle of the road
          const free = (sd) => { const cx = lead.x + sd * 0.5; return Math.abs(cx) <= lim && !this.riders.some((o) => o !== r && o !== lead && !o.finished && o.s - r.s > -2 && o.s - r.s < 14 && Math.abs(o.x - cx) < 0.25); };
          if (!free(side) && free(-side)) side = -side;
          st.ot = { rider: lead, side }; tx = lead.x + side * 0.5;
        } else tx = lead.x;
      }
      if (!r.item && !st.ot) { // boxes: only small detours while tucked in behind someone
        const reach = lead && bd < 12 ? 0.3 : 0.9; let best = 45, box = null;
        for (const b of this.boxes) { if (!b.active || Math.abs(b.x) > lim) continue; const d = ((b.s - r.s) % L + L) % L; if (d > 2 && d < best && Math.abs(b.x - tx) < reach) { best = d; box = b; } }
        if (box) tx = box.x;
      }
      for (const h of this.hazards) { const d = ((h.s - r.s) % L + L) % L; if (d > 0 && d < 28 && Math.abs(h.x - r.x) < 0.32) { tx = h.x + (h.x > 0 ? -0.55 : 0.55); break; } }
      for (const o of this.track.obstacles) {
        if (o.type === 'bump' || o.down) continue;
        const d = ((o.s - r.s) % L + L) % L;
        if (d > 0 && d < 26 && Math.abs(o.x - r.x) < 0.3) { tx = o.x + (o.x > r.x || (o.x === r.x && o.x > 0) ? -0.5 : 0.5); break; }
      }
      tx = this.avoidVehicles(r, tx);
      tx = clamp(tx, -lim, lim);
      st.txs = st.txs === undefined ? tx : st.txs + (tx - st.txs) * Math.min(1, dt * 3.5);
      return clamp((st.txs - r.x) * 3.2, -1, 1);
    }

    results() {
      const order = this.sorted();
      return order.map((r, i) => ({ place: i + 1, name: r.name, color: r.color, isPlayer: r.isPlayer, time: r.finished ? r.finishTime : null, behind: r.finished ? 0 : Math.max(0, this.total - r.s), avgPower: r.pT > 0 ? r.pSum / r.pT : 0 }));
    }
  }

  // Solo lap time (seconds) at constant power, for the menu's race-length estimate.
  function estimateLapTime(track, power, mass) {
    const m = mass + 2; let v = 6, s = 0, t = 0, mark = 0, lapT = 0;
    const dt = 0.1;
    while (s < track.length * 3) {
      const th = Math.atan(track.gradeAt(s));
      const F = (power * EFF) / Math.max(v, 1.2) - (m * G * (CRR * Math.cos(th) + Math.sin(th)) + 0.5 * RHO * CDA * v * v);
      v = Math.max(0.5, v + (F / m) * dt); s += v * dt; t += dt;
      if (s >= track.length * 2 && !mark) { mark = t; }
      if (s >= track.length * 3) lapT = t - mark;
    }
    return lapT * 1.15; // allowance for the standing start, cornering and obstacles
  }

  Object.assign(C, { Race, Rider, ITEMS, CDA, estimateLapTime, RIVAL_CATS, rivalPreview, riderCategory });
})();
