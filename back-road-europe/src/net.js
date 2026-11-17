/* ================= net: shared storage, identity, live room — artifact, server or this device ================= */
const Net = {
  kind: "local", me: { id: null, name: "" }, owner: false, editor: false, room: null, downloads: null,
  results: [], bank: [], listeners: { results: [], bank: [] }, status: "",
};
const RESULT_DAYS = 120;
const emit = (k, v) => Net.listeners[k].forEach(f => f(v));
function onNet(k, f) { Net.listeners[k].push(f); }

async function netInit() {
  if (window.BRE_SERVER) return serverInit();
  if (!window.claude || !window.claude.use) return;
  const use = n => Promise.resolve(window.claude.use(n)).catch(() => null);
  const [db, user, room, downloads] = await Promise.all([use("db"), use("user"), use("room"), use("downloads")]);
  Net.downloads = downloads;
  if (user) {
    const me = await user.me().catch(() => null);
    if (me) Net.me = { id: me.id, name: me.name || "" };
    Net.owner = await user.isOwner().catch(() => false);
    Net.editor = await user.canEdit().catch(() => false);
    Net.profiles = ids => user.profiles(ids).catch(() => ({}));
  }
  if (room) Net.room = room;
  if (!db || !Net.me.id) return;
  Net.db = db; Net.kind = "artifact";
  const timer = setTimeout(() => { Net.status = "slow"; emit("results", Net.results); }, 10000);
  db.collection("scores").onSnapshot(snap => {
    clearTimeout(timer); Net.status = snap.metadata && snap.metadata.fromCache ? "cached" : "";
    Net.results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit("results", Net.results);
  }, e => { clearTimeout(timer); Net.status = "error"; emit("results", Net.results); });
  db.collection("bank").onSnapshot(snap => { Net.bank = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit("bank", Net.bank); }, () => {});
}

/* ---------- writes, one at a time per document ---------- */
const queues = new Map();
function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next); return next;
}
async function upsert(path, patch) {
  const ref = Net.db.doc(path), snap = await ref.get();
  if (snap.exists) await ref.update(patch); else await ref.set(patch);
}

/* ---------- this player's own state: runs and record, private ---------- */
async function loadPrivate() {
  if (Net.kind === "artifact") { const s = await Net.db.doc(`data/users/${Net.me.id}/state`).get().catch(() => null); return s && s.exists ? s.data() : null; }
  if (Net.kind === "server") return api("GET", "state").catch(() => null);
  return null;
}
let privateTimer = 0;
function savePrivate(obj) {
  clearTimeout(privateTimer);
  privateTimer = setTimeout(() => {
    const body = JSON.parse(JSON.stringify(obj));
    if (Net.kind === "artifact") serial("private", () => Net.db.doc(`data/users/${Net.me.id}/state`).set(body)).catch(() => {});
    if (Net.kind === "server") serial("private", () => api("PUT", "state", body)).catch(() => {});
  }, 800);
}

/* ---------- results everyone can see ---------- */
// While a route is open, others see your points and road types only. Answers follow once the route closes.
async function postResult(day, entry) {
  if (Net.kind === "artifact") return serial("scores", () => upsert(`scores/${Net.me.id}`, { v: 2, days: { [day]: entry } }));
  if (Net.kind === "server") return serial("run", () => api("POST", "result", { day, ...entry })); // after the run's last answer has arrived
}
async function revealAnswers(map) { // map: day → answers
  if (!Object.keys(map).length) return;
  if (Net.kind === "artifact") return serial("scores", () => upsert(`scores/${Net.me.id}`, { days: Object.fromEntries(Object.entries(map).map(([d, ans]) => [d, { ans }])) }));
  if (Net.kind === "server") return api("POST", "reveal", { map });
}
async function pruneResults() {
  if (Net.kind !== "artifact") return;
  const mine = Net.results.find(r => r.id === Net.me.id); if (!mine || !mine.days) return;
  const cut = cetNow().day - RESULT_DAYS, old = Object.keys(mine.days).filter(d => +d < cut);
  if (old.length) serial("scores", () => Net.db.doc(`scores/${Net.me.id}`).set({ ...mine, id: undefined, days: Object.fromEntries(Object.entries(mine.days).filter(([d]) => +d >= cut)) })).catch(() => {});
}

