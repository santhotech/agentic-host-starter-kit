"""Hotels MCP server, v1: same data, now with an MCP App. The 'after' in the demo.

What changes vs server.py:
  * search_hotels is bound to a ui:// resource, so hosts that support MCP Apps render
    an interactive View instead of (well, alongside) the text result.
  * two app-only tools (visibility=["app"]) let the View drill down without the model
    in the loop. The model never sees them, so it won't call them by itself.
  * the plain get_hotel_details / get_hotel_reviews stay model-visible for follow-ups.

Run:  uv run --python 3.12 --with 'mcp>=2.3,<3' app_server.py   (stdio)
Rebuild the View after editing ui/src:  cd ui && npm install && npm run build
"""
from pathlib import Path
from typing import Literal, Optional

from typing_extensions import TypedDict

from mcp.server.apps import Apps
from mcp.server.mcpserver import MCPServer

import hotels_core as core
from hotels_core import City, TravelerType

# Typed returns => the SDK emits structuredContent (what the View reads) plus a JSON text
# block (what the model and non-Apps hosts read). A plain `dict` return gives text only.
class SearchOut(TypedDict):
    city: str
    filters: dict
    count: int
    hotels: list[dict]


class ProfileOut(TypedDict, total=False):
    hotel_name: str
    address: str
    city: str
    location: dict
    average_score: float
    total_reviews: int
    price_per_night: int | None
    currency: str | None
    business_trip_share: float | None
    traveler_mix: dict
    popular_rooms: list[dict]
    score_distribution: dict
    recent_positives: list[str]
    recent_negatives: list[str]
    error: str


class ReviewsOut(TypedDict):
    count: int
    reviews: list[dict]


VIEW_URI = "ui://hotels/explorer.html"
VIEW_HTML = (Path(__file__).parent / "ui" / "dist" / "explorer.html").read_text(encoding="utf-8")

apps = Apps()
apps.add_html_resource(
    VIEW_URI,
    VIEW_HTML,
    name="Hotel Explorer",
    description="Interactive hotel results: filters, map, details, shortlist",
    prefers_border=True,
)

# ---------- model-visible, renders the View ----------

@apps.tool(
    resource_uri=VIEW_URI,
    name="search_hotels",
    description=(
        "Search hotels in London, Paris, Amsterdam, Barcelona, Milan or Vienna, with nightly prices "
        "(GBP in London, EUR elsewhere; max_price caps the rate). "
        "Shows the user an interactive explorer where they can filter, open details, "
        "shortlist and pick a hotel, so keep your own reply short: one or two sentences "
        "on what stands out, no need to list every hotel."
    ),
)
def search_hotels(city: City, min_score: float = 0.0, traveler_type: Optional[TravelerType] = None,
                  business_friendly: bool = False, sort_by: Literal["score", "popularity", "price"] = "score",
                  limit: int = 12, max_price: Optional[int] = None) -> SearchOut:
    return core.search_hotels(city, min_score, traveler_type, business_friendly, sort_by, limit, max_price)


# ---------- app-only: the View calls these, the model never sees them ----------

@apps.tool(resource_uri=VIEW_URI, visibility=["app"], name="ui_hotel_profile",
           description="Hotel profile for the explorer's detail panel.")
def ui_hotel_profile(hotel_name: str) -> ProfileOut:
    return core.get_hotel_details(hotel_name)


@apps.tool(resource_uri=VIEW_URI, visibility=["app"], name="ui_hotel_reviews",
           description="Reviews for the explorer's review drawer.")
def ui_hotel_reviews(hotel_name: str, traveler_type: Optional[TravelerType] = None,
                     sentiment: Literal["all", "positive", "negative"] = "all", limit: int = 6) -> ReviewsOut:
    return core.get_hotel_reviews(hotel_name, traveler_type, sentiment, limit)


mcp = MCPServer(
    "hotels-app",
    instructions="Hotel search and guest reviews for six European cities, with an interactive explorer UI.",
    extensions=[apps],
)

# ---------- model-visible, plain (no UI): for follow-up questions ----------

@mcp.tool()
def get_hotel_details(hotel_name: str) -> dict:
    """Full profile for one hotel: traveler mix, popular rooms, score distribution, and
    recent positive and negative guest comments. Partial names work."""
    return core.get_hotel_details(hotel_name)


@mcp.tool()
def get_hotel_reviews(hotel_name: str, traveler_type: Optional[TravelerType] = None,
                      sentiment: Literal["all", "positive", "negative"] = "all", limit: int = 10) -> dict:
    """Recent individual guest reviews for a hotel, filterable by traveler type and
    sentiment (positive = reviewer score 8+, negative = under 6)."""
    return core.get_hotel_reviews(hotel_name, traveler_type, sentiment, limit)


if __name__ == "__main__":
    try:
        mcp.run()
    except KeyboardInterrupt:
        pass
