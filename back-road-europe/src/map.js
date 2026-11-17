/* ================= map: layers, camera, route, labels, interaction, share image ================= */
const MAP = { vb: null, anim: 0, user: false, legT: 1, stops: [], start: null, focus: null, reserved: [], el: null, svg: null };
const SVGNS = "http://www.w3.org/2000/svg";
const TIER_SHAPE = ["", "circle", "square", "diamond", "triangle", "star"];
const START = { label: "Dublin", lat: 53.35, lon: -6.26 };
[START.x, START.y] = project(START.lat, START.lon);

function mapInit() {
  MAP.el = $("map"); MAP.svg = $("svg");
  const M = D.map;
  const tierPat = (t, body) => `<pattern id="pat${t}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(${t * 30})"><rect width="8" height="8" class="pf t${t}"/>${body}</pattern>`;
  const defs = `<defs>
    ${tierPat(1, "")}${tierPat(2, `<rect width="8" height="3" class="ps"/>`)}${tierPat(3, `<circle cx="4" cy="4" r="1.6" class="ps"/>`)}
    ${tierPat(4, `<path d="M0 0L8 8M8 0L0 8" class="pl"/>`)}${tierPat(5, `<path d="M0 2H8M0 6H8" class="pl"/>`)}
    <radialGradient id="glow"><stop offset="0" class="glow0"/><stop offset="1" class="glow1"/></radialGradient>
  </defs>`;
  const ranges = M.ranges.map(r => `<path class="relief k${r.k}" d="${r.d}"/>`).join("");
  const lands = Object.entries(M.shapes).map(([cc, d]) => `<path class="land" data-cc="${cc}" d="${d}"/>`).join("");
  const seas = M.seas.map(s => `<text class="sea-name k${s.k}" x="${s.x}" y="${s.y}">${esc(s.t)}</text>`).join("");
  const rangeNames = M.ranges.filter(r => r.n).map(r => `<text class="range-name k${r.k}" x="${r.x}" y="${r.y}">${esc(r.n)}</text>`).join("");
  MAP.svg.innerHTML = `${defs}<rect class="sea" x="${-M.MX}" y="${-M.MY}" width="${M.W + 2 * M.MX}" height="${M.H + 2 * M.MY}"/>
    <path class="grat" d="${M.grat}"/><path class="land other" d="${M.other}"/><g id="lands">${lands}</g><g id="visits"></g>
    <g class="reliefs">${ranges}</g><path class="lake" d="${M.lakes}"/><path class="river" d="${M.rivers}"/><path class="border" d="${M.borders}"/>
    <g id="geo-labels">${seas}${rangeNames}</g><g id="route"></g><g id="stops"></g><g id="car"></g><g id="labels"></g>`;
  MAP.svg.setAttribute("aria-describedby", "route-desc");
  bindMapInput();
  MAP.vb = frame([{ x: 120, y: 80 }, { x: M.W - 120, y: M.H - 60 }]);
  applyVB();
}