// A friend without a Claude account: the owner adds their result from their challenge link.
const guestId = name => "g_" + hashStr(String(name).trim().toLowerCase()).toString(36);
async function addGuest(name, day, entry) {
  if (Net.kind !== "artifact") return;
  return serial("scores", () => upsert(`scores/${guestId(name)}`, { v: 2, guest: true, name: String(name).trim().slice(0, 20), days: { [day]: entry } }));
}

/* ---------- real rarity: counts of what players answered on earlier days ---------- */
function countAnswers(pids, beforeDay) {
  const want = new Set(pids), out = {};
  for (const r of Net.results) for (const [d, e] of Object.entries(r.days || {})) {
    if (+d >= beforeDay || !e.ans || !e.pids) continue;
    e.pids.forEach((pid, i) => { if (!want.has(pid) || e.ans[i] == null || e.ans[i] < 0) return; const s = out[pid] = out[pid] || { N: 0, c: {} }; s.N++; s.c[e.ans[i]] = (s.c[e.ans[i]] || 0) + 1; });
  }
  return out;
}
// One snapshot per day, so everyone playing that route is scored the same way.
async function rarityFor(day, pids) {
  if (Net.kind === "server") return api("GET", `rarity?day=${day}&pids=${pids.join(",")}`).catch(() => ({}));
  if (Net.kind !== "artifact") return {};
  const ref = Net.db.doc(`rarity/${day}`);
  const have = await ref.get().catch(() => null);
  if (have && have.exists && pids.every(p => have.data().snap && have.data().snap[p])) return have.data().snap;
  await new Promise(r => setTimeout(r, Net.results.length || Net.status ? 0 : 2500)); // give the table a moment to arrive
  const snap = { ...(have && have.exists ? have.data().snap : {}), ...countAnswers(pids, day) };
  for (const p of pids) snap[p] = snap[p] || { N: 0, c: {} };
  try {
    const lease = ref.acquire ? await ref.acquire({ holder: Net.me.id, ttlMs: 20000 }).catch(() => ({ acquired: true })) : { acquired: true };
    if (lease.acquired) await (have && have.exists ? ref.update({ snap }) : ref.set({ snap, at: now() }));
    else { await new Promise(r => setTimeout(r, 1500)); const again = await ref.get(); if (again.exists && again.data().snap) return again.data().snap; }
  } catch {}
  return snap;
}

/* ---------- answers players wished were on the list ---------- */
const missBuffer = {};
let missTimer = 0;
function logMiss(pid, text) {
  const s = String(text).trim().slice(0, 60); if (!s) return;
  (missBuffer[pid] = missBuffer[pid] || []).push(s);
  clearTimeout(missTimer);
  missTimer = setTimeout(async () => {
    const batch = { ...missBuffer }; for (const k in missBuffer) delete missBuffer[k];
    if (Net.kind === "artifact") serial("misses", async () => {
      const ref = Net.db.doc(`misses/${Net.me.id}`), snap = await ref.get(), items = snap.exists ? snap.data().items || {} : {};
      for (const [pid, list] of Object.entries(batch)) items[pid] = [...new Set([...(items[pid] || []), ...list])].slice(-30);
      await ref.set({ items, at: now() });
    }).catch(() => {});
    if (Net.kind === "server") api("POST", "miss", { batch }).catch(() => {});
  }, 3000);
}
async function loadMisses() {
  if (Net.kind === "artifact") { const s = await Net.db.collection("misses").get().catch(() => null); return s ? s.docs.map(d => d.data()) : []; }
  if (Net.kind === "server") return api("GET", "misses").catch(() => []);
  return [];
}

