// Hotel list (synced to the current map viewport), the hotel detail panel,
// and the race weekend schedule collapsible.

import { state, TIER_CLASS, HIGHLIGHT_COLOR, HOTEL_COLOR, TRANSIT_LABELS, TRANSIT_CONFIDENT_CLASSES, TRANSIT_CLASS_PRIORITY, formatDist } from "./state.js";
import { map } from "./map.js";
import { haversineKm, escapeHtml, displayName } from "./utils.js";

export function renderHotelList() {
  if (!state.currentData) return;
  const list = document.getElementById("hotel-list");
  const countBadge = document.getElementById("in-view-count");
  list.innerHTML = "";

  // Below zoom 13, the viewport covers too large an area for the list to be
  // useful — hundreds of hotels, no meaningful way to choose. Prompt the user
  // to zoom in instead. At zoom 13+ the list is genuinely navigable.
  const LIST_ZOOM_THRESHOLD = 13;
  if (map.getZoom() < LIST_ZOOM_THRESHOLD) {
    countBadge.textContent = "—";
    list.innerHTML = '<p class="empty-state">Zoom in to see hotels in this area.</p>';
    return;
  }

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
          <p class="hotel-distance">${formatDist(h.distance_km)}</p>
        </div>
        <span class="tier-badge ${TIER_CLASS[h.access_tier] || ""}">${h.access_tier}</span>
      `;
      card.addEventListener("click", () => showHotelDetail(h));
      list.appendChild(card);
    });
}

// Food category pill labels shown in the hotel detail panel
const FOOD_GROUP_LABELS = {
  all:        "All",
  restaurant: "Restaurants",
  cafe:       "Cafes",
  bar:        "Bars",
  fast_food:  "Fast food",
};

// Active food category filter within the hotel detail (separate from the
// main Hotels/Food map layer toggle)
let _detailFoodCategory = "all";

// Active MapLibre popup (for hover/tap on unclustered food/transit dots)
let _activePopup = null;
let _lastPopupArgs = null;
let _isReplacingPopup = false; // set synchronously around programmatic .remove()

function clearPopup() {
  if (_activePopup) {
    _isReplacingPopup = true;
    _activePopup.remove();
    _activePopup = null;
    _isReplacingPopup = false;
  }
}

export function isClickPopupAt(lng, lat) {
  if (!_activePopup) return false;
  const pos = _activePopup.getLngLat();
  return Math.abs(pos.lng - lng) < 0.00001 && Math.abs(pos.lat - lat) < 0.00001;
}

export function rerenderPopupAfterThemeChange() {
  if (_lastPopupArgs) _renderPopup(..._lastPopupArgs);
}

function makePillHtml(category, label, color, isActive) {
  const bg   = isActive ? color : "var(--card-bg)";
  const fg   = isActive ? "#fff" : "var(--text-secondary)";
  const bdr  = isActive ? "none" : "0.5px solid var(--border)";
  return `<button class="food-pill${isActive ? " active" : ""}" data-cat="${category}"
    style="background:${bg};color:${fg};border:${bdr};font-size:12px;padding:4px 12px;
    border-radius:999px;cursor:pointer;white-space:nowrap;font-weight:${isActive ? "600" : "400"};"
  >${label}</button>`;
}

function renderFoodRows(nearbyFood, activeCat) {
  const filtered = activeCat === "all"
    ? nearbyFood
    : nearbyFood.filter(f => f.food_group === activeCat);
  const limited  = filtered.slice(0, 8); // hard cap
  if (!limited.length) {
    return `<p class="empty-state">No ${activeCat === "all" ? "" : FOOD_GROUP_LABELS[activeCat]?.toLowerCase() + " "}options within 500 m.</p>`;
  }
  return limited.map((f, i) =>
    `<div class="detail-row clickable" data-poi-type="food" data-poi-index="${i}">
       <span>${escapeHtml(displayName(f))}</span>
       <span class="muted">${formatDist(f.d.toFixed(2))}</span>
     </div>`
  ).join("");
}

export function showPopup(lng, lat, name, categoryLabel, categoryColor, distStr) {
  if (_activePopup) {
    _isReplacingPopup = true;
    _activePopup.remove();
    _activePopup = null;
    _isReplacingPopup = false;
  }
  _lastPopupArgs = [lng, lat, name, categoryLabel, categoryColor, distStr];
  _renderPopup(lng, lat, name, categoryLabel, categoryColor, distStr);
}

function _renderPopup(lng, lat, name, categoryLabel, categoryColor, distStr) {
  if (_activePopup) {
    _isReplacingPopup = true;
    _activePopup.remove();
    _activePopup = null;
    _isReplacingPopup = false;
  }
  const emoji = categoryColor === "#2563eb" ? "🚌"
    : categoryColor === "#e63946" ? "🏨"
    : "🍽️";
  // Use CSS classes for text colors — they pick up CSS variable changes
  // automatically when the theme switches, no JS re-render needed.
  const html = `<div class="rd-popup">
    <div class="rd-popup-header">
      <span class="rd-popup-emoji">${emoji}</span>
      <span class="rd-popup-name">${escapeHtml(name)}</span>
    </div>
    <div class="rd-popup-meta">
      <span class="rd-popup-pill" style="background:${categoryColor}20;color:${categoryColor};">${escapeHtml(categoryLabel)}</span>
      ${distStr ? `<span class="rd-popup-dist">${distStr}</span>` : ""}
    </div>
  </div>`;
  _activePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    offset: 14,
    className: "race-day-popup",
    maxWidth: "260px",
  }).setLngLat([lng, lat]).setHTML(html).addTo(map);
  _activePopup.on("close", () => {
    _activePopup = null;
    _lastPopupArgs = null;
    if (!_isReplacingPopup) {
      clearRoute();
      clearSelectedPoiMarker();
    }
  });
}

export function showHotelDetail(hotel) {
  state.currentHotel = hotel;
  _detailFoodCategory = "all";
  document.getElementById("panel-content").classList.add("hidden");
  document.getElementById("hotel-detail").classList.remove("hidden");

  renderSelectedHotelMarker(hotel);
  clearSelectedPoiMarker();
  clearRoute();
  clearPopup();

  if (map.getLayer("clusters")) map.setLayoutProperty("clusters", "visibility", "none");
  if (map.getLayer("cluster-count")) map.setLayoutProperty("cluster-count", "visibility", "none");
  map.easeTo({ center: [hotel.lng, hotel.lat], zoom: 15, duration: 600 });
  map.once("idle", () => {
    if (map.getLayer("clusters")) map.setLayoutProperty("clusters", "visibility", "visible");
    if (map.getLayer("cluster-count")) map.setLayoutProperty("cluster-count", "visibility", "visible");
  });

  // Hard 500m limit for both food and transit
  const nearbyFood = state.currentData.food
    .map((f) => ({ ...f, d: haversineKm(hotel.lat, hotel.lng, f.lat, f.lng) }))
    .filter((f) => f.d <= 0.5)
    .sort((a, b) => a.d - b.d);

  const nearbyTransit = dedupeTransit(
    (state.currentData.transit || [])
      .map((t) => ({ ...t, d: haversineKm(hotel.lat, hotel.lng, t.lat, t.lng) }))
      .filter((t) => t.d <= 0.5)
  ).sort((a, b) => a.d - b.d).slice(0, 8);

  state._nearbyFood    = nearbyFood;
  state._nearbyTransit = nearbyTransit;

  // Determine which food category pills to show (only those with results)
  const availableGroups = ["all", ...["restaurant","cafe","bar","fast_food"]
    .filter(g => nearbyFood.some(f => f.food_group === g))];

  function buildHtml(activeCat) {
    const pills = availableGroups.map(g =>
      makePillHtml(g, FOOD_GROUP_LABELS[g], "#d97706", g === activeCat)
    ).join("");

    const transitRows = nearbyTransit.length
      ? nearbyTransit.map((t, i) => {
          const confident = TRANSIT_CONFIDENT_CLASSES.has(t.class);
          const label = TRANSIT_LABELS[t.class] || t.class;
          return `<div class="detail-row clickable transit-row" data-poi-type="transit" data-poi-index="${i}">
            <span>${escapeHtml(t.name)}</span>
            <span class="transit-badge ${confident ? "confident" : "neutral"}">${label}</span>
            <span class="transit-dist">${formatDist(t.d.toFixed(2))}</span>
          </div>`;
        }).join("")
      : '<p class="empty-state">No transit stops within 500 m.</p>';

    return `
      <div class="hotel-header-card">
        <div class="hotel-header-top">
          <h1 class="hotel-header-name">${escapeHtml(displayName(hotel))}</h1>
          <span class="tier-badge ${TIER_CLASS[hotel.access_tier] || ""}">${hotel.access_tier}</span>
        </div>
        <p class="hotel-header-distance">${formatDist(hotel.distance_km)} from circuit</p>
      </div>

      <p class="detail-section-header food">Food nearby</p>
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:10px;scrollbar-width:none;">
        ${pills}
      </div>
      <div class="detail-card food" id="food-rows">
        ${renderFoodRows(nearbyFood, activeCat)}
      </div>

      <p class="detail-section-header transit">Transit nearby</p>
      <div class="detail-card transit">${transitRows}</div>
    `;
  }

  document.getElementById("hotel-detail-body").innerHTML = buildHtml("all");

  function wireHandlers() {
    // Category pill clicks
    document.querySelectorAll(".food-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        _detailFoodCategory = pill.dataset.cat;
        document.getElementById("food-rows").innerHTML =
          renderFoodRows(nearbyFood, _detailFoodCategory);
        document.querySelectorAll(".food-pill").forEach(p => {
          const active = p.dataset.cat === _detailFoodCategory;
          p.style.background = active ? "#d97706" : "var(--card-bg)";
          p.style.color      = active ? "#fff"    : "var(--text-secondary)";
          p.style.border     = active ? "none"    : "0.5px solid var(--border)";
          p.style.fontWeight = active ? "600"     : "400";
        });
        wireFoodRowHandlers();
      });
    });
    wireFoodRowHandlers();
    wireTransitRowHandlers();
  }

  function wireFoodRowHandlers() {
    document.querySelectorAll("#food-rows .detail-row.clickable").forEach((row) => {
      row.addEventListener("click", () => {
        const filtered = _detailFoodCategory === "all"
          ? nearbyFood
          : nearbyFood.filter(f => f.food_group === _detailFoodCategory);
        const poi = filtered[parseInt(row.dataset.poiIndex, 10)];
        if (!poi) return;
        activatePoi(poi, "food", hotel, row);
      });
    });
  }

  function wireTransitRowHandlers() {
    document.querySelectorAll("#hotel-detail-body .detail-row.clickable[data-poi-type='transit']").forEach((row) => {
      row.addEventListener("click", () => {
        const poi = nearbyTransit[parseInt(row.dataset.poiIndex, 10)];
        if (!poi) return;
        activatePoi(poi, "transit", hotel, row);
      });
    });
  }

  wireHandlers();
}

// Shared handler for tapping a food/transit POI — from the panel list OR
// from the map. Draws the route, shows the popup, fits the viewport.
export function activatePoi(poi, type, hotel, activeRow) {
  const color = type === "food" ? "#d97706" : "#2563eb";
  const label = type === "food"
    ? (FOOD_GROUP_LABELS[poi.food_group] || poi.category || "Food")
    : (TRANSIT_LABELS[poi.class] || poi.class || "Transit");

  renderSelectedPoiMarker(poi.lng, poi.lat, color);

  // Show popup immediately with straight-line distance as placeholder;
  // updates to walking distance once OSRM resolves.
  showPopup(poi.lng, poi.lat, displayName(poi), label, color,
    `${formatDist(poi.d.toFixed(2))} straight-line`);

  drawConnectionLine(hotel.lng, hotel.lat, poi.lng, poi.lat, (walkDist, walkMins) => {
    // Update popup with actual walking distance once route arrives
    showPopup(poi.lng, poi.lat, displayName(poi), label, color,
      `${walkDist} · ~${walkMins} min walk`);
  });

  // Fit both hotel and POI in viewport
  if (hotel) {
    const minLng = Math.min(hotel.lng, poi.lng);
    const maxLng = Math.max(hotel.lng, poi.lng);
    const minLat = Math.min(hotel.lat, poi.lat);
    const maxLat = Math.max(hotel.lat, poi.lat);
    const sameLoc = Math.abs(maxLng - minLng) < 0.0001 && Math.abs(maxLat - minLat) < 0.0001;
    if (sameLoc) {
      map.jumpTo({ center: [poi.lng, poi.lat], zoom: 17 });
    } else {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
        padding: { top: 80, bottom: 80, left: 80, right: 80 },
        maxZoom: 17,
      });
    }
  }

  // Highlight active row in panel if tapped from list
  if (activeRow) {
    document.querySelectorAll("#hotel-detail-body .detail-row.clickable")
      .forEach(r => r.classList.remove("active"));
    activeRow.classList.add("active");
  }
}

// Overture/OSM model a single physical stop as several records —
// one stop_position plus one platform per direction — all sharing the same
// name and sitting almost on top of each other. Merge those into one row,
// keeping the closest distance and the most specific/informative class
// available among the duplicates (see TRANSIT_CLASS_PRIORITY).
function dedupeTransit(list) {
  const byName = new Map();
  list.forEach((t) => {
    const existing = byName.get(t.name);
    if (!existing) {
      byName.set(t.name, { ...t });
      return;
    }
    if (t.d < existing.d) existing.d = t.d;
    if (TRANSIT_CLASS_PRIORITY.indexOf(t.class) < TRANSIT_CLASS_PRIORITY.indexOf(existing.class)) {
      existing.class = t.class;
    }
  });
  return Array.from(byName.values());
}

export function showHotelList() {
  state.currentHotel = null;
  document.getElementById("hotel-detail").classList.add("hidden");
  document.getElementById("panel-content").classList.remove("hidden");
  clearSelectedHotelMarker();
  clearSelectedPoiMarker();
  clearRoute();
}

// --- Zoom-based visibility: hide the hotel highlight pin and hotel/cluster
// layers when the user zooms out past a threshold (zoom < 12). At that zoom
// level an individual hotel pin over a country-scale view is meaningless noise.
// Registered once from main.js so it's not re-registered on every panel switch.
export function registerZoomVisibilityHandler() {
  const THRESHOLD = 12;
  map.on("zoom", () => {
    const zoomed = map.getZoom() >= THRESHOLD;
    // Hotel highlight pin and its persistent dot
    if (state.selectedHotelMarker) {
      state.selectedHotelMarker.getElement().style.display = zoomed ? "" : "none";
    }
    if (state.selectedHotelDot) {
      state.selectedHotelDot.getElement().style.display = zoomed ? "" : "none";
    }
    // Secondary POI pin and its dot
    if (state.selectedPoiMarker) {
      state.selectedPoiMarker.getElement().style.display = zoomed ? "" : "none";
    }
    if (state.selectedPoiDot) {
      state.selectedPoiDot.getElement().style.display = zoomed ? "" : "none";
    }
    // Hide cluster layers below zoom threshold regardless of selection state.
    // Previously this only fired when a hotel was selected, but clicking a
    // bubble (expand cluster) also leaves cluster layers visible on zoom-out.
    if (map.getLayer("clusters")) map.setLayoutProperty("clusters", "visibility", zoomed ? "visible" : "none");
    if (map.getLayer("cluster-count")) map.setLayoutProperty("cluster-count", "visibility", zoomed ? "visible" : "none");
    if (map.getLayer("unclustered-point")) map.setLayoutProperty("unclustered-point", "visibility", zoomed ? "visible" : "none");
  });
}

// --- Highlight marker for the currently-selected hotel (green teardrop pin).

function renderSelectedHotelMarker(hotel) {
  clearSelectedHotelMarker();
  const el = document.createElement("div");
  el.className = "hotel-highlight-marker";
  el.innerHTML = `
    <svg width="32" height="29" viewBox="0 0 24 22" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${HIGHLIGHT_COLOR}" stroke="#ffffff" stroke-width="1"/>
      <circle cx="12" cy="9" r="3" fill="#ffffff"/>
    </svg>
  `;
  state.selectedHotelMarker = new maplibregl.Marker({ element: el, anchor: "bottom" })
    .setLngLat([hotel.lng, hotel.lat])
    .addTo(map);

  // Persistent DOM dot — the layer-based unclustered-point dot disappears when
  // switching to the Food layer (which replaces the entire source). This marker
  // is independent of the data layer so it stays visible regardless.
  const dot = document.createElement("div");
  dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${HOTEL_COLOR};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
  state.selectedHotelDot = new maplibregl.Marker({ element: dot })
    .setLngLat([hotel.lng, hotel.lat])
    .addTo(map);
}

export function clearSelectedHotelMarker() {
  if (state.selectedHotelMarker) {
    state.selectedHotelMarker.remove();
    state.selectedHotelMarker = null;
  }
  if (state.selectedHotelDot) {
    state.selectedHotelDot.remove();
    state.selectedHotelDot = null;
  }
}

// --- Secondary marker for a tapped food/transit row. Smaller hollow teardrop
// in the section's own color (amber for food, blue for transit), distinct from
// the filled hotel pin so both are readable at the same time.

function renderSelectedPoiMarker(lng, lat, color) {
  clearSelectedPoiMarker();
  const el = document.createElement("div");
  el.innerHTML = `
    <svg width="24" height="22" viewBox="0 0 24 22" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="12" cy="9" r="2.5" fill="#ffffff"/>
    </svg>
  `;
  state.selectedPoiMarker = new maplibregl.Marker({ element: el, anchor: "bottom" })
    .setLngLat([lng, lat])
    .addTo(map);

  // Also add a plain dot at the exact coordinate so the location is visible
  // regardless of which layer filter (Hotels/Food) is currently active —
  // the layer-based unclustered-point dots disappear when switching layers,
  // but this DOM marker is independent of the data layer.
  const dot = document.createElement("div");
  dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
  state.selectedPoiDot = new maplibregl.Marker({ element: dot })
    .setLngLat([lng, lat])
    .addTo(map);
}

export function clearSelectedPoiMarker() {
  if (state.selectedPoiMarker) {
    state.selectedPoiMarker.remove();
    state.selectedPoiMarker = null;
  }
  if (state.selectedPoiDot) {
    state.selectedPoiDot.remove();
    state.selectedPoiDot = null;
  }
}

// --- Walking route between hotel and selected POI via OSRM ---

const ROUTE_SOURCE = "walking-route";
const ROUTE_LAYER  = "walking-route-line";
const _routeCache  = {}; // session cache keyed by "lng1,lat1-lng2,lat2"
let _routeRequestId = 0; // incremented per request to discard stale responses
let _currentRouteGeometry = null; // stored so theme toggle can re-draw it

function routeCacheKey(lng1, lat1, lng2, lat2) {
  return `${lng1},${lat1}-${lng2},${lat2}`;
}

function routeColor() {
  // Visible against both the liberty (light) and fiord (dark) basemaps
  return state.theme === "dark" ? "#00fff5" : "#e63946";
}

async function fetchWalkingRoute(hotelLng, hotelLat, poiLng, poiLat) {
  const key = routeCacheKey(hotelLng, hotelLat, poiLng, poiLat);
  if (_routeCache[key]) return _routeCache[key];

  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${hotelLng},${hotelLat};${poiLng},${poiLat}?geometries=geojson&overview=full`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    const geometry = data?.routes?.[0]?.geometry;
    const duration = data?.routes?.[0]?.duration;
    const distance = data?.routes?.[0]?.distance;
    if (!geometry) throw new Error("No route geometry");
    const result = { geometry, duration, distance };
    _routeCache[key] = result;
    return result;
  } catch (err) {
    console.warn("[route] OSRM fetch failed, falling back to straight line:", err);
    return null;
  }
}

