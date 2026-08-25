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

export function showHotelDetail(hotel) {
  state.currentHotel = hotel;
  document.getElementById("panel-content").classList.add("hidden");
  document.getElementById("hotel-detail").classList.remove("hidden");

  renderSelectedHotelMarker(hotel);
  clearSelectedPoiMarker();
  clearRoute();

  // Hiding, not another camera-movement change: the cluster/cluster-count
  // layers' underlying data is recomputed in a background worker whenever
  // zoom changes, and that recompute lags slightly behind the camera —
  // regardless of flyTo/easeTo/jumpTo. During that lag the layer can
  // briefly show the previous zoom's (clustered) data. Hiding it for the
  // transition and revealing it once the map is truly idle sidesteps the
  // issue entirely instead of chasing camera-animation timing further.
  if (map.getLayer("clusters")) map.setLayoutProperty("clusters", "visibility", "none");
  if (map.getLayer("cluster-count")) map.setLayoutProperty("cluster-count", "visibility", "none");
  // easeTo gives a smooth pan+zoom; jumpTo was instant (jarring). The cluster
  // flash that originally motivated using jumpTo is handled separately by hiding
  // the layer before the move and revealing it once idle — so we can use easeTo
  // here without the flash coming back.
  map.easeTo({ center: [hotel.lng, hotel.lat], zoom: 15, duration: 600 });
  map.once("idle", () => {
    if (map.getLayer("clusters")) map.setLayoutProperty("clusters", "visibility", "visible");
    if (map.getLayer("cluster-count")) map.setLayoutProperty("cluster-count", "visibility", "visible");
  });

  const nearbyFood = state.currentData.food
    .map((f) => ({ ...f, d: haversineKm(hotel.lat, hotel.lng, f.lat, f.lng) }))
    .filter((f) => f.d <= 1)
    .sort((a, b) => a.d - b.d);

  const nearbyTransit = dedupeTransit(
    (state.currentData.transit || [])
      .map((t) => ({ ...t, d: haversineKm(hotel.lat, hotel.lng, t.lat, t.lng) }))
      .filter((t) => t.d <= 0.5)
  ).sort((a, b) => a.d - b.d);

  // Store for click handlers to reference
  state._nearbyFood = nearbyFood;
  state._nearbyTransit = nearbyTransit;

  document.getElementById("hotel-detail-body").innerHTML = `
    <div class="hotel-header-card">
      <div class="hotel-header-top">
        <h1 class="hotel-header-name">${escapeHtml(displayName(hotel))}</h1>
        <span class="tier-badge ${TIER_CLASS[hotel.access_tier] || ""}">${hotel.access_tier}</span>
      </div>
      <p class="hotel-header-distance">${formatDist(hotel.distance_km)} from circuit</p>
      <p id="hotel-walk-info" class="hotel-walk-info hidden"></p>
    </div>

    <p class="detail-section-header food">Food options nearby</p>
    <div class="detail-card food">
      ${
        nearbyFood.length
          ? nearbyFood
              .slice(0, 6)
              .map(
                (f, i) => `<div class="detail-row clickable" data-poi-type="food" data-poi-index="${i}"><span>${escapeHtml(displayName(f))}</span><span class="muted">${formatDist(f.d.toFixed(2))}</span></div>`
              )
              .join("")
          : `<p class="empty-state">No food places within ${formatDist(1)} in the current data.</p>`
      }
    </div>

    <p class="detail-section-header transit">Transit nearby</p>
    <div class="detail-card transit">
      ${
        nearbyTransit.length
          ? nearbyTransit
              .slice(0, 6)
              .map((t, i) => {
                const confident = TRANSIT_CONFIDENT_CLASSES.has(t.class);
                const label = TRANSIT_LABELS[t.class] || t.class;
                return `<div class="detail-row clickable transit-row" data-poi-type="transit" data-poi-index="${i}"><span>${escapeHtml(t.name)}</span><span class="transit-badge ${confident ? "confident" : "neutral"}">${label}</span><span class="transit-dist">${formatDist(t.d.toFixed(2))}</span></div>`;
              })
              .join("")
          : '<p class="empty-state">No transit stops within 500 m in the current data.</p>'
      }
    </div>

  `;

  // Wire up click handlers on each row
  document.querySelectorAll("#hotel-detail-body .detail-row.clickable").forEach((row) => {
    row.addEventListener("click", () => {
      const type = row.dataset.poiType;
      const idx = parseInt(row.dataset.poiIndex, 10);
      const poi = type === "food" ? state._nearbyFood[idx] : state._nearbyTransit[idx];
      if (!poi) return;
      const color = type === "food" ? "#d97706" : "#2563eb";
      renderSelectedPoiMarker(poi.lng, poi.lat, color);
      drawConnectionLine(hotel.lng, hotel.lat, poi.lng, poi.lat);

      // Fit both the hotel and the tapped POI within the viewport — just
      // jumping to the POI's coordinates loses the hotel off-screen when
      // they're more than a block apart.
      const hotelLng = state.currentData && hotel ? hotel.lng : poi.lng;
      const hotelLat = state.currentData && hotel ? hotel.lat : poi.lat;
      const minLng = Math.min(hotelLng, poi.lng);
      const maxLng = Math.max(hotelLng, poi.lng);
      const minLat = Math.min(hotelLat, poi.lat);
      const maxLat = Math.max(hotelLat, poi.lat);

      // If they're essentially at the same point, just jump there directly
      // rather than fitBounds (which would zoom too far in with zero extent).
      const sameLoc = Math.abs(maxLng - minLng) < 0.0001 && Math.abs(maxLat - minLat) < 0.0001;
      if (sameLoc) {
        map.jumpTo({ center: [poi.lng, poi.lat], zoom: 17 });
      } else {
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
          maxZoom: 17,
        });
      }
      // Highlight the active row
      document.querySelectorAll("#hotel-detail-body .detail-row.clickable").forEach((r) =>
        r.classList.remove("active")
      );
      row.classList.add("active");
    });
  });
}

// Overture/OSM model a single physical stop as several records — typically
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
  clearConnectionLine();
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
  console.log("[route] clearRoute called from:", new Error().stack.split('\n')[2].trim());
  _currentRouteGeometry = null;
  removeRouteLayers();
}

export function redrawRouteAfterThemeChange() {
  console.log("[route] redrawRouteAfterThemeChange called, geometry:", _currentRouteGeometry ? "present" : "null");
  if (_currentRouteGeometry) drawRoute(_currentRouteGeometry);
}

async function drawConnectionLine(hotelLng, hotelLat, poiLng, poiLat) {
  // Increment request ID — if another POI is tapped before this resolves,
  // the stale response will be discarded and won't write to the wrong element.
  const requestId = ++_routeRequestId;

  const route = await fetchWalkingRoute(hotelLng, hotelLat, poiLng, poiLat);
  if (requestId !== _routeRequestId) return; // stale — a newer request is in flight

  if (route) {
    drawRoute(route.geometry);
    const walkEl = document.getElementById("hotel-walk-info");
    if (walkEl && route.distance != null && route.duration != null) {
      const distStr = formatDist((route.distance / 1000).toFixed(2));
      const mins = Math.round(route.duration / 60);
      walkEl.textContent = `${distStr} · ~${mins} min walk`;
      walkEl.classList.remove("hidden");
    }
  } else {
    // SVG fallback
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
