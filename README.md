# Race Day — F1 race weekend logistics

**Pitch:** for a fan traveling to an F1 race weekend, Race Day answers "where
should I stay and how hard is it to actually get to the circuit" using real
hotel and road/rail data around the venue — instead of the generic "things to
do" answer every travel app gives. The name is deliberately generic rather
than travel-specific, since a planned future feature (watching a race locally
when you're not attending in person) is about the race weekend itself, not
just about being on-site.

## Why this

I follow F1 and travel for events myself, and the actual hard part of
planning a race weekend isn't finding the circuit, it's figuring out which
hotel doesn't leave you stuck in a two-hour transfer on race morning. Overture
is a genuinely good fit for this because it has three things I actually need
in one place: hotel locations, food places, and the road/rail network needed
to reason about how connected a location really is — not just how far away it
is in a straight line.

## How data flows into this app

1. `scripts/extract.py` queries Overture's cloud-hosted GeoParquet with
   DuckDB, pulls places (hotels, food) within a bounding box around each
   circuit in `scripts/circuits.json`, and computes straight-line distance and
   an access tier for each hotel.
2. That script runs automatically via GitHub Actions
   (`.github/workflows/extract-data.yml`) whenever `circuits.json` or
   `extract.py` change, and commits the output straight into `web/data/`.
3. The deployed app is a static site that only ever reads those small JSON
   files. It has no runtime dependency on Overture, DuckDB, or S3 — this
   keeps it fast and free-tier-friendly, at the cost of data only being as
   fresh as the last extraction run.

To add a new circuit: add it to `scripts/circuits.json`, push, and the Action
does the rest.

## Key trade-offs and cuts

- **Only places above a confidence threshold (0.8) are included.** Overture
  aggregates places from multiple providers without manual verification, so
  low-confidence records occasionally carry garbage names — we found a
  specific example (a "hotel" with an unrelated, domain-like name) that
  scored 0.77, and checked the 0.75–0.85 band near one circuit before
  picking 0.8 as the cutoff, rather than a round number picked blind.
  Still a judgment call, not something Overture defines as "correct" — a
  stricter threshold means fewer false positives but also fewer real hotels
  in areas with sparser Overture coverage; a looser one is the reverse.
- **Access tier is a straight-line distance heuristic, not routing.**
  "Walkable" / "Short Transfer" / "Long Transfer" are thresholds I picked
  (1.5 km / 10 km), not something Overture defines or a real travel-time
  computation. A hotel 3 km away by straight line could be a 20-minute drive
  if a river or the circuit itself sits between you. A real routing engine
  (Valhalla/OSRM) would fix this but is out of scope for this pass.
- **Session schedule (FP1/FP2/FP3, qualifying, race times) is stubbed, not
  built.** It's a real feature I want (live data from OpenF1 or the Jolpica
  API), but I deliberately treated it as secondary to the core logistics
  view and didn't want to ship a half-wired API integration. The UI has the
  slot for it already.
- **"Watch in your own city" (bars/pubs for races you're not attending) is
  not built.** It's a genuinely different feature — "any city" doesn't fit
  the pre-computed static-data pattern the way a fixed circuit list does,
  and doing it properly needs either a curated city list or a live backend.
  Deliberately cut to keep this submission scoped to a working core.
- **Data only refreshes on a code push, not on a schedule.** The extraction
  Action triggers on push to `scripts/extract.py` or `scripts/circuits.json`,
  or manually. It does not run automatically when Overture publishes a new
  monthly release with no code change on our end — so data can go stale
  silently between pushes. The fix is a `schedule:` cron trigger in the
  workflow (e.g. monthly, matching Overture's own release cadence), which
  is a small addition but not yet wired in.
- **Only two circuits are extracted** (Suzuka, COTA) as a proof of concept.
  Adding more is a one-line config change plus a re-run of the Action, not a
  code change — the pipeline is built to scale, the seed data isn't.
- **The basemap is a free third-party vector tile source** (OpenFreeMap),
  not built from Overture's own building/road themes. Building a full
  PMTiles pipeline from Overture's base/buildings/transportation themes
  would make the map itself Overture-derived end to end, which is a
  natural next step but adds real build complexity for what's currently a
  points-on-a-map need.

## Running the extraction yourself

You don't need to — GitHub Actions does it on push. But if you want to run it
locally:

```bash
pip install duckdb
python scripts/extract.py --all
```

## Stack

Plain HTML/CSS/JS + MapLibre GL JS, no build step. Data extraction in Python
with DuckDB against Overture's GeoParquet release. Deployed as a static site
(Render free tier, or any static host).

## Data sources

- **Hotel, food, and transit data:** [Overture Maps Foundation](https://overturemaps.org/) — places and base/infrastructure themes. Extracted at build time via GitHub Actions; no runtime dependency on Overture or S3.
- **Circuit track geometry:** [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT License, © Tomislav Bacinger) — filtered to the 24 circuits in this app; geometry unchanged.
- **Map tiles:** [OpenFreeMap](https://openfreemap.org/) (Liberty / Dark styles) — free, no API key.
