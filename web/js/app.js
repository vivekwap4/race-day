// Race Day — F1 race weekend logistics
// Data flow: web/data/circuits.json (list of available circuits) -> web/data/<key>.json
// (per-circuit hotels/food, pre-computed by scripts/extract.py). This file only
// ever reads static JSON — it never talks to Overture or DuckDB directly.

const state = {
  circuits: {},
  currentCircuit: null,
  currentData: null,
  activeLayer: "hotels",
  activeFoodCategory: "all",
  theme: "dark",
  language: (navigator.language || "en").toLowerCase().startsWith("en") ? "en" : "local",
  markers: [],
};

const TIER_CLASS = {
  Walkable: "tier-Walkable",
  "Short Transfer": "tier-Short-Transfer",
  "Long Transfer": "tier-Long-Transfer",
};

const CLUSTER_COLOR = "#e63946";
const HOTEL_COLOR = "#6ea8fe";
const FOOD_COLOR = "#f0b25e";

// Free vector basemap. No API key required. OpenFreeMap ships matching
// light and dark styles, so the map itself now follows the theme toggle
// too, not just the app's UI chrome.
const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const MAP_STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

function mapStyleFor(theme) {
  return theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

const map = new maplibregl.Map({
  container: "map",
  style: mapStyleFor(state.theme),
  center: [0, 20],
  zoom: 1.5,
});

map.addControl(new maplibregl.NavigationControl(), "bottom-right");

// Swapping map styles (see toggleTheme) removes any custom sources/layers,
// so re-add the hotel/food cluster layer whenever a new style finishes
// loading — covers both the toggle and the very first load.
map.on("style.load", () => {
  if (state.currentData) renderClusterLayer();
});

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
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("lang-toggle").addEventListener("click", toggleLanguage);

  applyTheme();
  applyLanguageLabel();

  map.on("moveend", renderHotelList);
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
  map.once("moveend", () => {
    renderCircuitMarker();
    renderClusterLayer();
    renderHotelList();
  });
}

// --- Theme ---

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();

  // setStyle can reset the camera to a default zoomed-out view when
  // switching between structurally different styles (light <-> dark here).
  // Save the current view and restore it once the new style is loaded, so
  // toggling theme doesn't silently zoom back out to a world view.
  const preservedCenter = map.getCenter();
  const preservedZoom = map.getZoom();
  map.setStyle(mapStyleFor(state.theme));
  map.once("style.load", () => {
    map.jumpTo({ center: preservedCenter, zoom: preservedZoom });
  });
  // renderClusterLayer() gets called again automatically via the
  // persistent "style.load" listener registered near map init.
}

function applyTheme() {
  document.body.setAttribute("data-theme", state.theme);
  document.getElementById("theme-icon").innerHTML = state.theme === "dark" ? "&#9728;" : "&#9790;";
}

// --- Language ---

function toggleLanguage() {
  state.language = state.language === "en" ? "local" : "en";
  applyLanguageLabel();
  renderHotelList();
  if (!document.getElementById("hotel-detail").classList.contains("hidden")) {
    // Detail view will just show whatever was last opened; re-opening picks up the new language.
  }
}

function applyLanguageLabel() {
  document.getElementById("lang-label").textContent = state.language === "en" ? "EN" : "Local";
}

function displayName(place) {
  if (state.language === "en" && place.name_en) return place.name_en;
  return place.name;
}

// --- Layer / filter controls ---

function setActiveLayer(layer) {
  state.activeLayer = layer;
  document.querySelectorAll("#layer-filters .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.layer === layer);
  });
  document.getElementById("food-subfilters").classList.toggle("hidden", layer !== "food");
  document.getElementById("panel-content").querySelector(".panel-section:last-child").style.display =
    layer === "hotels" ? "" : "none";
  renderClusterLayer();
}

function setFoodCategory(cat) {
  state.activeFoodCategory = cat;
  document.querySelectorAll("#food-subfilters .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.food === cat);
  });
  renderClusterLayer();
}

