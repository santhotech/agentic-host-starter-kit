import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatEvent } from "@agentic-host/core";
import { ROOT, env, loadConfig, loadProfile } from "./config.ts";
import { McpHub } from "./mcp.ts";
import { runTurn, systemPrompt, type Session } from "./agent.ts";
import { AnthropicProvider } from "./llm/anthropic.ts";
import { MockProvider } from "./llm/mock.ts";
import type { LlmProvider } from "./llm/types.ts";
import { createSandboxApp } from "./sandbox/server.ts";

const hub = new McpHub();
await hub.connectAll(loadConfig());

if (env.provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  console.error("[host] ANTHROPIC_API_KEY is not set. Add it to .env, or set LLM_PROVIDER=mock to try the UI without a key.");
}
const llm: LlmProvider = env.provider === "mock" ? new MockProvider() : new AnthropicProvider(env.model);
const system = systemPrompt(loadProfile());
const sessions = new Map<string, Session>(); // v1: in memory only
/** Approvals the agent is waiting on, keyed by tool_use id. */
const pendingApprovals = new Map<string, (approved: boolean) => void>();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/servers", (_req, res) => { res.json(hub.summary()); });

app.get("/api/config", (_req, res) => {
  res.json({ sandboxUrl: process.env.SANDBOX_URL ?? `http://localhost:${env.sandboxPort}/sandbox.html`, provider: env.provider, model: env.provider === "mock" ? "mock" : env.model });
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, text, appContext } = req.body ?? {};
  if (typeof sessionId !== "string" || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "sessionId and text are required" });
    return;
  }
  const session = sessions.get(sessionId) ?? { messages: [] };
  sessions.set(sessionId, session);

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const emit = (e: ChatEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const abort = new AbortController();
  const mine = new Set<string>();
  res.on("close", () => {
    abort.abort();
    for (const id of mine) { pendingApprovals.get(id)?.(false); pendingApprovals.delete(id); }
  });
  const requestApproval = (request: import("@agentic-host/core").ApprovalRequest) =>
    new Promise<boolean>((resolve) => {
      mine.add(request.id);
      pendingApprovals.set(request.id, (ok) => { pendingApprovals.delete(request.id); mine.delete(request.id); resolve(ok); });
      emit({ type: "approval_request", request });
    });
  try {
    await runTurn({ session, text, appContext: Array.isArray(appContext) ? appContext : [], hub, llm, system, emit, requestApproval, signal: abort.signal });
  } catch (e) {
    console.error("[agent]", e);
    emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    emit({ type: "done" });
  }
  res.end();
});

app.post("/api/approvals/:id", (req, res) => {
  const resolve = pendingApprovals.get(req.params.id);
  if (!resolve) { res.status(404).json({ error: "No pending approval with that id" }); return; }
  resolve(req.body?.approved === true);
  res.json({ ok: true });
});

// Views call tools on THEIR OWN server only; the browser says which server the View came from.
// Tools that write need the user's OK first: we answer { approvalRequired } and the host UI asks, then retries.
// (Only the host page can reach this API: the View lives on the sandbox origin.)
app.post("/api/apps/call-tool", async (req, res) => {
  const { server, name, arguments: args, approved } = req.body ?? {};
  const policy = hub.approvalPolicy(server, name);
  if (policy.required && approved !== true) {
    res.json({ approvalRequired: true, request: { server, tool: name, title: policy.title, input: args ?? {}, destructive: policy.destructive, origin: "app" } });
    return;
  }
  try {
    res.json(await hub.callTool(server, name, args ?? {}, "app"));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/apps/resource", async (req, res) => {
  const { server, uri, raw } = req.query as Record<string, string>;
  try {
    res.json(raw ? await hub.readRaw(server, uri) : await hub.uiResource(server, uri));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Production: serve the built web app from the same origin as the API.
const webDist = resolve(ROOT, "web/dist");
if (existsSync(webDist)) app.use(express.static(webDist));

app.listen(env.hostPort, () => console.log(`[host] API on http://localhost:${env.hostPort}`));
createSandboxApp(env.allowedHostOrigins).listen(env.sandboxPort, () =>
  console.log(`[host] sandbox on http://localhost:${env.sandboxPort} (separate origin for MCP Apps)`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => { await hub.close(); process.exit(0); });
}
