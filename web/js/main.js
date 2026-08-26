// Entry point. Loaded via <script type="module"> — no bundler or build
// step needed; the browser resolves the import graph natively. Fetches the
// circuit list, wires up every control's event listener, and starts the app.

import { state, setUnitForCircuit } from "./state.js";
import { map } from "./map.js";
import { applyTheme, toggleTheme } from "./theme.js";
import { populateCircuitPicker, renderHomeMarkers, clearHomeMarkers, resetCircuitSelection, selectCircuit } from "./circuits.js";
import { setActiveLayer, setFoodCategory, registerClusterInteractions } from "./clusters.js";
import { renderHotelList, showHotelList, showHotelDetail, toggleSchedule, registerZoomVisibilityHandler } from "./hotels.js";
import { startFlythrough, stopFlythrough } from "./flythrough.js";

async function init() {
  const res = await fetch("data/circuits.json");
  state.circuits = await res.json();
  populateCircuitPicker();
  renderHomeMarkers();
  startFlythrough();

  // Stop flythrough only on deliberate pan (mousedown + drag), not scroll zoom
  map.on("dragstart", stopFlythrough);

  document.querySelectorAll("#layer-filters .pill").forEach((btn) => {
    btn.addEventListener("click", () => setActiveLayer(btn.dataset.layer));
  });

  document.querySelectorAll("#food-subfilters .pill").forEach((btn) => {
    btn.addEventListener("click", () => setFoodCategory(btn.dataset.food));
  });

  document.getElementById("schedule-toggle").addEventListener("click", toggleSchedule);
  document.getElementById("detail-back").addEventListener("click", showHotelList);
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  function applyUnitToggle() {
    state.useMiles = !state.useMiles;
    const label = state.useMiles ? "mi" : "km";
    const el1 = document.getElementById("unit-label");
    const el2 = document.getElementById("unit-label-detail");
    if (el1) el1.textContent = label;
    if (el2) el2.textContent = label;
    renderHotelList();
    // Re-render hotel detail distances if a hotel is currently open
    if (state.currentHotel) showHotelDetail(state.currentHotel);
  }
  document.getElementById("unit-toggle").addEventListener("click", applyUnitToggle);
  const detailToggle = document.getElementById("unit-toggle-detail");
  if (detailToggle) detailToggle.addEventListener("click", applyUnitToggle);

  applyTheme();

  map.on("moveend", renderHotelList);
  registerClusterInteractions();
  registerZoomVisibilityHandler();

  // Show/hide the side panel based on zoom level AND proximity to the
  // selected circuit. Zoom alone isn't enough — the user could zoom into
  // Chicago while Las Vegas is selected and the panel would incorrectly
  // show Vegas hotels. The circuit must be in the current viewport.
  const PANEL_ZOOM_THRESHOLD = 11;
  const DESELECT_ZOOM_THRESHOLD = 4; // zoom ≤ 4 = continent/world view → deselect circuit
  const panel = document.getElementById("side-panel");
  const returnBtn = document.getElementById("return-to-circuit");
  const returnLabel = document.getElementById("return-circuit-label");

  returnBtn.addEventListener("click", () => {
    if (!state.currentData) return;
    const { circuit } = state.currentData;
    map.flyTo({ center: [circuit.lng, circuit.lat], zoom: 12 });
  });

  // Finds the nearest circuit key within maxDeg degrees of the map center,
  // or null if none is close enough.
  function nearestCircuitToCenter(maxDeg = 0.45) {
    const center = map.getCenter();
    let nearest = null;
    let nearestDist = Infinity;
    for (const [key, c] of Object.entries(state.circuits)) {
      const d = Math.abs(center.lng - c.lng) + Math.abs(center.lat - c.lat);
      if (d < nearestDist) { nearestDist = d; nearest = key; }
    }
    return nearest && nearestDist < maxDeg ? nearest : null;
  }

  function updatePanelVisibility() {
    const zoom = map.getZoom();

    if (state.currentData && zoom <= DESELECT_ZOOM_THRESHOLD && !state._flying) {
      resetCircuitSelection();
      panel.classList.remove("panel-visible");
      returnBtn.classList.add("hidden");
      return;
    }

    if (!state.currentData) {
      panel.classList.remove("panel-visible");
      returnBtn.classList.add("hidden");
      if (zoom >= PANEL_ZOOM_THRESHOLD && !state._flying) {
        const nearest = nearestCircuitToCenter();
        if (nearest) selectCircuit(nearest);
      }
      return;
    }

    // Auto-switch: if zoomed in past threshold but near a DIFFERENT circuit,
    // switch to it — handles hopping between nearby European circuits.
    if (zoom >= PANEL_ZOOM_THRESHOLD && !state._flying) {
      const nearest = nearestCircuitToCenter();
      if (nearest && nearest !== state.currentCircuit) {
        selectCircuit(nearest);
        return;
      }
    }

    const circuit = state.currentData.circuit;

    // Show home markers at country scale (zoom < PANEL_ZOOM_THRESHOLD) so
    // other circuits are visible when zoomed out. Hide them when zoomed in
    // close enough that cluster bubbles and the circuit marker take over.
    const showHomeMarkers = zoom < PANEL_ZOOM_THRESHOLD;
    if (showHomeMarkers && state.homeMarkers.length === 0 && !state._flying) {
      renderHomeMarkers();
    } else if (!showHomeMarkers) {
      clearHomeMarkers();
    }

    const inView = map.getBounds().contains([circuit.lng, circuit.lat]);
    const zoomed = zoom >= PANEL_ZOOM_THRESHOLD;
    const CLOSE_DEG = 0.45;
    const center = map.getCenter();
    const closeToCircuit =
      Math.abs(center.lng - circuit.lng) < CLOSE_DEG &&
      Math.abs(center.lat - circuit.lat) < CLOSE_DEG;
    const hotelDetailOpen = !document.getElementById("hotel-detail").classList.contains("hidden");

    const atCircuit = inView || closeToCircuit || hotelDetailOpen;
    panel.classList.toggle("panel-visible", zoomed && atCircuit);

    // Return button: show when genuinely away from circuit, not just slightly
    // panned — and never during flight
    if (!atCircuit && !state._flying) {
      returnLabel.textContent = `← ${circuit.name}`;
      returnBtn.classList.remove("hidden");
    } else {
      returnBtn.classList.add("hidden");
    }
  }
  map.on("zoom", updatePanelVisibility);
  map.on("moveend", updatePanelVisibility);
}

init();
