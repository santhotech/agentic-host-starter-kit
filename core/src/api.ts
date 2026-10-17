import type { ApprovalRequest, ChatEvent, ServerSummary, UiResource } from "./protocol.ts";

/** Thrown by callAppTool when the backend needs the user's OK before running the tool. */
export class ApprovalRequiredError extends Error {
  constructor(public request: Omit<ApprovalRequest, "id">) {
    super(`Approval required for ${request.server}.${request.tool}`);
  }
}

/** Thin client for the starter's backend. Swap baseUrl if the API lives elsewhere. */
export class HostApi {
  constructor(private baseUrl = "") {}

  async servers(): Promise<ServerSummary[]> {
    return this.json(await fetch(`${this.baseUrl}/api/servers`));
  }

  /**
   * Send one user turn and stream the agent's response.
   * `appContext` is whatever the open MCP Apps last reported via updateModelContext.
   */
  async *chat(sessionId: string, text: string, appContext: string[] = [], signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text, appContext }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
        if (data) yield JSON.parse(data) as ChatEvent;
      }
    }
  }

  /** Called by a View (via AppBridge) to run a tool on the server it came from. */
  async callAppTool(server: string, name: string, args: Record<string, unknown> = {}, approved = false): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/apps/call-tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ server, name, arguments: args, approved }),
    });
    const body = await this.json(res);
    if (body?.approvalRequired) throw new ApprovalRequiredError(body.request);
    return body;
  }

  /** Answer an approval_request the agent is waiting on. */
  async answerApproval(id: string, approved: boolean): Promise<void> {
    await this.json(await fetch(`${this.baseUrl}/api/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved }),
    }));
  }

  async uiResource(server: string, uri: string): Promise<UiResource> {
    const q = new URLSearchParams({ server, uri });
    return this.json(await fetch(`${this.baseUrl}/api/apps/resource?${q}`));
  }

  async readResource(server: string, uri: string): Promise<any> {
    const q = new URLSearchParams({ server, uri, raw: "1" });
    return this.json(await fetch(`${this.baseUrl}/api/apps/resource?${q}`));
  }

  private async json(res: Response) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body;
  }
}
