import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HostApi, type AppInstance, type AppMessage, type AppContextUpdate, type ApprovalRequest, type ChatEvent, type ServerSummary } from "@agentic-host/core";
import { AppView } from "./AppView.tsx";

type Item =
  | { kind: "user"; id: string; text: string; fromApp?: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; server: string; tool: string; status: "running" | "ok" | "error" | "declined" }
  | { kind: "approval"; id: string; request: ApprovalRequest; state: "pending" | "allowed" | "declined" }
  | { kind: "app"; id: string; app: AppInstance }
  | { kind: "error"; id: string; text: string };

/** Something an app wants to do that the HOST asks the user about. */
type PendingAppAction =
  | { kind: "message"; text: string; app: AppInstance; resolve: (ok: boolean) => void }
  | { kind: "tool"; request: Omit<ApprovalRequest, "id">; app: AppInstance; resolve: (ok: boolean) => void };

/** Turn tool arguments into a few readable lines for an approval prompt. */
function describe(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const cur = typeof input.currency === "string" ? input.currency : undefined;
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || k === "currency") continue;
    let text: string;
    if (Array.isArray(v)) text = `${v.length} item${v.length === 1 ? "" : "s"}`;
    else if (k === "amount" && typeof v === "number" && cur) text = new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(v);
    else if (typeof v === "object") text = JSON.stringify(v);
    else text = String(v);
    out.push(`${k.replace(/_/g, " ")}: ${text.length > 80 ? text.slice(0, 77) + "…" : text}`);
  }
  return out;
}

function ApprovalCard(props: { request: Omit<ApprovalRequest, "id">; state?: "pending" | "allowed" | "declined"; onAnswer: (ok: boolean) => void }) {
  const { request, state = "pending" } = props;
  return (
    <div className={`approval ${request.destructive ? "destructive" : ""} ${state}`} role="group" aria-label="Approval needed">
      <div className="approval-head">
        <span className="approval-icon">{request.destructive ? "!" : "✎"}</span>
        <div>
          <b>{request.origin === "app" ? `${request.server} app` : "Claude"} wants to {request.title ? request.title.toLowerCase() : request.tool}</b>
          <div className="muted">{request.server} · {request.tool}{request.destructive ? " · can't be undone" : " · makes a change"}</div>
        </div>
      </div>
      <ul>{describe(request.input).map((l) => <li key={l}>{l}</li>)}</ul>
      {state === "pending" ? (
        <div className="consent-actions">
          <button className="ghost" onClick={() => props.onAnswer(false)}>Deny</button>
          <button className="primary" onClick={() => props.onAnswer(true)}>Allow</button>
        </div>
      ) : <div className="approval-state">{state === "allowed" ? "Allowed" : "Denied"}</div>}
    </div>
  );
}

const uid = () => Math.random().toString(36).slice(2);
const SUGGESTIONS = [
  "Find me a hotel in London for a couple's weekend",
  "Business-friendly hotels in Paris under €250",
];

