// Entry point. Loaded via <script type="module"> — no bundler or build
// step needed; the browser resolves the import graph natively. Fetches the
// circuit list, wires up every control's event listener, and starts the app.

import { state } from "./state.js";
import { map } from "./map.js";
import { applyTheme, applyLanguageLabel, toggleTheme, toggleLanguage } from "./theme.js";
import { populateCircuitPicker, renderHomeMarkers } from "./circuits.js";
import { setActiveLayer, setFoodCategory, registerClusterInteractions } from "./clusters.js";
import { renderHotelList, showHotelList, toggleSchedule } from "./hotels.js";

async function init() {
  const res = await fetch("data/circuits.json");
  state.circuits = await res.json();
  populateCircuitPicker();
  renderHomeMarkers();

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
  registerClusterInteractions();
}

init();