/* ---------- camera ---------- */
function mapSize() { const r = MAP.el.getBoundingClientRect(); return { w: r.width || 600, h: r.height || 450 }; }
function frame(pts, pad = 90) {
  const M = D.map, { w: pw, h: ph } = mapSize(), AR = pw / ph || 1.2;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let w = Math.max(x1 - x0 + 2 * pad, (y1 - y0 + 2 * pad) * AR, 330);
  w = Math.min(w, M.W + 2 * M.MX, (M.H + 2 * M.MY) * AR);
  const h = w / AR;
  return { x: clamp((x0 + x1) / 2 - w / 2, -M.MX, M.W + M.MX - w), y: clamp((y0 + y1) / 2 - h / 2, -M.MY, M.H + M.MY - h), w, h };
}
function applyVB() {
  const v = MAP.vb;
  MAP.svg.setAttribute("viewBox", `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
  const k = v.w / mapSize().w;
  MAP.svg.style.setProperty("--k", k);
  MAP.svg.classList.toggle("near", k < 0.55);
  MAP.svg.classList.toggle("far", k > 1.3);
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function flyTo(to, ms = 1100, onStep) {
  cancelAnimationFrame(MAP.anim);
  const from = MAP.vb || to, t0 = performance.now(), dur = reduced ? 0 : ms;
  const step = nowT => {
    const p = dur ? clamp((nowT - t0) / dur, 0, 1) : 1, e = ease(p);
    MAP.vb = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), w: lerp(from.w, to.w, e), h: lerp(from.h, to.h, e) };
    applyVB(); if (onStep) onStep(e); drawDynamic();
    if (p < 1) MAP.anim = requestAnimationFrame(step); else layoutLabels();
  };
  step(t0);
}
// Where the camera rests: the last leg while playing, the whole route at the end.
function restFrame() {
  const pts = [START, ...MAP.stops.filter(s => s.x != null)];
  if (MAP.focus === "all" || pts.length < 2) return pts.length < 2 ? frame([{ x: 120, y: 80 }, { x: D.map.W - 120, y: D.map.H - 60 }]) : frame(pts);
  return frame(pts.slice(-2));
}
function mapShow(stops, how) { // how: "leg" draws the newest leg, "pan" moves the camera, "" redraws
  MAP.stops = stops;
  const visible = stops.filter(s => s.x != null);
  if (how === "leg" && visible.length && !MAP.user) { MAP.legT = 0; flyTo(restFrame(), 1300, e => MAP.legT = e); }
  else if (how && !MAP.user) { MAP.legT = 1; flyTo(restFrame()); }
  else { MAP.legT = 1; drawDynamic(); layoutLabels(); }
  describeRoute();
}
function recenter() { MAP.user = false; flyTo(restFrame()); }

/* ---------- route, stops, car ---------- */
function curve(a, b, i) { // a gentle bend, alternating sides
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, bend = Math.min(0.18 * len, 60) * (i % 2 ? -1 : 1);
  return { a, b, c: { x: (a.x + b.x) / 2 - dy / len * bend, y: (a.y + b.y) / 2 + dx / len * bend } };
}
const qPoint = (q, t) => ({ x: (1 - t) ** 2 * q.a.x + 2 * (1 - t) * t * q.c.x + t * t * q.b.x, y: (1 - t) ** 2 * q.a.y + 2 * (1 - t) * t * q.c.y + t * t * q.b.y });
function qPath(q, t = 1) {
  if (t >= 1) return `M${q.a.x.toFixed(1)} ${q.a.y.toFixed(1)}Q${q.c.x.toFixed(1)} ${q.c.y.toFixed(1)} ${q.b.x.toFixed(1)} ${q.b.y.toFixed(1)}`;
  let d = `M${q.a.x.toFixed(1)} ${q.a.y.toFixed(1)}`;
  for (let s = 1; s <= 24; s++) { const p = qPoint(q, t * s / 24); d += `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }
  return d;
}
function marker(s, k, big) {
  const r = (big ? 8 : 6.5) * k, x = s.x, y = s.y, cls = `stop t${s.tier}${s.current ? " current" : ""}`;
  const shape = TIER_SHAPE[s.tier] || "circle";
  let el;
  if (shape === "square") el = `<rect class="${cls}" x="${x - r * .85}" y="${y - r * .85}" width="${r * 1.7}" height="${r * 1.7}" rx="${r * .2}"/>`;
  else if (shape === "diamond") el = `<path class="${cls}" d="M${x} ${y - r * 1.15}L${x + r * 1.15} ${y}L${x} ${y + r * 1.15}L${x - r * 1.15} ${y}Z"/>`;
  else if (shape === "triangle") el = `<path class="${cls}" d="M${x} ${y - r * 1.2}L${x + r * 1.1} ${y + r * .8}L${x - r * 1.1} ${y + r * .8}Z"/>`;
  else if (shape === "star") { let d = ""; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .55 : r * 1.25; d += (i ? "L" : "M") + (x + rr * Math.cos(a)).toFixed(1) + " " + (y + rr * Math.sin(a)).toFixed(1); } el = `<path class="${cls}" d="${d}Z"/>`; }
  else el = `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`;
  return `<g class="stop-g" data-i="${s.i}" tabindex="-1">${el}</g>`;
}
function drawDynamic() {
  if (!MAP.vb) return;
  const k = MAP.vb.w / mapSize().w, pts = [START, ...MAP.stops.filter(s => s.x != null)];
  const legs = pts.slice(1).map((p, i) => curve(pts[i], p, i));
  let route = "";
  legs.forEach((q, i) => { const t = i === legs.length - 1 ? MAP.legT : 1; const d = qPath(q, t); route += `<path class="casing" d="${d}"/><path class="centre" d="${d}"/>`; });
  $("route").innerHTML = route;
  let st = `<circle class="stop home" cx="${START.x}" cy="${START.y}" r="${5 * k}"/>`;
  const visible = MAP.stops.filter(s => s.x != null);
  visible.forEach((s, j) => { if (j < visible.length - 1 || MAP.legT >= 1) st += marker(s, k, s.current); });
  $("stops").innerHTML = st;
  // the car rides the newest leg, pointing where it's going
  if (legs.length && MAP.legT < 1) {
    const q = legs[legs.length - 1], p = qPoint(q, MAP.legT), p2 = qPoint(q, Math.min(1, MAP.legT + 0.02));
    const ang = Math.atan2(p2.y - p.y, p2.x - p.x) * 180 / Math.PI;
    $("car").innerHTML = `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${ang.toFixed(0)}) scale(${(k * 1.1).toFixed(3)})"><rect class="car-body" x="-9" y="-5" width="18" height="10" rx="3"/><rect class="car-glass" x="1" y="-3.6" width="5" height="7.2" rx="1.2"/><circle class="car-wheel" cx="-5" cy="-5.2" r="1.8"/><circle class="car-wheel" cx="5" cy="-5.2" r="1.8"/><circle class="car-wheel" cx="-5" cy="5.2" r="1.8"/><circle class="car-wheel" cx="5" cy="5.2" r="1.8"/></g>`;
  } else $("car").innerHTML = "";
  // countries you've been through, patterned by road
  const best = {};
  for (const s of visible) if (s.cc && (!best[s.cc] || s.tier > best[s.cc])) best[s.cc] = s.tier;
  $("visits").innerHTML = Object.entries(best).filter(([cc]) => D.map.shapes[cc]).map(([cc, tr]) => `<path class="visit" fill="url(#pat${tr || 1})" d="${D.map.shapes[cc]}"/>`).join("");
}

