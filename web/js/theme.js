// Theme (light/dark) and language (local/English) toggle logic.

import { state } from "./state.js";
import { map, mapStyleFor, hideBasemapClutterLayers } from "./map.js";
import { renderClusterLayer } from "./clusters.js";
import { renderHotelList } from "./hotels.js";
import { renderTrack } from "./track.js";

export function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();

  const preservedCenter = map.getCenter();
  const preservedZoom = map.getZoom();

  map.setStyle(mapStyleFor(state.theme));

  map.once("style.load", () => {
    map.jumpTo({ center: preservedCenter, zoom: preservedZoom });
    hideBasemapClutterLayers();
    if (!state.currentData) return;
    map.once("idle", () => {
      renderClusterLayer();
      if (state.currentCircuit) renderTrack(state.currentCircuit);
    });
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
