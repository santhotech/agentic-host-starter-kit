import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { ExpenseState } from "../src/server.ts";
import type { Expense } from "../src/db.ts";

type Tab = "mine" | "approvals";

const app = new App({ name: "ExpenseCo", version: "0.1.0" });
const $ = (id: string) => document.getElementById(id)!;
let s: ExpenseState | null = null;
let tab: Tab = "mine";
const selected = new Set<string>();
let rejecting = false;
let busy = false;

// ------------------------------------------------------------ helpers
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number, cur = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const ICON: Record<string, string> = { hotel: "🏨", flight: "✈️", meal: "🍽️", transport: "🚕", conference: "🎟️", software: "💻", other: "🧾" };
const COLORS = ["#4338ca", "#0e7c6b", "#c2410c", "#7c3aed", "#0369a1", "#be185d"];
const avatarColor = (name: string) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const fmtDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

function data(r: any): ExpenseState {
  if (r?.isError) throw new Error(r.content?.[0]?.text ?? "Declined");
  return r.structuredContent as ExpenseState;
}

let toastTimer: number | undefined;
function toast(msg: string) {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el!.classList.remove("show"), 2000);
}

function applyHost(ctx: any) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

// ------------------------------------------------------------ render
function render() {
  if (!s) return;
  const first = s.user.split(" ")[0];
  $("greeting").textContent = `Hi ${first}`;
  $("sub").textContent = s.summary.pendingCount
    ? `${s.summary.pendingCount} team expense${s.summary.pendingCount === 1 ? "" : "s"} waiting on you`
    : "You're all caught up";
  $("mineCount").textContent = String(s.summary.mineCount);
  $("pendingCount").textContent = s.summary.pendingCount ? String(s.summary.pendingCount) : "";
  $("policy").textContent = `Policy: hotels ${s.policy.hotelCaps.London} in London, ${s.policy.hotelCaps["New York"]} in New York; meals ${s.policy.mealCap}.`;
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("mine").hidden = tab !== "mine";
  $("approvals").hidden = tab !== "approvals";
  renderMine();
  renderApprovals();
}

function amountCell(e: Expense) {
  return `<div class="right"><div class="amt">${money(e.amount, e.currency)}</div>
    ${e.currency !== "USD" ? `<div class="usd">≈ ${money(e.amount_usd)}</div>` : ""}
    <span class="pill ${e.status}">${e.status === "submitted" ? "Awaiting approval" : e.status === "approved" ? "Approved" : "Rejected"}</span></div>`;
}

function flagHtml(e: Expense, ask = false) {
  return e.flags.map((f) => `<div><span class="flag">⚠ ${esc(f)}</span>${ask ? `<button class="ask" data-ask="${esc(e.id)}">Ask Claude</button>` : ""}</div>`).join("");
}

function renderMine() {
  const el = $("mine");
  const mine = s!.mine;
  const isNew = (e: Expense) => s!.highlightIds.includes(e.id);
  el.innerHTML = `
    ${s!.notice && tab === "mine" && s!.highlightIds.length ? `<div class="notice">✓ ${esc(s!.notice)}</div>` : ""}
    <div class="tiles">
      <div class="tile"><div class="k">Awaiting ${esc(s!.manager.split(" ")[0])}</div><div class="v">${money(s!.summary.mineSubmittedUsd)}</div></div>
      <div class="tile"><div class="k">Approved this month</div><div class="v">${money(s!.summary.mineApprovedUsd)}</div></div>
      <div class="tile"><div class="k">Expenses</div><div class="v">${s!.summary.mineCount} <small>this month</small></div></div>
    </div>
    <ol class="list">${mine.map((e) => `
      <li class="row no-check ${isNew(e) ? "new" : ""}">
        <div class="ico">${ICON[e.category] ?? "🧾"}</div>
        <div class="main">
          <div class="title">${esc(e.merchant)}${isNew(e) ? `<span class="tag-new">Added from chat</span>` : ""}</div>
          <div class="meta">${esc(e.description || e.category)} · ${fmtDate(e.expense_date)}</div>
          ${flagHtml(e)}
        </div>
        ${amountCell(e)}
      </li>`).join("")}</ol>`;
}

