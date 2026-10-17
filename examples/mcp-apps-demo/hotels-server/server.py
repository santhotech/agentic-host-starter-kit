"""Hotels MCP server, v0: plain tools, no MCP Apps. The 'before' in the demo.

Run:  uv run --python 3.12 --with 'mcp>=2.3,<3' server.py   (stdio, for Claude Desktop)
"""
from typing import Literal, Optional

from mcp.server.mcpserver import MCPServer

import hotels_core as core
from hotels_core import City, TravelerType

mcp = MCPServer("hotels", instructions="Hotel search and guest reviews for London, Paris, Amsterdam, Barcelona, Milan and Vienna.")


@mcp.tool()
def search_hotels(city: City, min_score: float = 0.0, traveler_type: Optional[TravelerType] = None,
                  business_friendly: bool = False, sort_by: Literal["score", "popularity", "price"] = "score",
                  limit: int = 10, max_price: Optional[int] = None) -> dict:
    """Search hotels in one of six European cities.

    Scores are guest review averages out of 10. traveler_type ranks hotels popular with
    that kind of guest. business_friendly keeps hotels where at least 30% of stays were
    business trips. max_price caps the nightly rate (local currency: GBP in London, EUR elsewhere).
    Returns hotels with name, address, score, nightly price, review count and location.
    """
    return core.search_hotels(city, min_score, traveler_type, business_friendly, sort_by, limit, max_price)


@mcp.tool()
def get_hotel_details(hotel_name: str) -> dict:
    """Full profile for one hotel: location, score, who stays there, popular room types,
    score distribution, and a handful of recent positive and negative guest comments.
    hotel_name should match a name returned by search_hotels (partial names work)."""
    return core.get_hotel_details(hotel_name)


@mcp.tool()
def get_hotel_reviews(hotel_name: str, traveler_type: Optional[TravelerType] = None,
                      sentiment: Literal["all", "positive", "negative"] = "all", limit: int = 10) -> dict:
    """Recent individual guest reviews for a hotel, optionally filtered by traveler type
    and by sentiment (positive = reviewer score 8+, negative = under 6)."""
    return core.get_hotel_reviews(hotel_name, traveler_type, sentiment, limit)


if __name__ == "__main__":
    try:
        mcp.run()  # stdio: waits silently for a client, Ctrl+C to stop
    except KeyboardInterrupt:
        pass
