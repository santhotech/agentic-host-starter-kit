<div align="center">

# agentic-host-starter-kit

**Build your own AI chat host that renders MCP Apps.**

Connect any MCP servers, chat with Claude, and let their interactive UIs render inline,
securely sandboxed, in an app you own.

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![MCP Apps](https://img.shields.io/badge/MCP%20Apps-2026--01--26-6E56CF)

</div>

---

## Why this exists

[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) is the first official extension to the
Model Context Protocol. It lets an MCP server ship an **interactive UI with its tools**: a hotel picker, an
approval queue, a chart. The host renders it right inside the conversation instead of a wall of text.

Today, those UIs only render inside a handful of big hosts: Claude, ChatGPT, VS Code, Cursor, M365 Copilot
and a few dev tools. If you want them inside **your own product** (a vertical assistant, an internal copilot,
a customer-facing agent), you start from scratch: an MCP client per server, an agent loop, a sandbox on a
separate origin, the AppBridge handshake, CSP, consent for actions that change things...

**This kit is that scaffolding, done properly, in a codebase small enough to read in an afternoon.**
Clone it, point it at your servers, make it yours.

### What it solves

| Without it | With it |
|---|---|
| MCP Apps only render in someone else's chat app | They render in yours |
| Hand-rolled iframes on your own origin (an app can read your cookies) | Double-iframe sandbox on a **separate origin**, CSP sent as an HTTP header |
| Apps calling servers directly from the browser | Every app tool call goes **through your backend**, only to the app's own server |
| Agents quietly doing things with side effects | Tools that write need the user's OK, whether the **model** or an **app** asked |
| One-off integrations per vendor | Any MCP server, Claude Desktop config format, stdio or HTTP |

---

## Features

- 🔌 **Any MCP server.** `mcp.json` uses the same shape as Claude Desktop's config: paste yours in. Local
  (stdio) and remote (Streamable HTTP, SSE fallback) servers, `${ENV}` secrets.
- 🧠 **Agent loop.** Claude plans, calls tools across servers, and keeps going until it's done. Streams to the browser.
- 🪟 **MCP Apps rendering.** Tools with `_meta.ui.resourceUri` render their View inline, wired with the official
  `AppBridge`: tool input and result, app → tool calls, app → chat messages, model context updates, theming, auto-resize.
- 🔒 **Real sandboxing.** Apps run two iframes deep on their own origin. The proxy refuses to start if isolation is broken.
- ✅ **Approvals.** Tools annotated `readOnlyHint: false` or `destructiveHint: true` get an approval card,
  for actions the model starts *and* actions apps start. The host asks, not the app.
- 👁️ **App-only tools.** Tools with `visibility: ["app"]` are callable from Views but hidden from the model.
- 👤 **Profile.** `profile.md` goes into the system prompt so the agent knows your preferences up front.
- 🧩 **Framework-free core.** All host logic lives in plain TypeScript (`core/`). The React UI is a thin shell; bring Vue, Angular or vanilla.
- 🧪 **Testable offline.** A mock model plus headless-browser end-to-end tests. No API key needed to develop.

---

## Architecture

```
 Browser (your app, :5173)                    Backend (Node, :8787)                  MCP servers
┌──────────────────────────────────┐  HTTP  ┌──────────────────────────────┐
│ Chat UI (React)                  │◄──────►│ Agent loop (Claude + tools)  │───► hotels    (stdio, Python)
│ approvals · consent · status     │  SSE   │ McpHub: 1 client per server  │───► expenses  (stdio or HTTP, TS)
│                                  │        │ approval policy              │───► your server
│ AppBridge (one per app) ─────────┼──┐     │ reads mcp.json + profile.md  │
└──────────────────────────────────┘  │     └──────────────────────────────┘
                                       │     ┌──────────────────────────────┐
                    postMessage        └────►│ Sandbox origin (:8788)       │
                    (JSON-RPC)               │  proxy page + CSP header     │
                                             │   └ inner iframe = the View  │
                                             └──────────────────────────────┘
```

**Why a backend?** API keys can't live in the browser, browsers can't spawn local servers, many remote
servers don't allow CORS, and OAuth needs secrets. So the MCP clients live server-side, and the browser's
AppBridge is created with `client = null` and forwards everything to the backend.

---

## Quick start

```bash
git clone https://github.com/<you>/agentic-host-starter-kit
cd agentic-host-starter-kit
npm install
cp mcp.example.json mcp.json      # list your MCP servers
cp .env.example .env              # add ANTHROPIC_API_KEY (or set LLM_PROVIDER=mock)
npm run dev
```

Open **http://localhost:5173**. Requires Node 22+.

| Port | What |
|---|---|
| 5173 | Web app (Vite dev server, proxies `/api`) |
| 8787 | Backend API: agent, MCP connections |
| 8788 | Sandbox origin: where apps run. **Must** differ from the web app's origin |

---

## What's in the repo

```
agentic-host-starter-kit/
├── core/                         Framework-free host logic (use from any UI framework)
│   └── src/
│       ├── protocol.ts           Wire types: ChatEvent, AppInstance, ApprovalRequest
│       ├── api.ts                HostApi: chat stream, app tool calls, approvals
│       ├── app-frame.ts          mountApp(): sandbox iframe + AppBridge + approval hook
│       └── index.ts
├── server/                       Node backend
│   └── src/
│       ├── index.ts              HTTP API: /api/chat (SSE), /api/apps/*, /api/approvals/:id
│       ├── config.ts             mcp.json loading, ${ENV} expansion, profile.md
│       ├── mcp.ts                McpHub: connections, namespaced tools, visibility, approval policy
│       ├── agent.ts              Agent loop, app events, approval gating
│       ├── llm/
│       │   ├── types.ts          Provider interface
│       │   ├── anthropic.ts      Claude (streaming)
│       │   └── mock.ts           Scripted model for tests and offline UI work
│       └── sandbox/
│           ├── server.ts         Sandbox origin + CSP builder
│           ├── proxy.html
│           └── proxy.js          Outer iframe: origin checks, isolation self-test, message relay
├── web/                          React chat shell (thin on purpose)
│   └── src/
│       ├── App.tsx               Thread, tool chips, approval cards, consent bar
│       ├── AppView.tsx           React wrapper around core's mountApp()
│       └── styles.css
├── scripts/
│   ├── e2e-hotels.mjs            Smoke test: an app renders, isolation holds, app tool calls route
│   └── e2e-demo.mjs              Full flow: pick a hotel → expense it → batch-approve
├── mcp.example.json              Server config (Claude Desktop format)
├── profile.md                    User preferences added to the system prompt
├── .env.example                  Provider, model, ports, allowed origins
└── LICENSE                       Apache-2.0
```

---

## Configuration

### `mcp.json`

```json
{
  "mcpServers": {
    "hotels":   { "command": "uv", "args": ["run", "/path/to/hotels-server/app_server.py"] },
    "expenses": { "url": "http://localhost:4000/mcp", "headers": { "Authorization": "Bearer ${EXPENSES_TOKEN}" } },
    "old-one":  { "command": "node", "args": ["server.js"], "disabled": true }
  }
}
```

| Field | Meaning |
|---|---|
| `command`, `args`, `env`, `cwd` | Local server over stdio |
| `url`, `headers` | Remote server over Streamable HTTP (falls back to SSE) |
| `${VAR}` | Replaced from `.env`, so secrets stay out of the file |
| `disabled` | Skip this server |

### `.env`

| Variable | Default | |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `mock` runs a scripted model, no key needed |
| `ANTHROPIC_API_KEY` | | Required for `anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Any Claude model id your key can use |
| `HOST_PORT` / `SANDBOX_PORT` / `WEB_PORT` | `8787` / `8788` / `5173` | |
| `ALLOWED_HOST_ORIGINS` | localhost, any port | Origins allowed to embed the sandbox (set this in production) |

### `profile.md`

Standing preferences ("boutique hotels, up to £300 a night") that go into the system prompt, so the agent
doesn't open with twenty questions.

---

## How an MCP App renders here

1. Claude calls a tool whose definition has `_meta.ui.resourceUri`.
2. The backend runs it. The **text** result goes to Claude; the **full** result is streamed to the browser as an `app` event.
3. `mountApp()` fetches the `ui://` HTML (`resources/read`), loads the sandbox proxy on the sandbox origin with the
   app's CSP, connects an `AppBridge`, and hands over the HTML.
4. The View boots, completes the `ui/initialize` handshake, then receives `tool-input` and `tool-result`
   and renders. **The View blends template and data, in the browser.** The model never sees the HTML.
5. From then on:

| The View calls | Path | Model involved? |
|---|---|---|
| `app.callServerTool()` | View → bridge → backend → the View's own server | No: instant |
| `app.sendMessage()` | View → bridge → consent bar → next chat turn | Yes |
| `app.updateModelContext()` | View → bridge → held, attached to the next turn | Quietly |

---

## Security model

**What the host enforces:**
- **Origin isolation.** Views run on the sandbox origin, two iframes deep. They can't touch your DOM, cookies
  or storage. The proxy verifies this at startup and refuses to run otherwise.
- **CSP from the server's declaration** (`_meta.ui.csp`), sent as an **HTTP header** the View can't alter.
  Deny-by-default for anything undeclared.
- **Scoped tool calls.** A View can only call tools on **its own** server, and only ones visible to apps.
  App-only tools never reach the model.
- **Consent.** Messages a View wants to post need the user's OK. Tools that declare they write
  (`readOnlyHint: false`) or destroy (`destructiveHint: true`) need approval, from the model or from a View.
  Tools that declare nothing run freely, **so annotate your write tools.**

**Still on you:** which servers you trust, auth to remote servers (see roadmap), and what data you let flow
between apps from different vendors.

---

## Extending it

- **Use a different UI framework:** import `mountApp` and `HostApi` from `core/` and render however you like.
  `web/src/AppView.tsx` is the whole React integration, in one small file.
- **Add a model provider:** implement `LlmProvider` in `server/src/llm/types.ts` (one method: `turn()`).
  Messages use Anthropic's block format as the common shape; adapt at the edge.
- **Change the approval rules:** `McpHub.approvalPolicy()` in `server/src/mcp.ts`.
- **Build an MCP App server for it:** any server using the official
  [ext-apps SDK](https://github.com/modelcontextprotocol/ext-apps) (TypeScript) or the Python MCP SDK's
  `mcp.server.apps` works. Return typed results so the View gets `structuredContent`, keep the model-facing
  text short, and annotate tools that change things.

### Example servers

Two companion servers built alongside this kit show the full story: two companies, two languages, zero integration.

| Server | Stack | Shows off |
|---|---|---|
| **TravelCo hotels** | Python, MCP SDK 2.x, SQLite | Filters that re-query without the model, a tile-free map, app-only drill-down tools, Choose/Compare messages into the chat |
| **ExpenseCo** | TypeScript, ext-apps SDK, `node:sqlite` | "My expenses" / "To approve" tabs, policy flags, a write tool and a destructive tool, batch approval with one host confirm |

Ask for the hotel you want, pick it in TravelCo, say *"add it to my expenses"*, and the model carries the
hotel and price into ExpenseCo. Neither server knows the other exists.

---

## Testing

```bash
LLM_PROVIDER=mock npm run dev          # in one terminal
npx playwright install chromium        # once
npm run test:e2e                       # hotels: render, isolation, routing
node scripts/e2e-demo.mjs              # full flow: hotel → expense (approval) → batch approve
npm run typecheck
```

---

## Production notes

`npm start` builds the web app and serves it from the API port. Put the sandbox on a **different domain or
subdomain** (e.g. `sandbox.yourapp.com`), and set `SANDBOX_URL` and `ALLOWED_HOST_ORIGINS`. v1 keeps
conversations in memory and is single-user. See the roadmap before putting real users on it.

---

## Roadmap

**Next**
- [ ] OAuth 2.1 for remote MCP servers
- [ ] Bring the example servers into `examples/`
- [ ] Persisted conversations (pluggable store)
- [ ] More providers: Amazon Bedrock, OpenAI, local models

**Later**
- [ ] Fullscreen display mode
- [ ] **App Tools**: let the agent operate an open View instead of rendering a new one (tracks the spec proposal)
- [ ] Server catalog and per-deployment branding, for vertical hosts
- [ ] Multi-user sessions and an audit log of approvals
- [ ] A Vue / vanilla example alongside React

Done: ✅ approvals for tools that write, from the model and from apps

---

## Acknowledgements

The sandbox proxy and CSP rules are adapted from the official
[ext-apps basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) example.
MCP Apps grew out of MCP-UI and the OpenAI Apps SDK, and is maintained by the MCP community.

## License

[Apache-2.0](LICENSE)
