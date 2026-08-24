// Hotel list (synced to the current map viewport), the hotel detail panel,
// and the race weekend schedule collapsible.

import { state, TIER_CLASS, HIGHLIGHT_COLOR, HOTEL_COLOR, TRANSIT_LABELS, TRANSIT_CONFIDENT_CLASSES, TRANSIT_CLASS_PRIORITY } from "./state.js";
import { map } from "./map.js";
import { haversineKm, escapeHtml, displayName } from "./utils.js";

export function renderHotelList() {
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

export function showHotelDetail(hotel) {
  document.getElementById("panel-content").classList.add("hidden");
  document.getElementById("hotel-detail").classList.remove("hidden");

  renderSelectedHotelMarker(hotel);
  clearSelectedPoiMarker();

  // Hiding, not another camera-movement change: the cluster/cluster-count
  // layers' underlying data is recomputed in a background worker whenever
  // zoom changes, and that recompute lags slightly behind the camera —
  // regardless of flyTo/easeTo/jumpTo. During that lag the layer can
  // briefly show the previous zoom's (clustered) data. Hiding it for the
  // transition and revealing it once the map is truly idle sidesteps the
  // issue entirely instead of chasing camera-animation timing further.
  if (map.getLayer("clusters")) map.setLayoutProperty("clusters", "visibility", "none");
  if (map.getLayer("cluster-count")) map.setLayoutProperty("cluster-count", "visibility", "none");
  map.jumpTo({ center: [hotel.lng, hotel.lat], zoom: 15 });
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
    <h1 style="font-size:18px;margin:12px 0 4px;">${escapeHtml(displayName(hotel))}</h1>
    <div style="display:flex;align-items:center;gap:8px;margin:0 0 16px;">
      <span class="muted small">${hotel.distance_km} km from circuit</span>
      <span class="tier-badge ${TIER_CLASS[hotel.access_tier] || ""}">${hotel.access_tier}</span>
    </div>

    <p class="detail-section-header food">Food options nearby</p>
    <div class="detail-card food">
      ${
        nearbyFood.length
          ? nearbyFood
              .slice(0, 6)
              .map(
                (f, i) => `<div class="detail-row clickable" data-poi-type="food" data-poi-index="${i}"><span>${escapeHtml(displayName(f))}</span><span class="muted">${f.d.toFixed(2)} km</span></div>`
              )
              .join("")
          : '<p class="empty-state">No food places within 1 km in the current data.</p>'
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
                return `<div class="detail-row clickable" data-poi-type="transit" data-poi-index="${i}"><span>${escapeHtml(t.name)}</span><span style="display:flex;align-items:center;gap:8px;"><span class="transit-badge ${confident ? "confident" : "neutral"}">${label}</span><span class="muted">${t.d.toFixed(2)} km</span></span></div>`;
              })
              .join("")
          : '<p class="empty-state">No transit stops within 500 m in the current data.</p>'
      }
    </div>

    <p class="detail-footnote">
      Distances are straight-line, not routed. Access tier is derived from distance only —
      see the README for the exact thresholds and their limits.
    </p>
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
  document.getElementById("hotel-detail").classList.add("hidden");
  document.getElementById("panel-content").classList.remove("hidden");
  clearSelectedHotelMarker();
  clearSelectedPoiMarker();
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
    // Only touch the cluster/dot layers while a hotel is actively selected —
    // during normal hotel-list browsing these layers should always be visible
    // regardless of zoom. Also, only hide them if genuinely zoomed out past the
    // threshold; at zoom ≥ 12 always keep them visible.
    if (state.selectedHotelMarker) {
      const vis = zoomed ? "visible" : "none";
      if (map.getLayer("clusters")) map.setLayoutProperty("clusters", "visibility", vis);
      if (map.getLayer("cluster-count")) map.setLayoutProperty("cluster-count", "visibility", vis);
      // unclustered-point is visible at zoom > 14 (clusterMaxZoom) — let
      // MapLibre's own zoom filtering handle when it shows; we only force-hide
      // it when zoomed all the way out past our THRESHOLD.
      if (!zoomed && map.getLayer("unclustered-point")) {
        map.setLayoutProperty("unclustered-point", "visibility", "none");
      } else if (zoomed && map.getLayer("unclustered-point")) {
        map.setLayoutProperty("unclustered-point", "visibility", "visible");
      }
    }
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

export function toggleSchedule() {
  const body = document.getElementById("schedule-body");
  const chevron = document.getElementById("schedule-chevron");
  const btn = document.getElementById("schedule-toggle");
  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!expanded));
  body.classList.toggle("hidden");
  chevron.innerHTML = expanded ? "&#9662;" : "&#9652;";
}
