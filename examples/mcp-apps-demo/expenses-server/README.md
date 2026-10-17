# expenses-server: ExpenseCo

The second company in the demo. A TypeScript MCP server with an MCP App for filing and approving
expenses. It knows nothing about TravelCo: when you say "add the hotel to my expenses", the
**model** carries the hotel name and price across.

| Tool | Annotations | What it does |
|---|---|---|
| `show_expenses(view)` | read-only | Opens ExpenseCo on "My expenses" or "To approve" |
| `add_expense(...)` | **writes** | Files an expense (e.g. the hotel you just picked) and submits it to your manager |
| `decide_expenses(ids, decision, note)` | **destructive** | Approves / rejects team expenses. Irreversible |

The annotations are what the host keys on: anything that writes gets an approval card first.

Each result has two audiences: a short text summary for the model, the full state in
`structuredContent` for the View. See `src/server.ts`.

## Run

```bash
npm install
npm run build              # bundles dist/server.js and dist/expenses.html
npm run start:stdio        # stdio (Claude Desktop, the starter kit)
npm start                  # Streamable HTTP on http://localhost:4000/mcp (a "remote vendor")
npm run reset              # wipe and reseed the demo data. Do this before every rehearsal!
```

Needs Node 22.13+ (uses the built-in `node:sqlite`, nothing native to compile).

## Demo data

You're Sam. Your manager is Dana. Your team (Priya, Marcus, Elena, Jordan, Aisha) has six expenses
waiting on you, two of them flagged by policy (Marcus's New York hotel, Elena's team lunch).

Policy: hotels £300/night in London, $350/night in New York; meals $150 per receipt.
Pick Haymarket (£380/night) in the hotel demo and your own expense gets flagged too.

## Wire it up

Starter kit `mcp.json`:
```json
"expenses": { "command": "node", "args": ["--no-warnings", "/ABS/PATH/expenses-server/dist/server.js", "--stdio"] }
```

Claude Desktop: same, but use the absolute path to `node` (`which node`).
