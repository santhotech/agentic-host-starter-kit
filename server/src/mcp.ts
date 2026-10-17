/**
 * McpHub: one MCP client per server in mcp.json.
 * - gives the model a flat, namespaced tool list (app-only tools hidden)
 * - routes tool calls from the model and from Views to the right server
 * - fetches ui:// resources for the browser
 */
import { Client, StreamableHTTPClientTransport, SSEClientTransport, type Tool } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { RESOURCE_MIME_TYPE, getToolUiResourceUri, isToolVisibilityAppOnly } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ServerSummary, UiResource } from "@agentic-host/core";
import type { HostConfig, ServerConfig } from "./config.ts";

const CLIENT_INFO = { name: "agentic-host-starter-kit", version: "0.1.0" };
/** Tell servers we can render MCP Apps (SEP-2133 extension negotiation). */
const CLIENT_CAPABILITIES = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } },
} as any;

interface Connected {
  name: string;
  client?: Client;
  tools: Map<string, Tool>;
  error?: string;
}

export interface ModelTool {
  /** Name the model sees: "<server>__<tool>" */
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class McpHub {
  private servers = new Map<string, Connected>();
  private modelNames = new Map<string, { server: string; tool: string }>();

  async connectAll(config: HostConfig) {
    await Promise.all(Object.entries(config.mcpServers).map(([name, cfg]) => this.connect(name, cfg)));
  }

  private async connect(name: string, cfg: ServerConfig) {
    const entry: Connected = { name, tools: new Map() };
    this.servers.set(name, entry);
    try {
      const client = new Client(CLIENT_INFO, { capabilities: CLIENT_CAPABILITIES });
      if ("command" in cfg) {
        await client.connect(new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          cwd: cfg.cwd,
          env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) },
          stderr: "inherit",
        }));
      } else {
        const url = new URL(cfg.url);
        const requestInit = { headers: cfg.headers ?? {} };
        try {
          await client.connect(new StreamableHTTPClientTransport(url, { requestInit }));
        } catch {
          await client.connect(new SSEClientTransport(url, { requestInit }));
        }
      }
      const { tools } = await client.listTools();
      for (const t of tools) entry.tools.set(t.name, t);
      entry.client = client;
      console.log(`[mcp] ${name}: ${tools.length} tools (${tools.filter((t) => getToolUiResourceUri(t)).length} with UI)`);
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      console.error(`[mcp] ${name}: failed to connect: ${entry.error}`);
    }
  }

  summary(): ServerSummary[] {
    return [...this.servers.values()].map((s) => ({
      name: s.name,
      status: s.client ? "connected" : "error",
      error: s.error,
      tools: [...s.tools.values()].map((t) => ({ name: t.name, hasUi: !!getToolUiResourceUri(t), appOnly: isToolVisibilityAppOnly(t) })),
    }));
  }

  /** Tools the MODEL may call. App-only tools (visibility: ["app"]) are deliberately excluded. */
  modelTools(): ModelTool[] {
    const out: ModelTool[] = [];
    this.modelNames.clear();
    for (const s of this.servers.values()) {
      if (!s.client) continue;
      for (const t of s.tools.values()) {
        if (isToolVisibilityAppOnly(t)) continue;
        const name = `${s.name}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
        this.modelNames.set(name, { server: s.name, tool: t.name });
        out.push({
          name,
          description: `[${s.name}] ${t.description ?? t.title ?? t.name}`,
          input_schema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        });
      }
    }
    return out;
  }

  resolveModelTool(name: string) {
    return this.modelNames.get(name);
  }

  /**
   * Does this tool need the user's OK? Only tools that SAY they write: readOnlyHint === false
   * or destructiveHint === true. Tools that declare nothing (like the hotel search) run freely.
   */
  approvalPolicy(server: string, tool: string): { required: boolean; destructive: boolean; title?: string } {
    const t = this.getTool(server, tool);
    const a = (t?.annotations ?? {}) as { readOnlyHint?: boolean; destructiveHint?: boolean };
    const destructive = a.destructiveHint === true;
    return { required: destructive || a.readOnlyHint === false, destructive, title: t?.title ?? (a as any).title };
  }

  getTool(server: string, tool: string): Tool | undefined {
    return this.servers.get(server)?.tools.get(tool);
  }

  private client(server: string): Client {
    const s = this.servers.get(server);
    if (!s?.client) throw new Error(`Server "${server}" is not connected${s?.error ? `: ${s.error}` : ""}`);
    return s.client;
  }

  async callTool(server: string, tool: string, args: Record<string, unknown>, from: "model" | "app") {
    const t = this.getTool(server, tool);
    if (!t) throw new Error(`Unknown tool "${tool}" on server "${server}"`);
    // A View may only call tools visible to apps; the model may only call tools visible to the model.
    const vis = ((t._meta as any)?.ui?.visibility as string[] | undefined) ?? ["model", "app"];
    if (!vis.includes(from)) throw new Error(`Tool "${tool}" is not callable from ${from}`);
    return this.client(server).callTool({ name: tool, arguments: args });
  }

  async readRaw(server: string, uri: string) {
    return this.client(server).readResource({ uri });
  }

  async uiResource(server: string, uri: string): Promise<UiResource> {
    if (!uri.startsWith("ui://")) throw new Error("Only ui:// resources can be rendered");
    const res = await this.readRaw(server, uri);
    const c: any = res.contents?.[0];
    if (!c) throw new Error(`Empty resource ${uri}`);
    if (c.mimeType !== RESOURCE_MIME_TYPE) throw new Error(`${uri} has MIME type ${c.mimeType}, expected ${RESOURCE_MIME_TYPE}`);
    const html = typeof c.text === "string" ? c.text : Buffer.from(c.blob, "base64").toString("utf8");
    const ui = (c._meta ?? c.meta)?.ui ?? {};
    return { html, csp: ui.csp, permissions: ui.permissions, prefersBorder: ui.prefersBorder };
  }

  async close() {
    await Promise.all([...this.servers.values()].map((s) => s.client?.close().catch(() => {})));
  }
}
