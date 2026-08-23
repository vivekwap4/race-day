// Race Day — shared state and constants used across modules.
// Data flow: web/data/circuits.json (list of available circuits) -> web/data/<key>.json
// (per-circuit hotels/food, pre-computed by scripts/extract.py). The app only
// ever reads static JSON — it never talks to Overture or DuckDB directly.

export const state = {
  circuits: {},
  currentCircuit: null,
  currentData: null,
  activeLayer: "hotels",
  activeFoodCategory: "all",
  theme: "light",
  language: (navigator.language || "en").toLowerCase().startsWith("en") ? "en" : "local",
  markers: [],
  homeMarkers: [],
  selectedHotelMarker: null,
};

export const TIER_CLASS = {
  Walkable: "tier-Walkable",
  "Short Transfer": "tier-Short-Transfer",
  "Long Transfer": "tier-Long-Transfer",
};

export const CLUSTER_COLOR = "#e63946";
export const HOTEL_COLOR = "#e63946"; // matches CLUSTER_COLOR deliberately — hotel dots and bubbles should read as the same category
export const FOOD_COLOR = "#f0b25e";
export const CIRCUIT_COLOR = "#7c3aed"; // distinct from hotel/food/cluster red-amber palette, so the circuit itself always stands out
export const HIGHLIGHT_COLOR = "#059669"; // emerald — used only for the selected-hotel pin, distinct from every other color on the map
export const SOURCE_ID = "places";

// One flag per circuit, keyed to scripts/circuits.json's keys. Kept here
// rather than in the data file since it's purely decorative UI, not data
// Overture or the extraction pipeline has any part in.
export const CIRCUIT_FLAGS = {
  australia: "🇦🇺",
  china: "🇨🇳",
  suzuka: "🇯🇵",
  bahrain: "🇧🇭",
  saudi_arabia: "🇸🇦",
  miami: "🇺🇸",
  canada: "🇨🇦",
  monaco: "🇲🇨",
  barcelona: "🇪🇸",
  austria: "🇦🇹",
  silverstone: "🇬🇧",
  spa: "🇧🇪",
  hungary: "🇭🇺",
  zandvoort: "🇳🇱",
  monza: "🇮🇹",
  madrid: "🇪🇸",
  baku: "🇦🇿",
  singapore: "🇸🇬",
  cota: "🇺🇸",
  mexico: "🇲🇽",
  brazil: "🇧🇷",
  las_vegas: "🇺🇸",
  qatar: "🇶🇦",
  abu_dhabi: "🇦🇪",
};
