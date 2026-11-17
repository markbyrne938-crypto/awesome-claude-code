/* ================= ui: screens, dialogs and small pieces ================= */
// Road-sign pictograms for the five road types: shape and picture, not just colour.
const TIER_ICON = [
  `<path d="M3 12h18" stroke-dasharray="2 3"/>`,
  `<path d="M5 21L10 3M19 21L14 3M12 6v3M12 12v3M12 18v3"/><path d="M3 10h18" stroke-width="2.4"/>`,
  `<path d="M6 21L10 3M18 21L14 3M12 5v3M12 11v3M12 17v3"/>`,
  `<path d="M8 21C8 15 16 13 16 8S12 3 12 3"/><path d="M15 21C15 15 21 13 21 8" opacity=".5"/>`,
  `<path d="M9 21C6 16 15 13 12 8S14 4 15 3"/>`,
  `<path d="M7 21C6 15 9 11 8 3M16 21C17 15 14 11 15 3"/><path d="M11 18h2M10.5 12h2M11 6h1.5" opacity=".6"/>`,
];
const tierIcon = tr => `<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true">${TIER_ICON[tr] || TIER_ICON[0]}</svg>`;
const tierChip = (tr, pts) => `<span class="chip t${tr}">${tierIcon(tr)}<span>${esc(t("tier" + tr))}</span>${pts != null ? `<b>${pts}</b>` : ""}</span>`;
const flag = cc => !cc || !/^[A-Z]{2}$/.test(cc) ? "" : String.fromCodePoint(...[...cc].map(ch => 0x1F1A5 + ch.charCodeAt(0)));
const flagHtml = cc => cc ? `<span class="flag" aria-hidden="true">${flag(cc)}</span>` : "";
const CAT_ICON = {};
const svgI = d => `<svg class="ui-i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const UI_ICON = {
  help: svgI(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5"/><circle cx="12" cy="17.2" r=".6" class="fillc"/>`),
  record: svgI(`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`),
  tables: svgI(`<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 20h8"/>`),
  duel: svgI(`<path d="M4 4l9 9M13 4l-9 9M15 11l5 5M20 11l-5 5M6 18l-2 2M18 18l2 2"/>`),
  settings: svgI(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>`),
  owner: svgI(`<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>`),
  soundOn: svgI(`<path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>`),
  soundOff: svgI(`<path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6"/>`),
};

