// End-to-end smoke test against the hotels example. Run `LLM_PROVIDER=mock npm run dev` first,
// then `npm run test:e2e`. Needs Playwright with Chromium (npx playwright install chromium).
import { chromium } from "playwright";
const out = process.argv[2] ?? "e2e-shots"; await import("node:fs").then((fs) => fs.mkdirSync(out, { recursive: true }));
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1.25 });
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const apiCalls = [];
page.on("request", (r) => { if (r.url().includes("/api/")) apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`); });

await page.goto(`http://localhost:${process.env.WEB_PORT ?? 5173}/`);
await page.waitForSelector(".pill.connected");
await page.screenshot({ path: `${out}/e2e-1-empty.png` });
await page.click(".suggest button >> nth=0");

// The View lives two iframes deep: host page -> sandbox proxy (:8788) -> inner iframe.
const findView = async () => {
  for (let i = 0; i < 60; i++) {
    for (const f of page.frames()) {
      if (await f.$(".card").catch(() => null)) return f;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("View never rendered");
};
const view = await findView();
const proxy = page.frames().find((f) => f.url().startsWith(`http://localhost:${process.env.SANDBOX_PORT ?? 8788}`));
console.log("proxy frame origin:", proxy && new URL(proxy.url()).origin);
console.log("view frame url:", view.url() || "(document.write)");
console.log("cards:", await view.$$eval(".card", (c) => c.length), "| first:", await view.$eval(".card .name", (e) => e.textContent), "| price:", await view.$eval(".card .price", (e) => e.textContent).catch(() => "none"));
const isolated = await view.evaluate(() => { try { return !!window.top.document.title; } catch { return "blocked"; } });
console.log("view can read host DOM:", isolated);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/e2e-2-app.png` });

await view.click(".card:nth-child(1) [data-act=toggle]");
await view.waitForSelector(".detail .bars", { timeout: 8000 });
await view.click(".card:nth-child(2) [data-act=save]");
await view.click(".card:nth-child(3) [data-act=save]");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/e2e-3-details.png` });

await view.click(".card:nth-child(1) [data-act=pick]");
await page.waitForSelector(".consent", { timeout: 5000 });
console.log("consent text:", (await page.textContent(".consent blockquote")).slice(0, 140));
await page.screenshot({ path: `${out}/e2e-4-consent.png` });
await page.click(".consent button.primary");
await page.waitForSelector(".msg.user .via", { timeout: 5000 });
await page.waitForFunction(() => document.querySelectorAll(".msg.assistant").length >= 2, null, { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/e2e-5-followup.png`, fullPage: false });
console.log("assistant msgs:", await page.$$eval(".msg.assistant", (m) => m.map((x) => x.textContent.slice(0, 70))));
console.log("api calls:", [...new Set(apiCalls)].join(", "));
console.log("app tool calls:", apiCalls.filter((c) => c.includes("call-tool")).length);
console.log("errors:", errors.length ? "\n  " + errors.join("\n  ") : "none");
await browser.close();