/* ---------- labels that don't collide ---------- */
function layoutLabels() {
  const v = MAP.vb; if (!v) return;
  const { w: pw } = mapSize(), k = v.w / pw, fs = 12.5 * k, pad = 3 * k;
  const placed = [], out = [];
  const rect = r => r;
  const reserved = MAP.reserved.map(r => ({ x: v.x + r.x * k, y: v.y + r.y * k, w: r.w * k, h: r.h * k }));
  const overlaps = r => placed.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)
    || reserved.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)
    || r.x < v.x + pad || r.y < v.y + pad || r.x + r.w > v.x + v.w - pad || r.y + r.h > v.y + v.h - pad;
  const visible = MAP.stops.filter(s => s.x != null);
  for (const s of [...visible, START]) placed.push({ x: s.x - 7 * k, y: s.y - 7 * k, w: 14 * k, h: 14 * k }); // keep markers clear
  const items = [];
  visible.slice().reverse().forEach((s, i) => items.push({ s, text: s.label, pri: s.current ? 0 : 1 + i }));
  items.push({ s: START, text: START.label, pri: 50 });
  items.sort((a, b) => a.pri - b.pri);
  for (const { s, text } of items) {
    const tw = Math.min(text.length, 26) * fs * 0.56 + 2 * pad, th = fs * 1.3, off = 9 * k;
    const cands = [[off, -th / 2], [-off - tw, -th / 2], [-tw / 2, -off - th], [-tw / 2, off], [off, -th - 2 * k], [off, 2 * k], [-off - tw, -th - 2 * k], [-off - tw, 2 * k]];
    for (const [dx, dy] of cands) {
      const r = { x: s.x + dx, y: s.y + dy, w: tw, h: th };
      if (!overlaps(r)) { placed.push(r); out.push(`<text class="lbl${s.current ? " cur" : ""}" x="${(r.x + pad).toFixed(1)}" y="${(r.y + th * 0.72).toFixed(1)}" font-size="${fs.toFixed(2)}" stroke-width="${(3.2 * k).toFixed(2)}">${esc(text.length > 26 ? text.slice(0, 25) + "…" : text)}</text>`); break; }
    }
  }
  $("labels").innerHTML = out.join("");
  // sea and mountain names give way to stop labels and to each other, biggest features first
  const geo = [...$("geo-labels").children].map(el => ({ el, kk: +(el.getAttribute("class").match(/k(\d)/) || [0, 2])[1], sea: el.classList.contains("sea-name") }))
    .sort((a, b) => a.kk - b.kk || (b.sea - a.sea));
  for (const g of geo) {
    const x = +g.el.getAttribute("x"), y = +g.el.getAttribute("y"), em = (g.sea ? (g.kk === 1 ? 17 : 13) : 11) * k;
    const tw = g.el.textContent.length * em * 0.82, r = { x: x - tw / 2, y: y - em, w: tw, h: em * 1.4 };
    const tooSmall = (g.kk === 3 && k > 0.9) || (g.kk === 2 && k > 2.2) || (!g.sea && g.kk >= 2 && k > 1.2);
    const hide = tooSmall || overlaps(r);
    g.el.style.display = hide ? "none" : "";
    if (!hide) placed.push(r);
  }
}
function describeRoute() {
  const visible = MAP.stops.filter(s => s.x != null && !s.pending);
  $("route-desc").textContent = visible.length ? t("routeDesc", { list: visible.map(s => `${s.label} (${t("tier" + s.tier)})`).join(", ") }) : t("routeStart");
}

