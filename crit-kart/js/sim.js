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
      this.hop = 0; this.wobble = 0; this.scrape = 0; this.obsLast = -1; this.obsT = -9;
      this.ai = null;
    }
  }

  class Race {
    // opts: track, laps, mass (rider+bike, kg), pace (watts for an average AI rider), difficulty (0.8..1.2)
    constructor(opts) {
      this.track = opts.track; this.laps = opts.laps; this.mass = opts.mass; this.pace = opts.pace; this.diff = opts.difficulty || 1;
      this.length = this.track.length; this.total = this.laps * this.length;
      this.time = -4; this.state = 'countdown'; this.events = []; this.hazards = []; this.projectiles = [];
      this.riders = [];
      const player = new Rider('You', '#ff5fa2', true);
      this.player = player;
      const aiList = AI_RIDERS.slice();
      const slots = 8;
      const playerSlot = 5;
      for (let i = 0; i < slots; i++) {
        let r;
        if (i === playerSlot) r = player;
        else { const [n, c] = aiList.shift(); r = new Rider(n, c, false); r.ai = { f: rand(0.88, 1.1), lane: rand(-0.6, 0.6), itemT: 0, attackT: rand(15, 40), attacking: 0, phase: Math.random() * 6, sloppy: Math.random() < 0.3 }; }
        const row = Math.floor(i / 2), col = i % 2;
        r.s = -(row * 3.2 + 1.5); r.x = col ? 0.35 : -0.35;
        this.riders.push(r);
      }
      this.boxes = [];
      for (const s of this.track.boxRows) for (const x of [-0.5, 0, 0.5]) this.boxes.push({ s, x, active: true, respawn: 0 });
      this.finishCountdown = null;
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
      p.power = input.power;
      p.steer = input.steer;

      for (const r of this.riders) {
        if (!r.isPlayer) this.updateAI(r, dt);
        if (r.isPlayer && input.use) this.useItem(r);
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
        if (d > 0.4 && d < 9 && Math.abs(o.x - r.x) < 0.22) best = Math.max(best, 1 - d / 9);
      }
      r.draft += (best - r.draft) * Math.min(1, dt * 4);

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
      r.s += r.v * dt;
      r.phase += r.v * dt * 1.3 + (r.pw > 20 ? dt * 3 : 0);

      // lateral
      const k = Math.min(1, r.v / 4);
      const w = this.track.widthAt(r.s), walled = this.track.wallsAt(r.s);
      const push = this.track.curveAt(r.s) * 0.07 * Math.pow(r.v / 10, 2);
      r.x += ((r.steer * 1.1 * k - push) / w) * dt; // narrower road = same sideways speed in metres, more in road fractions
      r.scrape = Math.max(0, r.scrape - dt);
      if (walled) {
        const lim = 0.97;
        if (Math.abs(r.x) > lim) { r.x = clamp(r.x, -lim, lim); r.v = Math.max(0, r.v - 6 * dt); r.scrape = 0.25; } // grinding along the barrier
      } else r.x = clamp(r.x, -1.3, 1.3);
      r.lean += (clamp(r.steer, -1, 1) - r.lean) * Math.min(1, dt * 6);

      // light bumping so riders don't overlap exactly
      for (const o of this.riders) {
        if (o === r) continue;
        if (Math.abs(o.s - r.s) < 1.1 && Math.abs(o.x - r.x) < 0.1) r.x += (r.x >= o.x ? 1 : -1) * 0.6 * dt;
      }

      r.lap = clamp(Math.floor(Math.max(0, r.s) / this.length) + 1, 1, this.laps);
      if (!r.finished && r.s >= this.total) {
        r.finished = true; r.finishTime = this.time;
        this.emit('finish', { rider: r, place: this.riders.filter((o) => o.finished).length });
      }
      if (r.isPlayer) {
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
        r.v *= clamp(1 - 0.05 - r.v * 0.006, 0.78, 0.95); r.hop = 0.35;
        this.emit('obstacle', { rider: r, kind });
      } else if (kind === 'cone') {
        r.v *= 0.65; r.wobble = 0.7; o.down = true; o.downT = this.time;
        this.emit('obstacle', { rider: r, kind });
      } else if (kind === 'pothole') {
        r.v *= 0.78; r.wobble = 0.5; r.hop = 0.2;
        this.emit('obstacle', { rider: r, kind });
      } else if (kind === 'barrel') {
        o.down = true; o.downT = this.time;
        this.emit('obstacle', { rider: r, kind });
        this.hit(r, 1.0, 'barrel');
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
      const grade = this.track.gradeAt(r.s);
      let w = this.pace * a.f * this.diff * (1 + clamp(grade * 4, -0.25, 0.3));
      w *= 1 + 0.04 * Math.sin(t * 0.7 + a.phase);
      a.attackT -= dt;
      if (a.attacking > 0) { a.attacking -= dt; w *= 1.3; if (a.attacking <= 0) a.attackT = rand(25, 60); }
      else if (a.attackT <= 0) a.attacking = rand(6, 11);
      const gap = r.s - p.s;
      if (gap > 150) w *= 0.92; else if (gap < -150) w *= 1.08; // gentle rubber band keeps the race alive
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
      const lim = this.track.wallsAt(r.s) ? 0.78 : 1.1;
      tx = clamp(tx, -lim, lim);
      r.steer = clamp((tx - r.x) * 3, -1, 1);

      // item use
      if (r.item) {
        a.itemT -= dt;
        if (a.itemT <= 0) {
          a.itemT = rand(1, 3);
          const kind = r.item;
          const behind = this.riders.some((o) => { const d = r.s - o.s; return d > 1 && d < 30; });
          const ahead = this.riders.some((o) => { const d = o.s - r.s; return d > 1 && d < 200; });
          if ((kind === 'banana' && behind) || (kind === 'rocket' && ahead) || kind === 'boost' || kind === 'shield' || (kind === 'golden' && this.leader() !== r)) this.useItem(r);
        }
      }
    }

    results() {
      const order = this.sorted();
      return order.map((r, i) => ({ place: i + 1, name: r.name, color: r.color, isPlayer: r.isPlayer, time: r.finished ? r.finishTime : null, behind: r.finished ? 0 : Math.max(0, this.total - r.s) }));
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

  Object.assign(C, { Race, Rider, ITEMS, CDA, estimateLapTime });
})();
