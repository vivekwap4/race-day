// Theme (light/dark) and language (local/English) toggle logic.

import { state } from "./state.js";
import { map, mapStyleFor, hideBasemapClutterLayers } from "./map.js";
import { renderCircuitMarker, renderClusterLayer } from "./clusters.js";
import { renderHotelList } from "./hotels.js";
import { renderTrack } from "./track.js";
import { renderHomeMarkers } from "./circuits.js";
import { redrawRouteAfterThemeChange } from "./hotels.js";

export function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();

  const preservedCenter = map.getCenter();
  const preservedZoom = map.getZoom();
  const hadData = !!state.currentData;
  const circuitKey = state.currentCircuit;

  map.setStyle(mapStyleFor(state.theme));

  // MapLibre v4: style.load doesn't reliably fire after setStyle.
  // Confirmed by direct console instrumentation — idle fires but style.load
  // doesn't. Use idle directly, which fires once the new style is fully settled.
  map.once("idle", () => {
    map.jumpTo({ center: preservedCenter, zoom: preservedZoom });
    hideBasemapClutterLayers();
    if (!hadData) {
      // No circuit selected — re-render home markers so they use the new theme color
      renderHomeMarkers();
      return;
    }
    renderCircuitMarker();
    renderClusterLayer(true);
    if (circuitKey) {
      renderTrack(circuitKey)
        .then(() => redrawRouteAfterThemeChange())
        .catch(() => {
          map.once("idle", () => {
            renderTrack(circuitKey);
            redrawRouteAfterThemeChange();
          });
        });
    } else {
      redrawRouteAfterThemeChange();
    }
  });
}

export function applyTheme() {
  document.body.setAttribute("data-theme", state.theme);
  document.getElementById("theme-icon").innerHTML = state.theme === "dark" ? "&#9728;" : "&#9790;";
}

export function toggleLanguage() {
  state.language = state.language === "en" ? "local" : "en";
  applyLanguageLabel();
  renderHotelList();
}

export function applyLanguageLabel() {
  document.getElementById("lang-label").textContent = state.language === "en" ? "EN" : "Local";
}
