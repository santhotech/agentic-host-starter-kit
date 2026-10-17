/**
 * Entry point.
 *   node dist/server.js --stdio    for Claude Desktop / local hosts
 *   node dist/server.js            Streamable HTTP on PORT (default 4000), like a real remote vendor
 *   node dist/server.js --reset    wipe and reseed the demo data, then exit
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { openDb } from "./db.ts";
import { createServer } from "./server.ts";

const here = dirname(fileURLToPath(import.meta.url));          // .../dist when bundled
const ROOT = resolve(here, "..");
const DB_PATH = process.env.EXPENSES_DB ?? join(ROOT, "expenses.db");
const VIEW_PATH = join(ROOT, "dist", "expenses.html");
const viewHtml = () => readFile(VIEW_PATH, "utf8");

const args = process.argv.slice(2);
openDb(DB_PATH, { reset: args.includes("--reset") });

if (args.includes("--reset")) {
  console.error(`[expenseco] reset demo data in ${DB_PATH}`);
  process.exit(0);
} else if (args.includes("--stdio")) {
  await createServer(viewHtml).connect(new StdioServerTransport());
} else {
  const port = Number(process.env.PORT ?? 4000);
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer(viewHtml);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[expenseco]", e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });
  app.listen(port, () => console.error(`[expenseco] MCP on http://localhost:${port}/mcp  (db: ${DB_PATH})`));
}
