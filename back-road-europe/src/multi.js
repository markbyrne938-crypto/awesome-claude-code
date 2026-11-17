/* ================= multi: rivals, tables, revealing answers, live duels ================= */
const DUEL = { on: false, seed: 0, with: null, peers: [], myPeer: null, invite: null, mode: "std" };

/* ---------- comparing a finished route ---------- */
function rivalsFor(r) {
  const out = [];
  const code = r.rival ? parseCode(r.rival) : null;
  if (code && code.pids.join() === r.pids.join()) out.push({ name: code.name || t("yourFriend"), sum: summarise({ ...r, ans: code.ans }), verified: code.verified, mode: code.mode, code });
  if (r.type === "duel" && DUEL.opp && DUEL.opp.ans) out.push({ name: DUEL.oppName || t("opponent"), sum: summarise({ ...r, ans: DUEL.opp.ans }), live: true });
  if ((r.type === "daily" || r.type === "archive") && Net.results.length) {
    for (const res of Net.results) {
      if (res.id === Net.me.id) continue;
      const e = res.days && res.days[r.day]; if (!e || !e.pids || e.pids.join() !== r.pids.join()) continue;
      const sum = e.ans ? summarise({ ...r, ans: e.ans.map((k, i) => ({ k, ms: (e.ms || 0) / r.pids.length })) }) : { pts: e.pts, ms: e.ms || 0, tiers: e.tiers || "", rare: (e.tiers || "").split("").filter(x => +x >= 4).length, rows: null };
      out.push({ id: res.id, sum, late: e.late, mode: e.mode, shared: true });
    }
  }
  return out;
}
async function renderVersus() {
  const el = $("versus"); if (!el || !RUN || RUN.phase !== "end") return;
  const r = RUN, me = summarise(r), rivals = rivalsFor(r);
  const ids = rivals.filter(x => x.id).map(x => x.id);
  const names = ids.length ? await resolveNames(ids) : [];
  rivals.forEach(x => { if (x.id) x.name = names[ids.indexOf(x.id)]; });
  const head = x => { const c = compareRuns(me, x.sum), d = Math.abs(me.pts - x.sum.pts);
    const why = me.pts !== x.sum.pts ? "" : me.rare !== x.sum.rare ? t("tieRare") : me.ms !== x.sum.ms ? t("tieTime") : "";
    return (c > 0 ? t("youWin", { d }) : c < 0 ? t("theyWin", { x: x.name, d }) : t("deadHeat")) + (why ? " · " + why : ""); };
  const cell = (row, tr, pts) => row && row.it ? `<span class="vs-cell">${flagHtml(row.it.cc)}<b>${esc(row.it.label)}</b>${tierChip(row.tier, row.pts)}</span>` : `<span class="vs-cell">${tr != null ? tierChip(tr) : "<b>—</b>"}</span>`;
  const duels = rivals.filter(x => !x.shared).map(x => `<section class="vs">
      <h3>${esc(head(x))}</h3>${x.verified === false ? `<p class="note">${esc(t("unverified"))}</p>` : ""}${x.mode && x.mode !== r.mode ? `<p class="note">${esc(t("modeDiff", { m: t("mode_" + x.mode) }))}</p>` : ""}
      <div class="vs-head"><span>${esc(t("you"))} · ${me.pts}</span><span>${esc(x.name)} · ${x.sum.pts}</span></div>
      ${me.rows.map((row, i) => `<div class="vs-q">${esc(promptText(row.P))}</div><div class="vs-row">${cell(row)}${cell(x.sum.rows[i])}</div>`).join("")}
      ${x.code ? guestBox(x, r) : ""}
    </section>`).join("");
  const table = rivals.filter(x => x.shared);
  const tableHtml = table.length ? `<section class="vs"><h3>${esc(t(r.day === cetNow().day ? "todayTable" : "routeTable"))}</h3>
    ${[{ name: t("you"), sum: me, me: true }, ...table].sort((a, b) => compareRuns(b.sum, a.sum)).map((x, i) => `<div class="tb-row ${x.me ? "me" : ""}"><span class="tb-rank">${i + 1}</span><span class="tb-name">${esc(x.name)}${x.late ? ` <small>${esc(t("late"))}</small>` : ""}${x.mode && x.mode !== "std" ? ` <small>${esc(t("mode_" + x.mode))}</small>` : ""}</span><span class="tb-tiers">${(x.sum.tiers || "").split("").map(tr => tierIcon(+tr)).join("")}</span><b>${x.sum.pts}</b></div>`).join("")}
    ${r.day === cetNow().day ? `<p class="note">${esc(t("answersAtMidnight"))}</p>` : ""}</section>` : "";
  const hint = !duels && !table.length ? `<p class="note">${esc(t(Net.kind === "local" ? "compareHintLocal" : "compareHint"))}</p>` : "";
  el.innerHTML = duels + tableHtml + hint;
}

