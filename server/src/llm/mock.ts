/**
 * A scripted stand-in for a real model. No API key needed.
 * Used by the end-to-end test and handy for UI work offline. It is deliberately dumb:
 * if the user mentions a city we know and there's a tool that looks like a search, call it.
 */
import type { LlmProvider, TurnRequest, TurnResponse } from "./types.ts";

const CITIES = ["London", "Paris", "Amsterdam", "Barcelona", "Milan", "Vienna"];

export class MockProvider implements LlmProvider {
  async turn(req: TurnRequest, onText: (d: string) => void): Promise<TurnResponse> {
    const last = req.messages[req.messages.length - 1];
    const lastBlocks = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content } as const];
    const say = async (text: string): Promise<TurnResponse> => {
      for (const w of text.split(/(?<= )/)) { onText(w); await new Promise((r) => setTimeout(r, 8)); }
      return { content: [{ type: "text", text, citations: null }], stopReason: "end_turn" };
    };
    if (lastBlocks.some((b: any) => b.type === "tool_result")) {
      const declined = lastBlocks.some((b: any) => b.is_error && /declined/i.test(JSON.stringify(b.content)));
      if (declined) return say("No problem, I won't do that.");
      const prev = req.messages[req.messages.length - 2];
      const used = Array.isArray(prev?.content) ? (prev.content as any[]).find((b) => b.type === "tool_use")?.name ?? "" : "";
      if (/add_expense/.test(used)) return say("Done, it's filed and waiting on your manager. Heads up if it shows a policy flag.");
      if (/show_expenses|decide_expenses/.test(used)) return say("Here's ExpenseCo. The flagged ones are worth a look before you approve.");
      return say("Here are some options. Filter, open details, or shortlist a couple and I'll compare them.");
    }
    const text = lastBlocks.filter((b: any) => !String(b.text ?? "").startsWith("<app_context>")).map((b: any) => b.text ?? "").join(" ");
    const tool = (re: RegExp) => req.tools.find((t) => re.test(t.name));
    const callTool = async (name: string, input: Record<string, unknown>, lead: string): Promise<TurnResponse> => {
      await say(lead);
      return {
        content: [
          { type: "text", text: lead, citations: null },
          { type: "tool_use", id: `toolu_mock_${Date.now()}`, name, input } as any,
        ],
        stopReason: "tool_use",
      };
    };

    // "add it to my expenses": find the hotel the user picked earlier in the conversation.
    const addExpense = tool(/add_expense/);
    if (addExpense && /expense/i.test(text) && !/approv/i.test(text)) {
      const history = req.messages.map((m) => (typeof m.content === "string" ? m.content : (m.content as any[]).map((b) => b.text ?? "").join(" "))).join("\n");
      const m = [...history.matchAll(/go with (.+?) in (\w+) \(guest score [\d.]+, ([£€$])(\d+) a night\)/g)].pop();
      if (m) {
        const nights = Number(/(\d+) nights?/.exec(text)?.[1] ?? 2);
        const currency = { "£": "GBP", "€": "EUR", "$": "USD" }[m[3]]!;
        return callTool(addExpense.name, {
          category: "hotel", merchant: m[1], city: m[2], nights, amount: Number(m[4]) * nights, currency,
          description: `${m[2]} trip, ${nights} nights`,
        }, `Filing ${m[1]} for ${nights} nights. `);
      }
    }
    const show = tool(/show_expenses/);
    if (show && /(approv|expense)/i.test(text)) {
      return callTool(show.name, { view: /approv/i.test(text) ? "approvals" : "mine" }, "Opening ExpenseCo. ");
    }
    if (/\b(go with|compare|tell me more)\b/i.test(text)) {
      return say("Good choice. (mock model) With a real model I'd now dig into the reviews and what's nearby.");
    }
    const city = CITIES.find((c) => text.toLowerCase().includes(c.toLowerCase()));
    const search = req.tools.find((t) => /search/i.test(t.name));
    if (city && search) {
      await say(`Let me look for hotels in ${city}. `);
      return {
        content: [
          { type: "text", text: `Let me look for hotels in ${city}. `, citations: null },
          { type: "tool_use", id: `toolu_mock_${Date.now()}`, name: search.name, input: { city, traveler_type: /couple/i.test(text) ? "Couple" : undefined } , caller: undefined } as any,
        ],
        stopReason: "tool_use",
      };
    }
    return say(`(mock model) You said: "${text.slice(0, 120)}". Mention a city like London to trigger a tool.`);
  }
}