/* ---------- header ---------- */
let odoShown = 0;
function setOdo(n) {
  const el = $("odo"), digits = String(Math.max(0, Math.round(n))).padStart(3, "0").split("");
  if (el.children.length !== digits.length + 1) el.innerHTML = digits.map(() => `<span class="dg"><span class="roll">${"0123456789".split("").map(d => `<i>${d}</i>`).join("")}</span></span>`).join("") + `<em>${esc(t("pts"))}</em>`;
  [...el.querySelectorAll(".roll")].forEach((r, i) => r.style.transform = `translateY(${-digits[i] * 10}%)`);
  el.setAttribute("aria-label", t("pointsAria", { n }));
  odoShown = n;
}
function renderHeader() {
  const c = cetNow(), r = RUN;
  let mode = !r ? "" : r.type === "practice" ? t("practice") : r.type === "duel" ? t("duelMode") : r.type === "tutorial" ? t("tutorial")
    : t("routeN", { n: routeNo(r.day) }) + (r.day !== c.day ? " · " + t("earlier") : "");
  if (r && r.mode && r.mode !== "std") mode += " · " + t("mode_" + r.mode);
  $("mode").textContent = mode + " · " + t("nextIn", { t: hms(c.left) });
  const snd = SETTINGS.sound ? t("soundOn") : t("soundOff");
  $("b-sound").innerHTML = `<span class="ti" aria-hidden="true">${SETTINGS.sound ? UI_ICON.soundOn : UI_ICON.soundOff}</span><span class="tl">${esc(snd)}</span>`; $("b-sound").setAttribute("aria-label", snd); $("b-sound").title = snd;
  if (r) { const p = summarise(r).pts; if (p !== odoShown || !$("odo").children.length) setOdo(p); }
  $("b-sound").setAttribute("aria-pressed", String(!!SETTINGS.sound));
}
function renderPips() {
  const r = RUN; if (!r) return;
  const sum = summarise(r);
  $("pips").innerHTML = r.pids.map((id, i) => {
    const row = sum.rows[i], done = i < r.ans.length, cur = i === r.idx && !done && r.phase !== "intro" && r.phase !== "end";
    const P = getPrompt(id);
    return `<li class="pip ${done ? "t" + row.tier : cur ? "now" : ""}" title="${esc(P ? t("cat_" + P.cat) : "")}">${done ? tierIcon(row.tier) : `<span>${i + 1}</span>`}<span class="sr">${esc(t("stopN", { i: i + 1 }))}: ${done ? esc(t("tier" + row.tier)) + " " + row.pts : cur ? esc(t("current")) : esc(t("toCome"))}</span></li>`;
  }).join("");
}
function renderTags() {
  const r = RUN; if (!r) return;
  const n = r.pids.length, last = r.ans.length - 1, sum = summarise(r);
  const stops = mapStops(r);
  if (r.phase === "end") { $("tagL").textContent = t("routeDone"); $("tagR").textContent = t("kmDriven", { n: fmtN(routeKm(stops)) }); $("tagB").textContent = ""; reserveMapCorners(); return; }
  $("tagL").textContent = r.phase === "intro" ? t("startAt", { x: START.label }) : t("stopOf", { i: Math.min(r.idx + 1, n), n });
  const s = r.phase === "shown" && sum.rows[last] && sum.rows[last].it ? stops[stops.length - 1] : null;
  $("tagR").textContent = s && s.leg ? t("legKm", { n: fmtN(s.leg) }) : "";
  $("tagB").textContent = s ? [s.label, s.at, countryName(s.cc)].filter(Boolean).join(" · ") : "";
  reserveMapCorners();
}
// The places this run has driven to, in order.
function mapStops(r) {
  const sum = summarise(r), out = []; let prev = START;
  sum.rows.forEach((row, i) => {
    if (!row.it || row.it.x == null) return;
    const s = { i, x: row.it.x, y: row.it.y, lat: row.it.lat, lon: row.it.lon, cc: row.it.cc, label: row.it.label, at: row.it.at, tier: row.tier, pts: row.pts, q: promptText(row.P), current: r.phase === "shown" && i === r.ans.length - 1 };
    s.leg = Math.round(km(prev, s)); prev = s; out.push(s);
  });
  return out;
}
const routeKm = stops => stops.reduce((s, x) => s + (x.leg || 0), 0);

/* ---------- prompt text in the chosen language ---------- */
function promptText(P) {
  if (!P) return "";
  if (LANG === "en" || !P.t) return P.q;
  const L = LANG, cl = D.clauses, lt = D.letterT[L];
  if (P.t.city) {
    const reg = D.regions.find(r => r.key === P.t.city);
    const place = reg ? reg.names[L] || reg.en : countryName(P.t.city);
    return t("cityQ", { p: place, n: fmtN(P.t.n) });
  }
  if (P.t.million) return t("millionQ");
  if (P.t.L) return lt[P.kind === "k" ? "k" : "c"].replace("{a}", P.t.L[0]).replace("{b}", P.t.L[1]);
  if (P.t.ia) return lt.ia;
  if (P.t.land) return lt.land;
  const rel = k => k.startsWith("B_") ? cl._border[L].replace("{c}", (cl._borderNames[k.slice(2)] || {})[L] || countryName(k.slice(2))) : cl[k][L];
  if (P.t.a && cl[P.t.a] && cl[P.t.a].capOnly) return cl[P.t.a].capT[L];
  const r = P.t.b ? rel(P.t.a) + t("and") + rel(P.t.b) : rel(P.t.a);
  return t(P.t.cap ? "capQ" : "countryQ", { r });
}
const hintText = P => ({ country: t("hintCountry"), capital: t("hintCapital"), town: t("hintTown") })[P.h] || P.h;
const inEnglish = P => LANG !== "en" && !P.t ? ` <span class="lang-note">(${esc(t("inEnglish"))})</span>` : "";

