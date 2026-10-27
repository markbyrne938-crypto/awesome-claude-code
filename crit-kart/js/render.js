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

  function drawRider(ctx, x, y, w, r, time, front = false) {
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

    if (front) { // front wheel and fork, seen head-on (riders in the mirror are coming toward us)
      ctx.fillStyle = '#15151d'; ellipse(ctx, 0, -u * 0.31, u * 0.052, u * 0.31); ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = ew; ctx.stroke();
      ctx.strokeStyle = '#b9c0cc'; ctx.lineWidth = u * 0.011; ellipse(ctx, 0, -u * 0.31, u * 0.03, u * 0.285); ctx.stroke();
      ctx.strokeStyle = '#23262f'; ctx.lineWidth = u * 0.02; ctx.beginPath(); ctx.moveTo(0, -u * 0.33); ctx.lineTo(0, -u * 0.74); ctx.stroke();
    }
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
    if (front) { ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = u * 0.012; ctx.beginPath(); ctx.moveTo(0, -u * 1.0); ctx.lineTo(0, -u * 0.72); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    if (!front) for (const px of [-0.078, 0, 0.078]) { rrect(ctx, u * (px - 0.03), -u * 0.765, u * 0.06, u * 0.04, u * 0.012); ctx.fill(); }
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
    if (front) { // face, sunglasses, helmet over the forehead
      ctx.fillStyle = skin; ctx.strokeStyle = edge; ctx.lineWidth = ew; ellipse(ctx, 0, -u * 1.07, u * 0.085, u * 0.1); ctx.fill(); ctx.stroke();
      ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(0, -u * 1.12, u * 0.105, u * 0.085, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = kit; ctx.fillRect(-u * 0.012, -u * 1.2, u * 0.024, u * 0.07);
      ctx.fillStyle = '#15151d'; rrect(ctx, -u * 0.08, -u * 1.115, u * 0.16, u * 0.034, u * 0.012); ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,35,.5)'; ctx.lineWidth = u * 0.008; ctx.beginPath(); ctx.moveTo(-u * 0.03, -u * 1.02); ctx.lineTo(u * 0.03, -u * 1.02); ctx.stroke();
    } else {
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.moveTo(-u * 0.092, -u * 1.13); ctx.bezierCurveTo(-u * 0.095, -u * 1.22, u * 0.095, -u * 1.22, u * 0.092, -u * 1.13);
    ctx.quadraticCurveTo(u * 0.085, -u * 1.03, 0, -u * 0.985); ctx.quadraticCurveTo(-u * 0.085, -u * 1.03, -u * 0.092, -u * 1.13); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = kit; ctx.lineWidth = u * 0.02; ctx.beginPath(); ctx.moveTo(0, -u * 1.2); ctx.lineTo(0, -u * 1.0); ctx.stroke();
    ctx.fillStyle = 'rgba(30,30,50,.55)';
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { ellipse(ctx, sd * u * 0.045, -u * (1.17 - i * 0.04), u * 0.012, u * 0.014); ctx.fill(); }
    ctx.strokeStyle = 'rgba(20,20,35,.6)'; ctx.lineWidth = u * 0.006; ctx.beginPath(); ctx.moveTo(-u * 0.09, -u * 1.11); ctx.lineTo(-u * 0.06, -u * 1.14); ctx.moveTo(u * 0.09, -u * 1.11); ctx.lineTo(u * 0.06, -u * 1.14); ctx.stroke(); // glasses arms
    }

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

  function drawScenery(ctx, sp, x, y, pu, mirror) {
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
      if (!mirror) text(ctx, ['GO!', 'WATTS', 'PEDAL', 'HUP!'][sp.hue % 4], 0, -pu * 335 * s, pu * 70 * s, '#fff'); // (flipped lettering looks wrong in the mirror)
    } else if (sp.type === 'lolly') {
      ctx.fillStyle = '#fff'; ctx.fillRect(-pu * 14 * s, -pu * 330 * s, pu * 28 * s, pu * 330 * s); ctx.strokeRect(-pu * 14 * s, -pu * 330 * s, pu * 28 * s, pu * 330 * s);
      ctx.fillStyle = hsl(62); ellipse(ctx, 0, -pu * 430 * s, pu * 130 * s, pu * 130 * s); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.arc(0, -pu * 430 * s, pu * 70 * s, 0, Math.PI * 3.2); ctx.stroke();
    } else if (sp.type === 'cane') {
      ctx.strokeStyle = INK; ctx.lineWidth = pu * 60 * s + lw * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -pu * 380 * s); ctx.arc(pu * 80 * s, -pu * 380 * s, pu * 80 * s, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = pu * 60 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -pu * 380 * s); ctx.arc(pu * 80 * s, -pu * 380 * s, pu * 80 * s, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = '#ff4d6d'; ctx.setLineDash([pu * 30 * s, pu * 50 * s]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -pu * 380 * s); ctx.stroke(); ctx.setLineDash([]);
    } else if (sp.type === 'building') {
      const bw = 1100 * s, bh = (1800 + (sp.hue % 7) * 420) * s, rows = Math.max(3, Math.floor(bh / 280)), cols = 4, wpx = bw * pu;
      // level of detail: far buildings are a flat block, mid-distance ones get a gradient, only near ones get windows
      if (wpx < 14) { ctx.fillStyle = `hsl(${sp.hue},22%,56%)`; ctx.fillRect(-bw / 2 * pu, -bh * pu, bw * pu, bh * pu); ctx.restore(); return; }
      const lod = wpx < 60 ? 1 : 2;
      if (lod === 2) { const g = ctx.createLinearGradient(-bw / 2 * pu, 0, bw / 2 * pu, 0); g.addColorStop(0, `hsl(${sp.hue},22%,${66 + (sp.hue % 3) * 4}%)`); g.addColorStop(1, `hsl(${sp.hue},22%,${48 + (sp.hue % 3) * 4}%)`); ctx.fillStyle = g; } else ctx.fillStyle = `hsl(${sp.hue},22%,${58 + (sp.hue % 3) * 5}%)`;
      ctx.fillRect(-bw / 2 * pu, -bh * pu, bw * pu, bh * pu); ctx.lineWidth = Math.max(1, pu * 8); ctx.strokeStyle = 'rgba(20,20,40,.7)'; ctx.strokeRect(-bw / 2 * pu, -bh * pu, bw * pu, bh * pu);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-bw / 2 * pu, -bh * pu, bw * pu, pu * 70); // roof edge
      if (lod === 1) { ctx.fillStyle = '#33406a'; for (let r = 0; r < rows - 1; r += 2) ctx.fillRect((-bw / 2 + bw * 0.12) * pu, (-bh + 150 * s + r * ((bh - 420 * s) / (rows - 1))) * pu, bw * 0.76 * pu, 150 * s * pu); ctx.restore(); return; }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
        const wx = (-bw / 2 + bw * (c + 0.5) / cols - 80 * s) * pu, wy = (-bh + 150 * s + r * ((bh - 420 * s) / (rows - 1))) * pu, lit = (sp.hue + r * 7 + c * 3) % 5 === 0;
        ctx.fillStyle = lit ? '#ffe3a0' : '#33406a'; ctx.fillRect(wx, wy, 160 * s * pu, 150 * s * pu);
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(wx, wy, 160 * s * pu, 30 * s * pu);
      }
      ctx.fillStyle = '#2b2f3f'; ctx.fillRect(-90 * s * pu, -230 * s * pu, 180 * s * pu, 230 * s * pu); ctx.fillStyle = 'rgba(160,200,255,.5)'; ctx.fillRect(-70 * s * pu, -210 * s * pu, 140 * s * pu, 140 * s * pu); // doorway
    } else if (sp.type === 'streettree') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-pu * 14, -pu * 230, pu * 28, pu * 230);
      ctx.fillStyle = '#4bb852'; for (const [cx, cy, r] of [[0, -330, 120], [-80, -280, 85], [80, -280, 85]]) { ellipse(ctx, cx * pu, cy * pu, r * pu, r * pu); ctx.fill(); ctx.stroke(); }
    } else if (sp.type === 'streetlamp') {
      ctx.fillStyle = '#3b3f4d'; ctx.fillRect(-pu * 10, -pu * 520, pu * 20, pu * 520); ctx.fillRect(-pu * 10, -pu * 520, pu * 130, pu * 18);
      ctx.fillStyle = '#fff3b0'; ellipse(ctx, pu * 110, -pu * 500, pu * 38, pu * 20); ctx.fill(); ctx.stroke();
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

  // Vehicles: rear view (ahead of us), front view (in the mirror) or side view (cross traffic). Sizes are real (1 unit = 1 cm).
  function drawVehicle(ctx, v, x, y, pu, mode, t) {
    const T = C.VEHICLE_TYPES[v.type], w = T.w * pu, h = T.h * pu, body = v.color, dark = shade(body, -0.4), light = shade(body, 0.35);
    const lw = Math.max(1, pu * 5), edge = 'rgba(15,15,30,.65)';
    ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = edge;
    const sg = ctx.createRadialGradient(0, 0, w * 0.1, 0, 0, w * 0.75); sg.addColorStop(0, 'rgba(0,0,0,.4)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    const blinkOn = v.blink && Math.floor(t * 4) % 2 === 0, side = v.mode === 'traffic' || v.mode === 'parked' ? -Math.sign(v.laneX || 1) : 0;
    if (mode === 'side') {
      const L = T.len * 100 * pu, dir = v.vx < 0 ? -1 : 1; // front of the car points the way it is driving
      ctx.fillStyle = sg; ellipse(ctx, 0, pu * 4, L * 0.62, h * 0.12); ctx.fill();
      ctx.scale(dir, 1);
      const gb = ctx.createLinearGradient(0, -h * 0.7, 0, 0); gb.addColorStop(0, light); gb.addColorStop(1, dark);
      ctx.fillStyle = gb; rrect(ctx, -L / 2, -h * 0.62, L, h * 0.46, h * 0.12); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-L * 0.38, -h * 0.62); ctx.lineTo(-L * 0.28, -h * 0.98); ctx.lineTo(L * 0.2, -h * 0.98); ctx.lineTo(L * 0.34, -h * 0.62); ctx.closePath(); ctx.fillStyle = body; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#243049'; for (const [a0, a1] of [[-0.25, -0.02], [0.02, 0.2]]) { ctx.beginPath(); ctx.moveTo(L * a0, -h * 0.66); ctx.lineTo(L * (a0 + 0.015), -h * 0.93); ctx.lineTo(L * (a1 - 0.02), -h * 0.93); ctx.lineTo(L * a1 + L * 0.03, -h * 0.66); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#fff6c2'; ellipse(ctx, L * 0.47, -h * 0.42, L * 0.03, h * 0.07); ctx.fill(); ctx.fillStyle = '#ff4d4d'; ellipse(ctx, -L * 0.48, -h * 0.42, L * 0.02, h * 0.07); ctx.fill();
      for (const wx of [-0.29, 0.3]) { ctx.fillStyle = '#16161e'; ellipse(ctx, L * wx, -h * 0.17, h * 0.17, h * 0.17); ctx.fill(); ctx.fillStyle = '#aab0bb'; ellipse(ctx, L * wx, -h * 0.17, h * 0.08, h * 0.08); ctx.fill(); }
      ctx.restore(); return;
    }
    ctx.fillStyle = sg; ellipse(ctx, 0, pu * 4, w * 0.7, h * 0.1); ctx.fill();
    const front = mode === 'front', tall = v.type === 'van' ? 1.12 : v.type === 'suv' ? 1.0 : 0.82;
    for (const sx of [-1, 1]) { ctx.fillStyle = '#16161e'; rrect(ctx, sx * w * 0.37 - w * 0.085, -h * 0.3, w * 0.17, h * 0.3, w * 0.03); ctx.fill(); ctx.stroke(); }
    const gb = ctx.createLinearGradient(0, -h * 0.65, 0, -h * 0.1); gb.addColorStop(0, light); gb.addColorStop(1, dark);
    ctx.fillStyle = gb; rrect(ctx, -w / 2, -h * 0.62, w, h * 0.5, w * 0.06); ctx.fill(); ctx.stroke();
    const topY = -h * (0.62 + 0.36 * tall);
    ctx.beginPath(); ctx.moveTo(-w * 0.45, -h * 0.62); ctx.lineTo(-w * 0.38, topY); ctx.lineTo(w * 0.38, topY); ctx.lineTo(w * 0.45, -h * 0.62); ctx.closePath(); ctx.fillStyle = body; ctx.fill(); ctx.stroke();
    const gg = ctx.createLinearGradient(0, topY, 0, -h * 0.62); gg.addColorStop(0, '#34456b'); gg.addColorStop(1, '#1c2640');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(-w * 0.4, -h * 0.65); ctx.lineTo(-w * 0.34, topY + h * 0.035); ctx.lineTo(w * 0.34, topY + h * 0.035); ctx.lineTo(w * 0.4, -h * 0.65); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.65); ctx.lineTo(-w * 0.24, topY + h * 0.04); ctx.lineTo(-w * 0.12, topY + h * 0.04); ctx.lineTo(-w * 0.18, -h * 0.65); ctx.closePath(); ctx.fill();
    if (front) {
      ctx.fillStyle = '#1b1f2a'; rrect(ctx, -w * 0.2, -h * 0.36, w * 0.4, h * 0.15, w * 0.02); ctx.fill(); // grille
      for (const sx of [-1, 1]) { ctx.fillStyle = '#fffbe0'; rrect(ctx, sx * w * 0.36 - w * 0.09, -h * 0.5, w * 0.18, h * 0.1, w * 0.03); ctx.fill(); ctx.stroke(); }
    } else {
      for (const sx of [-1, 1]) { const amber = blinkOn && Math.sign(sx) === Math.sign(side || sx); ctx.fillStyle = amber ? '#ffb020' : '#b3262c'; rrect(ctx, sx * w * 0.4 - w * 0.07, -h * 0.5, w * 0.14, h * 0.1, w * 0.02); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = '#f5f5f8'; rrect(ctx, -w * 0.12, -h * 0.28, w * 0.24, h * 0.08, w * 0.01); ctx.fill(); ctx.stroke(); // plate
      if (v.type === 'suv') { ctx.strokeStyle = 'rgba(20,20,30,.6)'; ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.moveTo(-w * 0.36, topY - h * 0.02); ctx.lineTo(w * 0.36, topY - h * 0.02); ctx.stroke(); } // roof rail
    }
    ctx.fillStyle = '#1b1f2a'; rrect(ctx, -w / 2, -h * 0.17, w, h * 0.09, w * 0.03); ctx.fill(); // bumper
    // an opened door on a parked car swings out into the road
    if (v.doorT > 0 && v.mode === 'parked') {
      const sd = -Math.sign(v.x), open = Math.min(1, v.doorT / 0.4, (1.8 - v.doorT) / 0.2 + 0.05);
      ctx.fillStyle = shade(body, 0.15); ctx.beginPath(); ctx.moveTo(sd * w * 0.5, -h * 0.6); ctx.lineTo(sd * (w * 0.5 + w * 0.42 * open), -h * 0.52); ctx.lineTo(sd * (w * 0.5 + w * 0.42 * open), -h * 0.14); ctx.lineTo(sd * w * 0.5, -h * 0.18); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a3856'; ctx.beginPath(); ctx.moveTo(sd * w * 0.52, -h * 0.57); ctx.lineTo(sd * (w * 0.5 + w * 0.38 * open), -h * 0.5); ctx.lineTo(sd * (w * 0.5 + w * 0.38 * open), -h * 0.36); ctx.lineTo(sd * w * 0.52, -h * 0.4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // Flat road decals: zebra crossing stripes
  function drawCrosswalk(ctx, x, y, pu, hw) {
    ctx.save(); ctx.translate(x, y); const n = 14, sw = (hw * 2) / n, hh = pu * 70;
    for (let i = 0; i < n; i += 2) { ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(-hw + i * sw, -hh, sw * 0.9, hh); }
    ctx.restore();
  }
  function drawSignal(ctx, x, y, pu, state, t) {
    ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, pu * 6); ctx.strokeStyle = 'rgba(15,15,30,.7)';
    ctx.fillStyle = '#3b3f4d'; ctx.fillRect(-pu * 8, -pu * 330, pu * 16, pu * 330);
    rrect(ctx, -pu * 28, -pu * 440, pu * 56, pu * 130, pu * 12); ctx.fillStyle = '#1b1f2a'; ctx.fill(); ctx.stroke();
    const amber = state === 'amber' && Math.floor(t * 3) % 2 === 0;
    for (const [i, col, on] of [[0, '#ff4d4d', false], [1, '#ffb020', amber], [2, '#51cf66', state === 'green']]) { ctx.fillStyle = on ? col : 'rgba(255,255,255,.12)'; ellipse(ctx, 0, -pu * (415 - i * 38), pu * 12, pu * 12); ctx.fill(); }
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

  // The race as seen by the rear-view mirror camera: everything mapped onto the reversed track (s -> L - s, x -> -x).
  function buildMirrorView(race) {
    const L = race.length, f = (o, extra) => Object.create(o, Object.assign({ s: { value: L - o.s }, x: { value: -o.x } }, extra || {}));
    return {
      track: C.reverseTrack(race.track), length: L, state: race.state, time: race.time,
      player: f(race.player, { lean: { value: -race.player.lean }, hop: { value: 0 } }),
      riders: race.riders.map((r) => f(r, { lean: { value: -r.lean }, yaw: { value: 0, writable: true } })),
      boxes: race.boxes.map((b) => f(b)), hazards: race.hazards.map((h) => f(h)),
      projectiles: race.projectiles.map((q) => f(q)),
      vehicles: race.vehicles.map((v) => f(v, { vx: { value: -(v.vx || 0) }, laneX: { value: -(v.laneX || 0) } })),
      junctions: race.junctions.map((j) => ({ s: L - j.s, active: j.active })),
    };
  }

  class Renderer {
    constructor(canvas, opts = {}) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.bg = 0; this.pitch = 0; this.horizon = 360; this.stats = { riders: 0, sprites: {} };
      // camera and size settings; the rear-view mirror is a second renderer with a low, wide, backward-looking camera
      this.opts = Object.assign({ camH: CAM_H, camBack: CAM_BACK, rw: RW, depth: BASE_DEPTH, drawMax: DRAW_MAX, pitch: true, speedFov: true, mirror: false, fixed: null }, opts);
      this.mirror = this.opts.mirror; this.resize();
    }

    resize() {
      if (this.opts.fixed) { // offscreen canvas of a fixed size (the mirror)
        [this.W, this.H] = this.opts.fixed; this.cv.width = this.W; this.cv.height = this.H; this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ui = 1; return;
      }
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
      if (th.skyline) {
        [[0.25, 0.30, 90, 0], [0.6, 0.20, 60, 1]].forEach(([sp, amp, bwid, li]) => {
          ctx.fillStyle = th.hills[li]; ctx.strokeStyle = INK; ctx.lineWidth = 2; const off = this.bg * sp;
          for (let x = -bwid; x <= W + bwid; x += bwid) { const k = Math.floor((x + off) / bwid), hsh = Math.abs(Math.sin(k * 127.1 + li * 31.7) * 43758.5) % 1, hh = H * amp * (0.35 + 0.65 * hsh), bx = x - (((off % bwid) + bwid) % bwid); ctx.fillRect(bx, base - hh, bwid - 4, hh + 4); ctx.strokeRect(bx, base - hh, bwid - 4, hh + 4); }
        });
      } else
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
      const { ctx, W, H } = this, track = race.track, segs = track.segs, N = track.N, T = track.trackLen, p = race.player, th = track.theme, O = this.opts;
      const DRAW = Math.min(O.drawMax, N - O.camBack / SEG_LEN - 4 | 0); // never wrap past the camera segment
      // Camera pitch: look at the road surface ahead. Descents tilt the view down (horizon rises) so the road stays on screen
      // instead of showing mostly sky; climbs tilt up only a little.
      const slope = O.pitch ? (track.elevationAt(p.s + 35) - track.elevationAt(p.s + 5)) / 30 * C.VEXAG : 0;
      const targetPitch = clamp(slope < 0 ? slope * 0.95 : slope * 0.35, -0.3, 0.12) * H;
      DEPTH = O.depth * (O.speedFov ? 1 - clamp((p.v - 6) / 16, 0, 1) * 0.2 : 1);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, (dt || 0.016) * 2.5);
      this.horizon = H / 2 + this.pitch;
      this.drawBackground(race, dt);

      const mod = (z) => ((z % T) + T) % T;
      const camZ = mod(p.s * UNIT - O.camBack);
      const baseI = Math.floor(camZ / SEG_LEN), base = segs[baseI], pct = (camZ % SEG_LEN) / SEG_LEN;
      const shake = p.hop > 0 ? Math.sin(this.t * 30) * 16 * Math.sin(Math.PI * (1 - p.hop / 0.35)) : 0; // eases in and out with the hop
      const camY = lerp(base.y1, base.y2, pct) + O.camH + (O.mirror ? 0 : shake);
      const camX = p.x * ROAD_W * 0.8 * track.widthAt(p.s);
      let dx = -(base.curve * pct), x = 0, maxy = H;

      for (let n = 0; n < DRAW; n++) {
        const seg = segs[(baseI + n) % N], looped = seg.i < baseI, z = camZ - (looped ? T : 0);
        this.project(seg.p1, camX - x, camY, z, seg.w1); this.project(seg.p2, camX - x - dx, camY, z, seg.w2);
        x += dx; dx += seg.curve; seg.clip = maxy;
        let a = seg.p1.screen; const b = seg.p2.screen;
        let clipped = false;
        if (seg.p1.camera.z <= DEPTH * 25 && seg.p2.camera.z > DEPTH * 25) {
          // the segment under the camera: clip it at a near plane so the road in front of the wheel is still drawn (matters for the low mirror camera)
          const c1 = seg.p1.camera, c2 = seg.p2.camera, nz = DEPTH * 25, t = (nz - c1.z) / (c2.z - c1.z), cx = lerp(c1.x, c2.x, t), cy = lerp(c1.y, c2.y, t), sc = DEPTH / nz;
          a = { scale: sc, x: Math.round(W / 2 + (sc * cx * W) / 2), y: Math.round(this.horizon - (sc * cy * H) / 2), w: Math.round((sc * ROAD_W * lerp(seg.w1, seg.w2, t) * W) / 2) };
          clipped = true;
        }
        if (a.scale <= 0 || a.scale > 40 || (!clipped && seg.p1.camera.z <= DEPTH) || b.y >= a.y || b.y >= maxy) continue;
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
      for (const d of track.decals || []) put(d.s, d.type === 'signal' ? { kind: 'signal', off: d.side * 1.12, d } : { kind: 'crosswalk', off: 0 });
      for (const v of race.vehicles || []) put(v.s, { kind: 'vehicle', off: v.x, v });
      for (const b of race.boxes) if (b.active) put(b.s, { kind: 'box', off: b.x, b });
      for (const h of race.hazards) put(h.s, { kind: 'banana', off: h.x });
      for (const pr of race.projectiles) put(pr.s, { kind: 'proj', off: pr.x, pr });
      this.stats = { riders: 0, sprites: {} };
      for (const r of race.riders) { if (O.mirror && r.isPlayer) continue; put(r.s, { kind: 'rider', off: r.x, r }); }

      const tagged = new Set(race.riders.filter((o) => !o.isPlayer && o.s - p.s > 3 && o.s - p.s < 90).sort((a, b) => a.s - b.s).slice(0, 3));
      for (let n = DRAW - 1; n >= 1; n--) {
        const list = buckets[n];
        const seg = segs[(baseI + n) % N], a = seg.p1.screen, b = seg.p2.screen;
        if (!list && !seg.walls) continue;
        if (!a.scale || a.scale < 0 || seg.p1.camera.z <= DEPTH) continue;
        const clip = Math.min(H, seg.clip), needClip = clip < a.y - 2; // clipping is only needed where a nearer crest hides part of this segment's sprites
        ctx.save(); if (needClip) { ctx.beginPath(); ctx.rect(0, 0, W, clip + 2); ctx.clip(); }
        if (seg.walls) this.drawWalls(seg, a, b, th);
        const fogA = clamp(1 - (n / DRAW) * (n / DRAW) * 1.1, 0, 1);
        if (fogA < 0.08) { ctx.restore(); continue; } // lost in the fog
        for (const sp of list || []) {
          ctx.globalAlpha = fogA;
          // Project the sprite's own world position exactly (camera-relative z/x/y interpolated along the road polyline), instead of
          // interpolating the segment's screen points: the latter is wrong close to the camera and made nearby riders breathe and bob.
          const c1 = seg.p1.camera, c2 = seg.p2.camera, zc = lerp(c1.z, c2.z, sp.pct), xc = lerp(c1.x, c2.x, sp.pct), yc = lerp(c1.y, c2.y, sp.pct);
          const sc = DEPTH / zc, pu = (sc * W) / 2, wf = lerp(seg.w1, seg.w2, sp.pct);
          const sx = W / 2 + sc * (xc + sp.off * ROAD_W * wf) * W / 2, sy = this.horizon - sc * yc * H / 2, hw = sc * ROAD_W * wf * W / 2;
          if (sp.kind === 'scenery' && pu * 400 < 1.6) continue; // too small to see
          if (sp.kind === 'scenery') { if (sp.sc.type === 'building') ctx.globalAlpha = fogA * clamp((n - 5) / 3, 0, 1); drawScenery(ctx, sp.sc, sx, sy, pu, O.mirror); } // very near facades fade out rather than blocking the view
          else if (sp.kind === 'obstacle') drawObstacle(ctx, sp.o, sx, sy, pu, hw);
          else if (sp.kind === 'crosswalk') drawCrosswalk(ctx, sx, sy, pu, hw);
          else if (sp.kind === 'signal') drawSignal(ctx, sx, sy, pu, race.junctions && race.junctions.some((j) => j.active && Math.abs(j.s - sp.d.s) < 12) ? 'amber' : 'green', this.t);
          else if (sp.kind === 'vehicle') drawVehicle(ctx, sp.v, sx, sy, pu, sp.v.mode === 'cross' ? 'side' : this.mirror ? 'front' : 'rear', this.t);
          else if (sp.kind === 'rider') {
            const r = sp.r; this.stats.sprites[r.name] = { sx, sy, w: pu * O.rw }; r.yaw = clamp(track.curveAt(r.s) / 6, -1, 1) * 0.8 + r.lean * 0.25; const hopY = r.hop > 0 ? Math.sin(Math.PI * (1 - r.hop / 0.35)) * pu * 40 : 0;
            const dz = seg.p1.camera.z + sp.pct * SEG_LEN, fade = r.isPlayer ? 1 : clamp((dz - 390) / 90, 0, 1) * r.ghost; // short fade as a rival slips behind the camera; riders level with you stay solid
            if (fade > 0.02) { ctx.globalAlpha = fade * fogA; drawRider(ctx, sx, sy - hopY, pu * O.rw, r, this.t, O.mirror); ctx.globalAlpha = fogA; this.stats.riders++; }
            if (!O.mirror && pu * O.rw > 28 && (r.isPlayer || tagged.has(r))) { // (no name tags in the mirror: the image is flipped)
              const sz = clamp(pu * O.rw * 0.2, 10, 20);
              if (r.isPlayer) { ctx.save(); ctx.translate(sx, sy - pu * O.rw * 1.5); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(15,15,30,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-sz * 0.6, -sz * 0.6); ctx.lineTo(sz * 0.6, -sz * 0.6); ctx.lineTo(0, sz * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
              else {
                const label = r.status ? `${r.name} · ${r.status}` : r.name, stCol = r.status === 'SPRINT' ? '#ff8787' : r.status === 'ATTACK' ? '#ffd43b' : r.status === 'TIRED' ? '#9bd0ff' : '#fff';
                ctx.font = `700 ${sz}px ${FONT}`; const tw = ctx.measureText(label).width + sz * 0.9, ty = sy - pu * O.rw * 1.45;
                rrect(ctx, sx - tw / 2, ty - sz * 0.75, tw, sz * 1.5, sz * 0.75); ctx.fillStyle = 'rgba(15,15,30,.6)'; ctx.fill();
                ctx.fillStyle = stCol; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, sx, ty + 1);
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

      // rear-view mirror (a second, backward-looking render drawn flipped, like a real mirror)
      if (hud.mirror && W > 900) {
        const mx0 = W / 2 + S(66), mw = Math.min(S(330), W - S(256) - mx0 - S(12)), mh = mw * (hud.mirror.height / hud.mirror.width), my0 = S(14);
        if (mw > S(180)) {
          ctx.save(); rrect(ctx, mx0, my0, mw, mh, S(16)); ctx.clip();
          ctx.translate(mx0 + mw, my0); ctx.scale(-1, 1); ctx.drawImage(hud.mirror, 0, 0, mw, mh);
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.restore(); ctx.save();
          const gl = ctx.createLinearGradient(mx0, my0, mx0 + mw, my0 + mh); gl.addColorStop(0, 'rgba(255,255,255,.28)'); gl.addColorStop(0.35, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.15)');
          rrect(ctx, mx0, my0, mw, mh, S(16)); ctx.fillStyle = gl; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke(); ctx.restore();
          text(ctx, 'REAR', mx0 + mw / 2, my0 + mh + S(11), S(12), '#fff', 'center');
        }
      }

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
        // traffic warnings take priority: crossing car > car pulling out/drifting > traffic ahead > parked cars (doors)
        let vlabel = null, vrank = 9;
        for (const v of race.vehicles || []) {
          const d = ((v.s - p.s) % L + L * 1.5) % L - L / 2; if (d < 1.5 || d > 100) continue;
          const rk = v.mode === 'cross' ? 0 : v.blink ? 1 : v.mode === 'traffic' && d < 60 ? 2 : v.mode === 'parked' && d < 45 && v.door ? 3 : 9;
          if (rk < vrank) { vrank = rk; vlabel = ['CAR CROSSING AHEAD!', 'CAR PULLING OUT!', 'TRAFFIC AHEAD', 'PARKED CARS: WATCH THE DOORS'][rk]; }
        }
        const label0 = near && (!narrowSoon || bd < 30) ? { bump: 'SPEED BUMPS', cone: 'CONES: WEAVE!', pothole: 'POTHOLES', barrel: 'BARRELS: FIND THE GAP' }[near.type] + ` ${Math.round(bd)} m` : narrowSoon ? 'NARROW ROAD: KEEP OFF THE WALLS' : null;
        const label = vlabel || label0;
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

  Object.assign(C, { Renderer, buildMirrorView, fmtTime, drawItemIcon, zoneColor });
})();
