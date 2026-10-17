"""Add a believable nightly price to every hotel in hotels.db.

The Kaggle dataset has no prices, so we synthesize them: a per-city base rate, scaled by
guest score (better hotels cost more), with a little per-hotel noise. The noise is seeded
from the hotel name, so the same hotel always gets the same price. Your CSV is never touched.

Usage: python enrich_prices.py [path/to/hotels.db]
"""
import hashlib
import math
import random
import sqlite3
import sys
from pathlib import Path

# (base nightly rate for a ~8.4-rated hotel, currency)
CITY_RATES = {
    "London": (190, "GBP"),
    "Paris": (200, "EUR"),
    "Amsterdam": (185, "EUR"),
    "Barcelona": (150, "EUR"),
    "Milan": (165, "EUR"),
    "Vienna": (135, "EUR"),
}


def price_for(name: str, city: str, score: float) -> tuple[int, str]:
    base, currency = CITY_RATES.get(city, (160, "EUR"))
    seed = int(hashlib.sha256(name.encode()).hexdigest()[:8], 16)
    noise = math.exp(random.Random(seed).gauss(0, 0.18))
    price = base * math.exp((score - 8.4) * 0.55) * noise
    return int(round(max(price, 55) / 5) * 5), currency


def enrich(db_path: Path) -> None:
    con = sqlite3.connect(db_path)
    cols = {r[1] for r in con.execute("PRAGMA table_info(hotels)")}
    if "price_per_night" not in cols:
        con.execute("ALTER TABLE hotels ADD COLUMN price_per_night INTEGER")
    if "currency" not in cols:
        con.execute("ALTER TABLE hotels ADD COLUMN currency TEXT")
    rows = con.execute("SELECT hotel_name, city, average_score FROM hotels").fetchall()
    con.executemany(
        "UPDATE hotels SET price_per_night = ?, currency = ? WHERE hotel_name = ?",
        [(*price_for(n, c, s), n) for n, c, s in rows],
    )
    con.commit()
    con.close()
    print(f"Priced {len(rows)} hotels in {db_path}")


if __name__ == "__main__":
    enrich(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "hotels.db")