/* ---------- zoom, pan, tap ---------- */
function toSvg(cx, cy) { const pt = MAP.svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(MAP.svg.getScreenCTM().inverse()); }
function zoomAt(f, cx, cy) {
  const M = D.map, v = MAP.vb, p = cx == null ? { x: v.x + v.w / 2, y: v.y + v.h / 2 } : toSvg(cx, cy);
  const w = clamp(v.w * f, 120, M.W + 2 * M.MX), h = w * v.h / v.w;
  MAP.vb = { x: clamp(p.x - (p.x - v.x) * w / v.w, -M.MX, M.W + M.MX - w), y: clamp(p.y - (p.y - v.y) * h / v.h, -M.MY, M.H + M.MY - h), w, h };
  MAP.user = true; cancelAnimationFrame(MAP.anim); applyVB(); drawDynamic(); layoutLabels();
}
function panBy(dx, dy) {
  const M = D.map, v = MAP.vb, k = v.w / mapSize().w;
  MAP.vb = { ...v, x: clamp(v.x - dx * k, -M.MX, M.W + M.MX - v.w), y: clamp(v.y - dy * k, -M.MY, M.H + M.MY - v.h) };
  MAP.user = true; cancelAnimationFrame(MAP.anim); applyVB(); drawDynamic(); layoutLabels();
}
function bindMapInput() {
  const el = MAP.el, pointers = new Map(); let last = null, pinch = null, moved = 0;
  el.addEventListener("wheel", e => { e.preventDefault(); zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  el.addEventListener("pointerdown", e => { if (e.target.closest("button,.pop")) return; el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; moved = 0; });
  el.addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt(pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d; moved += 10; return;
    }
    if (last) { const dx = e.clientX - last.x, dy = e.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy); if (moved > 4) panBy(dx, dy); last = { x: e.clientX, y: e.clientY }; }
  });
  const up = e => {
    const wasTap = moved < 5 && pointers.size === 1;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; last = null;
    if (wasTap) { const g = e.target.closest && e.target.closest(".stop-g"); if (g) openStopPopup(+g.dataset.i); else closePopup(); }
  };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  el.addEventListener("keydown", e => {
    const map = { "+": () => zoomAt(0.7), "=": () => zoomAt(0.7), "-": () => zoomAt(1.4), ArrowLeft: () => panBy(40, 0), ArrowRight: () => panBy(-40, 0), ArrowUp: () => panBy(0, 40), ArrowDown: () => panBy(0, -40), "0": recenter };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  });
}
function openStopPopup(i) {
  const s = MAP.stops.find(x => x.i === i); if (!s) return;
  const pop = $("pop"), r = MAP.el.getBoundingClientRect(), ctm = MAP.svg.getScreenCTM();
  const px = s.x * ctm.a + ctm.e - r.left, py = s.y * ctm.d + ctm.f - r.top;
  pop.innerHTML = `<div class="pop-q">${esc(s.q)}</div><div class="pop-a">${flagHtml(s.cc)}${esc(s.label)}</div>${s.at ? `<div class="pop-at">${esc(t("drivesTo", { x: s.at }))}</div>` : ""}<div class="pop-row">${tierChip(s.tier, s.pts)}</div>`;
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = clamp(px - w / 2, 8, r.width - w - 8) + "px";
  pop.style.top = (py - h - 14 < 8 ? py + 14 : py - h - 14) + "px";
}
function closePopup() { const p = $("pop"); if (p) p.hidden = true; }

