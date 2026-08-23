// The single shared MapLibre map instance. ES modules are singletons, so
// every other module imports this same `map` object rather than each
// creating its own — this is the one file that should ever construct it.

import { state } from "./state.js";

// Free vector basemap. No API key required. OpenFreeMap ships matching
// light and dark styles, so the map itself follows the theme toggle too,
// not just the app's UI chrome.
export const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
export const MAP_STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

export function mapStyleFor(theme) {
  return theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

export const map = new maplibregl.Map({
  container: "map",
  style: mapStyleFor(state.theme),
  center: [0, 20],
  zoom: 1.5,
});

map.addControl(new maplibregl.NavigationControl(), "bottom-right");