// The owner can put a friend without an account on the shared tables, from their challenge link.
function guestBox(x, r) {
  if (Net.kind !== "artifact" || !Net.owner || x.verified === false || x.code.type !== "daily" || !(r.type === "daily" || r.type === "archive")) return "";
  const on = x.code.name && Net.results.some(res => res.id === guestId(x.code.name) && res.days && res.days[r.day]);
  if (on) return `<p class="note">${esc(t("guestOn", { x: x.code.name }))}</p>`;
  return `<form class="ask" id="guest-form" autocomplete="off"><input id="guest-name" maxlength="20" value="${esc(x.code.name || "")}" placeholder="${esc(t("guestName"))}" aria-label="${esc(t("guestName"))}"><button class="go alt">${esc(t("guestAdd"))}</button></form>
    <p class="msg" id="guest-msg"></p><p class="note">${esc(t("guestNote"))}</p>`;
}
function submitGuest() {
  const r = RUN, c = r && r.rival ? parseCode(r.rival) : null, name = $("guest-name").value.trim();
  if (!c || c.type !== "daily" || c.pids.join() !== r.pids.join()) return;
  if (!name) { $("guest-msg").textContent = t("guestNeedName"); return; }
  const s = summarise({ ...r, ans: c.ans });
  // Today's answers stay off the shared tables until the route closes, like everyone else's.
  const entry = { pts: s.pts, tiers: s.tiers, ms: s.ms, mode: c.mode, late: false, pids: c.pids, ans: c.day < cetNow().day ? c.ans.map(a => a.k) : null, at: now(), guest: true };
  addGuest(name, c.day, entry).then(() => { toast(t("guestAdded", { x: name })); }).catch(() => { $("guest-msg").textContent = t("saveFailed"); });
}

/* ---------- posting and revealing ---------- */
function resultEntry(r) {
  const s = summarise(r);
  return { pts: s.pts, tiers: s.tiers, ms: s.ms, mode: r.mode, late: r.type === "archive" || r.playedOn !== r.day, pids: r.pids, ans: null, at: now() };
}
function publishFinished(r) {
  if (Net.kind === "local" || !(r.type === "daily" || r.type === "archive")) return;
  const entry = resultEntry(r);
  if (r.day < cetNow().day) entry.ans = r.ans.map(a => a.k); // the route has closed, so the answers can show straight away
  postResult(r.day, entry).then(res => {
    if (entry.ans) STORE.revealed[r.day] = 1;
    const h = STORE.hist[r.day]; // the server scores runs itself; its numbers are the record
    if (res && h && res.verified && (h.pts !== res.pts || h.tiers !== res.tiers)) { h.pts = res.pts; h.tiers = res.tiers; }
    saveAll();
  }).catch(() => toast(t("saveFailed")));
}
function revealClosedDays() {
  if (Net.kind === "local") return;
  const today = cetNow().day, map = {};
  for (const run of Object.values(STORE.runs)) {
    if ((run.type === "daily" || run.type === "archive") && run.phase === "end" && run.day < today && !STORE.revealed[run.day]) map[run.day] = run.ans.map(a => a.k);
  }
  if (Object.keys(map).length) revealAnswers(map).then(() => { for (const d in map) STORE.revealed[d] = 1; saveAll(); }).catch(() => {});
}

