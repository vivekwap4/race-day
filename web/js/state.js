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
  selectedHotelDot: null,
  selectedPoiMarker: null,
  selectedPoiDot: null,
  currentHotel: null, // hotel currently shown in the detail panel
  useMiles: false, // set to true for US circuits; togglable by user
};

// US circuit keys — these default to miles when loaded.
const US_CIRCUITS = new Set(["miami", "cota", "las_vegas"]);

export function setUnitForCircuit(circuitKey) {
  state.useMiles = US_CIRCUITS.has(circuitKey);
}

// Converts a km value to the current display unit and returns a formatted string.
export function formatDist(km) {
  if (state.useMiles) {
    const mi = km * 0.621371;
    return `${mi.toFixed(2)} mi`;
  }
  return `${km} km`;
}

export const TIER_CLASS = {
  Walkable: "tier-Walkable",
  "Short Transfer": "tier-Short-Transfer",
  "Long Transfer": "tier-Long-Transfer",
};

export const CLUSTER_COLOR = "#e63946";
export const HOTEL_COLOR = "#e63946"; // matches CLUSTER_COLOR deliberately — hotel dots and bubbles should read as the same category
export const FOOD_COLOR = "#f0b25e";
export const CIRCUIT_COLOR = "#7c3aed"; // light theme circuit color (purple)
export const CIRCUIT_COLOR_DARK = "#00fff5"; // dark theme circuit color (electric cyan)

// Returns the correct circuit color for the current theme — purple in light,
// electric cyan in dark (for readability against the fiord basemap's navy).
export function getCircuitColor() {
  return state.theme === "dark" ? CIRCUIT_COLOR_DARK : CIRCUIT_COLOR;
}
export const HIGHLIGHT_COLOR = "#059669"; // emerald — used only for the selected-hotel pin, distinct from every other color on the map
export const SOURCE_ID = "places";

// Mirrors TRANSIT_LABELS in scripts/extract.py — kept in sync by hand since
// one's Python (runs at extraction time) and one's JS (runs in the browser).
// extract.py already applies this as a fallback name when a stop has none,
// so this copy is used here just to show the stop *type* alongside its name.
export const TRANSIT_LABELS = {
  bus_stop: "Bus stop",
  bus_station: "Bus station",
  platform: "Platform",
  stop_position: "Stop",
  railway_station: "Train station",
  railway_halt: "Train halt",
  ferry_terminal: "Ferry terminal",
  subway_station: "Metro station",
};

// Overture's platform/stop_position classes come from generic OSM tags
// (public_transport=platform / stop_position) that don't encode transit
// mode — could be bus, tram, or train. The other classes ARE mode-specific.
// Used to badge confidently-known stops differently from ambiguous ones,
// rather than guessing a mode we can't actually confirm.
export const TRANSIT_CONFIDENT_CLASSES = new Set([
  "bus_stop",
  "bus_station",
  "railway_station",
  "railway_halt",
  "ferry_terminal",
  "subway_station",
]);

// When merging duplicate records for the same named stop (a stop_position
// plus one platform per direction is normal OSM/Overture modeling for a
// single physical stop), prefer showing the most specific/informative class.
export const TRANSIT_CLASS_PRIORITY = [
  "railway_station",
  "subway_station",
  "ferry_terminal",
  "bus_station",
  "railway_halt",
  "bus_stop",
  "platform",
  "stop_position",
];

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
