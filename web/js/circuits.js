// The custom circuit dropdown, the clickable circuit markers shown on the
// home-view world map before anything is selected, and loading a circuit's
// data once picked.

import { state, CIRCUIT_FLAGS, CIRCUIT_COLOR, getCircuitColor, setUnitForCircuit } from "./state.js";
import { map } from "./map.js";
import { escapeHtml } from "./utils.js";
import { renderCircuitMarker, renderClusterLayer } from "./clusters.js";
import { renderHotelList, clearSelectedHotelMarker, clearSelectedPoiMarker } from "./hotels.js";
import { renderTrack, clearTrack } from "./track.js";
import { loadSchedule } from "./schedule.js";
import { stopFlythrough } from "./flythrough.js";

export function populateCircuitPicker() {
  const list = document.getElementById("circuit-list");
  list.innerHTML = "";
  Object.entries(state.circuits).forEach(([key, c]) => {
    const item = document.createElement("li");
    item.className = "circuit-option";
    item.setAttribute("role", "option");
    item.dataset.key = key;
    const flag = CIRCUIT_FLAGS[key] || "";
    item.innerHTML = `
      <span class="circuit-flag" aria-hidden="true">${flag}</span>
      <span class="circuit-option-text">${escapeHtml(c.name)} — ${escapeHtml(c.location)}</span>
    `;
    item.addEventListener("click", () => {
      closeCircuitDropdown();
      selectCircuit(key);
    });
    list.appendChild(item);
  });

  const trigger = document.getElementById("circuit-trigger");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCircuitDropdown();
  });
  document.addEventListener("click", (e) => {
    if (!document.getElementById("circuit-picker").contains(e.target)) {
      closeCircuitDropdown();
    }
  });
}

function toggleCircuitDropdown() {
  const list = document.getElementById("circuit-list");
  const trigger = document.getElementById("circuit-trigger");
  const isOpen = !list.classList.contains("hidden");
  if (isOpen) {
    closeCircuitDropdown();
  } else {
    list.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
  }
}

function closeCircuitDropdown() {
  document.getElementById("circuit-list").classList.add("hidden");
  document.getElementById("circuit-trigger").setAttribute("aria-expanded", "false");
}

// Shared by both the dropdown and the home-view map markers, so picking a
// circuit either way updates the trigger label and highlighted option the
// same way.
export function selectCircuit(key) {
  const c = state.circuits[key];
  console.log("[selectCircuit]", key, c);
  if (!c) { console.warn("[selectCircuit] no circuit data for key:", key); return; }
  const flag = CIRCUIT_FLAGS[key] || "";
  document.getElementById("circuit-trigger-label").textContent = `${flag} ${c.name} — ${c.location}`;
  document.querySelectorAll(".circuit-option").forEach((el) => {
    el.classList.toggle("selected", el.dataset.key === key);
  });
  loadCircuit(key);
}

// --- Home-view circuit markers, shown on the world map before a circuit is
// picked. Clicking one selects that circuit, same as the dropdown. Cleared
// once a circuit is loaded, since the map zooms in and they'd be off-screen
// or clutter the local view anyway.

export function renderHomeMarkers() {
  clearHomeMarkers();
  Object.entries(state.circuits).forEach(([key, c]) => {
    const isSelected = key === state.currentCircuit;
    const el = document.createElement("div");
    const color = getCircuitColor();
    if (isSelected) {
      el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 3px ${color}88;cursor:default;`;
    } else {
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.15);cursor:pointer;opacity:0.7;`;
    }
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([c.lng, c.lat])
      .addTo(map); // no popup — it interferes with click handling
    if (!isSelected) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCircuit(key);
      });
    }
    state.homeMarkers.push(marker);
  });
}

export function clearHomeMarkers() {
  state.homeMarkers.forEach((m) => m.remove());
  state.homeMarkers = [];
}

// Deselects the current circuit — clears all circuit-specific state and
// layers, resets the dropdown label, and re-renders the home markers so
// the user can see and pick any circuit again.
export function resetCircuitSelection() {
  if (!state.currentData) return;
  state.currentCircuit = null;
  state.currentData = null;
  clearSelectedHotelMarker();
  clearSelectedPoiMarker();
  clearTrack();
  // Remove cluster/unclustered layers
  ["clusters", "cluster-count", "unclustered-point"].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource("places")) map.removeSource("places");
  // Remove the selected-circuit dot marker
  state.markers.forEach((m) => m.remove());
  state.markers = [];
  // Restore home markers and reset the picker label
  renderHomeMarkers();
  document.getElementById("layer-filters").classList.add("hidden");
  document.getElementById("food-subfilters").classList.add("hidden");
  const triggerLabel = document.getElementById("circuit-trigger-label");
  if (triggerLabel) triggerLabel.textContent = "Choose a circuit";
  document.getElementById("panel-content").classList.add("hidden");
  document.getElementById("hotel-detail").classList.add("hidden");
  document.getElementById("panel-empty").classList.remove("hidden");
  // Reset the schedule body
  const scheduleBody = document.getElementById("schedule-body");
  if (scheduleBody) scheduleBody.innerHTML = "";
}

export async function loadCircuit(key) {
  stopFlythrough();
  const res = await fetch(`data/${key}.json`);
  if (!res.ok) {
    console.error(`No data file for circuit '${key}'. Run scripts/extract.py first.`);
    return;
  }
  clearSelectedHotelMarker();
  clearSelectedPoiMarker();
  clearTrack();
  state.currentCircuit = key;
  state.currentData = await res.json();

  // Re-render home markers immediately so the selected circuit gets its
  // distinctive ring while the flight animation plays. The zoom handler
  // will hide/show them based on zoom level.
  renderHomeMarkers();

  // Auto-set distance unit based on circuit country (miles for US, km elsewhere)
  setUnitForCircuit(key);
  const unitText = state.useMiles ? "mi" : "km";
  const el1 = document.getElementById("unit-label");
  const el2 = document.getElementById("unit-label-detail");
  if (el1) el1.textContent = unitText;
  if (el2) el2.textContent = unitText;
  // Hide layer filters during travel
  document.getElementById("layer-filters").classList.add("hidden");
  document.getElementById("food-subfilters").classList.add("hidden");

  const { circuit } = state.currentData;
  document.getElementById("circuit-name").textContent = circuit.name;
  document.getElementById("circuit-location").textContent = circuit.location;

  // Show the travel overlay during the flight.
  const overlay = document.getElementById("travel-overlay");
  document.getElementById("travel-circuit-name").textContent = circuit.name;
  document.getElementById("travel-circuit-location").textContent = circuit.location;
  overlay.classList.remove("hidden");

  // Clear hotel detail and list, show main panel content.
  document.getElementById("hotel-detail").classList.add("hidden");
  document.getElementById("panel-empty").classList.add("hidden");
  document.getElementById("panel-content").classList.remove("hidden");
  document.getElementById("hotel-list").innerHTML = "";
  document.getElementById("in-view-count").textContent = "0";

  // Circuit marker at destination visible during flight
  renderCircuitMarker();

  const thisGeneration = (state._loadGeneration = (state._loadGeneration || 0) + 1);
  state._flying = true;

  map.flyTo({ center: [circuit.lng, circuit.lat], zoom: 12 });
  map.once("moveend", () => {
    state._flying = false;
    if (state._loadGeneration !== thisGeneration) return;
    overlay.classList.add("hidden");
    clearHomeMarkers();
    renderCircuitMarker();
    document.getElementById("layer-filters").classList.remove("hidden");
    renderClusterLayer();
    renderHotelList();
    renderTrack(key);
    loadSchedule(key);
  });
}