/* ---------- tables ---------- */
function weekStart(day) { const dow = (new Date(day * 864e5).getUTCDay() + 6) % 7; return day - dow; } // Monday
function openTables(tab = "today") {
  const today = cetNow().day, all = Net.results;
  if (Net.kind === "local") {
    dialog(`<h2>${esc(t("tables"))}</h2><p class="note">${esc(t("tablesLocal"))}</p>${codeBox()}`);
    return;
  }
  const rowsFor = day => all.map(r => ({ id: r.id, e: r.days && r.days[day] })).filter(x => x.e && !x.e.late);
  let body = "";
  if (tab === "today") {
    const rows = rowsFor(today).sort((a, b) => b.e.pts - a.e.pts || (b.e.tiers || "").split("").filter(x => +x >= 4).length - (a.e.tiers || "").split("").filter(x => +x >= 4).length || a.e.ms - b.e.ms);
    body = rows.length ? rows.map((x, i) => `<div class="tb-row ${x.id === Net.me.id ? "me" : ""}"><span class="tb-rank">${i + 1}</span><span class="tb-name" data-id="${esc(x.id)}">…</span><span class="tb-tiers">${(x.e.tiers || "").split("").map(tr => tierIcon(+tr)).join("")}</span><b>${x.e.pts}</b></div>`).join("") : `<p class="note">${esc(t("nobodyYet"))}</p>`;
  } else if (tab === "week") {
    const w0 = weekStart(today), tot = {};
    for (let d = w0; d <= today; d++) for (const x of rowsFor(d)) { const o = tot[x.id] = tot[x.id] || { id: x.id, pts: 0, n: 0 }; o.pts += x.e.pts; o.n++; }
    const rows = Object.values(tot).sort((a, b) => b.pts - a.pts || b.n - a.n);
    body = `<p class="note">${esc(t("weekNote", { from: new Date(w0 * 864e5).toISOString().slice(5, 10) }))}</p>` + (rows.length ? rows.map((x, i) => `<div class="tb-row ${x.id === Net.me.id ? "me" : ""}"><span class="tb-rank">${i + 1}</span><span class="tb-name" data-id="${esc(x.id)}">…</span><span class="k">${esc(t("routesN", { n: x.n }))}</span><b>${x.pts}</b></div>`).join("") : `<p class="note">${esc(t("nobodyYet"))}</p>`);
  } else if (tab === "h2h") {
    const mine = (all.find(r => r.id === Net.me.id) || { days: {} }).days || {}, rec = {};
    for (const r of all) { if (r.id === Net.me.id) continue; for (const [d, e] of Object.entries(r.days || {})) { const m = mine[d]; if (!m || m.late || e.late) continue;
      const o = rec[r.id] = rec[r.id] || { id: r.id, w: 0, l: 0, d: 0 }; const c = m.pts - e.pts || (e.ms || 0) - (m.ms || 0); if (c > 0) o.w++; else if (c < 0) o.l++; else o.d++; } }
    const rows = Object.values(rec).sort((a, b) => (b.w + b.l + b.d) - (a.w + a.l + a.d));
    body = rows.length ? rows.map(x => `<div class="tb-row"><span class="tb-name" data-id="${esc(x.id)}">…</span><span class="k">${esc(t("h2hLine", { w: x.w, l: x.l, d: x.d }))}</span></div>`).join("") : `<p class="note">${esc(t("noH2h"))}</p>`;
  } else if (tab === "leagues") body = `<div id="leagues"><p class="note">${esc(t("loading"))}</p></div>`;
  const tabs = ["today", "week", "h2h", ...(Net.leagues ? ["leagues"] : [])];
  dialog(`<h2>${esc(t("tables"))}</h2><div class="tabs" role="tablist">${tabs.map(x => `<button role="tab" class="tab ${x === tab ? "on" : ""}" aria-selected="${x === tab}" data-tab="${x}">${esc(t("tab_" + x))}</button>`).join("")}</div>
    <div class="tb">${body}</div>${Net.status === "slow" ? `<p class="note">${esc(t("slowData"))}</p>` : ""}${codeBox()}`, "wide");
  const spans = [...document.querySelectorAll(".tb-name[data-id]")];
  resolveNames(spans.map(s => s.dataset.id)).then(ns => spans.forEach((s, i) => s.textContent = ns[i]));
  if (tab === "leagues") renderLeagues();
}
const codeBox = () => `<h3>${esc(t("pasteTitle"))}</h3><form class="ask" id="rival-form" autocomplete="off"><input id="rival-code" aria-label="${esc(t("pasteLabel"))}" placeholder="${esc(t("pastePlaceholder"))}" spellcheck="false"><button class="go alt">${esc(t("compare"))}</button></form><p class="msg" id="rival-msg"></p>`;
async function renderLeagues() {
  const el = $("leagues"); if (!el || !Net.leagues) return;
  const list = await Net.leagues.list().catch(() => []);
  el.innerHTML = list.map(L => `<section class="vs"><h3>${esc(L.name)} <small class="k">${esc(t("leagueCode", { c: L.code }))}</small></h3>${L.table.map((x, i) => `<div class="tb-row ${x.id === Net.me.id ? "me" : ""}"><span class="tb-rank">${i + 1}</span><span class="tb-name">${esc(x.name || t("someone"))}</span><b>${x.pts}</b></div>`).join("")}</section>`).join("") +
    `<form class="ask" id="league-new"><input id="league-name" maxlength="30" placeholder="${esc(t("leagueName"))}" aria-label="${esc(t("leagueName"))}"><button class="go alt">${esc(t("createLeague"))}</button></form>
     <form class="ask" id="league-join"><input id="league-code" maxlength="12" placeholder="${esc(t("leagueJoinCode"))}" aria-label="${esc(t("leagueJoinCode"))}"><button class="go alt">${esc(t("joinLeague"))}</button></form>`;
}