function renderApprovals() {
  const el = $("approvals");
  const pending = s!.approvals.filter((e) => e.status === "submitted");
  const decided = s!.approvals.filter((e) => e.status !== "submitted").slice(0, 6);
  for (const id of [...selected]) if (!pending.some((e) => e.id === id)) selected.delete(id);
  const selTotal = pending.filter((e) => selected.has(e.id)).reduce((a, e) => a + e.amount_usd, 0);
  const row = (e: Expense, checkable: boolean) => `
    <li class="row ${checkable ? "" : "no-check decided"} ${selected.has(e.id) ? "sel" : ""}" data-id="${esc(e.id)}">
      ${checkable ? `<input type="checkbox" class="check" data-check="${esc(e.id)}" ${selected.has(e.id) ? "checked" : ""} aria-label="Select ${esc(e.merchant)}" />` : ""}
      <div class="avatar" style="background:${avatarColor(e.employee)}">${initials(e.employee)}</div>
      <div class="main">
        <div class="title">${esc(e.employee)} · ${esc(e.merchant)}</div>
        <div class="meta">${ICON[e.category] ?? ""} ${esc(e.description || e.category)} · ${fmtDate(e.expense_date)}</div>
        ${checkable ? flagHtml(e, true) : ""}
      </div>
      ${amountCell(e)}
    </li>`;
  el.innerHTML = pending.length ? `
    <div class="bar">
      <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="check" id="all" ${selected.size === pending.length ? "checked" : ""} /> All</label>
      <div class="sum">${selected.size ? `<b>${selected.size} selected</b> · ${money(selTotal)}` : `${pending.length} waiting · ${money(s!.summary.pendingUsd)}${s!.summary.flaggedCount ? ` · ${s!.summary.flaggedCount} flagged` : ""}`}</div>
      <button class="btn danger" id="reject" ${!selected.size || busy ? "disabled" : ""}>Reject</button>
      <button class="btn primary" id="approve" ${!selected.size || busy ? "disabled" : ""}>Approve${selected.size ? ` ${selected.size}` : ""}</button>
      ${rejecting ? `<div class="note"><input id="reason" placeholder="Reason for the employee (optional)" /><button class="btn danger" id="confirmReject">Reject ${selected.size}</button></div>` : ""}
    </div>
    <ol class="list">${pending.map((e) => row(e, true)).join("")}</ol>`
    : `<div class="empty">Nothing waiting on you. 🎉</div>`;
  if (decided.length) el.innerHTML += `<div class="section">Recently decided</div><ol class="list">${decided.map((e) => row(e, false)).join("")}</ol>`;
}

// ------------------------------------------------------------ actions
async function refresh() {
  try { s = data(await app.callServerTool({ name: "show_expenses", arguments: { view: tab } })); render(); } catch { /* keep current */ }
}

async function decideSelected(decision: "approve" | "reject") {
  if (!selected.size || busy) return;
  busy = true; render();
  const ids = [...selected];
  const note = decision === "reject" ? (document.getElementById("reason") as HTMLInputElement | null)?.value || undefined : undefined;
  try {
    // A destructive tool: a good host asks the user before running it, even though the click came from here.
    s = data(await app.callServerTool({ name: "decide_expenses", arguments: { ids, decision, note } }));
    selected.clear(); rejecting = false;
    toast(s.notice ?? "Done");
    syncContext();
  } catch (e) {
    toast(e instanceof Error && /declin/i.test(e.message) ? "Cancelled" : "Couldn't update expenses");
  } finally {
    busy = false; render();
  }
}

async function ask(id: string) {
  const e = s?.approvals.find((x) => x.id === id);
  if (!e) return;
  try {
    await app.sendMessage({ role: "user", content: [{ type: "text", text:
      `${e.employee}'s ${e.merchant} expense (${money(e.amount, e.currency)}, ${e.description}) is flagged: ${e.flags.join("; ")}. Should I approve it?` }] });
  } catch { toast("Couldn't reach the chat"); }
}

function syncContext() {
  if (!s) return;
  const pending = s.approvals.filter((e) => e.status === "submitted");
  app.updateModelContext({ content: [{ type: "text", text:
    `ExpenseCo is open on "${tab}". ${pending.length} team expenses still waiting${selected.size ? `, ${selected.size} selected` : ""}. `
    + `${s.user} has ${s.mine.filter((e) => e.status === "submitted").length} of their own awaiting ${s.manager}.` }] }).catch(() => {});
}

document.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const tabBtn = t.closest<HTMLButtonElement>(".tabs button");
  if (tabBtn) { tab = tabBtn.dataset.tab as Tab; rejecting = false; render(); syncContext(); return; }
  if (t.id === "approve") return void decideSelected("approve");
  if (t.id === "reject") { rejecting = !rejecting; render(); (document.getElementById("reason") as HTMLInputElement | null)?.focus(); return; }
  if (t.id === "confirmReject") return void decideSelected("reject");
  if (t.dataset.ask) return void ask(t.dataset.ask);
  if (t.id === "all") {
    const pending = s!.approvals.filter((e) => e.status === "submitted");
    if ((t as HTMLInputElement).checked) pending.forEach((e) => selected.add(e.id)); else selected.clear();
    render(); return;
  }
  if (t.dataset.check) {
    (t as HTMLInputElement).checked ? selected.add(t.dataset.check) : selected.delete(t.dataset.check);
    render(); return;
  }
  const row = t.closest<HTMLElement>("#approvals .row[data-id]");
  if (row && !row.classList.contains("decided") && !t.closest("button")) {
    const id = row.dataset.id!;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    render();
  }
});

// ------------------------------------------------------------ lifecycle (handlers BEFORE connect)
app.ontoolinput = (p: any) => {
  const name = p?.toolName;
  const v = p?.arguments?.view;
  if (v === "approvals" || v === "mine") tab = v;
  if (p?.arguments?.decision) tab = "approvals";
  $("greeting").textContent = p?.arguments?.merchant ? `Filing ${p.arguments.merchant}…` : "Loading…";
  $(tab).innerHTML = `<div class="skel"></div><div class="skel"></div><div class="skel"></div>`;
  void name;
};
app.ontoolresult = (r: any) => {
  try {
    s = data(r);
    tab = s.view;
    render();
    syncContext();
  } catch (e) {
    $("greeting").textContent = "That action was cancelled.";
    $("sub").textContent = "";
    $(tab).innerHTML = "";
    void refresh();
  }
};
app.onhostcontextchanged = (ctx: any) => applyHost({ ...app.getHostContext(), ...ctx });
app.connect().then(() => applyHost(app.getHostContext())).catch((e) => console.error(e));
