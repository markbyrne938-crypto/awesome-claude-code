/* ================= main: state, runs, timers, events, start-up ================= */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let SETTINGS = Object.assign({ lang: "", timer: "std", sound: true, name: "", tutorialDone: false }, LS.get("bre2-settings", {}));
let STORE = Object.assign({ v: 2, runs: {}, hist: {}, revealed: {} }, LS.get("bre2-store", {}));
// Keep the record from the first version of the game.
{ const old = LS.get("bre-hist", null); if (old && !STORE.migrated) { for (const [d, h] of Object.entries(old)) if (!STORE.hist[d]) STORE.hist[d] = { pts: h.pts, tiers: (h.t || []).join(""), ms: 0, mode: "std", late: false }; STORE.migrated = 1; } }
let RUN = null;

function saveAll() {
  const keys = Object.keys(STORE.runs).sort((a, b) => (STORE.runs[b].upd || 0) - (STORE.runs[a].upd || 0));
  for (const k of keys.slice(40)) delete STORE.runs[k];
  LS.set("bre2-settings", SETTINGS); LS.set("bre2-store", STORE);
  if (Net.kind !== "local") savePrivate({ store: STORE, settings: { ...SETTINGS } });
}
function touch() { if (RUN) { RUN.upd = now(); STORE.runs[RUN.key] = RUN; } saveAll(); }

/* ---------- runs ---------- */
function newRun(type, o) {
  const today = cetNow().day;
  const key = type === "daily" || type === "archive" ? "d" + o.day : type === "practice" ? "p" + o.seed : type === "duel" ? "u" + o.seed : "tut";
  return { v: 2, key, type, day: o.day ?? today, seed: o.seed ?? 0, mode: o.mode || SETTINGS.timer, pids: o.pids, idx: 0, ans: [], phase: "intro", playedOn: today, rival: o.rival || "", rare: null, upd: now() };
}
function openDaily(day, rival) {
  const today = cetNow().day, key = "d" + day;
  let r = STORE.runs[key];
  if (!r) r = newRun(day === today ? "daily" : "archive", { day, pids: dayRoute(day, overrides()) });
  if (rival) r.rival = rival;
  RUN = r; touch(); show("pan");
}
function openPractice(seed, rival) {
  const key = "p" + seed;
  RUN = STORE.runs[key] || newRun("practice", { seed, pids: practiceRoute(seed) });
  if (rival) RUN.rival = rival;
  touch(); show("pan");
}
function openTutorial() {
  const pid = (D.prompts.find(p => p.t && p.t.a === "euro" && !p.t.b && !p.t.cap) || D.prompts[0]).id;
  RUN = newRun("tutorial", { pids: [pid], mode: "none" }); show("pan");
}
const overrides = () => Net.bank.filter(b => b.day && b.id).map(b => ({ id: b.id, c: b.c, day: b.day }));
function show(how) { closePopup(); renderStage(); MAP.focus = RUN && RUN.phase === "end" ? "all" : null; if (how) MAP.user = false; mapShow(mapStops(RUN), how); }

