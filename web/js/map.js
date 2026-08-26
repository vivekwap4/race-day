// The single shared MapLibre map instance. ES modules are singletons, so
// every other module imports this same `map` object rather than each
// creating its own — this is the one file that should ever construct it.

import { state } from "./state.js";

// Free vector basemap. No API key required. OpenFreeMap ships matching
// light and dark styles, so the map itself follows the theme toggle too,
// not just the app's UI chrome.
export const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
export const MAP_STYLE_DARK  = "https://tiles.openfreemap.org/styles/fiord";

export function mapStyleFor(theme) {
  return theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

export const map = new maplibregl.Map({
  container: "map",
  style: mapStyleFor(state.theme),
  center: [20, 20],
  zoom: 2,
  renderWorldCopies: false,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");

// OpenFreeMap's styles ship generic POI labels/icons (random shops,
// obscure businesses) tiered by importance rank: poi_r1 (most important,
// visible from further out) through poi_r20 (least important, only at
// close zoom). We keep poi_r1 (likely genuine landmarks) but hide the
// lower tiers, which were cluttering the map with things like a random
// "Portable Iron Houses" business label. Confirmed via inspecting each
// layer's actual minzoom before deciding which to hide.
const HIDDEN_BASEMAP_LAYERS = ["poi_r7", "poi_r20"];

export function hideBasemapClutterLayers() {
  HIDDEN_BASEMAP_LAYERS.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  });
}

// Runs on the very first style load. Theme toggles swap the entire style
// (see toggleTheme in theme.js), which resets this — that's why toggleTheme
// also calls hideBasemapClutterLayers() itself after each swap, not just here.
map.once("style.load", hideBasemapClutterLayers);

// Exposed on window purely so it's reachable from the browser console for
// debugging (e.g. map.getZoom(), map.queryRenderedFeatures(...)) — ES
// modules don't leak their variables into global scope the way the old
// single-file app.js did, so this is deliberate, not an accident.
window.map = map;
