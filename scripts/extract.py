#!/usr/bin/env python3
"""
Extracts Overture Maps data around one or more F1 circuits and writes small,
web-ready JSON files into web/data. Automatically discovers the latest
available Overture release via their STAC catalog rather than hardcoding a
date, since Overture only keeps the last two monthly releases public.

Run locally (needs internet access to Overture's S3-hosted GeoParquet):
    pip install duckdb
    python scripts/extract.py --circuit suzuka
    python scripts/extract.py --all

This same script is what the GitHub Action in .github/workflows/extract-data.yml
runs automatically on GitHub's servers, so you never need to run it yourself
unless you're adding a new circuit or want fresher data.
"""

import argparse
import json
import math
import os

import duckdb

def get_latest_release(con):
    """Overture only keeps the last two monthly releases in its public buckets,
    so hardcoding a release date will eventually 404. Ask their STAC catalog
    for whatever the current latest actually is instead."""
    row = con.execute(
        "SELECT latest FROM 'https://stac.overturemaps.org/catalog.json'"
    ).fetchone()
    return row[0]

HERE = os.path.dirname(os.path.abspath(__file__))
CIRCUITS_PATH = os.path.join(HERE, "circuits.json")
# Written straight into web/data so the static site can fetch it with no
# build step. scripts/circuits.json (the config, with bbox_km) and
# web/data/circuits.json (the generated picker index) are deliberately
# different files with the same base name — one is input, one is output.
DATA_DIR = os.path.join(HERE, "..", "web", "data")

# Categories pulled from the Overture places `categories.primary` taxonomy.
HOTEL_CATEGORIES = ["hotel", "motel", "resort", "bed_and_breakfast", "hostel"]
FOOD_CATEGORIES_MAP = {
    "restaurant": ["restaurant"],
    "cafe": ["cafe", "coffee_shop"],
    "fast_food": ["fast_food", "fast_food_restaurant"],
    "bar": ["bar", "pub", "sports_bar"],
}

# Straight-line distance thresholds for the access tier shown in the UI.
# Defined in miles, converted to km for comparison against extracted distances.
# Walkable      : ≤ 1 mile  (1.609 km) — on foot in ~20 min, no transport needed
# Short Transfer: ≤ 6 miles (9.656 km) — quick rideshare/taxi, ~20 min on race day
# Long Transfer : > 6 miles — plan transport carefully; road closures can add time
WALKABLE_KM = 1.609        # 1 mile
SHORT_TRANSFER_KM = 9.656  # 6 miles
# anything beyond SHORT_TRANSFER_KM is "Long Transfer"

# Transit stops live in Overture's base theme (infrastructure type, transit
# subtype), NOT the places theme — Overture deliberately excludes bus stops,
# platforms, and similar waypoints from places, since a place must be a
# destination. See https://docs.overturemaps.org/guides/base/infrastructure/
# Excludes parking-related classes (parking, parking_space, bicycle_parking,
# parking_entrance, motorcycle_parking, bicycle_rental) since those aren't
# meaningfully "transit" from a traveler's perspective.
TRANSIT_CLASSES = [
    "bus_stop",
    "bus_station",
    "platform",
    "stop_position",
    "railway_station",
    "railway_halt",
    "ferry_terminal",
    "subway_station",
]
TRANSIT_LABELS = {
    "bus_stop": "Bus stop",
    "bus_station": "Bus station",
    "platform": "Platform",
    "stop_position": "Stop",
    "railway_station": "Train station",
    "railway_halt": "Train halt",
    "ferry_terminal": "Ferry terminal",
    "subway_station": "Metro station",
}

# Overture places below this confidence score get dropped. Overture aggregates
# places from multiple providers without manual verification, so low-confidence
# matches sometimes carry garbage names (e.g. an unrelated string or domain-like
# text where a business name should be). We found a real example scoring 0.77,
# so the threshold sits comfortably above that. Still a judgment call, not
# an Overture-defined "correct" cutoff — see README.
MIN_CONFIDENCE = 0.8


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def access_tier(distance_km):
    if distance_km <= WALKABLE_KM:
        return "Walkable"
    if distance_km <= SHORT_TRANSFER_KM:
        return "Short Transfer"
    return "Long Transfer"


def bbox_around(lat, lng, km):
    # Rough degree-per-km conversion, fine at this precision for a bounding box filter.
    dlat = km / 111.0
    dlng = km / (111.0 * math.cos(math.radians(lat)))
    return (lng - dlng, lat - dlat, lng + dlng, lat + dlat)


def get_connection():
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    return con


def query_places(con, base_path, xmin, ymin, xmax, ymax):
    """Pull the places theme within a bounding box. Returns rows with the
    local/primary name, an English variant if Overture has one, primary
    category, confidence, and lon/lat. Filters out low-confidence records
    here rather than in Python, so the bad rows never leave the query."""
    sql = f"""
        SELECT
            names."primary" AS name,
            names.common['en'] AS name_en,
            categories."primary" AS category,
            confidence,
            ST_X(geometry) AS lng,
            ST_Y(geometry) AS lat
        FROM read_parquet('{base_path}/theme=places/type=place/*', filename=true, hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {xmin} AND {xmax}
          AND bbox.ymin BETWEEN {ymin} AND {ymax}
          AND names."primary" IS NOT NULL
          AND confidence >= {MIN_CONFIDENCE}
    """
    return con.execute(sql).fetchall()


