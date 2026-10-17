// Full demo flow: pick a hotel (TravelCo) -> expense it (ExpenseCo) -> approve team expenses.
// Run `LLM_PROVIDER=mock npm run dev` with both example servers in mcp.json, then `node scripts/e2e-demo.mjs`.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "e2e-shots"; mkdirSync(out, { recursive: true });
const WEB = `http://localhost:${process.env.WEB_PORT ?? 5173}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1050 }, deviceScaleFactor: 1.25 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${out}/demo-${n}.png` });
const frameWith = async (sel, nth = -1) => {
  for (let i = 0; i < 80; i++) {
    const hits = [];
    for (const f of page.frames()) if (await f.$(sel).catch(() => null)) hits.push(f);
    if (hits.length) return hits.at(nth);
    await page.waitForTimeout(250);
  }
  throw new Error(`no frame with ${sel}`);
};
const say = async (text) => { await page.fill(".composer input", text); await page.click(".composer button.primary"); };
const idle = () => page.waitForFunction(() => !document.querySelector(".composer input")?.disabled, null, { timeout: 30000 });

await page.goto(WEB);
await page.waitForSelector(".pill.connected");
// 1. TravelCo: find + choose a hotel
await page.click(".suggest button >> nth=0");
const hotels = await frameWith(".card .price");
await idle();
await hotels.click(".card:nth-child(2) [data-act=pick]");          // Haymarket, £380/night (over the £300 cap)
await page.waitForSelector(".consent");
await page.click(".consent button.primary");
await idle();
console.log("1. picked:", (await page.$$eval(".msg.user", (m) => m.at(-1).textContent)).slice(0, 110));

// 2. ExpenseCo: "add it to my expenses" -> approval card (model-initiated write) -> app renders with new row
await say("Great, add it to my expenses for 2 nights");
await page.waitForSelector(".approval:not(.allowed):not(.declined)", { timeout: 15000 });
console.log("2. approval card:", (await page.textContent(".approval")).replace(/\s+/g, " ").slice(0, 160));
await shot("1-approval");
await page.click(".approval .consent-actions button.primary");
const exp = await frameWith(".row.new");
await idle(); await page.waitForTimeout(600);
console.log("   new row:", (await exp.textContent(".row.new .title")).trim(), "|", (await exp.textContent(".row.new .amt")).trim(), "| flag:", await exp.$eval(".row.new .flag", (e) => e.textContent).catch(() => "none"));
await shot("2-expense-added");

// 3. Approvals tab via chat, then batch approve inside the app -> host confirm
await say("What needs my approval?");
const appr = await frameWith("#approvals:not([hidden]) .check[data-check]");
await idle(); await page.waitForTimeout(500);
const rows = await appr.$$("#approvals .check[data-check]");
console.log("3. pending rows:", rows.length, "| flagged:", (await appr.$$("#approvals .flag")).length);
for (const i of [0, 2, 4]) await appr.click(`#approvals .check[data-check] >> nth=${i}`);  // list re-renders on each click
await page.waitForTimeout(200);
console.log("   bar:", (await appr.textContent("#approvals .bar .sum")).trim());
await appr.click("#approve");
await page.waitForSelector(".composer-wrap .approval", { timeout: 8000 });
console.log("   host confirm:", (await page.textContent(".composer-wrap .approval")).replace(/\s+/g, " ").slice(0, 150));
await shot("3-host-confirm");
await page.click(".composer-wrap .approval button.primary");
await page.waitForTimeout(1200);
console.log("   after approve, pending:", (await appr.$$("#approvals .check[data-check]")).length, "| decided:", (await appr.$$("#approvals .row.decided")).length);
await shot("4-approved");

// 4. Deny path: try to reject one, deny at the host
await appr.click("#approvals .check[data-check] >> nth=0");
await appr.click("#reject"); await appr.click("#confirmReject");
await page.waitForSelector(".composer-wrap .approval", { timeout: 8000 });
await page.click(".composer-wrap .approval button.ghost");
await page.waitForTimeout(800);
console.log("4. after deny, pending still:", (await appr.$$("#approvals .check[data-check]")).length);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
