// F1 car flythrough — animates a car marker between circuits in calendar
// order while the user is on the home world view (no circuit selected).
// Stops immediately on any user interaction or circuit selection.

import { map } from "./map.js";
import { state, getCircuitColor } from "./state.js";

const CAR_SOURCE  = "flythrough-path";
const CAR_LAYER   = "flythrough-path-line";
const LEG_MS      = 2500;
const PAUSE_MS    = 500;
const TRAIL_MAX_PTS = 120;
let _arrived = false;

let _carMarker    = null;
let _animFrame    = null;
let _timeout      = null;
let _running      = false;
let _legStartTime = null;
let _trailCoords  = [];
let _circuitOrder = [];
let _currentIdx   = 0;
let _fromCoord    = null;
let _toCoord      = null;
let _toCircuit    = null; // the circuit object at the destination

// --- Initialise trail layer on first call ---
function ensureTrailLayer() {
  if (map.getSource(CAR_SOURCE)) return;
  map.addSource(CAR_SOURCE, { type: "geojson", data: emptyLine() });
  map.addLayer({
    id: CAR_LAYER,
    type: "line",
    source: CAR_SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": getCircuitColor(),
      "line-width": 1.5,
      "line-dasharray": [3, 3],
      "line-opacity": 0.55,
    },
  });
}

function emptyLine() {
  return { type: "Feature", geometry: { type: "LineString", coordinates: [] } };
}

function updateTrail(coords) {
  if (!map.getSource(CAR_SOURCE)) return;
  map.getSource(CAR_SOURCE).setData({
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
  });
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}


function lerpCoord([lng1, lat1], [lng2, lat2], t) {
  // Shortest-path interpolation across the antimeridian
  let dLng = lng2 - lng1;
  if (dLng > 180)  dLng -= 360;
  if (dLng < -180) dLng += 360;
  return [lng1 + dLng * t, lat1 + (lat2 - lat1) * t];
}

// --- Car marker ---
function createCarMarker() {
  const el = document.createElement("div");
  el.style.cssText = "cursor:default;user-select:none;";
  const inner = document.createElement("span");
  inner.style.cssText = "font-size:22px;line-height:1;display:inline-block;";
  inner.textContent = "🏎️";
  el.appendChild(inner);
  return new maplibregl.Marker({ element: el, anchor: "center" });
}

let _labelPopup   = null;
let _lastLabelKey = null;

function showArrivalLabel(circuit) {
  if (!circuit) return;
  const key = circuit.race_name || circuit.name;
  if (_labelPopup) { _labelPopup.remove(); _labelPopup = null; }
  _lastLabelKey = key;
  const isDark = document.body.getAttribute("data-theme") === "dark";
  const textPrimary = isDark ? "#f0f0f0" : "#1a1a1a";
  const textSub     = isDark ? "#9aa0ad" : "#6b7280";
  const html = `<div style="padding:8px 12px;text-align:center;">
    <p style="font-size:13px;font-weight:700;margin:0 0 2px;color:${textPrimary};">${circuit.race_name || circuit.name}</p>
    <p style="font-size:11px;color:${textSub};margin:0;">${circuit.location}</p>
  </div>`;
  _labelPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
    anchor: "bottom",
    className: "race-day-popup flythrough-label",
    maxWidth: "220px",
  }).setLngLat([circuit.lng, circuit.lat]).setHTML(html).addTo(map);
}

function hideArrivalLabel() {
  if (_labelPopup) { _labelPopup.remove(); _labelPopup = null; }
}
function animateLeg() {
  if (!_running) return;
  const now = performance.now();
  const elapsed = now - _legStartTime;
  const t = Math.min(elapsed / LEG_MS, 1);
  const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  const pos = lerpCoord(_fromCoord, _toCoord, eased);

  _carMarker.setLngLat(pos);

  let dLng = _toCoord[0] - _fromCoord[0];
  if (dLng > 180)  dLng -= 360;
  if (dLng < -180) dLng += 360;
  const inner = _carMarker.getElement().querySelector("span");
  // 🏎️ faces left by default — flip when going east (dLng > 0)
  if (inner) inner.style.transform = dLng >= 0 ? "scaleX(-1)" : "";

  if (_trailCoords.length > 0) {
    const last = _trailCoords[_trailCoords.length - 1];
    if (Math.abs(pos[0] - last[0]) > 90) _trailCoords = [];
  }
  _trailCoords.push(pos);
  if (_trailCoords.length > TRAIL_MAX_PTS) _trailCoords = _trailCoords.slice(-TRAIL_MAX_PTS);
  updateTrail(_trailCoords);

  if (t < 1) {
    _animFrame = requestAnimationFrame(animateLeg);
  } else if (!_arrived) {
    _arrived = true;
    showArrivalLabel(_toCircuit);
    _timeout = setTimeout(() => {
      hideArrivalLabel();
      _arrived = false;
      nextLeg();
    }, PAUSE_MS);
  }
}

function nextLeg() {
  if (!_running) return;
  _arrived = false;
  _currentIdx = (_currentIdx + 1) % _circuitOrder.length;
  const next = _circuitOrder[_currentIdx];
  _fromCoord = _toCoord;
  _toCoord   = [next.lng, next.lat];
  _toCircuit = next;
  _legStartTime = performance.now();
  _animFrame = requestAnimationFrame(animateLeg);
}

// --- Public API ---

export function startFlythrough() {
  if (_running || !state.circuits || Object.keys(state.circuits).length === 0) return;

  _circuitOrder = Object.values(state.circuits).filter(c => c.lng != null && c.lat != null);
  if (_circuitOrder.length < 2) return;

  _running = true;
  _trailCoords = [];
  _currentIdx = 1; // first leg goes circuits[0]→circuits[1], so we arrive at index 1
  _lastLabelKey = null;

  let _started = false;
  const begin = () => {
    if (!_running || _started) return;
    _started = true;
    try { ensureTrailLayer(); } catch {}

    const first  = _circuitOrder[0];
    const second = _circuitOrder[1];

    if (!_carMarker) _carMarker = createCarMarker();
    _carMarker.setLngLat([first.lng, first.lat]).addTo(map);

    _fromCoord = [first.lng, first.lat];
    _toCoord   = [second.lng, second.lat];
    _toCircuit = second;
    _legStartTime = performance.now();
    _animFrame = requestAnimationFrame(animateLeg);
  };

  if (map.isStyleLoaded()) {
    begin();
  } else {
    map.once("idle", begin);
  }
}

export function stopFlythrough() {
  _running = false;
  _arrived = false;
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  if (_timeout)   { clearTimeout(_timeout);           _timeout   = null; }
  if (_carMarker) { _carMarker.remove(); }
  if (_labelPopup) { _labelPopup.remove(); _labelPopup = null; }
  _lastLabelKey = null;
  if (map.getLayer(CAR_LAYER))   map.removeLayer(CAR_LAYER);
  if (map.getSource(CAR_SOURCE)) map.removeSource(CAR_SOURCE);
  _trailCoords = [];
}

// Update trail and car color when theme changes
export function updateFlythroughTheme() {
  if (!_running) return;
  if (map.getLayer(CAR_LAYER)) {
    map.setPaintProperty(CAR_LAYER, "line-color", getCircuitColor());
  }
}