def query_transit(con, base_path, xmin, ymin, xmax, ymax):
    """Pull transit stops from the base theme's infrastructure type — a
    completely different theme from places, since Overture deliberately
    excludes waypoints like bus stops from places (a place must be a
    destination). Unlike places, infrastructure has no confidence field to
    filter on. Geometries here can be Point, LineString, or Polygon
    depending on class, so ST_Centroid gives a safe representative point
    regardless of shape."""
    class_list = ", ".join(f"'{c}'" for c in TRANSIT_CLASSES)
    sql = f"""
        SELECT
            names."primary" AS name,
            class,
            ST_X(ST_Centroid(geometry)) AS lng,
            ST_Y(ST_Centroid(geometry)) AS lat
        FROM read_parquet('{base_path}/theme=base/type=infrastructure/*', filename=true, hive_partitioning=1)
        WHERE subtype = 'transit'
          AND class IN ({class_list})
          AND bbox.xmin BETWEEN {xmin} AND {xmax}
          AND bbox.ymin BETWEEN {ymin} AND {ymax}
    """
    return con.execute(sql).fetchall()


def classify_places(rows, center_lat, center_lng):
    hotels, food = [], []
    for name, name_en, category, confidence, lng, lat in rows:
        if category is None:
            continue
        dist = round(haversine_km(center_lat, center_lng, lat, lng), 2)
        record = {
            "name": name,
            "name_en": name_en,
            "category": category,
            "lat": lat,
            "lng": lng,
            "distance_km": dist,
        }
        if category in HOTEL_CATEGORIES:
            record["access_tier"] = access_tier(dist)
            hotels.append(record)
        else:
            for food_group, cats in FOOD_CATEGORIES_MAP.items():
                if category in cats:
                    record["food_group"] = food_group
                    food.append(record)
                    break
    hotels.sort(key=lambda h: h["distance_km"])
    food.sort(key=lambda f: f["distance_km"])
    return hotels, food


def classify_transit(rows, center_lat, center_lng):
    transit = []
    for name, cls, lng, lat in rows:
        dist = round(haversine_km(center_lat, center_lng, lat, lng), 2)
        transit.append(
            {
                # Many transit stops (especially bus_stop) have no name in
                # Overture — fall back to a readable label from the class
                # rather than showing a blank name in the UI.
                "name": name or TRANSIT_LABELS.get(cls, "Transit stop"),
                "class": cls,
                "lat": lat,
                "lng": lng,
                "distance_km": dist,
            }
        )
    transit.sort(key=lambda t: t["distance_km"])
    return transit


def extract_circuit(con, key, circuit, base_path, release):
    print(f"Extracting {circuit['name']} ({key})...")
    xmin, ymin, xmax, ymax = bbox_around(circuit["lat"], circuit["lng"], circuit["bbox_km"])
    rows = query_places(con, base_path, xmin, ymin, xmax, ymax)
    hotels, food = classify_places(rows, circuit["lat"], circuit["lng"])

    transit_rows = query_transit(con, base_path, xmin, ymin, xmax, ymax)
    transit = classify_transit(transit_rows, circuit["lat"], circuit["lng"])

    out = {
        "circuit": {
            "key": key,
            "name": circuit["name"],
            "location": circuit["location"],
            "lat": circuit["lat"],
            "lng": circuit["lng"],
        },
        "hotels": hotels,
        "food": food,
        "transit": transit,
        "overture_release": release,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    out_path = os.path.join(DATA_DIR, f"{key}.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"  -> {len(hotels)} hotels, {len(food)} food places, {len(transit)} transit stops written to {out_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--circuit", help="Single circuit key from circuits.json")
    parser.add_argument("--all", action="store_true", help="Extract every circuit in circuits.json")
    args = parser.parse_args()

    with open(CIRCUITS_PATH) as f:
        circuits = json.load(f)

    if not args.circuit and not args.all:
        parser.error("Pass --circuit <key> or --all")

    con = get_connection()
    release = get_latest_release(con)
    base_path = f"s3://overturemaps-us-west-2/release/{release}"
    print(f"Using Overture release {release}")

    keys = circuits.keys() if args.all else [args.circuit]
    for key in keys:
        if key not in circuits:
            print(f"Unknown circuit '{key}', skipping. Known: {list(circuits.keys())}")
            continue
        extract_circuit(con, key, circuits[key], base_path, release)

    write_web_index(circuits)


def write_web_index(circuits):
    """Writes web/data/circuits.json, the small index the frontend uses to
    populate the circuit picker. Regenerated every run so it can't drift out
    of sync with scripts/circuits.json."""
    web_data_dir = os.path.join(HERE, "..", "web", "data")
    os.makedirs(web_data_dir, exist_ok=True)
    index = {
        key: {
            "name": c["name"],
            "race_name": c.get("race_name", c["name"]),
            "location": c["location"],
            "lat": c["lat"],
            "lng": c["lng"]
        }
        for key, c in circuits.items()
    }
    with open(os.path.join(web_data_dir, "circuits.json"), "w") as f:
        json.dump(index, f, indent=2)
    print(f"Wrote circuit index for {len(index)} circuit(s) to web/data/circuits.json")


if __name__ == "__main__":
    main()