/* ---------- the panel ---------- */
const sign = (tag, body, cls = "") => `<section class="sign ${cls}"><div class="sign-inner"><span class="eroad">${tag}</span>${body}</div></section>`;
function renderStage() {
  const r = RUN; if (!r) return;
  renderHeader(); renderPips(); renderTags();
  document.body.classList.toggle("playing", r.phase === "ask" || r.phase === "shown");
  if (r.phase === "intro") return renderIntro();
  if (r.phase === "ask") return renderAsk();
  if (r.phase === "shown") return renderShown();
  return renderEnd();
}
function renderIntro() {
  const r = RUN, today = cetNow().day;
  const title = r.type === "tutorial" ? t("tutTitle") : r.type === "practice" ? t("practiceTitle") : r.type === "duel" ? t("duelTitle") : r.day === today ? t("todayTitle") : t("routeN", { n: routeNo(r.day) });
  const rival = r.rival ? parseCode(r.rival) : null;
  $("stage").innerHTML = `<div class="col">
    ${sign(esc(title), `<h2 class="q">${esc(r.type === "tutorial" ? t("tutLead") : t("introLead"))}</h2>`)}
    ${rival ? `<p class="callout">${esc(t("rivalWaiting", { name: rival.name || t("yourFriend") }))}</p>` : ""}
    ${r.type === "tutorial" ? "" : `<ul class="rules"><li>${esc(t(r.mode === "none" ? "ruleUntimed" : "ruleTime", { s: SECS[r.mode] }))}</li><li>${esc(t("ruleRare"))}</li><li>${esc(t("ruleMap"))}</li><li>${esc(t("ruleOnce"))}</li></ul>
    <div class="legend">${[1, 2, 3, 4, 5].map(i => tierChip(i)).join("")}</div>`}
    <div class="row"><button class="go" id="begin">${esc(r.type === "tutorial" ? t("tryIt") : t("startClock"))}</button>
    ${r.type === "daily" && SETTINGS.timer === "std" ? `<button class="go alt" id="untimed">${esc(t("moreTime"))}</button>` : ""}</div>
    <p class="note">${esc(t("bankNote", { n: fmtN(D.prompts.length + EXTRA.size) }))}</p>
  </div>`;
  $("begin").focus({ preventScroll: true });
}
function renderAsk() {
  const r = RUN, P = getPrompt(r.pids[r.idx]), secs = SECS[r.mode];
  $("stage").innerHTML = `<div class="col">
    ${sign(`${esc(t("cat_" + P.cat))} · ${r.idx + 1}/${r.pids.length}`, `<h2 class="q" id="qtext">${esc(promptText(P))}${inEnglish(P)}</h2>`)}
    ${secs ? `<div class="clock" role="timer" aria-live="off"><div class="bar" id="bar"><i></i></div><span class="secs" id="secs">${secs}</span></div>` : `<p class="note untimed">${esc(t("noTimer"))}</p>`}
    <form class="ask" id="ask" autocomplete="off"><input id="answer" type="text" aria-labelledby="qtext" aria-describedby="msg tries" placeholder="${esc(hintText(P))}" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="go"><button class="go" id="submit">${esc(t("go"))}</button></form>
    <p class="msg" id="msg" aria-live="assertive"></p>
    <p class="note" id="tries">${esc(t("countN", { n: P.items.length }))}</p>
  </div>`;
  const box = $("answer");
  box.focus({ preventScroll: true });
  if (r.draft) { box.value = r.draft; }
  box.addEventListener("input", () => { r.draft = box.value; });
  tickClock();
}
function renderShown() {
  const r = RUN, i = r.ans.length - 1, P = getPrompt(r.pids[i]), a = r.ans[i], tab = pointsTable(P, r.rare), ok = a.k >= 0;
  const pts = ok ? tab.pts[a.k] : 0, tr = ok ? tierOf(pts) : 0, it = ok ? P.items[a.k] : null;
  const pct = ok ? tab.q[a.k] * 100 : 0;
  const share = !ok ? "" : tab.real && tab.counts ? t("realShare", { c: tab.counts[a.k] || 0, n: tab.N }) : t("estShare", { n: pct < 1 ? "<1" : Math.round(pct) });
  const order = P.items.map((x, j) => ({ x, j, p: tab.pts[j] })).sort((a, b) => a.p - b.p || a.x.label.localeCompare(b.x.label));
  const stop = ok ? mapStops(r).find(s => s.i === i) : null;
  $("stage").innerHTML = `<div class="col">
    ${sign(`${esc(t("cat_" + P.cat))} · ${i + 1}/${r.pids.length}`, `<h2 class="q">${esc(promptText(P))}${inEnglish(P)}</h2>`)}
    <section class="res t${tr}" role="status">
      <div class="res-top"><span class="res-name">${ok ? flagHtml(it.cc) + esc(it.label) : esc(t("outOfTime"))}</span><span class="res-pts" id="pts">+${pts}</span></div>
      <div class="res-chip">${tierChip(tr)}${r.lastNote ? `<span class="note">${esc(r.lastNote)}</span>` : ""}</div>
      ${ok && stop ? `<p class="drive">${esc(t("drivesTo", { x: [it.at || it.label, countryName(it.cc)].filter(Boolean).join(", ") }))}${stop.leg ? " · " + esc(t("legKm", { n: fmtN(stop.leg) })) : ""}</p>` : ""}
      <p>${share ? esc(share) + " " : ""}${esc(t("listNote", { n: P.items.length, a: order[0].x.label, b: order[order.length - 1].x.label }))}</p>
      <div class="strip" aria-hidden="true">${P.items.map((x, j) => `<i class="${j === a.k ? "me" : ""}" style="left:${((tab.pts[j] - 15) / 85 * 100).toFixed(1)}%"></i>`).join("")}</div>
      <div class="strip-ends"><span>${esc(t("obvious"))}</span><span>${esc(t("rare"))}</span></div>
      <details class="all"><summary>${esc(t("seeAll", { n: P.items.length }))}</summary><ul class="answers">${order.map(o => `<li class="t${tierOf(o.p)} ${o.j === a.k ? "mine" : ""}">${tierIcon(tierOf(o.p))}<span>${esc(o.x.label)}</span><b>${o.p}</b></li>`).join("")}</ul></details>
    </section>
    ${DUEL.on ? `<p class="callout" id="duel-live"></p>` : ""}
    <div class="row"><button class="go" id="next">${esc(i === r.pids.length - 1 ? t("finish") : t("driveOn"))}</button></div>
  </div>`;
  $("next").focus({ preventScroll: true });
  countUp($("pts"), pts, "+");
  if (DUEL.on) renderDuelLive();
}
function verdict(p) { return t(p >= 560 ? "v5" : p >= 440 ? "v4" : p >= 320 ? "v3" : p >= 200 ? "v2" : "v1"); }
function renderEnd() {
  const r = RUN, sum = summarise(r), stops = mapStops(r), today = cetNow().day;
  const streak = streakNow(), title = r.type === "practice" ? t("practice") : r.type === "duel" ? t("duelMode") : t("routeN", { n: routeNo(r.day) });
  const late = r.type === "archive" || (r.type === "daily" && r.playedOn !== r.day);
  $("stage").innerHTML = `<div class="col">
    ${sign(esc(t("journeysEnd")), `<p class="big"><span id="bigpts">${sum.pts}</span> <small>${esc(t("ofPts", { n: r.pids.length * 100 }))}&nbsp;·&nbsp;${fmtN(routeKm(stops))}&nbsp;km</small></p><p class="verdict">${esc(verdict(sum.pts))}${(r.type === "daily" && !late && streak > 1) ? " " + esc(t("streak", { n: streak })) : ""}</p>${late ? `<p class="note on-sign">${esc(t("lateNote"))}</p>` : ""}`)}
    <div id="versus"></div>
    <ol class="itin">${sum.rows.map((row, i) => `<li><span class="pq">${esc(promptText(row.P))}</span><span class="c">${row.it ? flagHtml(row.it.cc) + esc(row.it.label) : "—"}</span>${tierChip(row.tier, row.pts)}</li>`).join("")}</ol>
    <div class="row">
      ${r.type !== "tutorial" ? `<button class="go" id="copy-link">${esc(t("copyLink"))}</button><button class="go alt" id="save-img">${esc(t("saveImage"))}</button>` : ""}
      ${r.type !== "daily" || r.day !== today ? `<button class="go" id="play-today">${esc(t("playToday"))}</button>` : ""}
      <button class="go alt" id="practice">${esc(t("practiceDrive"))}</button>
      <button class="go alt" id="archive">${esc(t("earlierRoutes"))}</button>
    </div>
    <div id="share-out"></div>
  </div>`;
  countUp($("bigpts"), sum.pts, "");
  renderVersus();
}