/* ---------- live duel over the room ---------- */
function duelInit() {
  if (!Net.room) return;
  Net.room.presence({ v: 2, st: "lobby" }).catch(() => {});
  Net.room.onPeers(ch => {
    DUEL.peers = ch.peers || [];
    const me = DUEL.peers.find(p => p.isMe); if (me) DUEL.myPeer = me.peer;
    const others = DUEL.peers.filter(p => !p.isMe && p.presence && p.presence.v === 2);
    // an invitation for me?
    const inv = others.find(p => p.presence.inv && p.presence.inv.to === DUEL.myPeer);
    if (inv && !DUEL.on && (!DUEL.incoming || DUEL.incoming.seed !== inv.presence.inv.seed)) { DUEL.incoming = { peer: inv.peer, by: inv.by, seed: inv.presence.inv.seed, mode: inv.presence.inv.mode }; showDuelInvite(); }
    // my invitation accepted?
    if (DUEL.invite) { const acc = others.find(p => p.peer === DUEL.invite.to && p.presence.acc && p.presence.acc.to === DUEL.myPeer && p.presence.acc.seed === DUEL.invite.seed);
      if (acc) { const s = DUEL.invite; DUEL.invite = null; startDuel(s.seed, s.mode, acc.peer, acc.by); } }
    if (DUEL.on) { const o = DUEL.peers.find(p => p.peer === DUEL.with); DUEL.opp = o && o.presence && o.presence.duel && o.presence.duel.seed === DUEL.seed ? o.presence.duel : DUEL.opp; DUEL.gone = !o; renderDuelLive(); if (RUN && RUN.phase === "end") renderVersus(); }
    if ($("duel-lobby")) renderLobby();
  }, () => { Net.room = null; });
}
function openDuel() {
  if (!Net.room) { dialog(`<h2>${esc(t("duelTitle"))}</h2><p class="note">${esc(t("duelUnavailable"))}</p>`); return; }
  dialog(`<h2>${esc(t("duelTitle"))}</h2><p class="note">${esc(t("duelLead"))}</p><div id="duel-lobby"></div>`);
  renderLobby();
}
async function renderLobby() {
  const el = $("duel-lobby"); if (!el) return;
  const others = DUEL.peers.filter(p => !p.isMe && p.presence && p.presence.v === 2 && !p.presence.duel);
  const names = await resolveNames(others.map(p => p.by));
  el.innerHTML = others.length ? others.map((p, i) => `<div class="tb-row"><span class="tb-name">${esc(names[i])}</span>${DUEL.invite && DUEL.invite.to === p.peer ? `<span class="k">${esc(t("waiting"))}</span>` : `<button class="go alt sm" data-invite="${esc(p.peer)}">${esc(t("challenge"))}</button>`}</div>`).join("") : `<p class="note">${esc(t("nobodyHere"))}</p>`;
}
function invitePeer(peer) {
  DUEL.invite = { to: peer, seed: (Math.random() * 2 ** 31) | 0, mode: SETTINGS.timer };
  Net.room.presence({ inv: DUEL.invite }).catch(() => {});
  renderLobby();
}
async function showDuelInvite() {
  const [name] = await resolveNames([DUEL.incoming.by]);
  banner(`${esc(t("duelInvite", { x: name }))} <button class="go sm" id="duel-accept">${esc(t("accept"))}</button> <button class="go alt sm" id="duel-decline">${esc(t("decline"))}</button>`);
}
function acceptDuel() {
  const inc = DUEL.incoming; if (!inc) return;
  Net.room.presence({ acc: { to: inc.peer, seed: inc.seed } }).catch(() => {});
  hideBanner(); startDuel(inc.seed, inc.mode, inc.peer, inc.by);
}
async function startDuel(seed, mode, peer, by) {
  DUEL.on = true; DUEL.seed = seed; DUEL.with = peer; DUEL.opp = null; DUEL.incoming = null;
  [DUEL.oppName] = await resolveNames([by]);
  closeDialog();
  RUN = newRun("duel", { seed, mode: mode || "std", pids: practiceRoute(seed) });
  STORE.runs[RUN.key] = RUN;
  await begin();
}
function duelProgress() {
  if (!DUEL.on || !Net.room || !RUN || RUN.type !== "duel") return;
  const s = summarise(RUN), done = RUN.phase === "end";
  Net.room.presence({ inv: null, acc: null, duel: { seed: DUEL.seed, idx: RUN.ans.length, pts: s.pts, tiers: s.tiers, done, ans: done ? RUN.ans.map(a => ({ k: a.k, ms: a.ms })) : null } }).catch(() => {});
}
function renderDuelLive() {
  const el = $("duel-live"); if (!el) return;
  const o = DUEL.opp;
  el.textContent = DUEL.gone ? t("oppLeft") : !o ? t("oppWaiting", { x: DUEL.oppName || t("opponent") }) : t("oppProgress", { x: DUEL.oppName || t("opponent"), i: o.idx, pts: o.pts });
}
