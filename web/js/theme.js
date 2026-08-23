// Theme (light/dark) and language (local/English) toggle logic.

import { state } from "./state.js";
import { map, mapStyleFor } from "./map.js";
import { renderClusterLayer } from "./clusters.js";
import { renderHotelList } from "./hotels.js";

export function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();

  // setStyle can reset the camera to a default zoomed-out view when
  // switching between structurally different styles (light <-> dark here),
  // and it also removes any custom sources/layers we'd added (the hotel/
  // food clusters). Handle both explicitly here rather than relying on a
  // separate persistent listener, which raced against this one on the same
  // event and led to the cluster layer sometimes not coming back.
  const preservedCenter = map.getCenter();
  const preservedZoom = map.getZoom();

  map.setStyle(mapStyleFor(state.theme));

  map.once("style.load", () => {
    map.jumpTo({ center: preservedCenter, zoom: preservedZoom });
    if (!state.currentData) return;
    // Always wait for idle rather than checking isStyleLoaded() and
    // sometimes rendering immediately — that race is what exposed a
    // transient null point_count value right after a style swap.
    map.once("idle", renderClusterLayer);
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
