// A stand-in for the claude.ai artifact host: shared documents, identity, a live room and downloads.
// Several pages (separate browser contexts) share one host, so multiplayer flows can be tested end to end.
// It does not enforce the platform's access rules; it checks the game's own logic.
function createHost() {
  const docs = new Map(), subs = [], peers = new Map(), saves = [];
  const collOf = p => p.split("/").slice(0, -1).join("/");
  const inColl = (p, coll) => collOf(p) === coll;
  const merge = (a, b) => { const out = { ...(a || {}) }; for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? merge(out[k], v) : v; return out; };
  const listOf = coll => [...docs.entries()].filter(([p]) => inColl(p, coll)).map(([p, d]) => ({ id: p.split("/").pop(), data: JSON.parse(JSON.stringify(d)) }));
  async function notify(coll) {
    for (const s of subs) if (s.coll === coll) await s.page.evaluate(([cid, list]) => window.__mockFire && window.__mockFire(cid, list), [s.cid, listOf(coll)]).catch(() => {});
  }
  async function roomNotify() {
    const all = [...peers.values()];
    for (const me of all) {
      const list = all.map(p => ({ peer: p.peer, by: p.by, isMe: p === me, sameTab: p === me, kind: "viewer", guest: false, presence: p.presence, updatedAt: Date.now() }));
      await me.page.evaluate(l => window.__mockPeers && window.__mockPeers(l), list).catch(() => {});
    }
  }
  async function attach(page, user) {
    await page.exposeBinding("__mockCall", async (src, op, a) => {
      const pg = src.page;
      // Like the real host: a document path has an even number of segments, a collection path an odd number.
      if (a && a.path && a.path.split("/").length % 2) throw new Error("invalid_argument: not a document path: " + a.path);
      if (a && a.coll && a.coll.split("/").length % 2 === 0) throw new Error("invalid_argument: not a collection path: " + a.coll);
      switch (op) {
        case "get": return { exists: docs.has(a.path), data: docs.has(a.path) ? JSON.parse(JSON.stringify(docs.get(a.path))) : undefined };
        case "set": docs.set(a.path, JSON.parse(JSON.stringify(a.data))); await notify(collOf(a.path)); return null;
        case "update": if (!docs.has(a.path)) throw new Error("invalid_argument: no document"); docs.set(a.path, merge(docs.get(a.path), a.data)); await notify(collOf(a.path)); return null;
        case "delete": docs.delete(a.path); await notify(collOf(a.path)); return null;
        case "list": return listOf(a.coll);
        case "sub": subs.push({ page: pg, cid: a.cid, coll: a.coll }); setTimeout(() => notify(a.coll), 10); return null;
        case "acquire": return { acquired: true, holder: a.holder };
        case "profiles": return Object.fromEntries(a.ids.map(id => [id, { id, name: (host.users[id] || {}).name || "", avatarUrl: "", color: "#888", email: null, isMe: id === user.id, guest: false }]));
        case "join": if (!peers.has(pg)) peers.set(pg, { page: pg, peer: "peer-" + user.id, by: user.id, presence: {} }); await roomNotify(); return null;
        case "presence": { const me = peers.get(pg) || { page: pg, peer: "peer-" + user.id, by: user.id, presence: {} }; me.presence = { ...me.presence, ...a.patch }; for (const k in me.presence) if (me.presence[k] === null) delete me.presence[k]; peers.set(pg, me); await roomNotify(); return null; }
        case "save": saves.push(a); return null;
      }
      throw new Error("unknown op " + op);
    });
    await page.addInitScript(u => {
      const fires = {}, peerCbs = [];
      window.__mockFire = (cid, list) => { const f = fires[cid]; if (f) f({ docs: list.map(d => ({ id: d.id, exists: true, data: () => d.data })), size: list.length, empty: !list.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] }); };
      window.__mockPeers = list => peerCbs.forEach(cb => cb({ peers: list, joined: [], left: [], updated: list }));
      const call = (op, a) => window.__mockCall(op, a || {});
      const doc = path => ({ id: path.split("/").pop(), path,
        get: async () => { const r = await call("get", { path }); return { id: path.split("/").pop(), exists: r.exists, data: () => r.data, metadata: { fromCache: false } }; },
        set: d => call("set", { path, data: d }), update: d => call("update", { path, data: d }), delete: () => call("delete", { path }),
        acquire: o => call("acquire", { path, holder: o.holder }) });
      const collection = coll => ({ path: coll, doc: id => doc(coll + "/" + id),
        onSnapshot: (next) => { const cid = Math.random().toString(36).slice(2); fires[cid] = next; call("sub", { cid, coll }); return () => { delete fires[cid]; }; },
        get: async () => { const list = await call("list", { coll }); return { docs: list.map(d => ({ id: d.id, exists: true, data: () => d.data })), size: list.length, empty: !list.length }; } });
      const db = { doc, collection };
      const user = { me: async () => ({ id: u.id, name: u.name, avatarUrl: "", color: "#888", email: null, isOwner: !!u.owner, canEdit: !!u.owner }), isOwner: async () => !!u.owner, canEdit: async () => !!u.owner, id: async () => u.id, can: async () => true, profiles: ids => call("profiles", { ids }) };
      const room = { presence: p => call("presence", { patch: p }), onPeers: cb => { peerCbs.push(cb); call("join"); return () => {}; }, peers: () => [] };
      const downloads = { save: async ({ filename, data }) => { await call("save", { filename, size: data.size || data.length || 0, type: data.type || "" }); return { status: "saved" }; } };
      window.claude = { use: async n => ({ db, user, room, downloads })[n] || null };
    }, user);
  }
  const host = { docs, saves, users: {}, attach: async (page, user) => { host.users[user.id] = user; await attach(page, user); } };
  return host;
}
module.exports = { createHost };
