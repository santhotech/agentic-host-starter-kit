/**
 * Mount one MCP App into a container element.
 *
 * Security model (same as the official ext-apps basic-host):
 *   your page  ──postMessage──▶  sandbox proxy iframe (DIFFERENT ORIGIN)  ──▶  inner iframe running the View
 * The View can't touch your DOM, cookies or storage, and every tool call it makes comes
 * back through the AppBridge here, which forwards it to YOUR backend (never straight to a server).
 */
import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostContext,
  type McpUiMessageRequest,
  type McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { ApprovalRequiredError, type HostApi } from "./api.ts";
import type { AppInstance, ApprovalRequest } from "./protocol.ts";

export type AppMessage = McpUiMessageRequest["params"];
export type AppContextUpdate = McpUiUpdateModelContextRequest["params"];

export interface MountOptions {
  container: HTMLElement;
  app: AppInstance;
  api: HostApi;
  /** Full URL of sandbox.html on the sandbox origin, e.g. http://localhost:8788/sandbox.html */
  sandboxUrl: string;
  hostInfo?: { name: string; version: string };
  theme?: "light" | "dark";
  /** The View wants to post a message into the chat. Return false to reject it. */
  onMessage?: (msg: AppMessage, app: AppInstance) => boolean | Promise<boolean>;
  /** The View updated what the model should know about it (sent with the next user turn). */
  onContextUpdate?: (ctx: AppContextUpdate | null, app: AppInstance) => void;
  /**
   * The View called a tool that writes or destroys something. The HOST asks the user, not the app:
   * the host can't know whether a click inside the iframe was real. Resolve true to run it.
   */
  onApprovalRequest?: (req: Omit<ApprovalRequest, "id">, app: AppInstance) => Promise<boolean>;
  /** Called after each app-initiated tool call (handy for logging / devtools panels). */
  onAppToolCall?: (name: string, args: unknown, app: AppInstance) => void;
  log?: (...args: unknown[]) => void;
}

export interface MountedApp {
  bridge: AppBridge;
  iframe: HTMLIFrameElement;
  setTheme(theme: "light" | "dark"): void;
  dispose(): Promise<void>;
}

const PROXY_READY = "ui/notifications/sandbox-proxy-ready";

export async function mountApp(opts: MountOptions): Promise<MountedApp> {
  const { container, app, api } = opts;
  const log = opts.log ?? (() => {});

  // 1. Fetch the View's HTML + declared CSP/permissions from our backend.
  const resource = await api.uiResource(app.server, app.resourceUri);

  // 2. Create the outer iframe pointing at the sandbox origin. CSP travels as a query param;
  //    the sandbox server turns it into an HTTP header the View cannot tamper with.
  const iframe = document.createElement("iframe");
  iframe.className = "mcp-app-frame";
  iframe.title = `${app.server} · ${app.toolName}`;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  iframe.style.cssText = "width:100%;height:160px;border:0;display:block;color-scheme:normal;";
  container.appendChild(iframe);

  const url = new URL(opts.sandboxUrl);
  if (resource.csp) url.searchParams.set("csp", JSON.stringify(resource.csp));
  const proxyReady = new Promise<void>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === iframe.contentWindow && e.data?.method === PROXY_READY) {
        window.removeEventListener("message", onMsg);
        resolve();
      }
    };
    window.addEventListener("message", onMsg);
  });
  iframe.src = url.href;
  await proxyReady;
  log("sandbox proxy ready", app.id);

  // 3. The bridge. client = null: we have no MCP client in the browser. Every request the
  //    View makes is handled below and forwarded to the backend.
  const hostContext: McpUiHostContext = {
    theme: opts.theme ?? "light",
    platform: "web",
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    containerDimensions: { maxHeight: 4000 },
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const bridge = new AppBridge(
    null,
    opts.hostInfo ?? { name: "agentic-host-starter-kit", version: "0.1.0" },
    {
      serverTools: {},
      serverResources: {},
      openLinks: {},
      logging: {},
      message: { text: {} },
      updateModelContext: { text: {} },
    },
    { hostContext },
  );

  bridge.oncalltool = async (params) => {
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    let result;
    try {
      result = await api.callAppTool(app.server, params.name, args);
    } catch (e) {
      if (!(e instanceof ApprovalRequiredError)) throw e;
      const ok = (await opts.onApprovalRequest?.(e.request, app)) ?? false;
      if (!ok) return { content: [{ type: "text", text: "The user declined this action." }], isError: true };
      result = await api.callAppTool(app.server, params.name, args, true);
    }
    opts.onAppToolCall?.(params.name, params.arguments, app);
    return result;
  };
  bridge.onreadresource = async (params) => api.readResource(app.server, params.uri);
  bridge.onmessage = async (params) => {
    const ok = (await opts.onMessage?.(params, app)) ?? true;
    return ok ? {} : { isError: true };
  };
  bridge.onupdatemodelcontext = async (params) => {
    const has = (params.content?.length ?? 0) > 0 || Object.keys(params.structuredContent ?? {}).length > 0;
    opts.onContextUpdate?.(has ? params : null, app);
    return {};
  };
  bridge.onopenlink = async ({ url }) => {
    if (/^(https?:|mailto:)/.test(url)) window.open(url, "_blank", "noopener,noreferrer");
    return {};
  };
  bridge.onrequestdisplaymode = async () => ({ mode: "inline" });
  bridge.onloggingmessage = (p) => log("[app log]", app.id, p);
  bridge.onsizechange = ({ height }) => {
    if (height !== undefined) iframe.style.height = `${Math.ceil(height)}px`;
  };

  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });

  // 4. Connect, hand the sandbox the HTML, wait for the View, then send input + result.
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  await bridge.sendSandboxResourceReady({
    html: resource.html,
    csp: resource.csp as any,
    permissions: resource.permissions as any,
  });
  await initialized;
  log("view initialized", app.id);
  await bridge.sendToolInput({ arguments: app.input });
  await bridge.sendToolResult(app.result as any);

  return {
    bridge,
    iframe,
    setTheme(theme) {
      bridge.sendHostContextChange({ theme });
    },
    async dispose() {
      try { await bridge.close(); } catch { /* already gone */ }
      iframe.remove();
    },
  };
}