async function begin() {
  const r = RUN; if (!r || r.phase !== "intro") return;
  $("stage").querySelector("#begin") && ($("begin").disabled = true);
  if (!r.rare) {
    const day = r.type === "daily" || r.type === "archive" ? r.day : cetNow().day;
    r.rare = await Promise.race([rarityFor(day, r.pids), new Promise(res => setTimeout(() => res({}), 4000))]).catch(() => ({}));
  }
  r.phase = "ask"; r.idx = r.ans.length; r.startedAt = r.startedAt || now(); startPrompt(); beep(660, 0.12);
}
function startPrompt() {
  const r = RUN; r.deadline = SECS[r.mode] ? now() + SECS[r.mode] * 1000 : 0; r.promptAt = now(); r.tried = []; r.draft = ""; r.lastNote = "";
  if (Net.kind === "server" && r.type === "daily") {
    const idx = r.idx;
    runEvent("start", { key: r.key, day: r.day, idx, mode: r.mode }).then(x => {
      if (!x || RUN !== r || r.idx !== idx) return;
      if (x.deadline) r.deadline = x.deadline; // the server's clock
      if (idx === 0 && x.pids && x.pids.join() !== r.pids.join()) { r.pids = x.pids; touch(); show(""); } // the official route
    }).catch(() => {});
  }
  touch(); show(""); announce(promptText(getPrompt(r.pids[r.idx])));
}
function submit() {
  const r = RUN; if (!r || r.phase !== "ask") return;
  const box = $("answer"), text = box.value.trim(); if (!text) return;
  const P = getPrompt(r.pids[r.idx]);
  const used = new Set(r.ans.map((a, i) => a.k >= 0 ? usedKey(getPrompt(r.pids[i]), getPrompt(r.pids[i]).items[a.k]) : null).filter(Boolean));
  const v = judge(P, text, used);
  if (!v.ok) {
    if (v.msg) { $("msg").textContent = v.msg; r.tried.push(text); $("tries").textContent = t("triedList", { list: r.tried.slice(-6).join(", ") }); }
    if (v.miss && r.type !== "tutorial") logMiss(P.id, text);
    box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake"); snd("bad"); box.select();
    return;
  }
  const ms = Math.max(0, now() - (r.promptAt || now()));
  r.ans.push({ k: v.idx, ms }); r.lastNote = v.note || ""; r.phase = "shown";
  const tr = tierOf(pointsTable(P, r.rare).pts[v.idx]);
  if (Net.kind === "server" && r.type === "daily") runEvent("answer", { key: r.key, day: r.day, idx: r.ans.length - 1, text }).catch(() => {});
  touch(); snd("good", tr); renderStage(); mapShow(mapStops(r), "leg"); duelProgress();
}
function timeUp() {
  const r = RUN; if (!r || r.phase !== "ask") return;
  r.ans.push({ k: -1, ms: SECS[r.mode] * 1000 }); r.phase = "shown"; r.lastNote = "";
  if (Net.kind === "server" && r.type === "daily") runEvent("answer", { key: r.key, day: r.day, idx: r.ans.length - 1, timeout: true }).catch(() => {});
  touch(); snd("out"); renderStage(); mapShow(mapStops(r), ""); duelProgress();
}
function next() {
  const r = RUN; if (!r || r.phase !== "shown") return;
  if (r.ans.length >= r.pids.length) return finish();
  r.idx = r.ans.length; r.phase = "ask"; startPrompt();
}
function finish() {
  const r = RUN; r.phase = "end"; r.endedAt = now();
  if (r.type === "tutorial") { SETTINGS.tutorialDone = true; saveAll(); openDaily(cetNow().day); return; }
  const s = summarise(r);
  if ((r.type === "daily" || r.type === "archive") && !STORE.hist[r.day]) STORE.hist[r.day] = { pts: s.pts, tiers: s.tiers, ms: s.ms, mode: r.mode, late: r.type === "archive" || r.playedOn !== r.day };
  touch(); snd("done"); show("pan"); publishFinished(r); duelProgress();
}

/* ---------- the clock ---------- */
let lastSec = -1, lastDay = cetNow().day;
function tickClock() {
  const r = RUN;
  if (r && r.phase === "ask" && r.deadline) {
    const left = Math.max(0, r.deadline - now()), total = SECS[r.mode] * 1000;
    const bar = $("bar"); if (bar) { bar.firstElementChild.style.width = (left / total * 100).toFixed(1) + "%"; bar.classList.toggle("low", left < 8000); }
    const s = Math.ceil(left / 1000); if ($("secs")) $("secs").textContent = s;
    if (s !== lastSec) { lastSec = s; if (s === 10 || s === 5) announce(t("secondsLeft", { n: s })); if (s > 0 && s <= 5) snd("tick"); }
    if (!left) timeUp();
  }
}
setInterval(() => {
  tickClock();
  const c = cetNow();
  if (RUN) renderHeader();
  if (c.day !== lastDay) { lastDay = c.day; revealClosedDays(); if (RUN && RUN.day !== c.day && RUN.phase !== "ask" && RUN.phase !== "shown") banner(`${esc(t("newRoute"))} <button class="go sm" id="banner-today">${esc(t("playIt"))}</button>`); }
}, 250);

/* ---------- banners and toasts ---------- */
function banner(html) { const b = $("banner"); b.innerHTML = html; b.hidden = false; }
function hideBanner() { $("banner").hidden = true; }
let toastTimer = 0;
function toast(text) { const el = $("toast"); el.textContent = text; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 3500); }

/* ---------- sharing ---------- */
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); if (btn) btn.textContent = t("copied"); toast(t("copied")); }
  catch { $("share-out").innerHTML = `<label class="field"><span>${esc(t("copyThis"))}</span><input id="share-text" readonly value="${esc(text)}"></label>`; $("share-text").select(); }
}
async function saveImage() {
  const r = RUN, s = summarise(r), title = r.type === "practice" ? t("practice") : t("routeN", { n: routeNo(r.day) });
  const blob = await routeImage(s, title + " · " + new Date(r.day * 864e5).toISOString().slice(0, 10), t("ofPts", { n: r.pids.length * 100 }));
  if (!blob) return toast(t("imageFailed"));
  const name = `back-road-europe-${r.type === "practice" ? "practice" : "route-" + routeNo(r.day)}.png`;
  if (Net.downloads) { try { await Net.downloads.save({ filename: name, data: blob }); return; } catch (e) { if (e && e.code === "declined") return; } }
  $("share-out").innerHTML = `<p class="note">${esc(t("imageHold"))}</p><img class="share-img" alt="${esc(t("imageAlt"))}" src="${URL.createObjectURL(blob)}">`;
}