/* ---------- prompts the owner schedules for a future day ---------- */
async function saveBank(entry) {
  if (Net.kind === "artifact") return Net.db.doc(`bank/${entry.id}`).set(entry);
  if (Net.kind === "server") return api("POST", "bank", entry);
}
async function deleteBank(id) {
  if (Net.kind === "artifact") return Net.db.doc(`bank/${id}`).delete();
  if (Net.kind === "server") return api("DELETE", "bank/" + id);
}

/* ---------- names ---------- */
const NAMES = {};
async function resolveNames(ids) {
  for (const id of ids) if (id && /^g_/.test(id)) NAMES[id] = (Net.results.find(r => r.id === id) || {}).name || ""; // friends without an account
  const need = ids.filter(id => id && !(id in NAMES));
  if (need.length && Net.profiles) { const ps = await Net.profiles(need); for (const id of need) NAMES[id] = (ps[id] && ps[id].name) || ""; }
  if (need.length && Net.kind === "server") for (const id of need) NAMES[id] = (Net.results.find(r => r.id === id) || {}).name || "";
  return ids.map(id => id === Net.me.id ? t("you") : NAMES[id] || t("someone"));
}

/* ---------- standalone server ---------- */
async function api(method, path, body) {
  const r = await fetch("api/" + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + (Net.token || "") }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw Object.assign(new Error(path + " " + r.status), { status: r.status });
  return r.status === 204 ? null : r.json();
}
// Run events go to the server one at a time and in order, retried if the connection drops.
function runEvent(path, body) {
  return serial("run", async () => {
    for (let i = 0; ; i++) {
      try { return await api("POST", path, body); }
      catch (e) { if ((e.status && e.status < 500) || i >= 3) throw e; await new Promise(r => setTimeout(r, 700 * 2 ** i)); }
    }
  });
}
function netRename(name) { if (Net.kind === "server") api("POST", "login", { token: Net.token, name }).then(w => { if (w) Net.me.name = w.name; }).catch(() => {}); }
async function serverInit() {
  Net.kind = "server";
  try { const h = await api("GET", "hello"); clockSkew = h.now - Date.now(); } catch { Net.kind = "local"; return; }
  let tok = null; try { tok = localStorage.getItem("bre2-token"); } catch {}
  const who = await api("POST", "login", { token: tok, name: SETTINGS.name || "" }).catch(() => null);
  if (!who) { Net.kind = "local"; return; }
  Net.token = who.token; Net.me = { id: who.id, name: who.name }; Net.owner = !!who.owner; Net.editor = !!who.owner;
  try { localStorage.setItem("bre2-token", who.token); } catch {}
  const poll = async () => {
    try { const r = await api("GET", "results"); Net.results = r.results; Net.bank = r.bank || []; emit("results", Net.results); emit("bank", Net.bank); } catch { Net.status = "error"; }
    setTimeout(poll, 15000);
  };
  poll();
  Net.room = serverRoom();
  Net.leagues = { list: () => api("GET", "leagues"), create: name => api("POST", "leagues", { name }), join: code => api("POST", "leagues/join", { code }) };
}
// The live room over plain polling: presence in, everyone's presence out.
function serverRoom() {
  let mine = {}, cbs = [], timer = 0, peers = [];
  const tick = async () => {
    try {
      const r = await api("POST", "room", { presence: mine });
      const prev = new Set(peers.map(p => p.peer)); peers = r.peers;
      cbs.forEach(f => f({ peers, joined: peers.filter(p => !prev.has(p.peer)), left: [], updated: peers }));
    } catch {}
    timer = setTimeout(tick, 1500);
  };
  tick();
  return { presence: async patch => { mine = { ...mine, ...patch }; for (const k in mine) if (mine[k] === null) delete mine[k]; }, onPeers: f => { cbs.push(f); return () => { cbs = cbs.filter(x => x !== f); }; }, peers: () => peers };
}
