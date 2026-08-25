// Circuit marker plus the clustered hotel/food layer: rendering, layer/
// filter switching, and the click/hover interactions for clusters and
// individual points.

import { state, HOTEL_COLOR, FOOD_COLOR, CIRCUIT_COLOR, getCircuitColor, SOURCE_ID } from "./state.js";
import { map } from "./map.js";
import { displayName } from "./utils.js";
import { showHotelDetail } from "./hotels.js";

// --- Circuit marker (always a plain DOM marker, never clustered) ---

export function renderCircuitMarker() {
  state.markers.forEach((m) => m.remove());
  state.markers = [];

  const { circuit } = state.currentData;
  const el = document.createElement("div");
  const color = getCircuitColor();
  el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 2px ${color}66, 0 2px 6px rgba(0,0,0,0.3);`;
  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([circuit.lng, circuit.lat])
    .setPopup(new maplibregl.Popup({ offset: 16 }).setText(circuit.name))
    .addTo(map);
  state.markers.push(marker);

  // Also store reference for the zoom-visibility handler
  state.circuitMarker = marker;
}

// --- Layer / filter controls ---

export function setActiveLayer(layer) {
  state.activeLayer = layer;
  document.querySelectorAll("#layer-filters .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.layer === layer);
  });
  document.getElementById("food-subfilters").classList.toggle("hidden", layer !== "food");
  document.getElementById("panel-content").querySelector(".panel-section:last-child").style.display =
    layer === "hotels" ? "" : "none";
  renderClusterLayer();
}

export function setFoodCategory(cat) {
  state.activeFoodCategory = cat;
  document.querySelectorAll("#food-subfilters .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.food === cat);
  });
  renderClusterLayer();
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

export function renderClusterLayer(force = false) {
  if (!force && !map.isStyleLoaded()) {
    map.once("idle", () => renderClusterLayer());
    return;
  }

  const points = currentPoints();
  const color = state.activeLayer === "hotels" ? HOTEL_COLOR : FOOD_COLOR;

  if (map.getLayer("clusters")) map.removeLayer("clusters");
  if (map.getLayer("cluster-count")) map.removeLayer("cluster-count");
  if (map.getLayer("unclustered-point")) map.removeLayer("unclustered-point");
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: toGeoJSON(points),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 45,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": color,
      "circle-radius": ["step", ["coalesce", ["get", "point_count"], 0], 16, 10, 20, 25, 26],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: SOURCE_ID,
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
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": color,
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

// --- Click/hover interactions ---
// Registered once from main.js's init, not inside renderClusterLayer (which
// runs repeatedly on every layer switch, filter change, and theme toggle).
// MapLibre binds these by layer ID, so a single registration keeps working
// correctly even after that layer is removed and re-added.

export function registerClusterInteractions() {
  // Deliberately NOT using MapLibre's delegated on(type, layerId, fn) form
  // here. That form appeared to silently stop matching after the clusters
  // layer had been removed and re-added a few times (which renderClusterLayer
  // does on every circuit load, filter change, and theme toggle) — confirmed
  // via a manual console test that a plain click + queryRenderedFeatures at
  // the same point found the feature fine when the delegated handler didn't
  // fire at all. Using the generic form with a manual query sidesteps that.
  map.on("click", (e) => {
    // queryRenderedFeatures throws if the named layer doesn't currently
    // exist on the style at all (not just "has no features here") — true
    // whenever no circuit is loaded yet, or briefly during a theme swap
    // before renderClusterLayer re-adds it. Bail out early in that case.
    if (!map.getLayer("clusters")) return;

    const clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    if (clusterFeatures.length) {
      const clusterId = clusterFeatures[0].properties.cluster_id;
      // This MapLibre version's getClusterExpansionZoom returns a Promise,
      // not the older Node-style (err, zoom) callback — confirmed directly
      // in the console (a callback passed here was simply never invoked,
      // even though the Promise itself resolved fine). Using .then() here
      // instead of a callback is the actual fix, not a workaround.
      map
        .getSource(SOURCE_ID)
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => {
          const targetZoom = zoom == null ? Math.min(map.getZoom() + 2, 16) : zoom;
          map.easeTo({ center: clusterFeatures[0].geometry.coordinates, zoom: targetZoom });
        })
        .catch(() => {});
      return;
    }

    const pointFeatures = map.queryRenderedFeatures(e.point, { layers: ["unclustered-point"] });
    if (!pointFeatures.length) return;
    const props = pointFeatures[0].properties;
    if (state.activeLayer === "hotels") {
      const hotel = state.currentData.hotels.find((h) => h.name === props.name && h.lat === props.lat);
      if (hotel) showHotelDetail(hotel);
    } else {
      new maplibregl.Popup({ offset: 10 }).setLngLat(e.lngLat).setText(displayName(props)).addTo(map);
    }
  });

  map.on("mousemove", (e) => {
    if (!map.getLayer("clusters")) {
      map.getCanvas().style.cursor = "";
      return;
    }
    const hits = map.queryRenderedFeatures(e.point, { layers: ["clusters", "unclustered-point"] });
    map.getCanvas().style.cursor = hits.length ? "pointer" : "";
  });
}
