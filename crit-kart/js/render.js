// Pseudo-3D cartoon renderer (road projection after the classic "OutRun" approach) + HUD.
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});
  const { UNIT, SEG_LEN, ITEMS } = C;

  const ROAD_W = 450, CAM_H = 360, CAM_BACK = 620, RW = 165, DRAW_MAX = 130;
  const BASE_DEPTH = 1 / Math.tan((86 / 2) * Math.PI / 180);
  let DEPTH = BASE_DEPTH; // widens the field of view as speed rises (sense of speed)
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

  // ---- riders: a more naturalistic rear view (tapered kit, jointed legs, aero helmet, shaded fabric) ----
  const SKIN = ['#f1c9a5', '#e0ac7e', '#b9835a', '#7d5238'];
  const hashStr = (str) => { let h = 7; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  function shade(hex, amt) { // hex colour -> rgb string, amt -1 (darker) .. 1 (lighter)
    const n = parseInt(hex.slice(1), 16), f = (c) => Math.round(clamp(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt, 0, 255));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function limb(ctx, x1, y1, x2, y2, w, color, edge, ew) {
    ctx.lineCap = 'round'; ctx.strokeStyle = edge; ctx.lineWidth = w + ew * 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawRider(ctx, x, y, w, r, time) {
    const u = w, edge = 'rgba(12,12,28,.6)', ew = Math.max(0.6, u * 0.008);
    const h = hashStr(r.name), skin = SKIN[h % 4], kit = r.color, kitDark = shade(kit, -0.4), kitLight = shade(kit, 0.4), shorts = '#1b1e2a';
    ctx.save(); ctx.translate(x, y);
    const sg = ctx.createRadialGradient(0, 0, u * 0.04, 0, 0, u * 0.46); sg.addColorStop(0, 'rgba(0,0,0,.42)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ellipse(ctx, 0, u * 0.01, u * 0.46, u * 0.1); ctx.fill();
    const strokeAmt = Math.min(1, r.rpm / 70) * (0.5 + 0.5 * Math.min(1, r.pw / 250)); // harder pedalling rocks the bike more
    ctx.translate(0, -Math.abs(Math.sin(r.phase)) * u * 0.006 * strokeAmt);
    ctx.transform(1, 0, (r.yaw || 0) * 0.14, 0.95, 0, 0); // looking down from behind: slight foreshortening + turn-in shear
    ctx.rotate(r.lean * 0.2 + Math.sin(r.phase) * 0.022 * strokeAmt + (r.stun > 0 ? Math.sin(time * 18) * 0.3 : 0) + (r.wobble > 0 ? Math.sin(time * 40) * 0.1 * Math.min(1, r.wobble / 0.5) : 0));
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = ew; ctx.strokeStyle = edge;
    const sway = Math.sin(r.phase) * u * 0.012;

    // rear wheel: tyre, rim, hub, a hint of spokes
    ctx.fillStyle = '#15151d'; ellipse(ctx, 0, -u * 0.33, u * 0.052, u * 0.33); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#b9c0cc'; ctx.lineWidth = u * 0.011; ellipse(ctx, 0, -u * 0.33, u * 0.03, u * 0.285); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,205,215,.45)'; ctx.lineWidth = u * 0.004;
    for (let i = 0; i < 4; i++) { const t = ((r.phase * 0.7 + i * 1.57) % 3.14) - 1.57; ctx.beginPath(); ctx.moveTo(Math.sin(t) * u * 0.028, -u * 0.33 + Math.cos(t) * u * 0.27); ctx.lineTo(0, -u * 0.33); ctx.stroke(); }
    ctx.fillStyle = '#8b93a1'; ellipse(ctx, 0, -u * 0.33, u * 0.014, u * 0.014); ctx.fill();
    // frame stays, seat tube, saddle
    ctx.strokeStyle = '#23262f'; ctx.lineWidth = u * 0.018;
    ctx.beginPath(); ctx.moveTo(-u * 0.02, -u * 0.34); ctx.lineTo(-u * 0.012, -u * 0.6); ctx.moveTo(u * 0.02, -u * 0.34); ctx.lineTo(u * 0.012, -u * 0.6); ctx.stroke();
    ctx.strokeStyle = kit; ctx.lineWidth = u * 0.007; ctx.beginPath(); ctx.moveTo(0, -u * 0.36); ctx.lineTo(0, -u * 0.6); ctx.stroke();
    ctx.fillStyle = '#16161e'; ctx.strokeStyle = edge; ctx.lineWidth = ew; rrect(ctx, -u * 0.055, -u * 0.655, u * 0.11, u * 0.032, u * 0.014); ctx.fill(); ctx.stroke();

    // legs: thigh + calf with a knee that bows out as the leg folds; shoes ride the pedals
    const cr = u * 0.095;
    for (const sd of [-1, 1]) {
      const ph = r.phase + (sd > 0 ? Math.PI : 0), hipX = sd * u * 0.07 + sway, hipY = -u * 0.655;
      const fx = sd * u * 0.125, fy = -u * 0.27 + Math.cos(ph) * cr, ax = fx, ay = fy - u * 0.035;
      const dist = Math.hypot(ax - hipX, ay - hipY), fold = clamp(1 - dist / (u * 0.6), 0, 1);
      const kx = (hipX + ax) / 2 + sd * u * (0.03 + fold * 0.06), ky = (hipY + ay) / 2 - fold * u * 0.03;
      limb(ctx, hipX, hipY, kx, ky, u * 0.108, shorts, edge, ew);
      limb(ctx, hipX - sd * u * 0.012, hipY, kx - sd * u * 0.012, ky, u * 0.03, 'rgba(255,255,255,.1)', 'rgba(0,0,0,0)', 0);
      limb(ctx, kx, ky, ax, ay, u * 0.072, skin, edge, ew);
      limb(ctx, ax, ay + u * 0.01, ax, ay - u * 0.045, u * 0.078, '#f3f4f8', edge, ew); // sock
      ctx.fillStyle = '#eceef4'; ctx.strokeStyle = edge; ctx.lineWidth = ew; ellipse(ctx, fx, fy + u * 0.012, u * 0.07, u * 0.036); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2e3a'; ellipse(ctx, fx, fy + u * 0.03, u * 0.062, u * 0.012); ctx.fill();
      ctx.fillStyle = kit; ellipse(ctx, fx, fy + u * 0.004, u * 0.022, u * 0.012); ctx.fill(); // shoe strap in kit colour
    }
    // bib shorts joining legs to torso
    ctx.fillStyle = shorts; ctx.strokeStyle = edge; ctx.lineWidth = ew;
    ctx.beginPath(); ctx.moveTo(-u * 0.115 + sway, -u * 0.72); ctx.lineTo(u * 0.115 + sway, -u * 0.72); ctx.quadraticCurveTo(u * 0.135 + sway, -u * 0.66, u * 0.09 + sway, -u * 0.62); ctx.lineTo(-u * 0.09 + sway, -u * 0.62); ctx.quadraticCurveTo(-u * 0.135 + sway, -u * 0.66, -u * 0.115 + sway, -u * 0.72); ctx.closePath(); ctx.fill(); ctx.stroke();

    // torso: tapered jersey, lit from the left
    ctx.save(); ctx.translate(sway * 1.5, 0);
    ctx.beginPath(); ctx.moveTo(-u * 0.118, -u * 0.69);
    ctx.bezierCurveTo(-u * 0.2, -u * 0.8, -u * 0.235, -u * 0.92, -u * 0.195, -u * 1.0);
    ctx.quadraticCurveTo(0, -u * 1.07, u * 0.195, -u * 1.0);
    ctx.bezierCurveTo(u * 0.235, -u * 0.92, u * 0.2, -u * 0.8, u * 0.118, -u * 0.69); ctx.closePath();
    const jg = ctx.createLinearGradient(-u * 0.22, 0, u * 0.22, 0); jg.addColorStop(0, kitLight); jg.addColorStop(0.45, kit); jg.addColorStop(1, kitDark);
    ctx.fillStyle = jg; ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip();
    const v = h % 3; ctx.fillStyle = 'rgba(255,255,255,.88)';
    if (v === 0) ctx.fillRect(-u * 0.3, -u * 1.01, u * 0.6, u * 0.05);
    else if (v === 1) ctx.fillRect(-u * 0.3, -u * 0.88, u * 0.6, u * 0.045);
    else { ctx.beginPath(); ctx.moveTo(-u * 0.25, -u * 0.98); ctx.lineTo(-u * 0.25, -u * 0.92); ctx.lineTo(u * 0.25, -u * 0.74); ctx.lineTo(u * 0.25, -u * 0.8); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(-u * 0.01, -u * 1.05, u * 0.02, u * 0.38); // spine seam
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    for (const px of [-0.078, 0, 0.078]) { rrect(ctx, u * (px - 0.03), -u * 0.765, u * 0.06, u * 0.04, u * 0.012); ctx.fill(); }
    ctx.restore();

    // arms to the drops: sleeve, bare forearm, glove
    for (const sd of [-1, 1]) {
      const sx = sd * u * 0.185 + sway, sy = -u * 0.97, ex = sd * u * 0.262, ey = -u * 0.86, hx = sd * u * 0.205, hy = -u * 0.745;
      limb(ctx, sx, sy, ex, ey, u * 0.082, sd < 0 ? kitLight : kit, edge, ew);
      limb(ctx, ex, ey, hx, hy - u * 0.012, u * 0.056, skin, edge, ew);
      ctx.fillStyle = '#1b1e2a'; ellipse(ctx, hx, hy, u * 0.034, u * 0.03); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = '#14141b'; ctx.lineWidth = u * 0.02; ctx.beginPath(); ctx.moveTo(-u * 0.215, -u * 0.74); ctx.lineTo(u * 0.215, -u * 0.74); ctx.stroke();

    // neck, aero helmet with tail, ears
    limb(ctx, 0, -u * 1.03, 0, -u * 1.08, u * 0.065, skin, edge, ew);
    ctx.fillStyle = skin; ctx.strokeStyle = edge; ctx.lineWidth = ew; ellipse(ctx, -u * 0.088, -u * 1.115, u * 0.016, u * 0.024); ctx.fill(); ellipse(ctx, u * 0.088, -u * 1.115, u * 0.016, u * 0.024); ctx.fill();
    const hg = ctx.createLinearGradient(-u * 0.1, 0, u * 0.1, 0); hg.addColorStop(0, '#ffffff'); hg.addColorStop(1, '#c9ced9');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.moveTo(-u * 0.092, -u * 1.13); ctx.bezierCurveTo(-u * 0.095, -u * 1.22, u * 0.095, -u * 1.22, u * 0.092, -u * 1.13);
    ctx.quadraticCurveTo(u * 0.085, -u * 1.03, 0, -u * 0.985); ctx.quadraticCurveTo(-u * 0.085, -u * 1.03, -u * 0.092, -u * 1.13); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = kit; ctx.lineWidth = u * 0.02; ctx.beginPath(); ctx.moveTo(0, -u * 1.2); ctx.lineTo(0, -u * 1.0); ctx.stroke();
    ctx.fillStyle = 'rgba(30,30,50,.55)';
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { ellipse(ctx, sd * u * 0.045, -u * (1.17 - i * 0.04), u * 0.012, u * 0.014); ctx.fill(); }
    ctx.strokeStyle = 'rgba(20,20,35,.6)'; ctx.lineWidth = u * 0.006; ctx.beginPath(); ctx.moveTo(-u * 0.09, -u * 1.11); ctx.lineTo(-u * 0.06, -u * 1.14); ctx.moveTo(u * 0.09, -u * 1.11); ctx.lineTo(u * 0.06, -u * 1.14); ctx.stroke(); // glasses arms

    // status effects
    if (r.shield > 0) {
      const g = ctx.createRadialGradient(0, -u * 0.6, u * 0.2, 0, -u * 0.6, u * 0.8);
      g.addColorStop(0, 'rgba(120,220,255,0.05)'); g.addColorStop(1, 'rgba(120,220,255,0.55)');
      ctx.fillStyle = g; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1.2, u * 0.03); ellipse(ctx, 0, -u * 0.6, u * 0.7, u * 0.8); ctx.fill(); ctx.stroke();
    }
    if (r.boost > 0) {
      ctx.strokeStyle = 'rgba(255,230,80,.9)'; ctx.lineWidth = Math.max(1.2, u * 0.03);
      for (let i = 0; i < 6; i++) { const yy = -u * (0.15 + 0.14 * i), off = ((time * 5 + i * 0.37) % 1) * u * 0.25; ctx.beginPath(); ctx.moveTo(-u * 0.5 - off, yy); ctx.lineTo(-u * 0.35 - off, yy); ctx.moveTo(u * 0.5 + off, yy); ctx.lineTo(u * 0.35 + off, yy); ctx.stroke(); }
    }
    if (r.scrape > 0) { ctx.fillStyle = '#ffd43b'; for (let i = 0; i < 5; i++) { const sx = (r.x > 0 ? 1 : -1) * u * (0.3 + Math.random() * 0.15); ellipse(ctx, sx, -u * (0.1 + Math.random() * 0.3), u * 0.012, u * 0.012); ctx.fill(); } }
    if (r.stun > 0) for (let i = 0; i < 3; i++) { const an = time * 6 + (i * Math.PI * 2) / 3; text(ctx, '★', Math.cos(an) * u * 0.28, -u * 1.32 + Math.sin(an) * u * 0.06, u * 0.2, '#ffe14d'); }
    ctx.restore();
  }

  function drawScenery(ctx, sp, x, y, pu) {
    pu *= 0.7; // scenery drawn for a wider road; keep it in proportion to the ~9 m road
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
    } else if (sp.type === 'post') {
      ctx.fillStyle = '#f4f4f8'; ctx.fillRect(-pu * 14, -pu * 170, pu * 28, pu * 170); ctx.strokeRect(-pu * 14, -pu * 170, pu * 28, pu * 170);
      ctx.fillStyle = sp.hue % 2 ? '#ff5a5f' : '#ffd43b'; ctx.fillRect(-pu * 14, -pu * 130, pu * 28, pu * 40);
    } else if (sp.type === 'lamp') {
      ctx.fillStyle = '#4b4f8a'; ctx.fillRect(-pu * 14 * s, -pu * 460 * s, pu * 28 * s, pu * 460 * s); ctx.strokeRect(-pu * 14 * s, -pu * 460 * s, pu * 28 * s, pu * 460 * s);
      for (let i = 3; i >= 1; i--) { ctx.fillStyle = `rgba(0,240,255,${0.12 * (4 - i)})`; ellipse(ctx, 0, -pu * 480 * s, pu * 55 * i * s, pu * 55 * i * s); ctx.fill(); }
      ctx.fillStyle = '#e8ffff'; ctx.lineWidth = lw; ellipse(ctx, 0, -pu * 480 * s, pu * 40 * s, pu * 40 * s); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawObstacle(ctx, o, x, y, pu, hw) {
    pu *= 0.5; // sprites were drawn for a wider road
    ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const lw = Math.max(1, pu * 9); ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(20,20,40,.75)';
    if (o.type === 'bump') {
      const h = pu * 70, n = 10, sw = (hw * 2) / n;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-hw, -h * 0.1, hw * 2, h * 0.35);
      for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#1f1f2e' : '#ffd43b'; ctx.fillRect(-hw + i * sw, -h, sw + 0.5, h); }
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-hw, -h, hw * 2, h * 0.25);
      ctx.strokeRect(-hw, -h, hw * 2, h);
    } else if (o.type === 'pothole') {
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ellipse(ctx, 0, 0, pu * 120, pu * 34); ctx.fill();
      ctx.fillStyle = '#14141f'; ellipse(ctx, 0, 0, pu * 95, pu * 25); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, pu * 118, pu * 33, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    } else if (o.type === 'cone') {
      if (o.down) ctx.rotate(1.25);
      const w = pu * 62, h = pu * 200;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ellipse(ctx, 0, 0, w * 1.1, w * 0.3); ctx.fill();
      ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(-w * 0.2, -h); ctx.lineTo(w * 0.2, -h); ctx.lineTo(w, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-w * 0.62, -h * 0.4); ctx.lineTo(-w * 0.4, -h * 0.68); ctx.lineTo(w * 0.4, -h * 0.68); ctx.lineTo(w * 0.62, -h * 0.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e65f00'; rrect(ctx, -w * 1.15, -h * 0.06, w * 2.3, h * 0.08, 2); ctx.fill();
    } else if (o.type === 'barrel') {
      if (o.down) { ctx.translate(pu * 60, 0); ctx.rotate(1.45); }
      const w = pu * 80, h = pu * 210;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ellipse(ctx, 0, 0, w * 1.1, w * 0.3); ctx.fill();
      const g = ctx.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, '#c92a2a'); g.addColorStop(0.45, '#ff6b6b'); g.addColorStop(1, '#a61e1e');
      ctx.fillStyle = g; rrect(ctx, -w, -h, w * 2, h, w * 0.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe066'; ctx.fillRect(-w, -h * 0.72, w * 2, h * 0.12); ctx.fillRect(-w, -h * 0.32, w * 2, h * 0.12);
    }
    ctx.restore();
  }

  class Renderer {
    constructor(canvas) { this.cv = canvas; this.ctx = canvas.getContext('2d'); this.bg = 0; this.pitch = 0; this.horizon = 360; this.stats = { riders: 0 }; this.resize(); }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = window.innerWidth; this.H = window.innerHeight;
      this.cv.width = Math.floor(this.W * dpr); this.cv.height = Math.floor(this.H * dpr);
      this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ui = clamp(Math.min(this.W / 1280, this.H / 720), 0.6, 1.5);
    }

    project(p, camX, camY, camZ, wf = 1) {
      const { W, H } = this;
      p.camera.x = (p.world.x || 0) - camX; p.camera.y = p.world.y - camY; p.camera.z = p.world.z - camZ;
      p.screen.scale = DEPTH / p.camera.z;
      p.screen.x = Math.round(W / 2 + (p.screen.scale * p.camera.x * W) / 2);
      p.screen.y = Math.round(this.horizon - (p.screen.scale * p.camera.y * H) / 2);
      p.screen.w = Math.round((p.screen.scale * ROAD_W * wf * W) / 2);
    }

    poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
      const c = this.ctx; c.fillStyle = color; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.lineTo(x4, y4); c.closePath(); c.fill();
    }

    drawBackground(race, dt) {
      const { ctx, W, H } = this, th = race.track.theme, p = race.player;
      const hz = this.horizon;
      const g = ctx.createLinearGradient(0, 0, 0, hz + 20); g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz + 20);
      this.bg += race.track.curveAt(p.s) * p.v * dt * 1.6;
      if (th.stars) { ctx.fillStyle = '#fff'; for (let i = 0; i < 70; i++) { const x = ((i * 977 + 13) % 1000) / 1000 * W, y = ((i * 613 + 7) % 1000) / 1000 * Math.max(10, hz - 10); ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 2 + i); ctx.fillRect(x, y, 2, 2); } ctx.globalAlpha = 1; }
      ctx.fillStyle = th.sun; ctx.globalAlpha = 0.95; ellipse(ctx, W * 0.72 - this.bg * 0.05 % W, hz - H * 0.3, H * 0.09, H * 0.09); ctx.fill(); ctx.globalAlpha = 1;
      const base = hz;
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
      if (!th.stars) { ctx.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 4; i++) { const x = (((i * 400 + this.bg * 0.12) % (W + 300)) + W + 300) % (W + 300) - 150, y = hz - H * (0.4 - 0.07 * (i % 3)); for (const [dx, r] of [[-40, 28], [0, 38], [45, 26]]) { ellipse(ctx, x + dx, y, r, r * 0.7); ctx.fill(); } } }
      ctx.fillStyle = th.grass[0]; ctx.fillRect(0, base, W, H - base);
    }

    render(race, dt, hud) {
      this.t = (this.t || 0) + dt;
      const { ctx, W, H } = this, track = race.track, segs = track.segs, N = track.N, T = track.trackLen, p = race.player, th = track.theme;
      const DRAW = Math.min(DRAW_MAX, N - CAM_BACK / SEG_LEN - 4 | 0); // never wrap past the camera segment
      // Camera pitch: look at the road surface ahead. Descents tilt the view down (horizon rises) so the road stays on screen
      // instead of showing mostly sky; climbs tilt up only a little.
      const slope = (track.elevationAt(p.s + 35) - track.elevationAt(p.s + 5)) / 30 * C.VEXAG;
      const targetPitch = clamp(slope < 0 ? slope * 0.95 : slope * 0.35, -0.3, 0.12) * H;
      DEPTH = BASE_DEPTH * (1 - clamp((p.v - 6) / 16, 0, 1) * 0.2);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, (dt || 0.016) * 2.5);
      this.horizon = H / 2 + this.pitch;
      this.drawBackground(race, dt);

      const mod = (z) => ((z % T) + T) % T;
      const camZ = mod(p.s * UNIT - CAM_BACK);
      const baseI = Math.floor(camZ / SEG_LEN), base = segs[baseI], pct = (camZ % SEG_LEN) / SEG_LEN;
      const shake = p.hop > 0 ? Math.sin(this.t * 30) * 16 * Math.sin(Math.PI * (1 - p.hop / 0.35)) : 0; // eases in and out with the hop
      const camY = lerp(base.y1, base.y2, pct) + CAM_H + shake;
      const camX = p.x * ROAD_W * 0.8 * track.widthAt(p.s);
      let dx = -(base.curve * pct), x = 0, maxy = H;

      for (let n = 0; n < DRAW; n++) {
        const seg = segs[(baseI + n) % N], looped = seg.i < baseI, z = camZ - (looped ? T : 0);
        this.project(seg.p1, camX - x, camY, z, seg.w1); this.project(seg.p2, camX - x - dx, camY, z, seg.w2);
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
      for (const o of track.obstacles) put(o.s, { kind: 'obstacle', off: o.x, o });
      for (const b of race.boxes) if (b.active) put(b.s, { kind: 'box', off: b.x, b });
      for (const h of race.hazards) put(h.s, { kind: 'banana', off: h.x });
      for (const pr of race.projectiles) put(pr.s, { kind: 'proj', off: pr.x, pr });
      this.stats = { riders: 0, sprites: {} };
      for (const r of race.riders) put(r.s, { kind: 'rider', off: r.x, r });

      const tagged = new Set(race.riders.filter((o) => !o.isPlayer && o.s - p.s > 3 && o.s - p.s < 90).sort((a, b) => a.s - b.s).slice(0, 3));
      for (let n = DRAW - 1; n >= 1; n--) {
        const list = buckets[n];
        const seg = segs[(baseI + n) % N], a = seg.p1.screen, b = seg.p2.screen;
        if (!list && !seg.walls) continue;
        if (!a.scale || a.scale < 0 || seg.p1.camera.z <= DEPTH) continue;
        const clip = Math.min(H, seg.clip);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, clip + (clip < H ? 2 : 0)); ctx.clip();
        if (seg.walls) this.drawWalls(seg, a, b, th);
        const fogA = clamp(1 - (n / DRAW) * (n / DRAW) * 1.1, 0, 1);
        for (const sp of list || []) {
          ctx.globalAlpha = fogA;
          // Project the sprite's own world position exactly (camera-relative z/x/y interpolated along the road polyline), instead of
          // interpolating the segment's screen points: the latter is wrong close to the camera and made nearby riders breathe and bob.
          const c1 = seg.p1.camera, c2 = seg.p2.camera, zc = lerp(c1.z, c2.z, sp.pct), xc = lerp(c1.x, c2.x, sp.pct), yc = lerp(c1.y, c2.y, sp.pct);
          const sc = DEPTH / zc, pu = (sc * W) / 2, wf = lerp(seg.w1, seg.w2, sp.pct);
          const sx = W / 2 + sc * (xc + sp.off * ROAD_W * wf) * W / 2, sy = this.horizon - sc * yc * H / 2, hw = sc * ROAD_W * wf * W / 2;
          if (sp.kind === 'scenery') drawScenery(ctx, sp.sc, sx, sy, pu);
          else if (sp.kind === 'obstacle') drawObstacle(ctx, sp.o, sx, sy, pu, hw);
          else if (sp.kind === 'rider') {
            const r = sp.r; this.stats.sprites[r.name] = { sx, sy, w: pu * RW }; r.yaw = clamp(track.curveAt(r.s) / 6, -1, 1) * 0.8 + r.lean * 0.25; const hopY = r.hop > 0 ? Math.sin(Math.PI * (1 - r.hop / 0.35)) * pu * 40 : 0;
            const dz = seg.p1.camera.z + sp.pct * SEG_LEN, fade = r.isPlayer ? 1 : clamp((dz - 390) / 90, 0, 1) * r.ghost; // short fade as a rival slips behind the camera; riders level with you stay solid
            if (fade > 0.02) { ctx.globalAlpha = fade * fogA; drawRider(ctx, sx, sy - hopY, pu * RW, r, this.t); ctx.globalAlpha = fogA; this.stats.riders++; }
            if (pu * RW > 28 && (r.isPlayer || tagged.has(r))) {
              const sz = clamp(pu * RW * 0.2, 10, 20);
              if (r.isPlayer) { ctx.save(); ctx.translate(sx, sy - pu * RW * 1.5); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(15,15,30,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-sz * 0.6, -sz * 0.6); ctx.lineTo(sz * 0.6, -sz * 0.6); ctx.lineTo(0, sz * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
              else {
                ctx.font = `700 ${sz}px ${FONT}`; const tw = ctx.measureText(r.name).width + sz * 0.9, ty = sy - pu * RW * 1.45;
                rrect(ctx, sx - tw / 2, ty - sz * 0.75, tw, sz * 1.5, sz * 0.75); ctx.fillStyle = 'rgba(15,15,30,.55)'; ctx.fill();
                ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(r.name, sx, ty + 1);
              }
            }
          } else if (sp.kind === 'box') {
            const bob = Math.sin(this.t * 3 + sp.b.s) * pu * 14, size = pu * 120, cy = sy - pu * 95 + bob;
            ctx.save(); ctx.translate(sx, cy); ctx.rotate(Math.sin(this.t * 2 + sp.b.x) * 0.15);
            const g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
            const hh = (this.t * 80) % 360; g.addColorStop(0, `hsl(${hh},90%,60%)`); g.addColorStop(1, `hsl(${hh + 120},90%,60%)`);
            rrect(ctx, -size / 2, -size / 2, size, size, size * 0.2); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = Math.max(2, size * 0.07); ctx.strokeStyle = INK; ctx.stroke();
            text(ctx, '?', 0, 0, size * 0.7, '#fff'); ctx.restore();
          } else if (sp.kind === 'banana') drawItemIcon(ctx, 'banana', sx, sy - pu * 40, pu * 110);
          else if (sp.kind === 'proj') {
            ctx.fillStyle = 'rgba(255,160,60,.6)'; ellipse(ctx, sx, sy - pu * 70, pu * 24, pu * 55); ctx.fill();
            drawItemIcon(ctx, sp.pr.kind, sx, sy - pu * 90, pu * 130);
          } else if (sp.kind === 'gantry') {
            const L = sx - sc * ROAD_W * 1.15 * W / 2, R = sx + sc * ROAD_W * 1.15 * W / 2, hgt = pu * 700;
            ctx.lineWidth = Math.max(2, pu * 15); ctx.strokeStyle = INK; ctx.fillStyle = '#e8e8f5';
            ctx.fillRect(L - pu * 20, sy - hgt, pu * 40, hgt); ctx.strokeRect(L - pu * 20, sy - hgt, pu * 40, hgt);
            ctx.fillRect(R - pu * 20, sy - hgt, pu * 40, hgt); ctx.strokeRect(R - pu * 20, sy - hgt, pu * 40, hgt);
            rrect(ctx, L - pu * 20, sy - hgt - pu * 20, R - L + pu * 40, pu * 110, pu * 20); ctx.fillStyle = '#ff5fa2'; ctx.fill(); ctx.stroke();
            text(ctx, 'FINISH  •  LAP', (L + R) / 2, sy - hgt + pu * 35, pu * 75, '#fff', 'center');
          }
        }
        ctx.restore();
      }
      if (!hud.menu) { this.drawSpeedFx(p.v); this.drawHUD(race, hud); }
    }

    // Streaks and a soft vignette at the screen edges; strength follows speed.
    drawSpeedFx(v) {
      const k = clamp((v - 5) / 13, 0, 1); if (k < 0.04) return;
      const { ctx, W, H } = this, cx = W / 2, cy = H * 0.52, f = Math.floor(this.t * 24);
      const vg = ctx.createRadialGradient(cx, cy, H * 0.45, cx, cy, H * 1.0); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.28 * k})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${0.32 * k})`; ctx.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const seed = Math.sin((i + 1) * 91.7 + f * 13.1) * 43758.5, rnd = seed - Math.floor(seed), rnd2 = Math.sin(seed * 1.7) * 0.5 + 0.5;
        const ang = (i / 26) * Math.PI * 2 + rnd * 0.2, r0 = H * (0.62 + rnd2 * 0.25), len = H * (0.06 + 0.16 * k * rnd);
        ctx.lineWidth = 1.5 + rnd * 2.5;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0 * 1.25, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * (r0 + len) * 1.25, cy + Math.sin(ang) * (r0 + len)); ctx.stroke();
      }
      ctx.restore();
    }

    // Concrete barriers along both edges of narrow sections.
    drawWalls(seg, a, b, th) {
      const ctx = this.ctx, H1 = a.scale * 115 * this.W / 2, H2 = b.scale * 115 * this.W / 2, col = th.rumble[seg.alt];
      for (const sd of [-1, 1]) {
        const ax = a.x + sd * a.w, bx = b.x + sd * b.w;
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(ax, a.y); ctx.lineTo(bx, b.y); ctx.lineTo(bx, b.y - H2); ctx.lineTo(ax, a.y - H1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.moveTo(ax, a.y - H1 * 0.55); ctx.lineTo(bx, b.y - H2 * 0.55); ctx.lineTo(bx, b.y - H2); ctx.lineTo(ax, a.y - H1); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(20,20,40,.55)'; ctx.lineWidth = Math.max(1, a.scale * 40 * this.W / 2); ctx.beginPath(); ctx.moveTo(ax, a.y - H1); ctx.lineTo(bx, b.y - H2); ctx.stroke();
      }
    }

    // ---- HUD ----
    drawHUD(race, hud) {
      const { ctx, W, H, ui } = this, p = race.player, tr = race.track;
      const S = (v) => v * ui;
      ctx.save();
      // power panel
      const px = S(16), py = S(16), pw = S(290), ph = S(150);
      panel(ctx, px, py, pw, ph);
      const ratio = hud.ftp ? hud.power / hud.ftp : 0, zc = zoneColor(ratio);
      text(ctx, String(Math.round(hud.power)), px + S(16), py + S(52), S(68), zc, 'left');
      text(ctx, 'WATTS', px + pw - S(16), py + S(30), S(20), '#fff', 'right');
      ctx.fillStyle = 'rgba(0,0,0,.18)'; rrect(ctx, px + S(16), py + S(92), pw - S(32), S(14), S(7)); ctx.fill();
      ctx.fillStyle = zc; rrect(ctx, px + S(16), py + S(92), Math.max(S(8), (pw - S(32)) * clamp(ratio / 1.6, 0, 1)), S(14), S(7)); ctx.fill();
      text(ctx, `${(hud.power / hud.weight).toFixed(1)} W/kg`, px + S(16), py + S(128), S(20), '#fff');
      text(ctx, `${hud.cadence ? Math.round(hud.cadence) : '--'} rpm`, px + S(112), py + S(128), S(20), '#fff');
      { const pct = hud.hr ? hud.hr / (hud.maxHr || 190) : 0, hc = !hud.hr ? '#b8bcc8' : pct < 0.6 ? '#9aa5b1' : pct < 0.7 ? '#4dabf7' : pct < 0.8 ? '#51cf66' : pct < 0.9 ? '#ffa94d' : '#ff5a5f';
        const hx = px + S(206), hy = py + S(128);
        ctx.save(); ctx.translate(hx, hy); ctx.scale(S(1), S(1)); ctx.beginPath(); ctx.moveTo(0, 6); ctx.bezierCurveTo(-12, -2, -8, -12, 0, -6); ctx.bezierCurveTo(8, -12, 12, -2, 0, 6); ctx.fillStyle = hc; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke(); ctx.restore();
        text(ctx, hud.hr ? String(Math.round(hud.hr)) : '--', hx + S(18), hy, S(20), hud.hr ? '#fff' : '#d0d3dc'); }
      text(ctx, `${(p.v * 3.6).toFixed(1)} km/h`, px + S(16), py + ph + S(22), S(22), '#fff');
      const gp = p.grade * 100, gcol = gp > 0.5 ? '#ff922b' : gp < -0.5 ? '#51cf66' : '#fff';
      text(ctx, `${gp > 0.5 ? '▲' : gp < -0.5 ? '▼' : '►'} ${Math.abs(gp).toFixed(1)}%`, px + S(150), py + ph + S(22), S(22), gcol);
      if (p.draft > 0.15) text(ctx, `DRAFTING -${Math.round(38 * p.draft)}% drag`, px + S(16), py + ph + S(50), S(16), '#8cffb0');

      // connection chips
      let cx = px;
      for (const chip of hud.chips || []) {
        ctx.font = `800 ${S(13)}px ${FONT}`; const w = ctx.measureText(chip.label).width + S(22);
        rrect(ctx, cx, py + ph + S(66), w, S(24), S(12)); ctx.fillStyle = chip.state === 'ok' ? '#51cf66' : chip.state === 'bad' ? '#ff6b6b' : 'rgba(255,255,255,.75)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
        text(ctx, chip.label, cx + w / 2, py + ph + S(78), S(13), chip.state === 'off' ? INK : '#fff', 'center', chip.state === 'off' ? 'rgba(0,0,0,0)' : INK);
        cx += w + S(6);
      }
      if (hud.warning) text(ctx, hud.warning, W / 2, H * 0.34, S(30), '#ff8787', 'center');

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

      // leaderboard (all riders, gap in seconds to you)
      { const rows = order.length, rh = S(21), lx = S(16), ly = py + ph + S(100), lw = S(210);
        panel(ctx, lx, ly, lw, rows * rh + S(14), 'rgba(15,15,30,.55)', S(12));
        order.forEach((o, i) => {
          const yy = ly + S(7) + i * rh + rh / 2, me = o === p, gapS = (o.s - p.s) / Math.max(4, p.v);
          if (me) { ctx.fillStyle = 'rgba(255,255,255,.22)'; rrect(ctx, lx + S(4), yy - rh / 2 + 1, lw - S(8), rh - 2, S(8)); ctx.fill(); }
          ctx.font = `800 ${S(13)}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineWidth = 0;
          ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), lx + S(10), yy);
          ctx.fillStyle = o.color; ellipse(ctx, lx + S(34), yy, S(5), S(5)); ctx.fill();
          ctx.fillStyle = me ? '#ffe066' : '#fff'; ctx.fillText(o.name.length > 13 ? o.name.slice(0, 12) + '…' : o.name, lx + S(46), yy);
          ctx.textAlign = 'right'; ctx.fillStyle = me ? '#ffe066' : gapS > 0 ? '#ffb3c8' : '#b3e0ff';
          ctx.fillText(me ? 'YOU' : o.finished ? 'FIN' : `${gapS > 0 ? '+' : '−'}${Math.abs(gapS).toFixed(1)}s`, lx + lw - S(10), yy);
        }); }

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

      // obstacle / narrow-road warning
      { const L = tr.length; let near = null, bd = 75;
        for (const o of tr.obstacles) { if (o.down && o.type !== 'bump' && o.type !== 'pothole') continue; const d = ((o.s - p.s) % L + L) % L; if (d > 2 && d < bd) { bd = d; near = o; } }
        const narrowSoon = !tr.wallsAt(p.s) && tr.wallsAt(p.s + 30);
        const label = near && (!narrowSoon || bd < 30) ? { bump: 'SPEED BUMPS', cone: 'CONES: WEAVE!', pothole: 'POTHOLES', barrel: 'BARRELS: FIND THE GAP' }[near.type] + ` ${Math.round(bd)} m` : narrowSoon ? 'NARROW ROAD: KEEP OFF THE WALLS' : null;
        if (label) text(ctx, '⚠ ' + label, W / 2, ey - S(54), S(20), '#ffe066', 'center'); }

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
