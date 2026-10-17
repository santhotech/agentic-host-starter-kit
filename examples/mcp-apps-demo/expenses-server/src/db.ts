/**
 * ExpenseCo data layer: one SQLite file, seeded with a believable month of expenses.
 * Uses Node's built-in node:sqlite, so there is nothing native to compile.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type Category = "hotel" | "flight" | "meal" | "transport" | "conference" | "software" | "other";
export type Status = "submitted" | "approved" | "rejected";

export interface Expense {
  id: string;
  employee: string;
  category: Category;
  merchant: string;
  description: string;
  city: string | null;
  nights: number | null;
  amount: number;
  currency: string;
  amount_usd: number;
  expense_date: string;
  submitted_at: string;
  status: Status;
  approver: string;
  decided_at: string | null;
  decision_note: string | null;
  source: string;
  /** Policy problems a manager should look at, e.g. "Over London hotel cap: £340/night vs £300". */
  flags: string[];
}

export const USER = process.env.EXPENSES_USER ?? "Sam Srinivasan";
export const MANAGER = "Dana Whitfield";

// Fixed demo FX rates to USD. Good enough for totals; a real system would look these up.
const FX: Record<string, number> = { USD: 1, GBP: 1.27, EUR: 1.08 };
export const toUsd = (amount: number, currency: string) => Math.round(amount * (FX[currency] ?? 1) * 100) / 100;

/** Nightly hotel caps by city, in local currency. */
const HOTEL_CAPS: Record<string, [number, string]> = {
  London: [300, "GBP"], Paris: [280, "EUR"], "New York": [350, "USD"], Amsterdam: [250, "EUR"],
};
const DEFAULT_HOTEL_CAP: [number, string] = [250, "USD"];
const MEAL_CAP_USD = 150;

export const POLICY: { hotelCaps: Record<string, string>; mealCap: string } = {
  hotelCaps: { ...Object.fromEntries(Object.entries(HOTEL_CAPS).map(([c, [a, cur]]) => [c, `${money(a, cur)}/night`])), default: `${money(DEFAULT_HOTEL_CAP[0], DEFAULT_HOTEL_CAP[1])}/night` },
  mealCap: `${money(MEAL_CAP_USD, "USD")} per receipt`,
};

export function money(n: number, cur: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
}

function flagsFor(e: Omit<Expense, "flags" | "amount_usd">): string[] {
  const flags: string[] = [];
  if (e.category === "hotel" && e.nights && e.nights > 0) {
    const [cap, capCur] = (e.city && HOTEL_CAPS[e.city]) || DEFAULT_HOTEL_CAP;
    const perNight = e.amount / e.nights;
    const perNightInCap = capCur === e.currency ? perNight : toUsd(perNight, e.currency) / (FX[capCur] ?? 1);
    if (perNightInCap > cap + 0.5) {
      flags.push(`Over ${e.city ?? "hotel"} cap: ${money(Math.round(perNightInCap), capCur)}/night vs ${money(cap, capCur)}`);
    }
  }
  if (e.category === "meal" && toUsd(e.amount, e.currency) > MEAL_CAP_USD) {
    flags.push(`Over meal cap: ${money(toUsd(e.amount, e.currency), "USD")} vs ${money(MEAL_CAP_USD, "USD")}`);
  }
  return flags;
}

let db: DatabaseSync;

