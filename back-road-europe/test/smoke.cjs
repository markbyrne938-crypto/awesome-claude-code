const { chromium } = require("playwright");
const wrap = require("./wrap.cjs");
(async () => {
  const url = wrap();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = []; p.on("pageerror", e => errs.push("pageerror " + e.message)); p.on("console", m => { if (m.type() === "error") errs.push("console " + m.text()); });
  await p.goto(url); await p.waitForTimeout(800);
  console.log("intro:", (await p.textContent("#stage")).slice(0, 120));
  await p.click("#begin"); await p.waitForTimeout(500);
  console.log("ask:", await p.textContent("#qtext"));
  await p.fill("#answer", "Australia"); await p.press("#answer", "Enter"); await p.waitForTimeout(150); console.log("msg:", await p.textContent("#msg"));
  await p.fill("#answer", "Ireland"); await p.press("#answer", "Enter"); await p.waitForTimeout(1500);
  console.log("shown:", (await p.textContent(".res")).slice(0, 160).replace(/\s+/g, " "));
  await p.screenshot({ path: "test/out/tut-shown.png" });
  await p.click("#next"); await p.waitForTimeout(800);
  console.log("daily intro:", (await p.textContent("#stage")).slice(0, 100).replace(/\s+/g, " "));
  await p.click("#begin"); await p.waitForTimeout(600);
  for (let i = 0; i < 7; i++) {
    const q = await p.textContent("#qtext");
    const a = await p.evaluate(i => { const P = getPrompt(RUN.pids[i]); const it = P.items[Math.min(P.items.length - 1, 3 + i)]; return it.label; }, i);
    await p.fill("#answer", a); await p.press("#answer", "Enter"); await p.waitForTimeout(1400);
    const res = await p.textContent(".res-top").catch(() => "?");
    console.log(i + 1, q.slice(0, 70), "→", a, "|", res.replace(/\s+/g, " ").trim());
    if (i === 2) await p.screenshot({ path: "test/out/daily-3.png" });
    await p.click("#next"); await p.waitForTimeout(400);
  }
  await p.waitForTimeout(1500);
  console.log("end:", (await p.textContent(".big")).replace(/\s+/g, " "));
  await p.screenshot({ path: "test/out/end-desktop.png", fullPage: true });
  console.log("errors:", errs.length ? errs.join("\n") : "none");
  await b.close();
})();