/* ---------- small motion and sound ---------- */
function countUp(el, to, pre) {
  if (!el || reduced || !to) return; const t0 = performance.now();
  const step = n => { const p = Math.min(1, (n - t0) / 600); el.textContent = pre + Math.round(to * (1 - (1 - p) ** 3)); if (p < 1 && el.isConnected) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
let AC = null;
function beep(f, d, when = 0, type = "sine", vol = 0.08) {
  if (!SETTINGS.sound) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain(), at = AC.currentTime + when;
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + d); o.connect(g).connect(AC.destination); o.start(at); o.stop(at + d); } catch {}
}
function snd(kind, tr = 1) {
  if (kind === "tick") beep(880, 0.06, 0, "square", 0.03);
  else if (kind === "bad") beep(160, 0.12, 0, "sawtooth", 0.05);
  else if (kind === "out") { beep(220, 0.2, 0, "sawtooth", 0.05); beep(150, 0.35, 0.18, "sawtooth", 0.05); }
  else if (kind === "good") [0, 4, 7, 12, 16].slice(0, Math.max(1, tr)).forEach((x, i) => beep(440 * 2 ** (x / 12), 0.18, i * 0.09));
  else if (kind === "done") [0, 4, 7, 12].forEach((x, i) => beep(523 * 2 ** (x / 12), 0.3, i * 0.12));
}
function announce(text) { const el = $("announce"); el.textContent = ""; setTimeout(() => el.textContent = text, 30); }

