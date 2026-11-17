const { chromium, devices } = require("playwright");
const wrap = require("./wrap.cjs");
(async () => {
  const url = wrap();
  const b = await chromium.launch();
  for (const [name, opts] of [["phone-dark", { ...devices["iPhone 13"], colorScheme: "dark" }], ["tablet", { viewport: { width: 820, height: 1100 } }]]) {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(url); await p.waitForTimeout(700);
    await p.evaluate(() => { SETTINGS.tutorialDone = true; openDaily(cetNow().day); });
    await p.waitForTimeout(600); await p.screenshot({ path: `test/out/${name}-intro.png` });
    await p.click("#begin"); await p.waitForTimeout(500);
    const a = await p.evaluate(() => getPrompt(RUN.pids[0]).items[5].label);
    await p.fill("#answer", a); await p.press("#answer", "Enter"); await p.waitForTimeout(1500);
    await p.screenshot({ path: `test/out/${name}-shown.png` });
    console.log(name, "overflow", await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), "errors", errs.join(" | ") || "none");
    await ctx.close();
  }
  await b.close();
})();
