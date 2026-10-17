import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Load ../.env if present (Node 22+ has this built in).
if (existsSync(resolve(ROOT, ".env"))) process.loadEnvFile(resolve(ROOT, ".env"));

/** One entry in mcp.json. Same shape as Claude Desktop's config, plus optional host extras. */
export type ServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string; disabled?: boolean }
  | { url: string; headers?: Record<string, string>; disabled?: boolean };

export interface HostConfig {
  mcpServers: Record<string, ServerConfig>;
}

/** Replace ${VAR} with process.env.VAR, so secrets stay in .env, not in mcp.json. */
function expandEnv<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, k) => {
      if (process.env[k] === undefined) console.warn(`[config] \${${k}} is not set`);
      return process.env[k] ?? "";
    }) as T;
  }
  if (Array.isArray(value)) return value.map(expandEnv) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v)])) as T;
  }
  return value;
}

export function loadConfig(path = process.env.MCP_CONFIG ?? resolve(ROOT, "mcp.json")): HostConfig {
  if (!existsSync(path)) {
    throw new Error(`No MCP config at ${path}. Copy mcp.example.json to mcp.json and edit it.`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const servers = Object.fromEntries(
    Object.entries(raw.mcpServers ?? {}).filter(([, v]: [string, any]) => !v?.disabled),
  );
  return { mcpServers: expandEnv(servers) as Record<string, ServerConfig> };
}

export function loadProfile(): string {
  const p = process.env.PROFILE_PATH ?? resolve(ROOT, "profile.md");
  return existsSync(p) ? readFileSync(p, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim() : "";
}

export const env = {
  hostPort: Number(process.env.HOST_PORT ?? 8787),
  sandboxPort: Number(process.env.SANDBOX_PORT ?? 8788),
  webPort: Number(process.env.WEB_PORT ?? 5173),
  provider: (process.env.LLM_PROVIDER ?? "anthropic") as "anthropic" | "mock",
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
  allowedHostOrigins: (process.env.ALLOWED_HOST_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};
