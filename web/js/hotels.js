// Hotel list (synced to the current map viewport), the hotel detail panel,
// and the race weekend schedule collapsible.

import { state, TIER_CLASS, HIGHLIGHT_COLOR, TRANSIT_LABELS, TRANSIT_CONFIDENT_CLASSES, TRANSIT_CLASS_PRIORITY } from "./state.js";
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

  // (state.currentData.transit || []) guards against data files extracted
  // before this field existed — old JSON just won't have a transit array.
  const nearbyTransit = dedupeTransit(
    (state.currentData.transit || [])
      .map((t) => ({ ...t, d: haversineKm(hotel.lat, hotel.lng, t.lat, t.lng) }))
      .filter((t) => t.d <= 0.5)
  ).sort((a, b) => a.d - b.d);

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
                (f) => `<div class="detail-row"><span>${escapeHtml(displayName(f))}</span><span class="muted">${f.d.toFixed(2)} km</span></div>`
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
              .map((t) => {
                const confident = TRANSIT_CONFIDENT_CLASSES.has(t.class);
                const label = TRANSIT_LABELS[t.class] || t.class;
                return `<div class="detail-row"><span>${escapeHtml(t.name)}</span><span style="display:flex;align-items:center;gap:8px;"><span class="transit-badge ${confident ? "confident" : "neutral"}">${label}</span><span class="muted">${t.d.toFixed(2)} km</span></span></div>`;
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
}

// --- Highlight marker for the currently-selected hotel, so it's easy to
// spot among all the other hotel points/bubbles on the map. Separate from
// the data-driven unclustered-point layer since MapLibre's layer paint
// can't easily single out one feature dynamically without a fragile
// per-selection filter expression — a plain DOM marker on top is simpler.

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
  // anchor: "bottom" so the pin's pointed tip sits exactly on the
  // coordinate, the same way a real map pin points at a location —
  // not the marker's visual center, which is what MapLibre uses by default.
  state.selectedHotelMarker = new maplibregl.Marker({ element: el, anchor: "bottom" })
    .setLngLat([hotel.lng, hotel.lat])
    .addTo(map);
}

export function clearSelectedHotelMarker() {
  if (state.selectedHotelMarker) {
    state.selectedHotelMarker.remove();
    state.selectedHotelMarker = null;
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
