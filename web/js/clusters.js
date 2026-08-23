// Circuit marker plus the clustered hotel/food layer: rendering, layer/
// filter switching, and the click/hover interactions for clusters and
// individual points.

import { state, CLUSTER_COLOR, HOTEL_COLOR, FOOD_COLOR, SOURCE_ID } from "./state.js";
import { map } from "./map.js";
import { displayName } from "./utils.js";
import { showHotelDetail } from "./hotels.js";

// --- Circuit marker (always a plain DOM marker, never clustered) ---

export function renderCircuitMarker() {
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

export function renderClusterLayer() {
  if (!map.isStyleLoaded()) {
    map.once("idle", renderClusterLayer);
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
      "circle-color": CLUSTER_COLOR,
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
    const clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    if (clusterFeatures.length) {
      const clusterId = clusterFeatures[0].properties.cluster_id;
      map.getSource(SOURCE_ID).getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        // getClusterExpansionZoom can come back with a null zoom (no error)
        // in some edge cases — passing that straight to easeTo throws a
        // validation error and silently aborts. Fall back to a reasonable
        // "zoom in a bit" default instead.
        const targetZoom = zoom == null ? Math.min(map.getZoom() + 2, 16) : zoom;
        map.easeTo({ center: clusterFeatures[0].geometry.coordinates, zoom: targetZoom });
      });
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
    const hits = map.queryRenderedFeatures(e.point, { layers: ["clusters", "unclustered-point"] });
    map.getCanvas().style.cursor = hits.length ? "pointer" : "";
  });
}