function useTheme(): "light" | "dark" {
  const q = window.matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(q.matches);
  useEffect(() => {
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [q]);
  return dark ? "dark" : "light";
}

export function App() {
  const api = useMemo(() => new HostApi(), []);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const theme = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [cfg, setCfg] = useState<{ sandboxUrl: string; model: string } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAppAction | null>(null);
  // Latest model context per open app (only the last update per app is kept, like Claude does).
  const appContext = useRef(new Map<string, string>());
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.servers().then(setServers).catch(() => setServers([]));
    fetch("/api/config").then((r) => r.json()).then(setCfg).catch(() => {});
  }, [api]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [items.length, pending]);

  const send = useCallback(async (text: string, fromApp?: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setItems((xs) => [...xs, { kind: "user", id: uid(), text, fromApp }]);
    const ctx = [...appContext.current.values()];
    let assistantId: string | null = null;
    try {
      for await (const e of api.chat(sessionId, text, ctx) as AsyncGenerator<ChatEvent>) {
        if (e.type === "text") {
          setItems((xs) => {
            const last = xs[xs.length - 1];
            if (last?.kind === "assistant" && last.id === assistantId) {
              return [...xs.slice(0, -1), { ...last, text: last.text + e.delta }];
            }
            assistantId = uid();
            return [...xs, { kind: "assistant", id: assistantId, text: e.delta }];
          });
        } else if (e.type === "tool_call") {
          assistantId = null;
          setItems((xs) => [...xs, { kind: "tool", id: e.id, server: e.server, tool: e.tool, status: "running" }]);
        } else if (e.type === "approval_request") {
          setItems((xs) => [...xs, { kind: "approval", id: e.request.id, request: e.request, state: "pending" }]);
        } else if (e.type === "tool_result") {
          setItems((xs) => xs.map((x) => (x.kind === "tool" && x.id === e.id ? { ...x, status: e.declined ? "declined" : e.isError ? "error" : "ok" } : x)));
        } else if (e.type === "app") {
          assistantId = null;
          setItems((xs) => [...xs, { kind: "app", id: e.app.id, app: e.app }]);
        } else if (e.type === "error") {
          setItems((xs) => [...xs, { kind: "error", id: uid(), text: e.message }]);
        }
      }
    } catch (err) {
      setItems((xs) => [...xs, { kind: "error", id: uid(), text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setBusy(false);
    }
  }, [api, busy, sessionId]);

  // An app wants to post into the chat: ask the user first (light consent).
  const onAppMessage = useCallback((msg: AppMessage, app: AppInstance) => {
    const text = (msg.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    return new Promise<boolean>((resolve) => setPending({ kind: "message", text, app, resolve }));
  }, []);

  // An app wants to run a tool that writes. The host asks, because it can't trust clicks inside the iframe.
  const onAppApproval = useCallback((request: Omit<ApprovalRequest, "id">, app: AppInstance) =>
    new Promise<boolean>((resolve) => setPending({ kind: "tool", request, app, resolve })), []);

  const answerModelApproval = useCallback(async (id: string, ok: boolean) => {
    setItems((xs) => xs.map((x) => (x.kind === "approval" && x.id === id ? { ...x, state: ok ? "allowed" : "declined" } : x)));
    try { await api.answerApproval(id, ok); } catch { /* turn already ended */ }
  }, [api]);

  const onAppContext = useCallback((ctx: AppContextUpdate | null, app: AppInstance) => {
    const text = (ctx?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    if (text) appContext.current.set(app.id, `[${app.server}] ${text}`);
    else appContext.current.delete(app.id);
  }, []);

  const decide = (ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
    if (ok && pending.kind === "message") void send(pending.text, pending.app.server);
  };

  const connected = servers.filter((s) => s.status === "connected");

  return (
    <div className="shell">
      <header className="top">
        <div className="brand"><span className="mark" />Agentic Host</div>
        <div className="servers">
          {servers.map((s) => (
            <span key={s.name} className={`pill ${s.status}`} title={s.error ?? `${s.tools.length} tools`}>
              <i />{s.name}
            </span>
          ))}
          {cfg ? <span className="pill model">{cfg.model}</span> : null}
        </div>
      </header>

      <main className="thread">
        {items.length === 0 ? (
          <div className="empty">
            <h1>What can I help with?</h1>
            <p className="muted">{connected.length} MCP server{connected.length === 1 ? "" : "s"} connected. Apps from any of them render right here.</p>
            <div className="suggest">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : null}

        {items.map((it) => {
          switch (it.kind) {
            case "user":
              return <div key={it.id} className="msg user">{it.fromApp ? <span className="via">via {it.fromApp}</span> : null}{it.text}</div>;
            case "assistant":
              return <div key={it.id} className="msg assistant">{it.text}</div>;
            case "tool":
              return <div key={it.id} className={`tool ${it.status}`}><i />{it.server} · {it.tool}<span>{it.status === "running" ? "running…" : it.status === "ok" ? "done" : it.status === "declined" ? "declined" : "failed"}</span></div>;
            case "approval":
              return <ApprovalCard key={`a-${it.id}`} request={it.request} state={it.state} onAnswer={(ok) => answerModelApproval(it.id, ok)} />;
            case "app":
              return cfg ? (
                <AppView key={it.id} app={it.app} api={api} sandboxUrl={cfg.sandboxUrl} theme={theme}
                  onMessage={onAppMessage} onContextUpdate={onAppContext} onApprovalRequest={onAppApproval} />
              ) : null;
            case "error":
              return <div key={it.id} className="msg error">{it.text}</div>;
          }
        })}
        {busy && items[items.length - 1]?.kind !== "assistant" ? <div className="typing"><i /><i /><i /></div> : null}
        <div ref={bottom} />
      </main>

      <footer className="composer-wrap">
        {pending?.kind === "message" ? (
          <div className="consent" role="dialog" aria-label="App wants to send a message">
            <div><b>{pending.app.server}</b> wants to send this to the chat:</div>
            <blockquote>{pending.text}</blockquote>
            <div className="consent-actions">
              <button className="ghost" onClick={() => decide(false)}>Dismiss</button>
              <button className="primary" onClick={() => decide(true)}>Send</button>
            </div>
          </div>
        ) : null}
        {pending?.kind === "tool" ? <ApprovalCard request={pending.request} onAnswer={decide} /> : null}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); const t = input; setInput(""); void send(t); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" disabled={busy} aria-label="Message" />
          <button className="primary" disabled={busy || !input.trim()}>Send</button>
        </form>
      </footer>
    </div>
  );
}