/* ---------- dialogs ---------- */
function dialog(html, cls = "") {
  const d = $("dlg"); $("dlg-body").innerHTML = html; d.className = cls;
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute("open", ""); } }
  const f = d.querySelector("[autofocus]") || $("dlg-close"); if (f) f.focus();
}
function closeDialog() { const d = $("dlg"); if (d.open) d.close(); }
function openHelp() {
  dialog(`<h2>${esc(t("helpTitle"))}</h2>
    <ul class="rules">${["help1", "help2", "help3", "help4", "help5", "help6"].map(k => `<li>${esc(t(k, { s: 25 }))}</li>`).join("")}</ul>
    <h3>${esc(t("roadTypes"))}</h3><div class="legend">${[1, 2, 3, 4, 5].map(i => tierChip(i)).join("")}</div>
    <p class="note">${esc(t("tierExplain"))}</p>
    <h3>${esc(t("europeTitle"))}</h3><p class="note">${esc(t("europeRule"))}</p>
    <h3>${esc(t("rarityTitle"))}</h3><p class="note">${esc(t("rarityExplain"))}</p>
    <h3>${esc(t("fairTitle"))}</h3><p class="note">${esc(t(Net.kind === "server" ? "fairServer" : "fairPage"))}</p>`);
}
function openSettings() {
  dialog(`<h2>${esc(t("settings"))}</h2>
    <form class="settings" id="settings-form">
      <label class="field"><span>${esc(t("language"))}</span><select id="set-lang">${Object.entries(LANG_NAMES).map(([k, v]) => `<option value="${k}" ${k === LANG ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <fieldset class="field"><legend>${esc(t("timerSetting"))}</legend>
        ${["std", "extra", "none"].map(m => `<label class="radio"><input type="radio" name="timer" value="${m}" ${SETTINGS.timer === m ? "checked" : ""}><span>${esc(t("timer_" + m))}</span></label>`).join("")}
        <p class="note">${esc(t("timerNote"))}</p></fieldset>
      <label class="radio"><input type="checkbox" id="set-sound" ${SETTINGS.sound ? "checked" : ""}><span>${esc(t("soundSetting"))}</span></label>
      <label class="field"><span>${esc(t("yourName"))}</span><input id="set-name" maxlength="20" value="${esc(SETTINGS.name)}" placeholder="${esc(t("namePlaceholder"))}"></label>
      <div class="row"><button class="go" id="set-save" type="submit">${esc(t("save"))}</button><button class="go alt" id="set-tutorial" type="button">${esc(t("showTutorial"))}</button></div>
    </form>`);
}
function streakNow() {
  const h = STORE.hist, today = cetNow().day; let d = h[today] && !h[today].late ? today : today - 1, n = 0;
  while (h[d] && !h[d].late) { n++; d--; }
  return n;
}
function openRecord() {
  const h = STORE.hist, days = Object.keys(h).map(Number), n = days.length, today = cetNow().day;
  const sum = days.reduce((s, d) => s + h[d].pts, 0), best = Math.max(0, ...days.map(d => h[d].pts));
  const tc = [0, 0, 0, 0, 0, 0]; days.forEach(d => (h[d].tiers || "").split("").forEach(x => tc[+x]++)); const mx = Math.max(1, ...tc);
  let list = "";
  for (let d = today; d >= Math.max(DAY1, today - 20); d--) {
    const run = STORE.runs["d" + d];
    list += `<li><span class="c">${esc(t("routeN", { n: routeNo(d) }))}${d === today ? " · " + esc(t("today")) : ""}</span>` +
      (h[d] ? `<span class="k">${h[d].pts}${h[d].late ? " · " + esc(t("late")) : ""}</span>` : run && run.phase !== "intro" ? `<button class="go alt sm" data-day="${d}">${esc(t("resume"))}</button>` : `<button class="go alt sm" data-day="${d}">${esc(t("play"))}</button>`) + "</li>";
  }
  dialog(`<h2>${esc(t("record"))}</h2>
    <div class="stats">${[["played", n], ["average", n ? Math.round(sum / n) : 0], ["best", best], ["dayStreak", streakNow()]].map(([l, v]) => `<div><b>${v}</b><span>${esc(t(l))}</span></div>`).join("")}</div>
    <h3>${esc(t("roadsTaken"))}</h3>${[5, 4, 3, 2, 1, 0].map(i => `<div class="dist">${tierChip(i)}<div class="bar"><i class="t${i}" style="width:${(tc[i] / mx * 100).toFixed(0)}%"></i></div><span class="k">${tc[i]}</span></div>`).join("")}
    <h3>${esc(t("routesList"))}</h3><ol class="itin arch">${list}</ol>
    <p class="note">${esc(t(Net.kind === "local" ? "recordLocal" : "recordSynced"))}</p>`);
}
function openOwner() {
  if (!Net.owner) return;
  dialog(`<h2>${esc(t("ownerTitle"))}</h2>
    <p class="note">${esc(t("ownerLead"))}</p>
    <h3>${esc(t("missesTitle"))}</h3><div id="misses"><p class="note">${esc(t("loading"))}</p></div>
    <h3>${esc(t("scheduleTitle"))}</h3>
    <form id="bank-form" class="settings">
      <label class="field"><span>${esc(t("bankDay"))}</span><input type="date" id="bank-date" required></label>
      <label class="field"><span>${esc(t("bankCat"))}</span><select id="bank-cat">${SLOTS.filter(s => s !== "countries").map(s => `<option value="${s === "science" ? "life" : s}">${esc(t("cat_" + s))}</option>`).join("")}</select></label>
      <label class="field"><span>${esc(t("bankQ"))}</span><input id="bank-q" required maxlength="120" placeholder="Name a …"></label>
      <label class="field"><span>${esc(t("bankHint"))}</span><input id="bank-h" maxlength="30" placeholder="A city"></label>
      <label class="field"><span>${esc(t("bankAnswers"))}</span><textarea id="bank-a" rows="8" required placeholder="Paris / Lutetia : 10 : FR @ Paris&#10;Lyon : 6 : FR @ Lyon"></textarea></label>
      <p class="note">${esc(t("bankFormat"))}</p>
      <p class="msg" id="bank-msg"></p>
      <div class="row"><button class="go" type="submit">${esc(t("schedule"))}</button></div>
    </form>
    <h3>${esc(t("scheduled"))}</h3><ul class="itin" id="bank-list">${Net.bank.map(b => `<li><span class="c">${esc(new Date(b.day * 864e5).toISOString().slice(0, 10))} · ${esc(b.q)}</span><button class="go alt sm" data-del="${esc(b.id)}">${esc(t("remove"))}</button></li>`).join("") || `<li class="note">${esc(t("noneYet"))}</li>`}</ul>`, "wide");
  const d = new Date((cetNow().day + 1) * 864e5); $("bank-date").value = d.toISOString().slice(0, 10);
  loadMisses().then(list => {
    const agg = {};
    for (const doc of list) for (const [pid, arr] of Object.entries(doc.items || {})) for (const s of arr) { const k = pid + "|" + norm(s); agg[k] = agg[k] || { pid, s, n: 0 }; agg[k].n++; }
    const byP = {}; Object.values(agg).forEach(x => (byP[x.pid] = byP[x.pid] || []).push(x));
    $("misses").innerHTML = Object.keys(byP).length ? Object.entries(byP).map(([pid, xs]) => `<div class="miss"><b>${esc(promptText(getPrompt(pid)) || pid)}</b><p>${xs.sort((a, b) => b.n - a.n).map(x => esc(x.s) + (x.n > 1 ? ` ×${x.n}` : "")).join(", ")}</p></div>`).join("") : `<p class="note">${esc(t("noMisses"))}</p>`;
  });
}
// "Paris / Lutetia : 10 : FR @ Paris" → an answer row; place names are looked up in the town list.
function parseBankAnswers(text) {
  const out = [], errors = [];
  text.split("\n").map(s => s.trim()).filter(Boolean).forEach((line, i) => {
    const [left, where = ""] = line.split("@").map(s => s.trim());
    const [names, fame = "1", cc = ""] = left.split(":").map(s => s.trim());
    const list = names.split("/").map(s => s.trim()).filter(Boolean);
    if (!list.length) { errors.push(i + 1); return; }
    let lat = null, lon = null; const m = where.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) { lat = +m[1]; lon = +m[2]; }
    else if (where || cc) { const g = globalDict(), hit = firstHit(g, keysOf(where || list[0])); if (hit && hit.t === "place") { lat = D.places[hit.i][2]; lon = D.places[hit.i][3]; } else if (C[cc.toUpperCase()]) { lat = C[cc.toUpperCase()].lat; lon = C[cc.toUpperCase()].lon; } }
    out.push([list[0], list.slice(1).join("|"), clamp(+fame || 1, 1, 10), C[cc.toUpperCase()] ? cc.toUpperCase() : "", lat, lon]);
  });
  return { out, errors };
}
