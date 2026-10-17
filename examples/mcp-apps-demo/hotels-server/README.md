# hotels-server: the cold-open demo

Two MCP servers over the same data (Kaggle "515K Hotel Reviews Data in Europe":
1,492 hotels, ~387K reviews, London / Paris / Amsterdam / Barcelona / Milan / Vienna).

| File | Role |
|---|---|
| `server.py` | **Before.** Plain MCP tools, answers come back as text |
| `app_server.py` | **After.** Same tools + an MCP App: `search_hotels` renders the TravelCo Hotel Explorer |
| `hotels_core.py` | Shared SQL, used by both |
| `ui/` | The View: `src/` (TS/CSS/HTML) → `dist/explorer.html` (single file, SDK inlined) |
| `build_db.py` | One-time CSV → `hotels.db` |

## What the App shows off
- Filters (traveler type, min score, sort, business-friendly) re-query the server **directly** from the View. No model round-trip.
- App-only tools (`visibility=["app"]`): `ui_hotel_profile`, `ui_hotel_reviews`. The model never sees them.
- Mini map with no tiles: hotel positions plotted around the city center from lat/lng.
- **Choose / Compare with Claude**: `app.sendMessage` pushes the decision back into the chat (the next turn).
- **updateModelContext**: the model quietly knows the current filters, open hotel and shortlist.
- **Claude's take**: `app.createSamplingMessage`, model intelligence *inside* the UI (only if the host supports sampling).
- Host theming: picks up the host's light/dark theme and CSS variables; TravelCo keeps its own brand color.

## Claude Desktop config
```json
{
  "mcpServers": {
    "hotels": {
      "command": "/Users/santhosh/.local/bin/uv",
      "args": ["run", "--python", "3.12", "--with", "mcp>=2.3,<3",
               "/Users/santhosh/projects/mcp-apps-demo/hotels-server/server.py"]
    },
    "hotels-app": {
      "command": "/Users/santhosh/.local/bin/uv",
      "args": ["run", "--python", "3.12", "--with", "mcp>=2.3,<3",
               "/Users/santhosh/projects/mcp-apps-demo/hotels-server/app_server.py"]
    }
  }
}
```
Keep only one enabled per chat during the demo, or Claude may pick either server's `search_hotels`.

## Rebuild the View after editing ui/src
```bash
cd ui && npm install && npm run build
```
Then restart Claude Desktop (the HTML is read when the server starts).

## Demo prompts
- "Find me a hotel in London for a couple's weekend, close to the West End"
- then in the App: switch to Solo, slide the min score, open Details, shortlist two, Compare with Claude

## Notes
- Python MCP SDK 2.x (`MCPServer`, `mcp.server.apps.Apps`). Tools return TypedDicts so the View gets `structuredContent`.
- Dataset strips accents ("H tel" → shown as "Hôtel"). Reviews from 2015 to 2017. No prices.
