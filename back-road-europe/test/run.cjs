// Automated checks for Back Road Europe. Run after a build: npm test
const { chromium, devices } = require("playwright");
const wrap = require("./wrap.cjs");
const { createHost } = require("./mock-host.cjs");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = wrap();

async function fresh(browser, opts = {}, user) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|net::ERR/.test(m.text())) page.errors.push(m.text()); });
  if (user) await opts.host.attach(page, user);
  await page.goto(URL + (opts.hash || ""));
  await page.waitForFunction(() => typeof RUN !== "undefined" && RUN);
  await sleep(300);
  return { ctx, page };
}
const skipTutorial = page => page.evaluate(() => { SETTINGS.tutorialDone = true; saveAll(); openDaily(cetNow().day); });
async function playRoute(page, pick = (P, i) => Math.min(P.items.length - 1, 2 + i)) {
  if (await page.evaluate(() => RUN.phase === "intro")) { await page.click("#begin"); }
  await page.waitForFunction(() => RUN.phase === "ask");
  for (let i = 0; i < 7; i++) {
    const label = await page.evaluate(([i, src]) => { const P = getPrompt(RUN.pids[i]); const k = (new Function("P", "i", "return (" + src + ")(P, i)"))(P, i); return P.items[k].label; }, [i, pick.toString()]);
    await page.fill("#answer", label); await page.press("#answer", "Enter");
    await page.waitForFunction(n => RUN.ans.length === n, i + 1);
    let ok = await page.evaluate(() => RUN.phase === "shown");
    if (!ok) { // already used: try the next answers down the list
      for (let j = 0; j < 8 && !ok; j++) { const l2 = await page.evaluate(([i, j]) => getPrompt(RUN.pids[i]).items[j].label, [i, j]); await page.fill("#answer", l2); await page.press("#answer", "Enter"); await sleep(80); ok = await page.evaluate(() => RUN.phase === "shown"); }
    }
    await page.click("#next");
  }
  await page.waitForFunction(() => RUN.phase === "end");
  await sleep(300);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- logic checks inside the page ---------- */
  {
    const { ctx, page } = await fresh(browser);
    const r = await page.evaluate(() => {
      const byQ = q => getPrompt(D.prompts.find(p => p.q === q).id);
      const J = (q, text, used) => { const v = judge(byQ(q), text, used); return v.ok ? "OK:" + byQ(q).items[v.idx].label + (v.note ? "|" + v.note : "") : "NO:" + v.msg; };
      const euro = "Name a European country that uses the euro.", nato = "Name a European member of NATO.", eucap = "Name the capital of a European country that lies on the Danube.", medcap = "Name the capital of a European country that has a Mediterranean coast.";
      const fr = D.prompts.find(p => p.t && p.t.city === "FR").q, de = D.prompts.find(p => p.t && p.t.city === "DE").q, cl = "Name a club that has won the European Cup or Champions League.";
      return {
        ireland: J(euro, "ireland"), australia: J(euro, "Australia"), deutschland: J(euro, "Deutschland"), holland: J(euro, "holland"),
        englandEuro: J(euro, "England"), englandNato: J(nato, "England"), wienAsCountry: J(euro, "Wien"), georgia: J(euro, "Georgia"),
        kazakh: J(euro, "Kazakhstan"), edinburgh: J(euro, "Edinburgh"), cork: J(euro, "Cork"), slovkia: J(euro, "Slovkia"), austriaTypo: J(euro, "Austira"),
        wien: J(eucap, "Wien"), roma: J(medcap, "Roma"), austriaCap: J(eucap, "Austria"), edinburghCap: J(eucap, "Edinburgh"),
        stEtienne: J(fr, "St Etienne"), koeln: J(de, "Koeln"), muenchen: J(de, "Muenchen"), cologne: J(de, "cologne"), heidelberg: J(de, "Heidelberg"),
        manU: J(cl, "Man U"), bayern: J(cl, "Bayern Munchen"), bayernUe: J(cl, "Bayern Muenchen"), madrid: J(cl, "Real Madird"),
        reuse: J(euro, "France", new Set(["cc:FR"])), garda: J("Name a lake in Europe.", "Lake Garda"), lough: J("Name a lake in Europe.", "Neagh"),
        nonsense: J(euro, "Narnia"),
      };
    });
    const expect = { ireland: /^OK:Ireland/, australia: /^NO:Australia isn't counted/, deutschland: /^OK:Germany/, holland: /^OK:Netherlands/,
      englandEuro: /^NO:England is part of the United Kingdom/, englandNato: /^OK:United Kingdom\|England counts as/, wienAsCountry: /^NO:Vienna is a capital/,
      georgia: /^NO:Georgia doesn't fit/, kazakh: /^NO:Kazakhstan has a little land/, edinburgh: /^NO:Edinburgh is the capital of Scotland/, cork: /^NO:Cork is a town in Ireland/,
      slovkia: /^OK:Slovakia\|Read as/, austriaTypo: /^OK:Austria/, wien: /^OK:Vienna/, roma: /^OK:Rome/, austriaCap: /^NO:Austria is a country/, edinburghCap: /^NO:Edinburgh is the capital of Scotland/,
      stEtienne: /^OK:Saint-Étienne/, koeln: /^OK:Cologne/, muenchen: /^OK:Munich/, cologne: /^OK:Cologne/, heidelberg: /^NO:Heidelberg has about/,
      manU: /^OK:Manchester United/, bayern: /^OK:Bayern Munich/, bayernUe: /^OK:Bayern Munich/, madrid: /^OK:Real Madrid/, reuse: /^NO:You've already used France/,
      garda: /^OK:Lake Garda/, lough: /^OK:Lough Neagh/, nonsense: /^NO:Not on our list/ };
    for (const [k, re] of Object.entries(expect)) check(`matching: ${k}`, re.test(r[k]), r[k]);

    const deal = await page.evaluate(() => {
      const out = { badSize: 0, badSlots: 0, tagClash: 0, firstRepeat: {}, sizes: {} };
      const seen = {};
      for (let d = DAY1; d < DAY1 + 200; d++) {
        const ids = dayRoute(d), Ps = ids.map(getPrompt);
        if (ids.length !== 7) out.badSize++;
        if (new Set(Ps.map(p => p.cat)).size !== 7) out.badSlots++;
        for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) if (Ps[i].tags.some(t => t !== "towns" && Ps[j].tags.includes(t))) out.tagClash++;
        for (const P of Ps) { const s = seen[P.cat] = seen[P.cat] || new Set(); if (s.has(P.id) && !out.firstRepeat[P.cat]) out.firstRepeat[P.cat] = d - DAY1; s.add(P.id); }
      }
      for (const k in CATEGORY) out.sizes[k] = CATEGORY[k].length;
      return out;
    });
    check("deal: seven prompts every day for 200 days", deal.badSize === 0, deal.badSize + " short days");
    check("deal: one prompt from each of the seven slots", deal.badSlots === 0, deal.badSlots + " days repeat a slot");
    check("deal: no two prompts on one theme in a day", deal.tagClash === 0, deal.tagClash + " clashes");
    for (const [cat, n] of Object.entries(deal.sizes)) check(`deal: ${cat} doesn't repeat before ${Math.floor(n * 0.8)} days`, !deal.firstRepeat[cat] || deal.firstRepeat[cat] >= Math.floor(n * 0.8), `first repeat on day ${deal.firstRepeat[cat]} of ${n}`);

    const sc = await page.evaluate(() => {
      const bad = [], range = [];
      for (const p of D.prompts) {
        const P = getPrompt(p.id), tab = pointsTable(P, null);
        if (tab.pts.some(x => x < 15 || x > 100)) range.push(P.q);
        if (P.items.length >= 20) { const top = tab.pts.filter(x => x >= 95).length / P.items.length; if (top > 0.35) bad.push(`${P.q} ${(top * 100).toFixed(0)}%`); }
      }
      const lowest = D.prompts.map(p => { const P = getPrompt(p.id), tab = pointsTable(P, null); return Math.min(...tab.pts); });
      return { bad, range, maxLowest: Math.max(...lowest) };
    });
    check("scoring: points stay within 15 to 100", sc.range.length === 0, sc.range.slice(0, 3).join("; "));
    check("scoring: on long lists at most 35% of answers reach 95+", sc.bad.length === 0, sc.bad.slice(0, 4).join("; "));
    check("scoring: the most obvious answer scores 45 or less", sc.maxLowest <= 45, "max " + sc.maxLowest);
    const real = await page.evaluate(() => { const P = getPrompt(D.prompts.find(p => p.t && p.t.a === "euro" && !p.t.b && !p.t.cap).id); const i = P.items.findIndex(x => x.label === "Ireland");
      const before = pointsTable(P, null).pts[i]; const snap = { [P.id]: { N: 300, c: { [i]: 3 } } }; const after = pointsTable(P, snap).pts[i]; return { before, after, real: pointsTable(P, snap).real }; });
    check("scoring: real answer counts move points (a rarely given answer scores more)", real.after > real.before && real.real, JSON.stringify(real));

    const codes = await page.evaluate(() => {
      const run = { type: "daily", day: DAY1 + 3, seed: 0, mode: "std", pids: dayRoute(DAY1 + 3), ans: [0, 3, -1, 2, 5, 1, 4].map((k, i) => ({ k, ms: 1000 * (i + 3) })) };
      const code = makeCode(run, "Siobhán");
      const back = parseCode(shareLink(code));
      const bent = code.slice(0, 60) + (code[60] === "a" ? "b" : "a") + code.slice(61);
      const t2 = parseCode(bent);
      return { ok: back && back.verified && back.name === "Siobhán" && back.pids.join() === run.pids.join() && back.ans.map(a => a.k).join() === "0,3,-1,2,5,1,4" && back.day === run.day, tamper: !t2 || !t2.verified, len: code.length, hashSafe: /^[A-Za-z0-9-]+$/.test(code) };
    });
    check("codes: round trip keeps route, answers, times and name", codes.ok);
    check("codes: an edited code is flagged", codes.tamper);
    check("codes: links use only letters, digits and hyphens", codes.hashSafe, "length " + codes.len);

    const i18n = await page.evaluate(() => { const miss = {}; for (const l of Object.keys(STR)) miss[l] = Object.keys(STR.en).filter(k => !(k in STR[l])); return miss; });
    for (const [l, m] of Object.entries(i18n)) check(`translation: ${l} has every string`, m.length === 0, m.slice(0, 8).join(", "));
    const fr = await page.evaluate(() => { setLang("fr"); const P = getPrompt(D.prompts.find(p => p.t && p.t.a === "landlocked" && !p.t.b && !p.t.cap).id); const C2 = getPrompt(D.prompts.find(p => p.t && p.t.city === "DE").id); const out = [promptText(P), promptText(C2), t("go")]; setLang("en"); return out; });
    check("translation: generated prompts read in French", /^Nomme un pays européen qui n'a pas d'accès à la mer\.$/.test(fr[0]) && /^Nomme une ville de Allemagne|^Nomme une ville d/.test(fr[1]), fr.join(" | "));

    const contrast = async dark => page.evaluate(dark => {
      const css = getComputedStyle(document.documentElement), hex = v => { v = css.getPropertyValue(v).trim(); const m = v.match(/^#([0-9a-f]{6})$/i); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : v === "#fff" ? [255, 255, 255] : null; };
      const L = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const x = L(hex(a)), y = L(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const pairs = [["--ink", "--bg"], ["--muted", "--bg"], ["--muted", "--surface"], ["--marking-ink", "--marking"], ["--ink", "--surface"], ...[0, 1, 2, 3, 4, 5].map(i => ["--tk" + i, "--t" + i])];
      return pairs.map(([a, b]) => [a + " on " + b, +ratio(a, b).toFixed(2)]);
    }, dark);
    for (const [name, v] of await contrast(false)) check(`contrast (light): ${name} ≥ 4.5`, v >= 4.5, String(v));
    await page.emulateMedia({ colorScheme: "dark" });
    for (const [name, v] of await contrast(true)) check(`contrast (dark): ${name} ≥ 4.5`, v >= 4.5, String(v));
    await page.emulateMedia({ colorScheme: "light" });
    await ctx.close();
  }

  /* ---------- a full route, resume, timer, archive, image ---------- */
  {
    const { ctx, page } = await fresh(browser);
    check("first visit opens the untimed warm-up", await page.evaluate(() => RUN.type === "tutorial" && RUN.mode === "none"));
    await page.click("#begin"); await page.waitForFunction(() => RUN.phase === "ask");
    check("warm-up has no timer", await page.evaluate(() => !$("bar")));
    await page.fill("#answer", "Ireland"); await page.press("#answer", "Enter"); await page.waitForFunction(() => RUN.phase === "shown");
    await page.click("#next"); await page.waitForFunction(() => RUN.type === "daily");
    check("after the warm-up, today's route opens", true);
    await page.click("#begin"); await page.waitForFunction(() => RUN.phase === "ask");
    for (let i = 0; i < 2; i++) { const l = await page.evaluate(i => getPrompt(RUN.pids[i]).items[1].label, i); await page.fill("#answer", l); await page.press("#answer", "Enter"); await page.waitForFunction(n => RUN.ans.length === n, i + 1); await page.click("#next"); await page.waitForFunction(() => RUN.phase === "ask"); }
    const before = await page.evaluate(() => ({ n: RUN.ans.length, deadline: RUN.deadline }));
    await page.reload(); await page.waitForFunction(() => typeof RUN !== "undefined" && RUN); await sleep(300);
    const after = await page.evaluate(() => ({ n: RUN.ans.length, phase: RUN.phase, deadline: RUN.deadline }));
    check("reload resumes the route where it was", after.n === before.n && after.phase === "ask", JSON.stringify(after));
    check("reload doesn't reset the clock", after.deadline === before.deadline);
    await page.evaluate(() => { RUN.deadline = now() + 400; });
    await page.waitForFunction(() => RUN.phase === "shown", null, { timeout: 4000 });
    check("running out of time records no answer", await page.evaluate(() => RUN.ans[RUN.ans.length - 1].k === -1));
    await page.click("#next");
    for (let i = 3; i < 7; i++) { await page.waitForFunction(() => RUN.phase === "ask"); const l = await page.evaluate(i => getPrompt(RUN.pids[i]).items[0].label, i); await page.fill("#answer", l); await page.press("#answer", "Enter"); await sleep(60);
      if (await page.evaluate(() => RUN.phase !== "shown")) { const l2 = await page.evaluate(i => getPrompt(RUN.pids[i]).items[4].label, i); await page.fill("#answer", l2); await page.press("#answer", "Enter"); }
      await page.waitForFunction(() => RUN.phase === "shown"); await page.click("#next"); }
    await page.waitForFunction(() => RUN.phase === "end"); await sleep(400);
    const end = await page.evaluate(() => ({ hist: STORE.hist[cetNow().day], odo: $("odo").getAttribute("aria-label"), rows: document.querySelectorAll(".itin li").length, km: $("tagR").textContent }));
    check("finishing records the day", !!end.hist && end.hist.late === false && end.rows === 7, JSON.stringify(end));
    check("odometer shows the score", end.odo === `${end.hist.pts} points`, end.odo);
    const blob = await page.evaluate(async () => { const b = await routeImage(summarise(RUN), "Route", "of 700 points"); return b ? b.size : 0; });
    check("route image is made", blob > 20000, blob + " bytes");
    const yesterday = await page.evaluate(() => cetNow().day - 1);
    await page.evaluate(d => openDaily(d), yesterday);
    await playRoute(page);
    const arch = await page.evaluate(d => ({ type: RUN.type, late: STORE.hist[d] && STORE.hist[d].late, streak: streakNow() }), yesterday);
    check("an earlier route is marked late and doesn't build a streak", arch.type === "archive" && arch.late === true && arch.streak === 1, JSON.stringify(arch));
    await page.evaluate(() => { clockSkew = 864e5; });
    await sleep(700);
    check("a new route is offered after midnight", await page.evaluate(() => !$("banner").hidden));
    await page.evaluate(() => { clockSkew = 0; });
    check("no script errors in the single-player run", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---------- layouts ---------- */
  for (const width of [320, 375, 414, 768, 1024, 1440, 1920]) for (const scheme of ["light", "dark"]) {
    const { ctx, page } = await fresh(browser, { viewport: { width, height: 900 }, colorScheme: scheme });
    await skipTutorial(page); await sleep(200);
    await page.click("#begin"); await page.waitForFunction(() => RUN.phase === "ask");
    const l = await page.evaluate(() => getPrompt(RUN.pids[0]).items[3].label); await page.fill("#answer", l); await page.press("#answer", "Enter"); await page.waitForFunction(() => RUN.phase === "shown"); await sleep(1400);
    const m = await page.evaluate(() => {
      const over = document.documentElement.scrollWidth - innerWidth;
      const small = [...document.querySelectorAll("button:not([hidden])")].filter(b => b.offsetParent && !b.closest("details")).map(b => b.getBoundingClientRect()).filter(r => r.height < 43.5 || r.width < 43.5).length;
      const lbl = [...document.querySelectorAll("#labels text, #geo-labels text")].filter(t => t.style.display !== "none").map(t => t.getBoundingClientRect());
      let overlaps = 0; for (let i = 0; i < lbl.length; i++) for (let j = i + 1; j < lbl.length; j++) { const a = lbl[i], b = lbl[j]; if (a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2) overlaps++; }
      return { over, small, overlaps };
    });
    check(`layout ${width}px ${scheme}: no sideways scroll`, m.over <= 0, String(m.over));
    check(`layout ${width}px ${scheme}: buttons at least 44px`, m.small === 0, m.small + " small");
    check(`layout ${width}px ${scheme}: map labels don't overlap`, m.overlaps === 0, m.overlaps + " overlaps");
    if (width === 375 && scheme === "dark") await page.screenshot({ path: "test/out/layout-375-dark.png", fullPage: true });
    if (width === 1920 && scheme === "light") await page.screenshot({ path: "test/out/layout-1920.png" });
    check(`layout ${width}px ${scheme}: no script errors`, page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---------- two players on a shared host ---------- */
  {
    const host = createHost();
    const A = await fresh(browser, { host }, { id: "u_ana", name: "Ana", owner: true });
    const B = await fresh(browser, { host }, { id: "u_ben", name: "Ben" });
    await sleep(500);
    for (const p of [A.page, B.page]) await skipTutorial(p);
    await sleep(300);
    check("shared host: both players are connected", await A.page.evaluate(() => Net.kind === "artifact") && await B.page.evaluate(() => Net.kind === "artifact"));
    check("shared host: owner tools show only for the owner", await A.page.evaluate(() => !$("b-owner").hidden) && await B.page.evaluate(() => $("b-owner").hidden));
    await playRoute(A.page, (P, i) => Math.min(P.items.length - 1, 1 + i));
    await sleep(500);
    const today = await A.page.evaluate(() => cetNow().day);
    const aDoc = host.docs.get("scores/u_ana");
    check("result is posted to the shared table", aDoc && aDoc.days && aDoc.days[today] && aDoc.days[today].pts > 0, JSON.stringify(aDoc || {}).slice(0, 120));
    check("answers stay hidden while the route is open", aDoc && aDoc.days[today].ans === null);
    check("run state is saved privately for other devices", host.docs.has("data/users/u_ana/state"));
    check("today's rarity snapshot is stored once for everyone", host.docs.has("rarity/" + today));
    // B tries a wrong answer, then plays
    const handIdx = await B.page.evaluate(() => RUN.pids.findIndex(id => getPrompt(id).kind === "hand"));
    await playRoute(B.page, (P, i) => Math.min(P.items.length - 1, 4 + i));
    await B.page.evaluate(id => logMiss(id, "Atlantis Rovers"), await B.page.evaluate(i => RUN.pids[i], handIdx));
    await sleep(3600);
    check("missing answers are logged for the owner", host.docs.has("misses/u_ben"));
    await sleep(500);
    const bTable = await B.page.evaluate(() => $("versus").textContent);
    check("the end screen shows today's table with both players", /Today's table/.test(bTable) && /Ana/.test(bTable) && /You/.test(bTable), bTable.slice(0, 200));
    await A.page.evaluate(() => openTables("today")); await sleep(600);
    const aTables = await A.page.evaluate(() => $("dlg-body").textContent);
    check("the tables dialog lists both players", /Ana|You/.test(aTables) && /Ben/.test(aTables), aTables.slice(0, 200));
    await A.page.evaluate(() => openTables("week")); await sleep(400);
    check("the weekly table adds up the week", /You|Ben/.test(await A.page.evaluate(() => $("dlg-body").textContent)));
    await A.page.evaluate(() => openTables("h2h")); await sleep(400);
    check("head-to-head shows a record", /won/.test(await A.page.evaluate(() => $("dlg-body").textContent)));
    await A.page.evaluate(() => closeDialog());
    // midnight: answers are revealed
    await A.page.evaluate(() => { clockSkew = 864e5; revealClosedDays(); });
    await sleep(800);
    check("after midnight the answers are revealed", Array.isArray(host.docs.get("scores/u_ana").days[today].ans));
    await A.page.evaluate(() => { clockSkew = 0; });
    // owner schedules a prompt for tomorrow and sees missing answers
    await A.page.evaluate(() => openOwner()); await sleep(700);
    check("owner panel lists missing answers", /Atlantis Rovers/.test(await A.page.evaluate(() => $("misses").textContent)));
    await A.page.fill("#bank-q", "Name a bridge over the Liffey.");
    await A.page.fill("#bank-a", "Ha'penny Bridge : 9 : IE @ Dublin\nO'Connell Bridge : 8 : IE @ Dublin\nSamuel Beckett Bridge : 6 : IE @ Dublin\nSeán Heuston Bridge : 2 : IE @ Dublin\nMellows Bridge : 1 : IE @ Dublin");
    await A.page.click("#bank-form button[type=submit]"); await sleep(700);
    const bank = [...host.docs.entries()].find(([p]) => p.startsWith("bank/"));
    check("owner can schedule a prompt", !!bank, "");
    await B.page.evaluate(() => { clockSkew = 864e5; openDaily(cetNow().day); }); await sleep(500);
    check("a scheduled prompt appears on its day", await B.page.evaluate(() => RUN.pids.some(id => id.startsWith("x"))));
    await B.page.evaluate(() => { clockSkew = 0; openDaily(cetNow().day); }); await sleep(300);
    // challenge link: A's code, B opens it
    const code = await A.page.evaluate(() => makeCode(STORE.runs["d" + cetNow().day], "Ana"));
    const C = await fresh(browser, { host, hash: "#" + code }, { id: "u_cat", name: "Cat" });
    check("a challenge link opens the same route", await C.page.evaluate(c => RUN.rival === c && RUN.type === "daily", code));
    await C.page.evaluate(() => { SETTINGS.tutorialDone = true; });
    await playRoute(C.page, (P, i) => Math.min(P.items.length - 1, 6));
    const vs = await C.page.evaluate(() => $("versus").textContent);
    check("after finishing, the challenger's answers are compared", /wins by|You win by|Dead heat/.test(vs) && /Ana/.test(vs), vs.slice(0, 160));
    // live duel between B and C
    await B.page.evaluate(() => openDuel()); await sleep(600);
    const lobby = await B.page.evaluate(() => $("duel-lobby").textContent);
    check("the duel lobby lists who's here", /Cat|Ana/.test(lobby), lobby);
    await B.page.click(`[data-invite="peer-u_cat"]`); await sleep(600);
    check("the invited player sees the invitation", await C.page.evaluate(() => !$("banner").hidden && /wants a live duel/.test($("banner").textContent)));
    await C.page.click("#duel-accept"); await sleep(1200);
    const duel = [await B.page.evaluate(() => RUN.type + ":" + RUN.seed), await C.page.evaluate(() => RUN.type + ":" + RUN.seed)];
    check("both players start the same duel route", duel[0] === duel[1] && duel[0].startsWith("duel:"), duel.join(" vs "));
    await Promise.all([playRoute(B.page, (P, i) => 0), playRoute(C.page, (P, i) => Math.min(P.items.length - 1, 5))]);
    await sleep(1200);
    const dvs = await B.page.evaluate(() => $("versus").textContent);
    check("the duel ends with a comparison", /Cat/.test(dvs) && /win|Dead heat/.test(dvs), dvs.slice(0, 160));
    const saved = await B.page.evaluate(async () => { await saveImage(); return true; }); await sleep(800);
    check("route image is offered as a download", host.saves.some(s => /\.png$/.test(s.filename) && s.size > 20000), JSON.stringify(host.saves));
    for (const [n, p] of [["A", A.page], ["B", B.page], ["C", C.page]]) check(`shared host: no script errors for player ${n}`, p.errors.length === 0, p.errors.join(" | "));
    await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
