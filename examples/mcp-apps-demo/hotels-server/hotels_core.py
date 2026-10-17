"""Shared queries over hotels.db, used by both server.py (plain) and app_server.py (MCP App)."""
import sqlite3
from pathlib import Path
from typing import Literal, Optional

DB_PATH = Path(__file__).parent / "hotels.db"
City = Literal["London", "Paris", "Amsterdam", "Barcelona", "Milan", "Vienna"]
TravelerType = Literal[
    "Couple", "Solo traveler", "Group", "Family with young children",
    "Family with older children", "Travelers with friends",
]
TRAVELER_COL = {
    "Couple": "pct_couple",
    "Solo traveler": "pct_solo_traveler",
    "Group": "pct_group",
    "Family with young children": "pct_family_with_young_children",
    "Family with older children": "pct_family_with_older_children",
    "Travelers with friends": "pct_travelers_with_friends",
}


def _db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise RuntimeError(f"{DB_PATH} not found. Run: python build_db.py <path to hotels.csv>")
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def search_hotels(city, min_score=0.0, traveler_type=None, business_friendly=False,
                  sort_by="score", limit=10, max_price=None) -> dict:
    limit = max(1, min(limit, 25))
    where, params = ["city = ?", "average_score >= ?"], [city, min_score]
    if max_price:
        where.append("price_per_night <= ?")
        params.append(max_price)
    if business_friendly:
        where.append("pct_business >= 0.3")
    order = {"score": "average_score DESC, total_reviews DESC",
             "popularity": "total_reviews DESC",
             "price": "price_per_night ASC, average_score DESC"}.get(sort_by, "average_score DESC")
    mix_col = TRAVELER_COL.get(traveler_type) if traveler_type else None
    if mix_col:
        where.append(f"{mix_col} >= 0.25")
        if sort_by == "score":
            order = f"average_score DESC, {mix_col} DESC"
    sql = f"""
        SELECT hotel_name, address, city, average_score, total_reviews, price_per_night, currency,
               lat, lng, pct_business,
               pct_couple, pct_solo_traveler, pct_family_with_young_children, pct_travelers_with_friends
        FROM hotels WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?
    """
    with _db() as con:
        rows = [dict(r) for r in con.execute(sql, [*params, limit])]
    return {
        "city": city,
        "filters": {"min_score": min_score, "traveler_type": traveler_type,
                    "business_friendly": business_friendly, "sort_by": sort_by, "max_price": max_price},
        "count": len(rows),
        "hotels": rows,
    }


def get_hotel_details(hotel_name: str) -> dict:
    with _db() as con:
        hotel = con.execute(
            "SELECT * FROM hotels WHERE hotel_name = ? OR hotel_name LIKE ? "
            "ORDER BY hotel_name = ? DESC, total_reviews DESC LIMIT 1",
            (hotel_name, f"%{hotel_name}%", hotel_name),
        ).fetchone()
        if not hotel:
            return {"error": f"No hotel matching '{hotel_name}'"}
        name = hotel["hotel_name"]
        traveler_mix = {t: hotel[c] for t, c in TRAVELER_COL.items() if hotel[c]}
        rooms = [{"room_type": r[0], "stays": r[1]} for r in con.execute(
            "SELECT room_type, COUNT(*) n FROM reviews WHERE hotel_name = ? AND room_type IS NOT NULL "
            "GROUP BY room_type ORDER BY n DESC LIMIT 5", (name,))]
        dist = {r[0]: r[1] for r in con.execute(
            """SELECT CASE WHEN reviewer_score >= 9 THEN '9-10' WHEN reviewer_score >= 7 THEN '7-9'
                          WHEN reviewer_score >= 5 THEN '5-7' ELSE 'under 5' END b, COUNT(*)
               FROM reviews WHERE hotel_name = ? GROUP BY b""", (name,))}
        liked = [r[0] for r in con.execute(
            "SELECT positive_review FROM reviews WHERE hotel_name = ? AND length(positive_review) > 40 "
            "AND reviewer_score >= 8 ORDER BY review_date DESC LIMIT 5", (name,))]
        disliked = [r[0] for r in con.execute(
            "SELECT negative_review FROM reviews WHERE hotel_name = ? AND length(negative_review) > 40 "
            "AND lower(trim(negative_review)) NOT LIKE 'nothing%' AND lower(trim(negative_review)) NOT LIKE 'no complaint%' "
            "AND reviewer_score < 8.5 ORDER BY review_date DESC LIMIT 5", (name,))]
    return {
        "hotel_name": name,
        "address": hotel["address"],
        "city": hotel["city"],
        "location": {"lat": hotel["lat"], "lng": hotel["lng"]},
        "average_score": hotel["average_score"],
        "total_reviews": hotel["total_reviews"],
        "price_per_night": hotel["price_per_night"],
        "currency": hotel["currency"],
        "business_trip_share": hotel["pct_business"],
        "traveler_mix": traveler_mix,
        "popular_rooms": rooms,
        "score_distribution": dist,
        "recent_positives": liked,
        "recent_negatives": disliked,
    }


def get_hotel_reviews(hotel_name, traveler_type=None, sentiment="all", limit=10) -> dict:
    limit = max(1, min(limit, 30))
    where, params = ["hotel_name LIKE ?"], [f"%{hotel_name}%"]
    if traveler_type:
        where.append("traveler_type = ?")
        params.append(traveler_type)
    if sentiment == "positive":
        where.append("reviewer_score >= 8")
    elif sentiment == "negative":
        where.append("reviewer_score < 6")
    with _db() as con:
        rows = [dict(r) for r in con.execute(
            "SELECT hotel_name, review_date, reviewer_nationality, reviewer_score, traveler_type, "
            "trip_type, room_type, nights, positive_review, negative_review FROM reviews "
            f"WHERE {' AND '.join(where)} ORDER BY review_date DESC LIMIT ?", [*params, limit])]
    return {"count": len(rows), "reviews": rows}
