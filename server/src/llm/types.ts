/**
 * The provider interface. We use Anthropic's message shapes as the common format because
 * they map cleanly onto MCP (tool_use / tool_result blocks). Another provider adapts to this.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelTool } from "../mcp.ts";

export type Message = Anthropic.MessageParam;
export type ContentBlock = Anthropic.ContentBlock;

export interface TurnRequest {
  system: string;
  messages: Message[];
  tools: ModelTool[];
}

export interface TurnResponse {
  content: ContentBlock[];
  stopReason: string | null;
}

export interface LlmProvider {
  /** Run one model call, streaming text deltas through onText. */
  turn(req: TurnRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<TurnResponse>;
}
