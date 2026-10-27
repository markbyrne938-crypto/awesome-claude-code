// Race photos and a shareable results card (browser only).
(function () {
  'use strict';
  const C = (globalThis.Crit = globalThis.Crit || {});
  const INK = '#1b1b2f', FONT = '"Trebuchet MS","Arial Rounded MT Bold",system-ui,sans-serif';

  function toBlob(canvas, type = 'image/jpeg', q = 0.88) { return new Promise((res) => canvas.toBlob(res, type, q)); }

  // info: { course, theme, date, place, field, time, avg, np, wkg, best, hrAvg, hrMax, cat, ftp, power:[W per second], map:[[x,y]...] }
  async function makeCard(info) {
    const W = 1200, H = 675, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'), th = C.THEMES[info.theme] || C.THEMES.meadow;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, th.sky[0]); bg.addColorStop(1, th.sky[1]); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = th.grass[0]; g.fillRect(0, H * 0.78, W, H * 0.22);
    const text = (s, x, y, size, fill, align = 'left') => { g.font = `800 ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = Math.max(3, size * 0.16); g.strokeStyle = INK; g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y); };
    const panel = (x, y, w, h, r = 24) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = 'rgba(255,253,245,.94)'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke(); };
    text('CRIT KART', 48, 62, 54, '#ff5fa2'); text(info.course, 48, 112, 30, '#fff'); text(info.date, 48, 150, 20, '#fff');
    // headline
    panel(48, 180, 330, 190); text(`P${info.place}`, 213, 250, 96, info.place === 1 ? '#ffd43b' : '#ff5fa2', 'center'); text(`of ${info.field} riders`, 213, 330, 26, '#fff', 'center'); 
    // stats
    const stats = [['TIME', info.time], ['AVG POWER', `${info.avg} W`], ['NORMALIZED', info.np ? `${info.np} W` : '–'], ['W/KG', info.wkg], ['BEST LAP', info.best], ['HEART RATE', info.hrAvg ? `${info.hrAvg} avg / ${info.hrMax} max` : '–']];
    stats.forEach(([k, v], i) => { const x = 408 + (i % 3) * 248, y = 180 + Math.floor(i / 3) * 100; panel(x, y, 232, 88, 18); g.font = `800 15px ${FONT}`; g.fillStyle = '#6b6f82'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(k, x + 16, y + 24); g.font = `800 ${String(v).length > 11 ? 21 : 28}px ${FONT}`; g.fillStyle = INK; g.fillText(String(v), x + 16, y + 58); });
    // power chart
    panel(48, 392, 700, 230, 22);
    const pw = info.power || [];
    if (pw.length) {
      const cx = 70, cy = 412, cw = 656, ch = 160, top = Math.max(info.ftp * 1.4, ...pw), bw = cw / pw.length;
      pw.forEach((p, i) => { g.fillStyle = C.zoneColor(p / info.ftp); const h = (p / top) * ch; g.fillRect(cx + i * bw, cy + ch - h, Math.ceil(bw) + 0.5, h); });
      g.setLineDash([8, 6]); g.strokeStyle = INK; g.lineWidth = 3; const fy = cy + ch - (info.ftp / top) * ch; g.beginPath(); g.moveTo(cx, fy); g.lineTo(cx + cw, fy); g.stroke(); g.setLineDash([]);
      g.font = `800 16px ${FONT}`; g.fillStyle = INK; g.textAlign = 'left'; g.fillText(`FTP ${info.ftp} W  ·  race power per second`, cx, cy + ch + 28);
    }
    // route
    panel(770, 392, 382, 230, 22);
    if (info.map && info.map.length) {
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; for (const [x, y] of info.map) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
      const k = Math.min(300 / (maxx - minx || 1), 170 / (maxy - miny || 1)), ox = 770 + 191 - ((minx + maxx) / 2) * k, oy = 392 + 115 - ((miny + maxy) / 2) * k;
      g.lineJoin = 'round'; g.beginPath(); info.map.forEach(([x, y], i) => (i ? g.lineTo(ox + x * k, oy + y * k) : g.moveTo(ox + x * k, oy + y * k))); g.closePath();
      g.lineWidth = 12; g.strokeStyle = INK; g.stroke(); g.lineWidth = 6; g.strokeStyle = '#ff5fa2'; g.stroke();
    }
    text(`Rivals: Cat ${info.cat}`, 1152, 645, 20, '#fff', 'right');
    return toBlob(cv);
  }

  C.share = { makeCard, toBlob };
})();
