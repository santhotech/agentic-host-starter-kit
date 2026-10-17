import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, TurnRequest, TurnResponse } from "./types.ts";

export class AnthropicProvider implements LlmProvider {
  private client = new Anthropic(); // reads ANTHROPIC_API_KEY
  constructor(private model: string, private maxTokens = 4096) {}

  async turn(req: TurnRequest, onText: (d: string) => void, signal?: AbortSignal): Promise<TurnResponse> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system: req.system,
        messages: req.messages,
        tools: req.tools as Anthropic.Tool[],
      },
      { signal },
    );
    stream.on("text", onText);
    const msg = await stream.finalMessage();
    return { content: msg.content, stopReason: msg.stop_reason };
  }
}
