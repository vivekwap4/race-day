// Circuit track outlines — loaded from a pre-filtered GeoJSON derived from
// https://github.com/bacinger/f1-circuits (MIT License, © Tomislav Bacinger).
// Only the 24 circuits in our app are included; geometry is unchanged.
//
// The GeoJSON is committed to the repo rather than fetched from GitHub at
// runtime, so the track outline renders with no external dependencies.

import { map } from "./map.js";
import { CIRCUIT_COLOR, getCircuitColor } from "./state.js";

const TRACK_SOURCE = "circuit-track";
const TRACK_LAYER = "circuit-track-line";
let trackData = null; // cached after first fetch

export async function loadTrackData() {
  if (trackData) return trackData;
  const res = await fetch("data/circuits-track.geojson");
  if (!res.ok) throw new Error("Failed to load circuit track data");
  trackData = await res.json();
  return trackData;
}

export async function renderTrack(circuitKey) {
  const data = await loadTrackData();
  const feature = data.features.find(
    (f) => f.properties.circuit_key === circuitKey
  );

  // Remove any existing track layer/source before adding the new one
  clearTrack();

  if (!feature) {
    // Not every circuit in our list necessarily has a track in the GeoJSON —
    // fail gracefully so nothing else breaks.
    console.warn(`No track geometry found for circuit key: ${circuitKey}`);
    return;
  }

  map.addSource(TRACK_SOURCE, {
    type: "geojson",
    data: feature,
  });

  map.addLayer({
    id: TRACK_LAYER,
    type: "line",
    source: TRACK_SOURCE,
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": getCircuitColor(),
      "line-width": 3,
      "line-opacity": 0.85,
    },
  });
}

export function clearTrack() {
  if (map.getLayer(TRACK_LAYER)) map.removeLayer(TRACK_LAYER);
  if (map.getSource(TRACK_SOURCE)) map.removeSource(TRACK_SOURCE);
}