// --- Circuit marker (always a plain DOM marker, never clustered) ---

function renderCircuitMarker() {
  state.markers.forEach((m) => m.remove());
  state.markers = [];

  const { circuit } = state.currentData;
  const el = document.createElement("div");
  el.style.cssText =
    "width:16px;height:16px;border-radius:50%;background:#c0392b;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.15);";
  state.markers.push(
    new maplibregl.Marker({ element: el })
      .setLngLat([circuit.lng, circuit.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(circuit.name))
      .addTo(map)
  );
}

// --- Clustered hotel/food layer ---

function currentPoints() {
  if (!state.currentData) return [];
  if (state.activeLayer === "hotels") return state.currentData.hotels;
  return state.currentData.food.filter(
    (f) => state.activeFoodCategory === "all" || f.food_group === state.activeFoodCategory
  );
}

function toGeoJSON(points) {
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { ...p },
    })),
  };
}

function renderClusterLayer() {
  if (!map.isStyleLoaded()) {
    map.once("idle", renderClusterLayer);
    return;
  }

  const sourceId = "places";
  const points = currentPoints();
  const color = state.activeLayer === "hotels" ? HOTEL_COLOR : FOOD_COLOR;

  if (map.getLayer("clusters")) map.removeLayer("clusters");
  if (map.getLayer("cluster-count")) map.removeLayer("cluster-count");
  if (map.getLayer("unclustered-point")) map.removeLayer("unclustered-point");
  if (map.getSource(sourceId)) map.removeSource(sourceId);

  map.addSource(sourceId, {
    type: "geojson",
    data: toGeoJSON(points),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 45,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: sourceId,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": CLUSTER_COLOR,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 25, 26],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: sourceId,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
      "text-font": ["Noto Sans Bold"],
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: sourceId,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": color,
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.on("click", "clusters", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource(sourceId).getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });
  });

  map.on("click", "unclustered-point", (e) => {
    const props = e.features[0].properties;
    if (state.activeLayer === "hotels") {
      const hotel = state.currentData.hotels.find((h) => h.name === props.name && h.lat === props.lat);
      if (hotel) showHotelDetail(hotel);
    } else {
      new maplibregl.Popup({ offset: 10 }).setLngLat(e.lngLat).setText(displayName(props)).addTo(map);
    }
  });

  map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));
  map.on("mouseenter", "unclustered-point", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "unclustered-point", () => (map.getCanvas().style.cursor = ""));
}

// --- Hotel list, synced to the current map viewport ---

function renderHotelList() {
  if (!state.currentData) return;
  const list = document.getElementById("hotel-list");
  const countBadge = document.getElementById("in-view-count");
  list.innerHTML = "";

  const bounds = map.getBounds();
  const hotels = state.currentData.hotels.filter((h) => bounds.contains([h.lng, h.lat]));
  countBadge.textContent = hotels.length;

  if (!hotels.length) {
    list.innerHTML = '<p class="empty-state">No hotels in the current map view. Pan or zoom out.</p>';
    return;
  }

  hotels
    .slice()
    .sort((a, b) => a.distance_km - b.distance_km)
    .forEach((h) => {
      const card = document.createElement("div");
      card.className = "hotel-card";
      card.innerHTML = `
        <div>
          <p class="hotel-name">${escapeHtml(displayName(h))}</p>
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
    <h1 style="font-size:18px;margin:12px 0 2px;">${escapeHtml(displayName(hotel))}</h1>
    <p class="muted small" style="margin:0 0 14px;">${hotel.distance_km} km from circuit &middot; <span class="tier-badge ${TIER_CLASS[hotel.access_tier] || ""}">${hotel.access_tier}</span></p>
    <p class="section-label">Nearby (within 1 km)</p>
    ${
      nearbyFood.length
        ? nearbyFood
            .slice(0, 6)
            .map(
              (f) => `<div class="detail-row"><span>${escapeHtml(displayName(f))}</span><span class="muted">${f.d.toFixed(2)} km</span></div>`
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