/* ---------- events ---------- */
document.addEventListener("submit", e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "ask") submit();
  else if (id === "settings-form") {
    const lang = $("set-lang").value, timer = (document.querySelector("input[name=timer]:checked") || {}).value || "std";
    SETTINGS = { ...SETTINGS, lang, timer, sound: $("set-sound").checked, name: $("set-name").value.trim().slice(0, 20) };
    setLang(lang); saveAll(); closeDialog(); staticTexts(); netRename(SETTINGS.name);
    if (RUN && RUN.phase === "intro") RUN.mode = timer;
    show("");
  } else if (id === "rival-form") {
    const c = parseCode($("rival-code").value);
    if (!c) { $("rival-msg").textContent = t("badCode"); return; }
    closeDialog(); takeChallenge(c);
  } else if (id === "bank-form") {
    const { out, errors } = parseBankAnswers($("bank-a").value);
    if (errors.length || out.length < 4) { $("bank-msg").textContent = t("bankError", { n: out.length }); return; }
    const day = Math.round(Date.parse($("bank-date").value) / 864e5), q = $("bank-q").value.trim();
    if (!(day > cetNow().day)) { $("bank-msg").textContent = t("bankFuture"); return; }
    const entry = { id: "x" + hashStr(q + day).toString(36), day, c: $("bank-cat").value, k: "hand", q, h: $("bank-h").value.trim() || t("hintAnswer"), it: out, tag: [] };
    saveBank(entry).then(() => { toast(t("scheduledOk")); closeDialog(); }).catch(() => { $("bank-msg").textContent = t("saveFailed"); });
  } else if (id === "league-new") { Net.leagues.create($("league-name").value.trim()).then(renderLeagues).catch(() => toast(t("saveFailed"))); }
  else if (id === "league-join") { Net.leagues.join($("league-code").value.trim()).then(renderLeagues).catch(() => toast(t("badCode"))); }
});
document.addEventListener("click", e => {
  const b = e.target.closest("button, [data-day], [data-tab], [data-invite], [data-del]"); if (!b) return;
  const id = b.id;
  if (id === "begin") begin();
  else if (id === "untimed") { RUN.mode = "extra"; begin(); }
  else if (id === "next") next();
  else if (id === "b-help") openHelp();
  else if (id === "b-record") openRecord();
  else if (id === "b-tables") openTables();
  else if (id === "b-duel") openDuel();
  else if (id === "b-settings") openSettings();
  else if (id === "b-owner") openOwner();
  else if (id === "b-sound") { SETTINGS.sound = !SETTINGS.sound; saveAll(); renderHeader(); if (SETTINGS.sound) beep(660, 0.1); }
  else if (id === "dlg-close") closeDialog();
  else if (id === "z-in") zoomAt(0.7);
  else if (id === "z-out") zoomAt(1.4);
  else if (id === "z-fit") { MAP.focus = "all"; recenter(); }
  else if (id === "copy-link") copyText(t("shareText", { n: routeNo(RUN.day), pts: summarise(RUN).pts }) + " " + shareLink(makeCode(RUN, SETTINGS.name || Net.me.name)), b);
  else if (id === "save-img") saveImage();
  else if (id === "practice") openPractice((Math.random() * 2 ** 31) | 0);
  else if (id === "play-today" || id === "banner-today") { hideBanner(); openDaily(cetNow().day); }
  else if (id === "archive") openRecord();
  else if (id === "set-tutorial") { closeDialog(); openTutorial(); }
  else if (id === "duel-accept") acceptDuel();
  else if (id === "duel-decline") { DUEL.incoming = null; hideBanner(); }
  else if (b.dataset.day) { closeDialog(); openDaily(+b.dataset.day); }
  else if (b.dataset.tab) openTables(b.dataset.tab);
  else if (b.dataset.invite) invitePeer(b.dataset.invite);
  else if (b.dataset.del) deleteBank(b.dataset.del).then(() => { closeDialog(); openOwner(); });
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && RUN && RUN.phase === "shown" && !$("dlg").open && document.activeElement && document.activeElement.id !== "next" && document.activeElement.tagName !== "SUMMARY") { e.preventDefault(); next(); }
});
addEventListener("resize", () => { if (RUN) { cancelAnimationFrame(MAP.anim); MAP.vb = restFrame(); applyVB(); drawDynamic(); layoutLabels(); } });

