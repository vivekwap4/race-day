// The custom circuit dropdown, the clickable circuit markers shown on the
// home-view world map before anything is selected, and loading a circuit's
// data once picked.

import { state, CIRCUIT_FLAGS } from "./state.js";
import { map } from "./map.js";
import { escapeHtml } from "./utils.js";
import { renderCircuitMarker, renderClusterLayer } from "./clusters.js";
import { renderHotelList } from "./hotels.js";

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
  if (!c) return;
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
    const el = document.createElement("div");
    el.style.cssText =
      "width:10px;height:10px;border-radius:50%;background:#e63946;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.15);cursor:pointer;";
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([c.lng, c.lat])
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText(`${c.name} — ${c.location}`))
      .addTo(map);
    el.addEventListener("click", () => {
      selectCircuit(key);
    });
    state.homeMarkers.push(marker);
  });
}

export function clearHomeMarkers() {
  state.homeMarkers.forEach((m) => m.remove());
  state.homeMarkers = [];
}

export async function loadCircuit(key) {
  const res = await fetch(`data/${key}.json`);
  if (!res.ok) {
    console.error(`No data file for circuit '${key}'. Run scripts/extract.py first.`);
    return;
  }
  clearHomeMarkers();
  state.currentCircuit = key;
  state.currentData = await res.json();

  document.getElementById("panel-empty").classList.add("hidden");
  document.getElementById("panel-content").classList.remove("hidden");
  document.getElementById("hotel-detail").classList.add("hidden");

  const { circuit } = state.currentData;
  document.getElementById("circuit-name").textContent = circuit.name;
  document.getElementById("circuit-location").textContent = circuit.location;

  map.flyTo({ center: [circuit.lng, circuit.lat], zoom: 12 });
  map.once("moveend", () => {
    renderCircuitMarker();
    renderClusterLayer();
    renderHotelList();
  });
}
