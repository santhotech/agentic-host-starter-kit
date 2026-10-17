"""One-time: convert the Kaggle '515K Hotel Reviews in Europe' CSV into SQLite.

Usage: python build_db.py ~/Downloads/hotels.csv
"""
import ast
import sqlite3
import sys
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).parent / "hotels.db"

CITY_BY_COUNTRY = {
    "Kingdom": ("London", "United Kingdom"),
    "France": ("Paris", "France"),
    "Netherlands": ("Amsterdam", "Netherlands"),
    "Spain": ("Barcelona", "Spain"),
    "Italy": ("Milan", "Italy"),
    "Austria": ("Vienna", "Austria"),
}
TRAVELER_TYPES = {
    "Couple", "Solo traveler", "Group", "Family with young children",
    "Family with older children", "Travelers with friends",
}
SKIP_TAGS = {"Submitted from a mobile device", "With a pet"}


def parse_tags(raw: str) -> dict:
    out = {"trip_type": None, "traveler_type": None, "room_type": None, "nights": None}
    try:
        tags = [t.strip() for t in ast.literal_eval(raw)]
    except (ValueError, SyntaxError):
        return out
    for t in tags:
        if t.endswith("trip"):
            out["trip_type"] = t
        elif t in TRAVELER_TYPES:
            out["traveler_type"] = t
        elif t.startswith("Stayed "):
            try:
                out["nights"] = int(t.split()[1])
            except (IndexError, ValueError):
                pass
        elif t in SKIP_TAGS or t.endswith(("room", "rooms")) and t[0].isdigit():
            continue
        elif out["room_type"] is None:
            out["room_type"] = t
    return out


def clean_text(s, placeholder):
    s = str(s).strip()
    return "" if s in (placeholder, "nan") else s


def main(csv_path: str) -> None:
    print(f"Reading {csv_path} ...")
    df = pd.read_csv(csv_path)
    country_key = df["hotel_address"].str.split().str[-1]
    df["city"] = country_key.map(lambda k: CITY_BY_COUNTRY.get(k, (None, None))[0])
    df["country"] = country_key.map(lambda k: CITY_BY_COUNTRY.get(k, (None, None))[1])
    df["review_date"] = pd.to_datetime(df["review_date"], format="%m/%d/%Y").dt.date.astype(str)
    df["positive_review"] = df["positive_review"].map(lambda s: clean_text(s, "No Positive"))
    df["negative_review"] = df["negative_review"].map(lambda s: clean_text(s, "No Negative"))
    df["reviewer_nationality"] = df["reviewer_nationality"].astype(str).str.strip()

    print("Parsing tags ...")
    tags = pd.DataFrame(df["tags"].map(parse_tags).tolist(), index=df.index)
    df = pd.concat([df, tags], axis=1)

    reviews = df[[
        "hotel_name", "review_date", "reviewer_nationality", "reviewer_score",
        "positive_review", "negative_review", "trip_type", "traveler_type",
        "room_type", "nights",
    ]]

    print("Aggregating hotels ...")
    g = df.groupby("hotel_name")
    hotels = g.agg(
        address=("hotel_address", "first"),
        city=("city", "first"),
        country=("country", "first"),
        lat=("lat", "first"),
        lng=("lng", "first"),
        average_score=("average_score", "first"),
        total_reviews=("total_number_of_reviews", "max"),
        reviews_in_dataset=("reviewer_score", "size"),
        latest_review=("review_date", "max"),
    ).reset_index()
    # Share of reviews per traveler / trip type, used for "good for couples" style filters
    mix = (
        df.pivot_table(index="hotel_name", columns="traveler_type", values="reviewer_score",
                       aggfunc="size", fill_value=0)
    )
    mix = mix.div(mix.sum(axis=1), axis=0).round(3)
    mix.columns = ["pct_" + c.lower().replace(" ", "_") for c in mix.columns]
    biz = (df["trip_type"] == "Business trip").groupby(df["hotel_name"]).mean().round(3).rename("pct_business")
    hotels = hotels.merge(mix, left_on="hotel_name", right_index=True, how="left")
    hotels = hotels.merge(biz, left_on="hotel_name", right_index=True, how="left")

    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    hotels.to_sql("hotels", con, index=False)
    reviews.to_sql("reviews", con, index=False, chunksize=50_000)
    con.executescript("""
        CREATE INDEX idx_hotels_city ON hotels(city);
        CREATE INDEX idx_reviews_hotel ON reviews(hotel_name, review_date);
        VACUUM;
    """)
    con.close()
    print(f"Wrote {DB_PATH}: {len(hotels)} hotels, {len(reviews)} reviews")
    from enrich_prices import enrich
    enrich(DB_PATH)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / "Downloads" / "hotels.csv"))