/* ---------- challenges from a link or a pasted code ---------- */
function takeChallenge(c) {
  const today = cetNow().day;
  if (c.type === "daily") {
    if (c.day > today || c.day < DAY1) { toast(t("badCode")); return; }
    openDaily(c.day, c.code);
  } else openPractice(c.seed, c.code);
  banner(esc(t("challenged", { x: c.name || t("yourFriend"), pts: summarise({ pids: c.pids, ans: c.ans, rare: null }).pts })));
  if (RUN.phase === "end") renderVersus();
}
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!/^c2-/i.test(h)) return null;
  const c = parseCode(h);
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  return c;
}

/* ---------- start-up ---------- */
function staticTexts() {
  document.documentElement.lang = LANG;
  const ICON = { "b-help": UI_ICON.help, "b-record": UI_ICON.record, "b-tables": UI_ICON.tables, "b-duel": UI_ICON.duel, "b-settings": UI_ICON.settings, "b-owner": UI_ICON.owner };
  for (const [id, k] of [["b-help", "help"], ["b-record", "record"], ["b-tables", "tables"], ["b-duel", "duel"], ["b-settings", "settings"], ["b-owner", "owner"]]) {
    $(id).innerHTML = `<span class="ti" aria-hidden="true">${ICON[id]}</span><span class="tl">${esc(t(k))}</span>`; $(id).setAttribute("aria-label", t(k)); $(id).title = t(k);
  }
  $("dlg-close").textContent = t("close");
  $("z-in").setAttribute("aria-label", t("zoomIn")); $("z-out").setAttribute("aria-label", t("zoomOut")); $("z-fit").setAttribute("aria-label", t("zoomFit"));
  $("map").setAttribute("aria-label", t("mapLabel")); $("pips").setAttribute("aria-label", t("stops"));
}
function reserveMapCorners() {
  const r = $("map").getBoundingClientRect();
  MAP.reserved = [["tagL", 0], ["tagR", 0], ["tagB", 0], ["zoom", 0]].map(([id]) => { const el = id === "zoom" ? document.querySelector(".zoom") : $(id); if (!el || !el.textContent && id !== "zoom") return null; const b = el.getBoundingClientRect(); return { x: b.left - r.left - 4, y: b.top - r.top - 4, w: b.width + 8, h: b.height + 8 }; }).filter(Boolean);
}
function mergePrivate(p) {
  if (!p || !p.store) return false;
  let changed = false;
  for (const [k, r] of Object.entries(p.store.runs || {})) {
    const mine = STORE.runs[k];
    if (!mine || (r.ans || []).length > (mine.ans || []).length || (r.phase === "end" && mine.phase !== "end")) { STORE.runs[k] = r; changed = true; }
  }
  for (const [d, h] of Object.entries(p.store.hist || {})) if (!STORE.hist[d]) { STORE.hist[d] = h; changed = true; }
  Object.assign(STORE.revealed, p.store.revealed || {});
  if (p.settings && !SETTINGS.name && p.settings.name) SETTINGS.name = p.settings.name;
  if (p.settings && p.settings.tutorialDone) SETTINGS.tutorialDone = true;
  return changed;
}
async function boot() {
  setLang(SETTINGS.lang || (navigator.language || "en").slice(0, 2));
  staticTexts(); mapInit();
  const challenge = readHash();
  if (challenge) takeChallenge(challenge);
  else if (!SETTINGS.tutorialDone && !Object.keys(STORE.hist).length) openTutorial();
  else openDaily(cetNow().day);
  await netInit();
  $("b-owner").hidden = !Net.owner;
  const priv = await loadPrivate();
  if (mergePrivate(priv)) { saveAll(); if (RUN && RUN.type === "daily" && STORE.runs[RUN.key] !== RUN && RUN.phase !== "ask") { RUN = STORE.runs[RUN.key]; show("pan"); } }
  onNet("results", () => { if (RUN && RUN.phase === "end") renderVersus(); });
  onNet("bank", list => {
    for (const b of list) if (b.id && b.it) { EXTRA.set(b.id, { id: b.id, c: b.c, k: "hand", q: b.q, h: b.h, it: b.it, tag: b.tag || [] }); CACHE.delete(b.id); MAPS.delete(b.id); }
    RARITY_CACHE.clear();
    if (RUN && RUN.phase === "intro" && RUN.type === "daily" && !RUN.ans.length) { const p = dayRoute(RUN.day, overrides()); if (p.join() !== RUN.pids.join()) { RUN.pids = p; touch(); show(""); } }
  });
  revealClosedDays(); pruneResults(); duelInit();
  if (RUN && RUN.phase === "end") renderVersus();
}
boot();
