/**
 * Wire types shared by the browser and the backend.
 * The backend streams ChatEvents to the browser over Server-Sent Events.
 */

/** A rendered MCP App: which server/tool produced it, and what to hand the View. */
export interface AppInstance {
  /** Unique per tool call; use it as a React key / DOM id. */
  id: string;
  /** Server name from mcp.json. */
  server: string;
  /** The tool's real name on its server (not the namespaced name the model sees). */
  toolName: string;
  /** The ui:// resource the tool points at. */
  resourceUri: string;
  /** Arguments the model called the tool with (sent to the View as tool-input). */
  input: Record<string, unknown>;
  /** The MCP CallToolResult (sent to the View as tool-result). */
  result: unknown;
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; server: string; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; isError: boolean; declined?: boolean }
  /** The model wants to run a tool that writes or destroys something. POST /api/approvals/:id to answer. */
  | { type: "approval_request"; request: ApprovalRequest }
  | { type: "app"; app: AppInstance }
  | { type: "error"; message: string }
  | { type: "done" };

/** A tool call waiting for the user's OK (from the model, or from an app). */
export interface ApprovalRequest {
  id: string;
  server: string;
  tool: string;
  title?: string;
  input: Record<string, unknown>;
  /** destructiveHint: true (irreversible), as opposed to a plain write */
  destructive: boolean;
  origin: "model" | "app";
}

/** What GET /api/apps/resource returns: the View HTML plus its declared sandbox needs. */
export interface UiResource {
  html: string;
  csp?: Record<string, string[]>;
  permissions?: Record<string, unknown>;
  prefersBorder?: boolean;
}

export interface ServerSummary {
  name: string;
  status: "connected" | "error";
  error?: string;
  tools: { name: string; hasUi: boolean; appOnly: boolean }[];
}