function removeRouteLayers() {
  if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
  if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
  const svg = document.getElementById("poi-connection-line");
  if (svg) svg.classList.add("hidden");
}

export function drawRoute(geometry) {
  removeRouteLayers(); // remove existing layers without wiping geometry state
  _currentRouteGeometry = geometry;
  if (!map.isStyleLoaded()) return;
  map.addSource(ROUTE_SOURCE, {
    type: "geojson",
    data: { type: "Feature", geometry },
  });
  map.addLayer({
    id: ROUTE_LAYER,
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": routeColor(),
      "line-width": 3,
      "line-dasharray": [2, 2],
      "line-opacity": 0.9,
    },
  });
}

export function clearRoute() {
  _currentRouteGeometry = null;
  removeRouteLayers();
}

export function redrawRouteAfterThemeChange() {
  if (_currentRouteGeometry) drawRoute(_currentRouteGeometry);
}

async function drawConnectionLine(hotelLng, hotelLat, poiLng, poiLat, onRouteResolved) {
  const requestId = ++_routeRequestId;
  const route = await fetchWalkingRoute(hotelLng, hotelLat, poiLng, poiLat);
  if (requestId !== _routeRequestId) return;
  if (route) {
    drawRoute(route.geometry);
    if (onRouteResolved && route.distance != null && route.duration != null) {
      const distStr = formatDist((route.distance / 1000).toFixed(2));
      const mins = Math.round(route.duration / 60);
      onRouteResolved(distStr, mins);
    }
  } else {
    const svg = document.getElementById("poi-connection-line");
    if (svg) {
      svg.classList.remove("hidden");
      const seg = document.getElementById("poi-connection-segment");
      const updateSvg = () => {
        try {
          const h = map.project([hotelLng, hotelLat]);
          const p = map.project([poiLng, poiLat]);
          if (seg) { seg.setAttribute("x1", h.x); seg.setAttribute("y1", h.y); seg.setAttribute("x2", p.x); seg.setAttribute("y2", p.y); }
        } catch {}
      };
      updateSvg();
      map.on("move", updateSvg);
      map.on("zoom", updateSvg);
    }
  }
}

function clearConnectionLine() {
  clearRoute();
}

export function toggleSchedule() {
  const body = document.getElementById("schedule-body");
  const chevron = document.getElementById("schedule-chevron");
  const btn = document.getElementById("schedule-toggle");
  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!expanded));
  body.classList.toggle("hidden");
  chevron.innerHTML = expanded ? "&#9662;" : "&#9652;";
}
