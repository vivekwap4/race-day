// Race Day — F1 race weekend logistics
// Data flow: data/circuits.json (list of available circuits) -> data/<key>.json
// (per-circuit hotels/food, pre-computed by scripts/extract.py). This file only
// ever reads static JSON — it never talks to Overture or DuckDB directly.

const state = {
  circuits: {},
  currentCircuit: null,
  currentData: null,
  activeLayer: "hotels",
  activeFoodCategory: "all",
  markers: [],
};

const TIER_CLASS = {
  Walkable: "tier-Walkable",
  "Short Transfer": "tier-Short-Transfer",
  "Long Transfer": "tier-Long-Transfer",
};

// Free vector basemap. No API key required. Swap for your own PMTiles-based
// style later if you want the map itself built from Overture's own building/
// road themes rather than a third-party basemap.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const map = new maplibregl.Map({
  container: "map",
  style: MAP_STYLE,
  center: [0, 20],
  zoom: 1.5,
});

map.addControl(new maplibregl.NavigationControl(), "bottom-right");

init();

async function init() {
  const res = await fetch("data/circuits.json");
  state.circuits = await res.json();
  populateCircuitPicker();

  document.getElementById("circuit-select").addEventListener("change", (e) => {
    if (e.target.value) loadCircuit(e.target.value);
  });

  document.querySelectorAll("#layer-filters .pill").forEach((btn) => {
    btn.addEventListener("click", () => setActiveLayer(btn.dataset.layer));
  });

  document.querySelectorAll("#food-subfilters .pill").forEach((btn) => {
    btn.addEventListener("click", () => setFoodCategory(btn.dataset.food));
  });

  document.getElementById("schedule-toggle").addEventListener("click", toggleSchedule);
  document.getElementById("detail-back").addEventListener("click", showHotelList);
}

function populateCircuitPicker() {
  const select = document.getElementById("circuit-select");
  select.innerHTML = '<option value="">Choose a circuit</option>';
  Object.entries(state.circuits).forEach(([key, c]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${c.name} — ${c.location}`;
    select.appendChild(opt);
  });
}

async function loadCircuit(key) {
  const res = await fetch(`data/${key}.json`);
  if (!res.ok) {
    console.error(`No data file for circuit '${key}'. Run scripts/extract.py first.`);
    return;
  }
  state.currentCircuit = key;
  state.currentData = await res.json();

  document.getElementById("panel-empty").classList.add("hidden");
  document.getElementById("panel-content").classList.remove("hidden");
  document.getElementById("hotel-detail").classList.add("hidden");

  const { circuit } = state.currentData;
  document.getElementById("circuit-name").textContent = circuit.name;
  document.getElementById("circuit-location").textContent = circuit.location;

  map.flyTo({ center: [circuit.lng, circuit.lat], zoom: 12 });

  renderMarkers();
  renderHotelList();
}

function setActiveLayer(layer) {
  state.activeLayer = layer;
  document.querySelectorAll("#layer-filters .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.layer === layer);
  });
  document.getElementById("food-subfilters").classList.toggle("hidden", layer !== "food");
  renderMarkers();
}

function setFoodCategory(cat) {
  state.activeFoodCategory = cat;
  document.querySelectorAll("#food-subfilters .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.food === cat);
  });
  renderMarkers();
}

function clearMarkers() {
  state.markers.forEach((m) => m.remove());
  state.markers = [];
}

function renderMarkers() {
  clearMarkers();
  if (!state.currentData) return;

  const { circuit, hotels, food } = state.currentData;

  const circuitEl = document.createElement("div");
  circuitEl.style.cssText =
    "width:16px;height:16px;border-radius:50%;background:#c0392b;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.15);";
  state.markers.push(
    new maplibregl.Marker({ element: circuitEl })
      .setLngLat([circuit.lng, circuit.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(circuit.name))
      .addTo(map)
  );

  const points = state.activeLayer === "hotels"
    ? hotels
    : food.filter((f) => state.activeFoodCategory === "all" || f.food_group === state.activeFoodCategory);

  const color = state.activeLayer === "hotels" ? "#33449a" : "#97650f";

  points.forEach((p) => {
    const el = document.createElement("div");
    el.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};border:1.5px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.12);cursor:pointer;`;
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([p.lng, p.lat])
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText(p.name))
      .addTo(map);
    if (state.activeLayer === "hotels") {
      el.addEventListener("click", () => showHotelDetail(p));
    }
    state.markers.push(marker);
  });
}

function renderHotelList() {
  const list = document.getElementById("hotel-list");
  list.innerHTML = "";

  const hotels = state.currentData.hotels;
  if (!hotels.length) {
    list.innerHTML = '<p class="empty-state">No hotels found in Overture data for this bounding box.</p>';
    return;
  }

  hotels.forEach((h) => {
    const card = document.createElement("div");
    card.className = "hotel-card";
    card.innerHTML = `
      <div>
        <p class="hotel-name">${escapeHtml(h.name)}</p>
        <p class="hotel-distance">${h.distance_km} km</p>
      </div>
      <span class="tier-badge ${TIER_CLASS[h.access_tier] || ""}">${h.access_tier}</span>
    `;
    card.addEventListener("click", () => showHotelDetail(h));
    list.appendChild(card);
  });
}

function showHotelDetail(hotel) {
  document.getElementById("panel-content").classList.add("hidden");
  document.getElementById("hotel-detail").classList.remove("hidden");

  const nearbyFood = state.currentData.food
    .map((f) => ({ ...f, d: haversineKm(hotel.lat, hotel.lng, f.lat, f.lng) }))
    .filter((f) => f.d <= 1)
    .sort((a, b) => a.d - b.d);

  document.getElementById("hotel-detail-body").innerHTML = `
    <h1 style="font-size:18px;margin:12px 0 2px;">${escapeHtml(hotel.name)}</h1>
    <p class="muted small" style="margin:0 0 14px;">${hotel.distance_km} km from circuit &middot; <span class="tier-badge ${TIER_CLASS[hotel.access_tier] || ""}">${hotel.access_tier}</span></p>
    <p class="section-label">Nearby (within 1 km)</p>
    ${
      nearbyFood.length
        ? nearbyFood
            .slice(0, 6)
            .map(
              (f) => `<div class="detail-row"><span>${escapeHtml(f.name)}</span><span class="muted">${f.d.toFixed(2)} km</span></div>`
            )
            .join("")
        : '<p class="empty-state">No food places within 1 km in the current data.</p>'
    }
    <p class="muted small" style="margin-top:14px;">
      Distances are straight-line, not routed. Access tier is derived from distance only —
      see the README for the exact thresholds and their limits.
    </p>
  `;
}

function showHotelList() {
  document.getElementById("hotel-detail").classList.add("hidden");
  document.getElementById("panel-content").classList.remove("hidden");
}

function toggleSchedule() {
  const body = document.getElementById("schedule-body");
  const chevron = document.getElementById("schedule-chevron");
  const btn = document.getElementById("schedule-toggle");
  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!expanded));
  body.classList.toggle("hidden");
  chevron.innerHTML = expanded ? "&#9662;" : "&#9652;";
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
