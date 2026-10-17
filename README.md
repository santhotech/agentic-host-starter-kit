# agentic-host-starter-kit

A starter kit for building **your own AI chat app that renders MCP Apps**.

Claude, ChatGPT, VS Code and a handful of others can render [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview):
interactive UIs that MCP servers ship alongside their tools. This kit gives you the same thing in an app
you own: connect any MCP servers, chat with Claude, and their apps render inline, sandboxed properly.

Clone it, point it at your servers, make it yours.

```
Browser                                  Backend (Node)                    MCP servers
┌───────────────────────────────┐ HTTP  ┌───────────────────────────┐
│ Chat UI (React)               │◄─────►│ Agent loop (Claude+tools) │──► hotels   (stdio, Python)
│ AppBridge per app             │  SSE  │ McpHub: 1 client/server   │──► expenses (HTTP, TS)
│   └ iframe on SANDBOX origin  │       │ reads mcp.json            │──► anything else
│       └ inner iframe = the App│       │ serves the sandbox page   │
└───────────────────────────────┘       └───────────────────────────┘
```

## Quick start

```bash
npm install
cp mcp.example.json mcp.json     # list your MCP servers (Claude Desktop format)
cp .env.example .env             # add ANTHROPIC_API_KEY
npm run dev                      # web on :5173, API on :8787, sandbox on :8788
```

Open http://localhost:5173. No API key yet? Set `LLM_PROVIDER=mock` in `.env` to click around with a scripted model.

Requires Node 22+.

## Configuring servers: `mcp.json`

Same shape as Claude Desktop's `claude_desktop_config.json`, so you can paste your existing config.

```json
{
  "mcpServers": {
    "hotels":   { "command": "uv", "args": ["run", "app_server.py"] },
    "expenses": { "url": "http://localhost:4000/mcp", "headers": { "Authorization": "Bearer ${EXPENSES_TOKEN}" } }
  }
}
```

- `command` / `args` / `env` / `cwd`: local server over stdio
- `url` / `headers`: remote server over Streamable HTTP (falls back to SSE)
- `${VAR}` is replaced from `.env`, so secrets stay out of the file
- `"disabled": true` skips a server

## Personalization: `profile.md`

Whatever is in `profile.md` goes into the agent's system prompt. Standing preferences live here
("boutique hotels, up to £300 a night") so the agent doesn't ask twenty questions.

## What's in the box

| Path | What it does |
|---|---|
| `core/` | **Framework-free** host logic. `HostApi` (talks to the backend), `mountApp()` (sandbox + AppBridge wiring). Use it from React, Vue, Angular or plain JS |
| `server/src/mcp.ts` | `McpHub`: one MCP client per server, namespaced tools for the model, hides app-only tools, routes app tool calls back to the right server |
| `server/src/agent.ts` | The agent loop: Claude → tool calls → Claude. Emits an `app` event when a tool has a UI |
| `server/src/llm/` | Provider interface + Anthropic implementation + a mock for tests |
| `server/src/sandbox/` | The sandbox origin: proxy page + CSP built from the app's `_meta.ui.csp`, sent as an HTTP header |
| `web/` | React chat shell. Deliberately thin |
| `scripts/e2e-hotels.mjs` | Headless-browser smoke test against the hotels example |

## How an app renders

1. Claude calls a tool whose definition has `_meta.ui.resourceUri`.
2. The backend runs it and streams an `app` event (tool input + result) to the browser.
3. `mountApp()` fetches the `ui://` HTML, loads the **sandbox proxy on a different origin**,
   hands it the HTML, and connects an `AppBridge`.
4. The app gets its input and result, renders, and from then on:
   - **app → tool calls** go app → bridge → *your backend* → the app's own server. Never directly.
   - **app → chat messages** show a confirm bar before they're sent.
   - **app → model context** is held and attached to your next message.

## Security notes

- Apps run in an iframe on a **separate origin** (port 8788 locally). They can't read your page, cookies or storage.
  The proxy checks this at startup and refuses to run if isolation is broken.
- The app's CSP comes from what the server declared, applied as an **HTTP header** the app can't change.
- An app can only call tools on **its own** server, and only tools whose visibility includes `"app"`.
  The model never sees tools marked app-only.
- Messages an app wants to post into the chat need the user's OK.
- Not yet: OAuth to MCP servers, per-tool approval for destructive actions, multi-user. See roadmap.

The sandbox pattern and CSP rules are adapted from the official
[ext-apps basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host).

## Production

`npm start` builds the web app and serves it from the API port. Put the sandbox on a **different
domain or subdomain** (e.g. `sandbox.yourapp.com`), set `SANDBOX_URL` and `ALLOWED_HOST_ORIGINS`.

## Roadmap

- [ ] Approval prompts for destructive tools (`destructiveHint`), from the model or an app
- [ ] OAuth for remote MCP servers
- [ ] Persist conversations
- [ ] More providers (Bedrock, OpenAI, local)
- [ ] Fullscreen display mode

## License

Apache-2.0
