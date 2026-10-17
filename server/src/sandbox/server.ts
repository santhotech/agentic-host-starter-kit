/**
 * The sandbox origin. Serves ONE page (the proxy) with a Content-Security-Policy header built
 * from the View's declared _meta.ui.csp. Headers can't be altered by the View, unlike <meta> tags.
 * CSP logic adapted from ext-apps examples/basic-host/serve.ts.
 */
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

type Csp = { resourceDomains?: string[]; connectDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] };

/** Drop anything that could break out of a CSP source list. */
const clean = (d?: string[]) => (d ?? []).filter((x) => typeof x === "string" && !/[;\r\n'" ]/.test(x));

export function buildCsp(csp?: Csp): string {
  const res = clean(csp?.resourceDomains).join(" ");
  const conn = clean(csp?.connectDomains).join(" ");
  const frame = clean(csp?.frameDomains).join(" ");
  const base = clean(csp?.baseUriDomains).join(" ");
  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${res}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${res}`.trim(),
    `img-src 'self' data: blob: ${res}`.trim(),
    `font-src 'self' data: blob: ${res}`.trim(),
    `media-src 'self' data: blob: ${res}`.trim(),
    `connect-src 'self' ${conn}`.trim(),
    `worker-src 'self' blob: ${res}`.trim(),
    frame ? `frame-src ${frame}` : "frame-src 'none'",
    "object-src 'none'",
    base ? `base-uri ${base}` : "base-uri 'none'",
  ].join("; ");
}

export function createSandboxApp(allowedHostOrigins: string[]) {
  const page = readFileSync(join(here, "proxy.html"), "utf8")
    .replace("/*__ALLOWED__*/[]", () => JSON.stringify(allowedHostOrigins))
    .replace("/*__PROXY__*/", () => readFileSync(join(here, "proxy.js"), "utf8"));

  const app = express();
  app.get(["/", "/sandbox.html"], (req, res) => {
    let csp: Csp | undefined;
    if (typeof req.query.csp === "string") {
      try { csp = JSON.parse(req.query.csp); } catch { /* ignore bad CSP, fall back to strictest */ }
    }
    res.setHeader("Content-Security-Policy", buildCsp(csp));
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(page);
  });
  app.use((_req, res) => { res.status(404).send("Only the sandbox page is served on this origin."); });
  return app;
}
