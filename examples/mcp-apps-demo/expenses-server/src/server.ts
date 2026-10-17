/**
 * ExpenseCo MCP server. Three tools, one UI:
 *   show_expenses    read-only      model + app   opens the ExpenseCo app
 *   add_expense      writes         model + app   files an expense (e.g. the hotel you just picked)
 *   decide_expenses  destructive    model + app   approve / reject your team's expenses
 *
 * Every result has TWO audiences:
 *   content[0].text     a short summary for the model
 *   structuredContent   the full state for the View
 */
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as db from "./db.ts";

const VIEW_URI = "ui://expenses/app.html";

export interface ExpenseState {
  user: string;
  manager: string;
  view: "mine" | "approvals";
  highlightIds: string[];
  mine: db.Expense[];
  approvals: db.Expense[];
  summary: {
    mineSubmittedUsd: number; mineApprovedUsd: number; mineCount: number;
    pendingCount: number; pendingUsd: number; flaggedCount: number;
  };
  policy: typeof db.POLICY;
  notice?: string;
}

function state(view: "mine" | "approvals", highlightIds: string[] = [], notice?: string): ExpenseState {
  const mine = db.myExpenses();
  const approvals = db.approvalQueue();
  const pending = approvals.filter((e) => e.status === "submitted");
  const sum = (xs: db.Expense[]) => Math.round(xs.reduce((a, e) => a + e.amount_usd, 0) * 100) / 100;
  return {
    user: db.USER, manager: db.MANAGER, view, highlightIds, mine, approvals, policy: db.POLICY, notice,
    summary: {
      mineSubmittedUsd: sum(mine.filter((e) => e.status === "submitted")),
      mineApprovedUsd: sum(mine.filter((e) => e.status === "approved")),
      mineCount: mine.length,
      pendingCount: pending.length,
      pendingUsd: sum(pending),
      flaggedCount: pending.filter((e) => e.flags.length).length,
    },
  };
}

/** The model's view of the same state: short, factual, no UI concerns. */
function forModel(s: ExpenseState, lead: string): string {
  const pending = s.approvals.filter((e) => e.status === "submitted");
  const lines = [
    lead,
    `${s.user}: ${s.mine.filter((e) => e.status === "submitted").length} expenses awaiting ${s.manager}'s approval (${db.money(s.summary.mineSubmittedUsd, "USD")}).`,
    `${pending.length} team expenses waiting on ${s.user} (${db.money(s.summary.pendingUsd, "USD")}), ${s.summary.flaggedCount} flagged by policy:`,
    ...pending.map((e) => `- [${e.id}] ${e.employee}: ${e.merchant}, ${db.money(e.amount, e.currency)}${e.flags.length ? ` ⚠ ${e.flags.join("; ")}` : ""}`),
    "The user can see all of this in the ExpenseCo app, so don't repeat the list; answer questions or comment on what stands out.",
  ];
  return lines.join("\n");
}

function result(s: ExpenseState, lead: string): CallToolResult {
  return { content: [{ type: "text", text: forModel(s, lead) }], structuredContent: s as unknown as Record<string, unknown> };
}

export function createServer(viewHtml: () => Promise<string>): McpServer {
  const server = new McpServer({ name: "expenseco", version: "0.1.0" });

  registerAppResource(server, "ExpenseCo", VIEW_URI, { mimeType: RESOURCE_MIME_TYPE, description: "ExpenseCo expenses and approvals" },
    async () => ({ contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(), _meta: { ui: { prefersBorder: true } } }] }));

  registerAppTool(server, "show_expenses", {
    title: "Show expenses",
    description: "Open ExpenseCo: the user's own expenses and the team expenses waiting for their approval. "
      + "Use view='approvals' when they ask what needs approving.",
    inputSchema: z.object({ view: z.enum(["mine", "approvals"]).default("mine").describe("Which tab to open") }),
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: VIEW_URI } },
  }, async ({ view }) => result(state(view ?? "mine"), `Opened ExpenseCo (${view ?? "mine"}).`));

  registerAppTool(server, "add_expense", {
    title: "Add expense",
    description: "File a new expense for the user and submit it to their manager. Use it when the user asks to expense "
      + "something they booked or bought, including things picked in other apps in this conversation. "
      + "For a hotel: merchant = hotel name, amount = nightly price x nights, nights and city set, currency as quoted (e.g. GBP).",
    inputSchema: z.object({
      category: z.enum(["hotel", "flight", "meal", "transport", "conference", "software", "other"]),
      merchant: z.string().describe("Who was paid, e.g. the hotel name"),
      amount: z.number().positive().describe("Total amount in the original currency"),
      currency: z.string().length(3).describe("ISO code: USD, GBP, EUR"),
      description: z.string().optional().describe("Short purpose, e.g. 'Atlanta talk, 2 nights'"),
      city: z.string().optional(),
      nights: z.number().int().positive().optional(),
      expense_date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: VIEW_URI } },
  }, async (args) => {
    const e = db.addExpense({ ...args, source: "chat" });
    const flagNote = e.flags.length ? ` Heads up: ${e.flags.join("; ")}.` : "";
    return result(state("mine", [e.id], `Added ${e.merchant} · ${db.money(e.amount, e.currency)}`),
      `Filed expense [${e.id}]: ${e.merchant}, ${db.money(e.amount, e.currency)} (${db.money(e.amount_usd, "USD")}), submitted to ${db.MANAGER}.${flagNote}`);
  });

  registerAppTool(server, "decide_expenses", {
    title: "Approve or reject expenses",
    description: "Approve or reject team expenses that are waiting on the user. Irreversible. "
      + "Only call this when the user has clearly decided; ids come from show_expenses.",
    inputSchema: z.object({
      ids: z.array(z.string()).min(1),
      decision: z.enum(["approve", "reject"]),
      note: z.string().optional().describe("Reason, shown to the employee (useful for rejections)"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    _meta: { ui: { resourceUri: VIEW_URI } },
  }, async ({ ids, decision, note }) => {
    const changed = db.decide(ids, decision, note);
    const verb = decision === "approve" ? "Approved" : "Rejected";
    return result(state("approvals", changed, `${verb} ${changed.length} expense${changed.length === 1 ? "" : "s"}`),
      `${verb} ${changed.length} of ${ids.length} expenses${changed.length < ids.length ? " (others were already decided or not yours to approve)" : ""}.`);
  });

  return server;
}
