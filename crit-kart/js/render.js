// Pseudo-3D cartoon renderer (road projection after the classic "OutRun" approach) + HUD.
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});
  const { UNIT, SEG_LEN, ITEMS } = C;

  const ROAD_W = 2000, CAM_H = 1000, CAM_BACK = 1300, DEPTH = 1 / Math.tan((86 / 2) * Math.PI / 180), DRAW_MAX = 130;
  const FONT = '"Trebuchet MS","Arial Rounded MT Bold",system-ui,sans-serif';
  const INK = '#1b1b2f';
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ZONES = [[0.55, '#9aa5b1'], [0.75, '#4dabf7'], [0.9, '#51cf66'], [1.05, '#ffd43b'], [1.2, '#ff922b'], [1.5, '#ff4d4d'], [99, '#b44dff']];
  const zoneColor = (ratio) => { for (const [t, c] of ZONES) if (ratio < t) return c; return ZONES[ZONES.length - 1][1]; };

  function fmtTime(t) {
    if (t < 0) t = 0;
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }

  // ---- little drawing helpers ----
  function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, str, x, y, size, fill, align = 'left', stroke = INK) {
    ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size * 0.18); ctx.strokeStyle = stroke; ctx.strokeText(str, x, y);
    ctx.fillStyle = fill; ctx.fillText(str, x, y);
  }
  function panel(ctx, x, y, w, h, fill = 'rgba(255,255,255,0.9)', r = 16) {
    ctx.save(); rrect(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke(); ctx.restore();
  }

  function drawItemIcon(ctx, kind, cx, cy, s) {
    ctx.save(); ctx.translate(cx, cy); ctx.lineWidth = Math.max(1.5, s * 0.07); ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (kind === 'banana') {
      ctx.rotate(-0.4); ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0.15 * Math.PI, 0.95 * Math.PI);
      ctx.bezierCurveTo(-s * 0.3, s * 0.1, s * 0.1, s * 0.15, s * 0.4, -s * 0.05); ctx.closePath();
      ctx.fillStyle = '#ffe14d'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6b4a1e'; ctx.fillRect(s * 0.36, -s * 0.12, s * 0.1, s * 0.1);
    } else if (kind === 'rocket' || kind === 'golden') {
      const gold = kind === 'golden';
      ctx.fillStyle = '#ff9a3c'; ctx.beginPath(); ctx.moveTo(-s * 0.12, s * 0.3); ctx.lineTo(0, s * 0.62); ctx.lineTo(s * 0.12, s * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
      rrect(ctx, -s * 0.2, -s * 0.28, s * 0.4, s * 0.6, s * 0.12); ctx.fillStyle = gold ? '#ffd43b' : '#ff4d6d'; ctx.fill(); ctx.stroke();
      rrect(ctx, -s * 0.1, -s * 0.46, s * 0.2, s * 0.18, s * 0.05); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-s * 0.2 + s * 0.06, -s * 0.2, s * 0.06, s * 0.35);
      if (gold) { text(ctx, '★', 0, s * 0.05, s * 0.3, '#fff'); }
    } else if (kind === 'boost') {
      ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2); ctx.fillStyle = '#5be37d'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.08, -s * 0.34); ctx.lineTo(-s * 0.2, s * 0.04); ctx.lineTo(-s * 0.02, s * 0.04); ctx.lineTo(-s * 0.1, s * 0.34); ctx.lineTo(s * 0.22, -s * 0.06); ctx.lineTo(s * 0.03, -s * 0.06); ctx.closePath();
      ctx.fillStyle = '#fff176'; ctx.fill(); ctx.stroke();
    } else if (kind === 'shield') {
      ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2); ctx.fillStyle = 'rgba(120,220,255,.75)'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.14, s * 0.14, Math.PI, Math.PI * 1.6); ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    ctx.restore();
  }

  function drawRider(ctx, x, y, w, r, time) {
    const u = w;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(ctx, 0, 0, u * 0.36, u * 0.07); ctx.fill();
    ctx.rotate(r.lean * 0.2 + (r.stun > 0 ? Math.sin(time * 18) * 0.3 : 0));
    const lw = Math.max(1.2, u * 0.035);
    ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // wheel
    ctx.fillStyle = '#2b2b3d'; ellipse(ctx, 0, -u * 0.31, u * 0.065, u * 0.31); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#8c8ca8'; ctx.lineWidth = lw * 0.6; ellipse(ctx, 0, -u * 0.31, u * 0.03, u * 0.26); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = lw;
    // frame + saddle
    ctx.beginPath(); ctx.moveTo(0, -u * 0.3); ctx.lineTo(0, -u * 0.58); ctx.stroke();
    ctx.fillStyle = '#333'; rrect(ctx, -u * 0.07, -u * 0.62, u * 0.14, u * 0.05, u * 0.02); ctx.fill(); ctx.stroke();
    // legs
    const a = Math.sin(r.phase), b = Math.sin(r.phase + Math.PI);
    for (const [sd, ph] of [[-1, a], [1, b]]) {
      const hx = sd * u * 0.09, hy = -u * 0.62, fx = sd * u * 0.14, fy = -u * 0.2 + ph * u * 0.1;
      ctx.lineWidth = u * 0.13 + lw * 2; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.lineWidth = u * 0.13; ctx.strokeStyle = '#2d3561'; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = lw; ellipse(ctx, fx, fy + u * 0.02, u * 0.08, u * 0.04); ctx.fill(); ctx.stroke();
    }
    // arms + bars
    ctx.strokeStyle = INK; ctx.lineWidth = u * 0.07 + lw * 2;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * u * 0.17, -u * 0.95); ctx.lineTo(sd * u * 0.3, -u * 0.72); ctx.stroke(); }
    ctx.strokeStyle = r.color; ctx.lineWidth = u * 0.07;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * u * 0.17, -u * 0.95); ctx.lineTo(sd * u * 0.3, -u * 0.72); ctx.stroke(); }
    ctx.strokeStyle = INK; ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.moveTo(-u * 0.34, -u * 0.71); ctx.lineTo(u * 0.34, -u * 0.71); ctx.stroke();
    // torso
    ctx.lineWidth = lw; ctx.fillStyle = r.color; ellipse(ctx, 0, -u * 0.83, u * 0.2, u * 0.25); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = u * 0.045; ctx.beginPath(); ctx.moveTo(-u * 0.17, -u * 0.8); ctx.quadraticCurveTo(0, -u * 0.74, u * 0.17, -u * 0.8); ctx.stroke();
    // head + helmet
    ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.fillStyle = '#ffd7b5'; ellipse(ctx, 0, -u * 1.1, u * 0.125, u * 0.125); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, -u * 1.15, u * 0.15, u * 0.12, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = r.color; ctx.fillRect(-u * 0.02, -u * 1.27, u * 0.04, u * 0.12);
    // status effects
    if (r.shield > 0) {
      const g = ctx.createRadialGradient(0, -u * 0.6, u * 0.2, 0, -u * 0.6, u * 0.8);
      g.addColorStop(0, 'rgba(120,220,255,0.05)'); g.addColorStop(1, 'rgba(120,220,255,0.55)');
      ctx.fillStyle = g; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = lw; ellipse(ctx, 0, -u * 0.6, u * 0.7, u * 0.8); ctx.fill(); ctx.stroke();
    }
    if (r.boost > 0) {
      ctx.strokeStyle = 'rgba(255,230,80,.9)'; ctx.lineWidth = lw * 1.5;
      for (let i = 0; i < 6; i++) { const yy = -u * (0.15 + 0.14 * i), off = ((time * 5 + i * 0.37) % 1) * u * 0.25; ctx.beginPath(); ctx.moveTo(-u * 0.5 - off, yy); ctx.lineTo(-u * 0.35 - off, yy); ctx.moveTo(u * 0.5 + off, yy); ctx.lineTo(u * 0.35 + off, yy); ctx.stroke(); }
    }
    if (r.stun > 0) for (let i = 0; i < 3; i++) { const an = time * 6 + (i * Math.PI * 2) / 3; text(ctx, '★', Math.cos(an) * u * 0.28, -u * 1.38 + Math.sin(an) * u * 0.06, u * 0.2, '#ffe14d'); }
    ctx.restore();
  }

  function drawScenery(ctx, sp, x, y, pu) {
    const s = sp.scale; ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const lw = Math.max(1, pu * 14); ctx.lineWidth = lw; ctx.strokeStyle = INK;
    const hsl = (l) => `hsl(${sp.hue},70%,${l}%)`;
    if (sp.type === 'tree') {
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-pu * 35 * s, -pu * 260 * s, pu * 70 * s, pu * 260 * s); ctx.strokeRect(-pu * 35 * s, -pu * 260 * s, pu * 70 * s, pu * 260 * s);
      ctx.fillStyle = '#46c04a';
      for (const [cx, cy, r] of [[0, -420, 200], [-130, -330, 150], [130, -330, 150]]) { ellipse(ctx, cx * pu * s, cy * pu * s, r * pu * s, r * pu * s); ctx.fill(); ctx.stroke(); }
    } else if (sp.type === 'bush') {
      ctx.fillStyle = '#5fd35b';
      for (const [cx, cy, r] of [[-70, -60, 80], [70, -60, 80], [0, -100, 95]]) { ellipse(ctx, cx * pu * s, cy * pu * s, r * pu * s, r * pu * s); ctx.fill(); ctx.stroke(); }
    } else if (sp.type === 'sign') {
      ctx.fillStyle = '#6b4a1e'; ctx.fillRect(-pu * 15 * s, -pu * 260 * s, pu * 30 * s, pu * 260 * s); ctx.strokeRect(-pu * 15 * s, -pu * 260 * s, pu * 30 * s, pu * 260 * s);
      rrect(ctx, -pu * 130 * s, -pu * 420 * s, pu * 260 * s, pu * 170 * s, pu * 30); ctx.fillStyle = hsl(60); ctx.fill(); ctx.stroke();
      text(ctx, ['GO!', 'WATTS', 'PEDAL', 'HUP!'][sp.hue % 4], 0, -pu * 335 * s, pu * 70 * s, '#fff');
    } else if (sp.type === 'lolly') {
      ctx.fillStyle = '#fff'; ctx.fillRect(-pu * 14 * s, -pu * 330 * s, pu * 28 * s, pu * 330 * s); ctx.strokeRect(-pu * 14 * s, -pu * 330 * s, pu * 28 * s, pu * 330 * s);
      ctx.fillStyle = hsl(62); ellipse(ctx, 0, -pu * 430 * s, pu * 130 * s, pu * 130 * s); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.arc(0, -pu * 430 * s, pu * 70 * s, 0, Math.PI * 3.2); ctx.stroke();
    } else if (sp.type === 'cane') {
      ctx.strokeStyle = INK; ctx.lineWidth = pu * 60 * s + lw * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -pu * 380 * s); ctx.arc(pu * 80 * s, -pu * 380 * s, pu * 80 * s, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = pu * 60 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -pu * 380 * s); ctx.arc(pu * 80 * s, -pu * 380 * s, pu * 80 * s, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = '#ff4d6d'; ctx.setLineDash([pu * 30 * s, pu * 50 * s]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -pu * 380 * s); ctx.stroke(); ctx.setLineDash([]);
    } else if (sp.type === 'lamp') {
      ctx.fillStyle = '#4b4f8a'; ctx.fillRect(-pu * 14 * s, -pu * 460 * s, pu * 28 * s, pu * 460 * s); ctx.strokeRect(-pu * 14 * s, -pu * 460 * s, pu * 28 * s, pu * 460 * s);
      for (let i = 3; i >= 1; i--) { ctx.fillStyle = `rgba(0,240,255,${0.12 * (4 - i)})`; ellipse(ctx, 0, -pu * 480 * s, pu * 55 * i * s, pu * 55 * i * s); ctx.fill(); }
      ctx.fillStyle = '#e8ffff'; ctx.lineWidth = lw; ellipse(ctx, 0, -pu * 480 * s, pu * 40 * s, pu * 40 * s); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  class Renderer {
    constructor(canvas) { this.cv = canvas; this.ctx = canvas.getContext('2d'); this.bg = 0; this.resize(); }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = window.innerWidth; this.H = window.innerHeight;
      this.cv.width = Math.floor(this.W * dpr); this.cv.height = Math.floor(this.H * dpr);
      this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ui = clamp(Math.min(this.W / 1280, this.H / 720), 0.6, 1.5);
    }

    project(p, camX, camY, camZ) {
      const { W, H } = this;
      p.camera.x = (p.world.x || 0) - camX; p.camera.y = p.world.y - camY; p.camera.z = p.world.z - camZ;
      p.screen.scale = DEPTH / p.camera.z;
      p.screen.x = Math.round(W / 2 + (p.screen.scale * p.camera.x * W) / 2);
      p.screen.y = Math.round(H / 2 - (p.screen.scale * p.camera.y * H) / 2);
      p.screen.w = Math.round((p.screen.scale * ROAD_W * W) / 2);
    }

    poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
      const c = this.ctx; c.fillStyle = color; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.lineTo(x4, y4); c.closePath(); c.fill();
    }

    drawBackground(race, dt) {
      const { ctx, W, H } = this, th = race.track.theme, p = race.player;
      const g = ctx.createLinearGradient(0, 0, 0, H / 2 + 20); g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H / 2 + 20);
      this.bg += race.track.curveAt(p.s) * p.v * dt * 1.6;
      if (th.stars) { ctx.fillStyle = '#fff'; for (let i = 0; i < 70; i++) { const x = ((i * 977 + 13) % 1000) / 1000 * W, y = ((i * 613 + 7) % 1000) / 1000 * H * 0.45; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 2 + i); ctx.fillRect(x, y, 2, 2); } ctx.globalAlpha = 1; }
      ctx.fillStyle = th.sun; ctx.globalAlpha = 0.95; ellipse(ctx, W * 0.72 - this.bg * 0.05 % W, H * 0.2, H * 0.09, H * 0.09); ctx.fill(); ctx.globalAlpha = 1;
      const base = H / 2;
      [[0.35, 0.22, 0.6], [0.9, 0.14, 1.0]].forEach(([sp, amp, wl], li) => {
        ctx.fillStyle = th.hills[li]; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, base + 4);
        const off = this.bg * sp;
        for (let x = 0; x <= W; x += 8) {
          const xx = x + off; const y = base - H * amp * (0.45 + 0.3 * Math.sin(xx / (180 * wl)) + 0.25 * Math.sin(xx / (71 * wl) + li));
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, base + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      // clouds
      if (!th.stars) { ctx.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 4; i++) { const x = (((i * 400 + this.bg * 0.12) % (W + 300)) + W + 300) % (W + 300) - 150, y = H * (0.1 + 0.07 * (i % 3)); for (const [dx, r] of [[-40, 28], [0, 38], [45, 26]]) { ellipse(ctx, x + dx, y, r, r * 0.7); ctx.fill(); } } }
      ctx.fillStyle = th.grass[0]; ctx.fillRect(0, base, W, H - base);
    }

    render(race, dt, hud) {
      this.t = (this.t || 0) + dt;
      const { ctx, W, H } = this, track = race.track, segs = track.segs, N = track.N, T = track.trackLen, p = race.player, th = track.theme;
      const DRAW = Math.min(DRAW_MAX, N - CAM_BACK / SEG_LEN - 4 | 0); // never wrap past the camera segment
      this.drawBackground(race, dt);

      const mod = (z) => ((z % T) + T) % T;
      const camZ = mod(p.s * UNIT - CAM_BACK);
      const baseI = Math.floor(camZ / SEG_LEN), base = segs[baseI], pct = (camZ % SEG_LEN) / SEG_LEN;
      const camY = lerp(base.y1, base.y2, pct) + CAM_H;
      const camX = p.x * ROAD_W * 0.8;
      let dx = -(base.curve * pct), x = 0, maxy = H;

      for (let n = 0; n < DRAW; n++) {
        const seg = segs[(baseI + n) % N], looped = seg.i < baseI, z = camZ - (looped ? T : 0);
        this.project(seg.p1, camX - x, camY, z); this.project(seg.p2, camX - x - dx, camY, z);
        x += dx; dx += seg.curve; seg.clip = maxy;
        const a = seg.p1.screen, b = seg.p2.screen;
        if (a.scale <= 0 || a.scale > 40 || seg.p1.camera.z <= DEPTH || b.y >= a.y || b.y >= maxy) continue;
        const gr = th.grass[seg.alt]; ctx.fillStyle = gr; ctx.fillRect(0, b.y, W, a.y - b.y);
        const r1 = a.w / 6, r2 = b.w / 6, rc = th.rumble[seg.alt];
        this.poly(a.x - a.w - r1, a.y, a.x - a.w, a.y, b.x - b.w, b.y, b.x - b.w - r2, b.y, rc);
        this.poly(a.x + a.w + r1, a.y, a.x + a.w, a.y, b.x + b.w, b.y, b.x + b.w + r2, b.y, rc);
        if (seg.i < 2) {
          for (let c = 0; c < 8; c++) {
            const t0 = c / 8, t1 = (c + 1) / 8, col = (c + seg.i) % 2 ? '#1b1b2f' : '#ffffff';
            this.poly(a.x - a.w + 2 * a.w * t0, a.y, a.x - a.w + 2 * a.w * t1, a.y, b.x - b.w + 2 * b.w * t1, b.y, b.x - b.w + 2 * b.w * t0, b.y, col);
          }
        } else this.poly(a.x - a.w, a.y, a.x + a.w, a.y, b.x + b.w, b.y, b.x - b.w, b.y, th.road[seg.alt]);
        if (seg.alt && seg.i >= 2) {
          const l1 = a.w / 28, l2 = b.w / 28; // dashed centre line
          this.poly(a.x - l1, a.y, a.x + l1, a.y, b.x + l2, b.y, b.x - l2, b.y, th.lane);
        }
        const fog = clamp((n / DRAW) * (n / DRAW) * 1.1, 0, 1);
        if (fog > 0.02) { ctx.globalAlpha = fog; ctx.fillStyle = th.fog; ctx.fillRect(0, b.y, W, a.y - b.y); ctx.globalAlpha = 1; }
        maxy = b.y;
      }

      // bucket sprites by segment
      const buckets = new Array(DRAW);
      const put = (s, sp) => {
        const z = mod(s * UNIT), idx = Math.floor(z / SEG_LEN), n = (idx - baseI + N) % N;
        if (n < 1 || n >= DRAW) return;
        if (sp.minN && n < sp.minN) return;
        sp.pct = (z % SEG_LEN) / SEG_LEN; (buckets[n] || (buckets[n] = [])).push(sp);
      };
      for (let n = 1; n < DRAW; n++) for (const sc of segs[(baseI + n) % N].scenery) (buckets[n] || (buckets[n] = [])).push({ kind: 'scenery', off: sc.off, pct: 0.5, sc });
      // finish gantry
      { const z0 = 0, idx = 1, n = (idx - baseI + N) % N; if (n >= 1 && n < DRAW) (buckets[n] || (buckets[n] = [])).push({ kind: 'gantry', off: 0, pct: 0 }); }
      for (const b of race.boxes) if (b.active) put(b.s, { kind: 'box', off: b.x, b });
      for (const h of race.hazards) put(h.s, { kind: 'banana', off: h.x });
      for (const pr of race.projectiles) put(pr.s, { kind: 'proj', off: pr.x, pr });
      for (const r of race.riders) put(r.s, { kind: 'rider', off: r.x, r, minN: r.isPlayer ? 1 : 3 });

      for (let n = DRAW - 1; n >= 1; n--) {
        const list = buckets[n]; if (!list) continue;
        const seg = segs[(baseI + n) % N], a = seg.p1.screen, b = seg.p2.screen;
        if (!a.scale || a.scale < 0 || seg.p1.camera.z <= DEPTH) continue;
        const clip = Math.min(H, seg.clip);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, clip + (clip < H ? 2 : 0)); ctx.clip();
        for (const sp of list) {
          const sc = lerp(a.scale, b.scale, sp.pct), pu = (sc * W) / 2;
          const sx = lerp(a.x, b.x, sp.pct) + sc * sp.off * ROAD_W * W / 2, sy = lerp(a.y, b.y, sp.pct);
          if (sp.kind === 'scenery') drawScenery(ctx, sp.sc, sx, sy, pu);
          else if (sp.kind === 'rider') {
            const r = sp.r; drawRider(ctx, sx, sy, pu * 280, r, this.t);
            if (pu * 280 > 28) {
              const sz = clamp(pu * 280 * 0.2, 10, 20);
              if (r.isPlayer) { ctx.save(); ctx.translate(sx, sy - pu * 280 * 1.55); ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-sz * 0.6, -sz * 0.6); ctx.lineTo(sz * 0.6, -sz * 0.6); ctx.lineTo(0, sz * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
              else text(ctx, r.name, sx, sy - pu * 280 * 1.5, sz, '#fff', 'center');
            }
          } else if (sp.kind === 'box') {
            const bob = Math.sin(this.t * 3 + sp.b.s) * pu * 25, size = pu * 200, cy = sy - pu * 150 + bob;
            ctx.save(); ctx.translate(sx, cy); ctx.rotate(Math.sin(this.t * 2 + sp.b.x) * 0.15);
            const g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
            const hh = (this.t * 80) % 360; g.addColorStop(0, `hsl(${hh},90%,60%)`); g.addColorStop(1, `hsl(${hh + 120},90%,60%)`);
            rrect(ctx, -size / 2, -size / 2, size, size, size * 0.2); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = Math.max(2, size * 0.07); ctx.strokeStyle = INK; ctx.stroke();
            text(ctx, '?', 0, 0, size * 0.7, '#fff'); ctx.restore();
          } else if (sp.kind === 'banana') drawItemIcon(ctx, 'banana', sx, sy - pu * 60, pu * 190);
          else if (sp.kind === 'proj') {
            ctx.fillStyle = 'rgba(255,160,60,.6)'; ellipse(ctx, sx, sy - pu * 120, pu * 40, pu * 90); ctx.fill();
            drawItemIcon(ctx, sp.pr.kind, sx, sy - pu * 150, pu * 220);
          } else if (sp.kind === 'gantry') {
            const L = sx - sc * ROAD_W * 1.15 * W / 2, R = sx + sc * ROAD_W * 1.15 * W / 2, hgt = pu * 1500;
            ctx.lineWidth = Math.max(2, pu * 30); ctx.strokeStyle = INK; ctx.fillStyle = '#e8e8f5';
            ctx.fillRect(L - pu * 40, sy - hgt, pu * 80, hgt); ctx.strokeRect(L - pu * 40, sy - hgt, pu * 80, hgt);
            ctx.fillRect(R - pu * 40, sy - hgt, pu * 80, hgt); ctx.strokeRect(R - pu * 40, sy - hgt, pu * 80, hgt);
            rrect(ctx, L - pu * 40, sy - hgt - pu * 40, R - L + pu * 80, pu * 220, pu * 40); ctx.fillStyle = '#ff5fa2'; ctx.fill(); ctx.stroke();
            text(ctx, 'FINISH  •  LAP', (L + R) / 2, sy - hgt + pu * 70, pu * 150, '#fff', 'center');
          }
        }
        ctx.restore();
      }
      if (!hud.menu) this.drawHUD(race, hud);
    }

    // ---- HUD ----
    drawHUD(race, hud) {
      const { ctx, W, H, ui } = this, p = race.player, tr = race.track;
      const S = (v) => v * ui;
      ctx.save();
      // power panel
      const px = S(16), py = S(16), pw = S(250), ph = S(150);
      panel(ctx, px, py, pw, ph);
      const ratio = hud.ftp ? hud.power / hud.ftp : 0, zc = zoneColor(ratio);
      text(ctx, String(Math.round(hud.power)), px + S(16), py + S(52), S(68), zc, 'left');
      text(ctx, 'WATTS', px + pw - S(16), py + S(30), S(20), '#fff', 'right');
      ctx.fillStyle = 'rgba(0,0,0,.18)'; rrect(ctx, px + S(16), py + S(92), pw - S(32), S(14), S(7)); ctx.fill();
      ctx.fillStyle = zc; rrect(ctx, px + S(16), py + S(92), Math.max(S(8), (pw - S(32)) * clamp(ratio / 1.6, 0, 1)), S(14), S(7)); ctx.fill();
      text(ctx, `${(hud.power / hud.weight).toFixed(1)} W/kg`, px + S(16), py + S(128), S(20), '#fff');
      text(ctx, `${hud.cadence ? Math.round(hud.cadence) : '--'} rpm`, px + S(140), py + S(128), S(20), '#fff');
      text(ctx, `${(p.v * 3.6).toFixed(1)} km/h`, px + S(16), py + ph + S(22), S(22), '#fff');
      const gp = p.grade * 100, gcol = gp > 0.5 ? '#ff922b' : gp < -0.5 ? '#51cf66' : '#fff';
      text(ctx, `${gp > 0.5 ? '▲' : gp < -0.5 ? '▼' : '►'} ${Math.abs(gp).toFixed(1)}%`, px + S(150), py + ph + S(22), S(22), gcol);
      if (p.draft > 0.15) text(ctx, `DRAFTING -${Math.round(38 * p.draft)}% drag`, px + S(16), py + ph + S(50), S(16), '#8cffb0');

      // race info (top right)
      const order = race.sorted(), place = order.indexOf(p) + 1;
      const rx = W - S(236), rw = S(220);
      panel(ctx, rx, py, rw, S(110));
      text(ctx, `${place}`, rx + S(14), py + S(44), S(62), place === 1 ? '#ffd43b' : '#fff');
      text(ctx, `/ ${race.riders.length}`, rx + S(66), py + S(60), S(22), '#fff');
      text(ctx, `LAP ${p.lap}/${race.laps}`, rx + rw - S(14), py + S(30), S(24), '#fff', 'right');
      text(ctx, fmtTime(Math.max(0, race.time)), rx + rw - S(14), py + S(62), S(24), '#fff', 'right');
      const ahead = order[place - 2], behind = order[place];
      const gap = (o) => Math.abs(o.s - p.s) / Math.max(4, p.v);
      if (ahead) text(ctx, `▲ ${ahead.name} +${gap(ahead).toFixed(1)}s`, rx + rw - S(10), py + S(90), S(15), '#ffd7e8', 'right');
      if (behind) text(ctx, `▼ ${behind.name} -${gap(behind).toFixed(1)}s`, rx + rw - S(10), py + S(110) + S(4), S(15), '#d7f0ff', 'right');

      // minimap
      const ms = S(150), mx = W - ms - S(16), my = py + S(142);
      panel(ctx, mx, my, ms, ms, 'rgba(255,255,255,.85)');
      const pts = tr.map; let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
      const sc = (ms - S(30)) / Math.max(maxx - minx, maxy - miny), mp = (i) => [mx + S(15) + (pts[i][0] - minx) * sc + ((ms - S(30)) - (maxx - minx) * sc) / 2, my + S(15) + (pts[i][1] - miny) * sc + ((ms - S(30)) - (maxy - miny) * sc) / 2];
      ctx.lineWidth = S(7); ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.beginPath();
      for (let i = 0; i <= tr.N; i++) { const [x, y] = mp(i % tr.N); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      ctx.lineWidth = S(3.5); ctx.strokeStyle = '#fff'; ctx.stroke();
      for (const r of order.slice().reverse()) {
        const i = tr.segIndex(r.s), [x, y] = mp(i); ctx.fillStyle = r.color; ctx.strokeStyle = INK; ctx.lineWidth = S(2);
        ellipse(ctx, x, y, r.isPlayer ? S(7) : S(5), r.isPlayer ? S(7) : S(5)); ctx.fill(); ctx.stroke();
      }

      // item slot
      const ix = W / 2 - S(48), iy = S(14);
      panel(ctx, ix, iy, S(96), S(96), 'rgba(255,255,255,.88)', S(22));
      if (p.item) {
        drawItemIcon(ctx, p.item, ix + S(48), iy + S(48), S(70));
        text(ctx, ITEMS[p.item].name, W / 2, iy + S(114), S(18), '#fff', 'center');
        text(ctx, hud.useHint, W / 2, iy + S(136), S(14), '#ffe9a8', 'center');
      } else text(ctx, '?', ix + S(48), iy + S(50), S(54), 'rgba(255,255,255,.6)', 'center', 'rgba(27,27,47,.5)');

      // elevation profile + positions
      const ew = Math.min(W * 0.46, S(560)), eh = S(64), ex = W / 2 - ew / 2, ey = H - eh - S(14);
      panel(ctx, ex - S(10), ey - S(10), ew + S(20), eh + S(20), 'rgba(255,255,255,.78)', S(14));
      let mn = 1e9, mxe = -1e9; for (let i = 0; i <= tr.N; i++) { mn = Math.min(mn, tr.ys[i]); mxe = Math.max(mxe, tr.ys[i]); }
      const span = Math.max(mxe - mn, 4000);
      const yy = (i) => ey + eh - ((tr.ys[i] - mn) / span) * eh * 0.9 - S(4);
      ctx.beginPath(); ctx.moveTo(ex, ey + eh);
      for (let i = 0; i <= tr.N; i++) ctx.lineTo(ex + (i / tr.N) * ew, yy(i));
      ctx.lineTo(ex + ew, ey + eh); ctx.closePath(); ctx.fillStyle = '#8fd694'; ctx.fill(); ctx.lineWidth = S(3); ctx.strokeStyle = INK; ctx.stroke();
      for (const r of order.slice().reverse()) {
        const f = (((r.s % tr.length) + tr.length) % tr.length) / tr.length, i = Math.floor(f * tr.N);
        ctx.fillStyle = r.color; ctx.strokeStyle = INK; ctx.lineWidth = S(2); ellipse(ctx, ex + f * ew, yy(i) - S(6), r.isPlayer ? S(8) : S(5.5), r.isPlayer ? S(8) : S(5.5)); ctx.fill(); ctx.stroke();
      }
      // upcoming grade label
      const ahead50 = tr.gradeAt(p.s + 60) * 100;
      if (Math.abs(ahead50) > 3) text(ctx, ahead50 > 0 ? `CLIMB AHEAD ${ahead50.toFixed(0)}%` : `DESCENT ${Math.abs(ahead50).toFixed(0)}%`, W / 2, ey - S(26), S(16), ahead50 > 0 ? '#ffb36b' : '#8cffb0', 'center');

      // toasts
      let ty = H * 0.25;
      for (const t of hud.toasts) { ctx.globalAlpha = clamp(t.life * 2, 0, 1); text(ctx, t.msg, W / 2, ty, S(32), t.color || '#fff', 'center'); ty += S(40); }
      ctx.globalAlpha = 1;

      // countdown
      if (race.state === 'countdown') {
        const c = Math.ceil(-race.time);
        text(ctx, c > 3 ? 'GET READY — start pedalling!' : String(c), W / 2, c > 3 ? H * 0.22 : H * 0.42, c > 3 ? S(34) : S(150), '#fff', 'center');
      } else if (race.time < 1.2) text(ctx, 'GO!', W / 2, H * 0.42, S(150), '#7dff9b', 'center');
      if (hud.incoming) text(ctx, '⚠ INCOMING!', W / 2, H * 0.34, S(40), '#ff6b6b', 'center');
      if (hud.paused) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H); text(ctx, 'PAUSED — press Esc to resume', W / 2, H / 2, S(40), '#fff', 'center'); }
      ctx.restore();
    }
  }

  Object.assign(C, { Renderer, fmtTime, drawItemIcon, zoneColor });
})();
