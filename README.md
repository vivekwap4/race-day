# Race Day — Your F1 Race Weekend Companion

**Pitch:** for a fan traveling to an F1 race weekend, Race Day answers "where should I stay and how hard is it to actually get to the circuit" using real hotel, food, and transit data around all 24 venues on the 2026 calendar. Not the generic "things to do" answer every travel app gives; the specific, practical one for race morning.

## Why This

I follow F1 and travel for events. The actual hard part of planning a race weekend is not finding the circuit; it is figuring out which hotel does not leave you stuck in a two-hour transfer on race morning. Overture is a good fit here because it has three things I need in one place: hotel locations, food places near each hotel, and the transit infrastructure needed to reason about how connected a location actually is.

## What It Does

- **All 24 circuits** on the 2026 F1 calendar, accessible via a dropdown or by clicking circuit markers on the world map
- **Hotels** within the viewport, sorted by distance from the circuit, with an access tier (Walkable / Short Transfer / Long Transfer)
- **Food nearby** each selected hotel within 500m, filterable by Restaurants / Cafes / Bars / Fast food
- **Transit nearby** each selected hotel within 500m: bus stops, metro stations, platforms
- **Walking routes** from the selected hotel to any food or transit option via OSRM (open-source routing, no API key). Shows actual walking distance and estimated time with a dashed route line on the map
- **Race weekend schedule** for each circuit: FP1/FP2/FP3 (or Sprint sessions), Qualifying, and Race, with times in circuit local time. Fetched live from Jolpica's Ergast-compatible API and cached for the session. Past races show the winner
- **F1 car flythrough** on the home screen: a car marker travels between all 24 circuits in calendar order, showing the race name on arrival, stopping when you interact
- **Dark and light themes**; dark is the default

## How Data Flows Into This App

`scripts/extract.py` queries Overture's cloud-hosted GeoParquet with DuckDB, pulls places (hotels, food) and base/infrastructure (transit stops) within a bounding box around each circuit in `scripts/circuits.json`, and computes straight-line distance and an access tier for each hotel.

That script runs automatically via GitHub Actions (`.github/workflows/extract-data.yml`) whenever `circuits.json` or `extract.py` change, and commits the output into `web/data/`.

The deployed app is a static site that only reads those small JSON files plus two live APIs (Jolpica for schedule, OSRM for walking routes). No runtime dependency on Overture, DuckDB, or S3: fast and free-tier-friendly, at the cost of place data being as fresh as the last extraction run.

To add a new circuit: add it to `scripts/circuits.json`, push, and the Action does the rest.

## Key Trade-offs and Cuts

**Confidence threshold (0.8).** Overture aggregates places from multiple providers without manual verification, so low-confidence records occasionally carry garbage names. A specific example: a "hotel" with an unrelated, domain-like name scored 0.77. We checked the 0.75-0.85 band near one circuit before settling on 0.8, rather than picking a round number blind. A stricter threshold means fewer false positives but also fewer real hotels in areas with sparser Overture coverage; a looser one is the reverse.

**Access tier is straight-line distance, not routing.** Three tiers, defined in miles:
- **Walkable** -- 1 mile (1.609 km) or less: on foot in about 20 minutes, no transport needed
- **Short Transfer** -- 6 miles (9.656 km) or less: quick rideshare or taxi, roughly 20 minutes on race day without major road closures
- **Long Transfer** -- more than 6 miles: plan transport carefully; race-day closures can significantly extend journey times

These are judgment calls, not something Overture defines. A hotel 2 miles away as the crow flies could be a 30-minute detour if a river or the circuit perimeter sits between you. Walking routes via OSRM give actual routed distances for the hotel-to-POI leg, but the hotel-to-circuit tier is still straight-line.

**Transit route and line numbers not included.** Overture's infrastructure theme stores stop names and classes (bus stop, metro station, platform) but not which lines serve each stop. That data lives in GTFS feeds and would require a separate integration. The current build shows stop name and type.

**Walking routes use OSRM's public instance.** Free, no API key, cached per session. The public instance is rate-limited and occasionally slow.

**Data refreshes on code push, not on a schedule.** The Action triggers on push to `scripts/`. It does not run automatically when Overture publishes a new monthly release. A cron trigger in the workflow matching Overture's release cadence would fix this; small addition, not yet wired.

**The basemap is OpenFreeMap**, not built from Overture's own building and road themes. A full PMTiles pipeline from Overture's base/buildings/transportation themes would make the map itself Overture-derived end to end, which is a natural next step but adds real build complexity.

## Future Features

- **Local city watch:** find bars, pubs, and watch parties near you for races you are not attending in person. This needs a different data pattern than the fixed circuit list and a live backend or curated city index, so it was deliberately cut from this build.
- **Smarter zoom around remote circuits:** some circuits (Bahrain, Lusail, Yas Marina) are far from any major city. Better default zoom levels and viewport handling for remote venues would improve the first-load experience.
- **Detailed transit layer with line numbers:** integrate GTFS feeds or a transit API (Transitland, OpenRouteService) to show which specific bus or tram lines serve each stop, and optionally route you from a transit stop back to your hotel.
- **GTFS/transit line numbers on existing stops:** even without a full transit layer, enriching the current stop data with route refs from OpenStreetMap's Overpass API at extraction time would make the transit section meaningfully more useful.
- **Scheduled data refresh:** a monthly cron trigger in GitHub Actions to match Overture's release cadence, so hotel and food data does not go silently stale between code pushes.

## Running the Extraction Yourself

You do not need to; GitHub Actions runs it on push. To run locally:

```bash
pip install duckdb
python scripts/extract.py --all
```

## Stack

Plain HTML/CSS/JS + MapLibre GL JS, no build step. Data extraction in Python with DuckDB against Overture's GeoParquet release. Deployed as a static site (Render free tier, or any static host).

## Data Sources

- **Hotel, food, and transit data:** Overture Maps Foundation, places and base/infrastructure themes. Extracted at build time via GitHub Actions; no runtime dependency on Overture or S3.
- **Circuit track geometry:** [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT License, copyright Tomislav Bacinger), filtered to the 24 circuits in this app; geometry unchanged.
- **Race schedule:** [Jolpica Ergast API](https://api.jolpi.ca/), free, no key, fetched client-side and cached per session.
- **Walking routes:** [OSRM](https://project-osrm.org/) public instance, free, no key, fetched on demand and cached per session.
- **Map tiles:** OpenFreeMap (Fiord / Liberty styles), free, no API key.
