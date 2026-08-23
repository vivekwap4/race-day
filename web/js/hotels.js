// Hotel list (synced to the current map viewport), the hotel detail panel,
// and the race weekend schedule collapsible.

import { state, TIER_CLASS } from "./state.js";
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

  map.flyTo({ center: [hotel.lng, hotel.lat], zoom: 15 });

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

export function showHotelList() {
  document.getElementById("hotel-detail").classList.add("hidden");
  document.getElementById("panel-content").classList.remove("hidden");
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