/* ---------- route image to save or share ---------- */
async function routeImage(sum, title, sub) {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || "#888";
  g.fillStyle = col("--bg"); g.fillRect(0, 0, W, H);
  // the map, as it stands now, framed on the whole route
  const saveVB = MAP.vb, saveFocus = MAP.focus; MAP.focus = "all"; MAP.vb = restFrame(); applyVB(); drawDynamic(); layoutLabels();
  const clone = MAP.svg.cloneNode(true), box = MAP.svg.getBoundingClientRect();
  clone.setAttribute("width", box.width); clone.setAttribute("height", box.height);
  const styles = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const vars = [...css].filter(p => p.startsWith("--")).map(p => `${p}:${css.getPropertyValue(p)}`).join(";");
  clone.insertAdjacentHTML("afterbegin", `<style>svg{${vars}}${styles}</style>`);
  MAP.vb = saveVB; MAP.focus = saveFocus; applyVB(); drawDynamic(); layoutLabels();
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  await new Promise(res => { const im = new Image(); im.onload = () => { const mw = W - 96, mh = mw * box.height / box.width; g.save(); g.beginPath(); g.roundRect ? g.roundRect(48, 230, mw, mh, 24) : g.rect(48, 230, mw, mh); g.clip(); g.drawImage(im, 48, 230, mw, mh); g.restore(); res(); }; im.onerror = res; im.src = url; });
  g.fillStyle = col("--ink"); g.font = "900 64px Overpass, Arial, sans-serif"; g.fillText("BACK ROAD EUROPE", 48, 110);
  g.fillStyle = col("--muted"); g.font = "500 34px Figtree, Arial, sans-serif"; g.fillText(title, 48, 165);
  g.fillStyle = col("--ink"); g.font = "900 120px Overpass, Arial, sans-serif"; g.fillText(String(sum.pts), 48, H - 150);
  g.font = "700 40px Overpass, Arial, sans-serif"; g.fillText(sub, 48, H - 90);
  const sw = 92; sum.rows.forEach((r, i) => { g.fillStyle = col("--t" + r.tier); g.fillRect(W - 48 - (7 - i) * (sw + 10), H - 230, sw, sw); g.fillStyle = col("--tk" + r.tier); g.font = "900 40px Overpass, Arial"; g.textAlign = "center"; g.fillText(String(r.pts), W - 48 - (7 - i) * (sw + 10) + sw / 2, H - 170); g.textAlign = "left"; });
  return new Promise(res => cv.toBlob(res, "image/png"));
}