export function openDb(path: string, { reset = false } = {}) {
  if (reset && existsSync(path)) rmSync(path);
  const fresh = !existsSync(path);
  db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, employee TEXT NOT NULL, category TEXT NOT NULL, merchant TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', city TEXT, nights INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL,
    expense_date TEXT NOT NULL, submitted_at TEXT NOT NULL, status TEXT NOT NULL, approver TEXT NOT NULL,
    decided_at TEXT, decision_note TEXT, source TEXT NOT NULL DEFAULT 'manual')`);
  if (fresh) seed();
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

function seed() {
  const rows: Array<Partial<Expense> & Pick<Expense, "employee" | "category" | "merchant" | "amount" | "currency">> = [
    // Sam's own expenses (approver: his manager)
    { employee: USER, category: "flight", merchant: "Delta Air Lines", description: "TPA → ATL round trip, conference talk", amount: 384.6, currency: "USD", expense_date: daysAgo(4), status: "submitted" },
    { employee: USER, category: "conference", merchant: "Atlanta Dev Conference", description: "Speaker registration", amount: 199, currency: "USD", expense_date: daysAgo(9), status: "submitted" },
    { employee: USER, category: "meal", merchant: "Bern's Steak House", description: "Client dinner, 3 people", amount: 212.4, currency: "USD", expense_date: daysAgo(12), status: "approved" },
    { employee: USER, category: "transport", merchant: "Uber", description: "Airport to client office", amount: 46.2, currency: "USD", expense_date: daysAgo(13), status: "approved" },
    { employee: USER, category: "software", merchant: "Figma", description: "Professional plan, monthly", amount: 15, currency: "USD", expense_date: daysAgo(20), status: "approved" },
    // Team expenses waiting on Sam
    { employee: "Priya Nair", category: "hotel", merchant: "The Hoxton, Shoreditch", description: "Client workshop, 3 nights", city: "London", nights: 3, amount: 744, currency: "GBP", expense_date: daysAgo(3), status: "submitted" },
    { employee: "Marcus Chen", category: "hotel", merchant: "Marriott Marquis Times Square", description: "Customer onsite, 2 nights", city: "New York", nights: 2, amount: 1118, currency: "USD", expense_date: daysAgo(2), status: "submitted" },
    { employee: "Marcus Chen", category: "flight", merchant: "Delta Air Lines", description: "TPA → JFK round trip", amount: 412.8, currency: "USD", expense_date: daysAgo(2), status: "submitted" },
    { employee: "Elena Rossi", category: "meal", merchant: "Ulele", description: "Team lunch, 6 people", amount: 186.5, currency: "USD", expense_date: daysAgo(5), status: "submitted" },
    { employee: "Jordan Blake", category: "transport", merchant: "Lyft", description: "Rides to customer site (4)", amount: 64.3, currency: "USD", expense_date: daysAgo(6), status: "submitted" },
    { employee: "Aisha Patel", category: "conference", merchant: "KubeCon North America", description: "Full conference pass", amount: 1299, currency: "USD", expense_date: daysAgo(8), status: "submitted" },
    // Already decided by Sam (shows history)
    { employee: "Jordan Blake", category: "software", merchant: "JetBrains", description: "IntelliJ IDEA, annual", amount: 169, currency: "USD", expense_date: daysAgo(15), status: "approved", decided_at: daysAgo(14) },
  ];
  const insert = db.prepare(`INSERT INTO expenses (id, employee, category, merchant, description, city, nights, amount, currency,
    expense_date, submitted_at, status, approver, decided_at, decision_note, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of rows) {
    insert.run(randomUUID(), r.employee, r.category, r.merchant, r.description ?? "", r.city ?? null, r.nights ?? null,
      r.amount, r.currency, r.expense_date!, r.expense_date!, r.status!, r.employee === USER ? MANAGER : USER,
      r.decided_at ?? (r.status === "approved" ? r.expense_date! : null), null, "seed");
  }
}

function hydrate(row: any): Expense {
  const base = { ...row, nights: row.nights ?? null, city: row.city ?? null } as Omit<Expense, "flags" | "amount_usd">;
  return { ...base, amount_usd: toUsd(base.amount, base.currency), flags: flagsFor(base) };
}

export function myExpenses(): Expense[] {
  return (db.prepare(`SELECT * FROM expenses WHERE employee = ? ORDER BY submitted_at DESC, rowid DESC`).all(USER) as any[]).map(hydrate);
}

export function approvalQueue(): Expense[] {
  return (db.prepare(`SELECT * FROM expenses WHERE approver = ? ORDER BY status = 'submitted' DESC, COALESCE(decided_at, submitted_at) DESC, rowid DESC`)
    .all(USER) as any[]).map(hydrate);
}

export function addExpense(input: {
  category: Category; merchant: string; description?: string; amount: number; currency: string;
  city?: string; nights?: number; expense_date?: string; source?: string;
}): Expense {
  const id = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO expenses (id, employee, category, merchant, description, city, nights, amount, currency,
    expense_date, submitted_at, status, approver, decided_at, decision_note, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, USER, input.category, input.merchant, input.description ?? "", input.city ?? null, input.nights ?? null,
      Math.round(input.amount * 100) / 100, input.currency.toUpperCase(), input.expense_date ?? today, today, "submitted", MANAGER, null, null, input.source ?? "chat");
  return hydrate(db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id));
}

export function decide(ids: string[], decision: "approve" | "reject", note?: string) {
  const status: Status = decision === "approve" ? "approved" : "rejected";
  const today = new Date().toISOString().slice(0, 10);
  const stmt = db.prepare(`UPDATE expenses SET status = ?, decided_at = ?, decision_note = ? WHERE id = ? AND approver = ? AND status = 'submitted'`);
  const changed: string[] = [];
  for (const id of ids) {
    const r = stmt.run(status, today, note ?? null, id, USER);
    if (Number(r.changes) > 0) changed.push(id);
  }
  return changed;
}
