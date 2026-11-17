// End-to-end checks for the standalone server: real HTTP, real pages, a throwaway database. Run after a build.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path"), fs = require("fs"), os = require("os");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8700 + Math.floor(Math.random() * 200), BASE = `http://localhost:${PORT}/`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bre-")), "db.json");

function startServer() {
  const proc = spawn(process.execPath, [path.join(__dirname, "../server/server.mjs")], { env: { ...process.env, PORT: String(PORT), DB_PATH: DB }, stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", d => process.stderr.write("[server] " + d));
  return new Promise((ok, bad) => { proc.stdout.on("data", d => { if (/Back Road Europe on/.test(String(d))) ok(proc); }); proc.on("exit", c => bad(new Error("server exited " + c))); setTimeout(() => bad(new Error("server didn't start")), 15000); });
}
async function api(method, p, body, token) {
  const r = await fetch(BASE + "api/" + p, { method, headers: { "content-type": "application/json", authorization: "Bearer " + (token || "") }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
}
async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|net::ERR|Content Security Policy.*font/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => typeof RUN !== "undefined" && RUN && typeof Net !== "undefined" && Net.kind === "server" && Net.me.id);
  await page.evaluate(() => { SETTINGS.tutorialDone = true; saveAll(); openDaily(cetNow().day); });
  await sleep(200);
  return { ctx, page };
}
async function playRoute(page, pick = (P, i) => Math.min(P.items.length - 1, 2 + i)) {
  if (await page.evaluate(() => RUN.phase === "intro")) await page.click("#begin");
  await page.waitForFunction(() => RUN.phase === "ask");
  for (let i = 0; i < 7; i++) {
    const label = await page.evaluate(([i, src]) => { const P = getPrompt(RUN.pids[i]); const k = (new Function("P", "i", "return (" + src + ")(P, i)"))(P, i); return P.items[k].label; }, [i, pick.toString()]);
    await page.fill("#answer", label); await page.press("#answer", "Enter");
    let ok = await page.waitForFunction(n => RUN.ans.length === n, i + 1, { timeout: 1500 }).then(() => true).catch(() => false);
    for (let j = 0; j < 12 && !ok; j++) { // already used on this route: go down the list
      const l2 = await page.evaluate(([i, j]) => getPrompt(RUN.pids[i]).items[j].label, [i, j]);
      await page.fill("#answer", l2); await page.press("#answer", "Enter"); await sleep(100);
      ok = await page.evaluate(n => RUN.ans.length === n, i + 1);
    }
    await page.click("#next");
  }
  await page.waitForFunction(() => RUN.phase === "end");
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const health = await fetch(BASE + "healthz").then(r => r.json());
    check("server answers and knows today's route day", health.ok && health.day > 20000);

    /* ---------- a player's route, timed and scored by the server ---------- */
    const A = await open(browser);
    const a = await A.page.evaluate(() => ({ id: Net.me.id, owner: Net.owner, token: Net.token, ownerBtn: !$("b-owner").hidden }));
    check("first account is the owner and sees the owner tools", a.owner && a.ownerBtn);
    await A.page.click("#begin");
    await A.page.waitForFunction(() => RUN.phase === "ask");
    await sleep(600);
    const dl = await A.page.evaluate(() => ({ deadline: RUN.deadline, now: now() }));
    check("the prompt clock comes from the server", dl.deadline > dl.now + 20000 && dl.deadline < dl.now + 26000, JSON.stringify(dl));
    await playRoute(A.page);
    await sleep(1200);
    const local = await A.page.evaluate(() => ({ pts: summarise(RUN).pts, tiers: summarise(RUN).tiers, day: RUN.day, hist: STORE.hist[RUN.day] }));
    let db = JSON.parse(fs.readFileSync(DB, "utf8"));
    const saved = db.results[a.id] && db.results[a.id][local.day];
    check("the server checked every answer and recorded a verified result", saved && saved.verified && !saved.late && saved.ans.length === 7, JSON.stringify(saved));
    check("the server's score matches what the page showed", saved && saved.pts === local.pts && saved.tiers === local.tiers, `${saved && saved.pts} vs ${local.pts}`);
    check("each answer's time was measured by the server", saved && saved.ms > 0 && saved.ms < 7 * 25000);

    /* ---------- no second go, no posting a better score ---------- */
    const again = await api("POST", "result", { day: local.day, pts: 700, tiers: "5555555", ms: 1, mode: "std" }, a.token);
    check("a second result for the same day is refused", again.status === 409);
    const restart = await api("POST", "start", { day: local.day, idx: 0, mode: "std" }, a.token);
    check("the route can't be started again", restart.status === 409);

    const B = await open(browser);
    const b = await B.page.evaluate(() => ({ id: Net.me.id, owner: Net.owner, token: Net.token }));
    check("second account is a separate, ordinary player", b.id !== a.id && !b.owner);
    const fake = await api("POST", "result", { day: local.day, pts: 700, tiers: "5555555", ms: 1, mode: "std", pids: saved.pids, ans: [0, 0, 0, 0, 0, 0, 0] }, b.token);
    check("a result the server didn't see played is kept only as 'played later'", fake.status === 200 && fake.body.late && !fake.body.verified);
    const skipAhead = await api("POST", "start", { day: local.day, idx: 3, mode: "std" }, b.token);
    check("prompts must be played in order", skipAhead.status === 409);
    const pastDay = await api("POST", "start", { day: local.day - 1, idx: 0, mode: "std" }, b.token);
    check("only today's route is timed by the server", pastDay.status === 409);

    /* ---------- what the other player sees ---------- */
    await B.page.reload();
    await B.page.waitForFunction(() => Net.kind === "server" && Net.results.length > 0, null, { timeout: 10000 }).catch(() => {});
    const seen = await B.page.evaluate(([id, day]) => { const r = Net.results.find(x => x.id === id); return r && r.days[day]; }, [a.id, local.day]);
    check("the other player sees the score but not today's answers", seen && seen.pts === local.pts && seen.ans === null, JSON.stringify(seen));
    await B.page.evaluate(() => { SETTINGS.tutorialDone = true; saveAll(); openTables("today"); });
    await sleep(500);
    const table = await B.page.evaluate(() => [...document.querySelectorAll(".tb-row")].map(r => r.textContent));
    check("today's table lists the verified run and leaves out the unchecked one", table.length === 1 && table[0].includes(String(local.pts)), JSON.stringify(table));
    await B.page.evaluate(() => closeDialog());

    /* ---------- rarity is frozen per day ---------- */
    const r1 = await api("GET", `rarity?day=${local.day}&pids=${saved.pids.join(",")}`, null, b.token);
    const r2 = await api("GET", `rarity?day=${local.day + 1}&pids=${saved.pids.join(",")}`, null, b.token);
    check("today's rarity doesn't count today's answers", r1.status === 200 && Object.values(r1.body).every(s => s.N === 0));
    check("tomorrow's rarity counts today's checked answers only", r2.status === 200 && Object.values(r2.body).every(s => s.N === 1), JSON.stringify(r2.body));

    /* ---------- owner tools, leagues, reminder, live room ---------- */
    const bankDay = local.day + 3;
    const bank = { id: "xtest1", day: bankDay, c: "food", k: "hand", q: "Name a European cheese.", h: "A cheese", it: [["Brie", "", 9, "FR"], ["Gouda", "", 9, "NL"], ["Feta", "", 8, "GR"], ["Gjetost", "Brunost", 2, "NO"]], tag: [] };
    check("only the owner can schedule prompts", (await api("POST", "bank", bank, b.token)).status === 403 && (await api("POST", "bank", bank, a.token)).status === 204);
    const bankB = await api("GET", "results", null, b.token), bankA = await api("GET", "results", null, a.token);
    check("a scheduled prompt stays hidden from players until its day", !bankB.body.bank.some(x => x.id === "xtest1") && bankA.body.bank.some(x => x.id === "xtest1"));
    check("only the owner can read the missing-answer log", (await api("GET", "misses", null, b.token)).status === 403 && (await api("GET", "misses", null, a.token)).status === 200);

    const lg = await A.page.evaluate(() => Net.leagues.create("Friday quiz"));
    const joined = await B.page.evaluate(code => Net.leagues.join(code).then(() => Net.leagues.list()), lg.code);
    check("a league can be created and joined with its code", joined.length === 1 && joined[0].table.length === 2 && joined[0].table[0].pts === local.pts, JSON.stringify(joined));

    await B.page.evaluate(() => openSettings());
    const remind = await B.page.evaluate(() => { const l = $("set-remind"); return l && l.getAttribute("href"); });
    const ics = await fetch(BASE + "api/reminder.ics?h=9").then(r => r.text());
    check("settings offer a calendar reminder", remind === "api/reminder.ics?h=9" && /RRULE:FREQ=DAILY/.test(ics) && /TZID=Europe\/Berlin:\d{8}T090000/.test(ics));
    await B.page.evaluate(() => closeDialog());

    await sleep(3500); // both pages poll the room
    const peers = await A.page.evaluate(id => DUEL.peers.some(p => p.by === id && p.presence && p.presence.v === 2), b.id);
    check("players online see each other for a live duel", peers);

    /* ---------- the database survives a restart ---------- */
    server.kill("SIGTERM"); await sleep(500);
    db = JSON.parse(fs.readFileSync(DB, "utf8"));
    check("data is written to disk on shutdown", db.results[a.id][local.day].verified && db.leagues[lg.code] && db.bank.xtest1);

    const errs = [...A.page.errors, ...B.page.errors].filter(e => !/Failed to fetch|ERR_CONNECTION_REFUSED|api\/(room|results)/.test(e));
    check("no page errors", !errs.length, errs.join(" | "));
  } catch (e) { check("server test ran to the end", false, e.stack); }
  finally { await browser.close(); server.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
