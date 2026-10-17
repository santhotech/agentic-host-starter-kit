/**
 * The agent loop: model -> tool calls -> model ... until the model stops asking for tools.
 * Emits ChatEvents as it goes; tools with a UI also emit an "app" event the browser renders.
 */
import { randomUUID } from "node:crypto";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ApprovalRequest, ChatEvent } from "@agentic-host/core";
import type { McpHub } from "./mcp.ts";
import type { LlmProvider, Message } from "./llm/types.ts";

const MAX_STEPS = 8;

const BASE_SYSTEM = `You are a helpful assistant inside a chat app that can use tools from several services.
Some tools show the user an interactive app (cards, filters, buttons) right in the chat. When that
happens, do NOT repeat what the app already shows: reply in one or two sentences about what stands out,
and let the user drive from the app. When the user picks something in an app, you'll get a message
from them about it; follow up naturally. Messages in <app_context> describe what the user is currently
looking at in an open app.`;

export interface Session {
  messages: Message[];
}

export function systemPrompt(profile: string) {
  return profile ? `${BASE_SYSTEM}\n\n<user_profile>\n${profile}\n</user_profile>` : BASE_SYSTEM;
}

/** Turn an MCP CallToolResult into tool_result content the model can read. */
function toModelContent(result: any): { type: "text"; text: string }[] {
  const texts = (result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => ({ type: "text" as const, text: c.text }));
  if (texts.length) return texts;
  if (result?.structuredContent) return [{ type: "text", text: JSON.stringify(result.structuredContent) }];
  return [{ type: "text", text: "(no content)" }];
}

export async function runTurn(opts: {
  session: Session;
  text: string;
  appContext: string[];
  hub: McpHub;
  llm: LlmProvider;
  system: string;
  emit: (e: ChatEvent) => void;
  /** Ask the user before running a tool that writes. Resolves true if they allow it. */
  requestApproval: (req: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
}) {
  const { session, hub, llm, emit } = opts;
  const userContent: { type: "text"; text: string }[] = [];
  if (opts.appContext.length) {
    userContent.push({ type: "text", text: `<app_context>\n${opts.appContext.join("\n---\n")}\n</app_context>` });
  }
  userContent.push({ type: "text", text: opts.text });
  session.messages.push({ role: "user", content: userContent });

  for (let step = 0; step < MAX_STEPS; step++) {
    const tools = hub.modelTools();
    const res = await llm.turn({ system: opts.system, messages: session.messages, tools }, (delta) => emit({ type: "text", delta }), opts.signal);
    session.messages.push({ role: "assistant", content: res.content as any });

    const toolUses = res.content.filter((b: any) => b.type === "tool_use") as any[];
    if (res.stopReason !== "tool_use" || toolUses.length === 0) break;

    const results: any[] = [];
    for (const use of toolUses) {
      const target = hub.resolveModelTool(use.name);
      if (!target) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` });
        continue;
      }
      emit({ type: "tool_call", id: use.id, server: target.server, tool: target.tool, input: use.input });
      const policy = hub.approvalPolicy(target.server, target.tool);
      if (policy.required) {
        const ok = await opts.requestApproval({
          id: use.id, server: target.server, tool: target.tool, title: policy.title,
          input: use.input ?? {}, destructive: policy.destructive, origin: "model",
        });
        if (!ok) {
          emit({ type: "tool_result", id: use.id, isError: true, declined: true });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "The user declined this action. Don't retry unless they ask." });
          continue;
        }
      }
      try {
        const result: any = await hub.callTool(target.server, target.tool, use.input ?? {}, "model");
        const isError = !!result?.isError;
        emit({ type: "tool_result", id: use.id, isError });
        const tool = hub.getTool(target.server, target.tool);
        const uri = tool && getToolUiResourceUri(tool);
        if (uri && !isError) {
          emit({
            type: "app",
            app: { id: randomUUID(), server: target.server, toolName: target.tool, resourceUri: uri, input: use.input ?? {}, result },
          });
        }
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: isError, content: toModelContent(result) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        emit({ type: "tool_result", id: use.id, isError: true });
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: message });
      }
    }
    session.messages.push({ role: "user", content: results });
  }
  emit({ type: "done" });
}
