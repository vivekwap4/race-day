// Race weekend schedule — fetches session times from the Jolpica F1 API
// (Ergast-compatible, free, no key) and renders them as a vertical timeline
// in the panel's "Race weekend details" collapsible.
//
// Fetches the entire 2026 season in a single call and filters client-side —
// simpler, faster (one request instead of one per circuit), and avoids the
// per-circuit endpoint which is less reliable for newer seasons.

const CIRCUIT_TO_JOLPICA_ID = {
  australia:    "albert_park",
  china:        "shanghai",
  suzuka:       "suzuka",
  bahrain:      "bahrain",
  saudi_arabia: "jeddah",
  miami:        "miami",
  canada:       "villeneuve",
  monaco:       "monaco",
  barcelona:    "catalunya",
  austria:      "red_bull_ring",
  silverstone:  "silverstone",
  spa:          "spa",
  hungary:      "hungaroring",
  zandvoort:    "zandvoort",
  monza:        "monza",
  madrid:       "madring",
  baku:         "baku",
  singapore:    "marina_bay",
  cota:         "americas",
  mexico:       "rodriguez",
  brazil:       "interlagos",
  las_vegas:    "las_vegas",
  qatar:        "losail",
  abu_dhabi:    "yas_marina",
};

const CIRCUIT_TIMEZONE = {
  australia:    "Australia/Melbourne",
  china:        "Asia/Shanghai",
  suzuka:       "Asia/Tokyo",
  bahrain:      "Asia/Bahrain",
  saudi_arabia: "Asia/Riyadh",
  miami:        "America/New_York",
  canada:       "America/Toronto",
  monaco:       "Europe/Monaco",
  barcelona:    "Europe/Madrid",
  austria:      "Europe/Vienna",
  silverstone:  "Europe/London",
  spa:          "Europe/Brussels",
  hungary:      "Europe/Budapest",
  zandvoort:    "Europe/Amsterdam",
  monza:        "Europe/Rome",
  madrid:       "Europe/Madrid",
  baku:         "Asia/Baku",
  singapore:    "Asia/Singapore",
  cota:         "America/Chicago",
  mexico:       "America/Mexico_City",
  brazil:       "America/Sao_Paulo",
  las_vegas:    "America/Los_Angeles",
  qatar:        "Asia/Qatar",
  abu_dhabi:    "Asia/Dubai",
};

const SESSION_LABELS = {
  FirstPractice:    "Free Practice 1",
  SecondPractice:   "Free Practice 2",
  ThirdPractice:    "Free Practice 3",
  SprintQualifying: "Sprint Qualifying",
  Sprint:           "Sprint Race",
  Qualifying:       "Qualifying",
  Race:             "Race",
};

const SESSION_ORDER = [
  "FirstPractice", "SecondPractice", "SprintQualifying",
  "ThirdPractice", "Sprint", "Qualifying", "Race",
];

// Cached after the first fetch — one object with all 2026 races,
// keyed by Jolpica circuitId.
let seasonCache = null;

async function getSeasonData() {
  if (seasonCache) return seasonCache;
  const res = await fetch("https://api.jolpi.ca/ergast/f1/2026.json?limit=30");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const races = data?.MRData?.RaceTable?.Races || [];
  seasonCache = { byId: {}, byLocality: {} };
  for (const race of races) {
    const id = race.Circuit?.circuitId;
    const locality = race.Circuit?.Location?.locality?.toLowerCase();
    if (id) seasonCache.byId[id] = race;
    if (locality) seasonCache.byLocality[locality] = race;
  }
  // Log the full list of circuit IDs returned so any mapping issues
  // are immediately visible in the browser console.
  console.log("[schedule] 2026 Jolpica circuit IDs:", Object.keys(seasonCache.byId));
  return seasonCache;
}

export async function loadSchedule(circuitKey) {
  const container = document.getElementById("schedule-body");
  if (!container) return;

  container.innerHTML = '<p class="empty-state">Loading schedule…</p>';

  const jolpicaId = CIRCUIT_TO_JOLPICA_ID[circuitKey];
  if (!jolpicaId) {
    container.innerHTML = '<p class="empty-state">Schedule not available for this circuit.</p>';
    return;
  }

  try {
    const season = await getSeasonData();
    // Try the hardcoded ID first; fall back to locality name match if missing.
    // This makes the lookup self-healing: a wrong ID in CIRCUIT_TO_JOLPICA_ID
    // won't silently fail as long as the city name matches.
    const race = season.byId[jolpicaId] || (() => {
      const localityFallbacks = {
        australia:    "melbourne",
        china:        "shanghai",
        suzuka:       "suzuka",
        bahrain:      "sakhir",
        saudi_arabia: "jeddah",
        miami:        "miami",
        canada:       "montréal",
        monaco:       "monte-carlo",
        barcelona:    "montmeló",
        austria:      "spielberg",
        silverstone:  "silverstone",
        spa:          "spa",
        hungary:      "budapest",
        zandvoort:    "zandvoort",
        monza:        "monza",
        madrid:       "madrid",
        baku:         "baku",
        singapore:    "singapore",
        cota:         "austin",
        mexico:       "mexico city",
        brazil:       "são paulo",
        las_vegas:    "las vegas",
        qatar:        "lusail",
        abu_dhabi:    "abu dhabi",
      };
      const fallback = localityFallbacks[circuitKey];
      return fallback ? season.byLocality[fallback] : null;
    })();

    if (!race) {
      console.warn(`[schedule] No 2026 race found for circuit key "${circuitKey}" (jolpicaId: "${jolpicaId}")`);
      container.innerHTML = '<p class="empty-state">No 2026 race scheduled at this circuit.</p>';
      return;
    }
    renderSchedule(container, race, circuitKey);
  } catch (err) {
    console.error("Schedule fetch failed:", err);
    container.innerHTML = '<p class="empty-state">Couldn\'t load schedule. Check your connection.</p>';
  }
}

function buildSessions(race) {
  // The practice/quali sessions are nested objects (race.FirstPractice etc),
  // but the race itself is stored at the top level as race.date / race.time —
  // there is no race["Race"] sub-object, so we handle it separately.
  const sessions = SESSION_ORDER
    .filter((key) => key !== "Race" && race[key])
    .map((key) => ({
      key,
      label: SESSION_LABELS[key],
      date: race[key].date,
      time: race[key].time,
      isRace: false,
    }));

  if (race.date) {
    sessions.push({
      key: "Race",
      label: SESSION_LABELS["Race"],
      date: race.date,
      time: race.time || "00:00:00Z",
      isRace: true,
    });
  }

  return sessions;
}

function formatLocalDateTime(dateStr, timeStr, timezone) {
  // API returns "2026-03-13" and "03:30:00Z" — combine into an ISO string.
  const iso = `${dateStr}T${timeStr}`;
  const dt = new Date(iso);
  if (isNaN(dt)) return { date: dateStr, time: "—" };

  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day:     "numeric",
    month:   "short",
    timeZone: timezone,
  });

  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
    timeZone: timezone,
  });

  return {
    date: dateFmt.format(dt),  // e.g. "Fri 13 Mar"
    time: timeFmt.format(dt),  // e.g. "13:30"
  };
}

// Winner cache keyed by round number to avoid re-fetching
let winnerCache = {};

async function fetchWinner(round) {
  if (winnerCache[round] !== undefined) return winnerCache[round];
  try {
    const res = await fetch(`https://api.jolpi.ca/ergast/f1/2026/${round}/results.json?limit=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data?.MRData?.RaceTable?.Races?.[0]?.Results?.[0];
    if (!result) { winnerCache[round] = null; return null; }
    const winner = {
      name: `${result.Driver.givenName} ${result.Driver.familyName}`,
      team: result.Constructor.name,
      time: result.Time?.time || null,
    };
    winnerCache[round] = winner;
    return winner;
  } catch {
    winnerCache[round] = null;
    return null;
  }
}

function renderSchedule(container, race, circuitKey) {
  const timezone = CIRCUIT_TIMEZONE[circuitKey] || "UTC";
  const sessions = buildSessions(race);
  const raceDate = new Date(`${race.date}T${race.time || "00:00:00Z"}`);
  const isPast = raceDate < new Date();

  const badge = isPast
    ? `<span class="schedule-badge past">Past</span>`
    : `<span class="schedule-badge upcoming">Upcoming</span>`;

  const rows = sessions.map((s, i) => {
    const { date, time } = formatLocalDateTime(s.date, s.time || "00:00:00Z", timezone);
    const isLast = i === sessions.length - 1;
    const dotColor = s.isRace ? "#e63946" : "var(--border)";
    const dotSize  = s.isRace ? "11px" : "9px";
    const nameStyle = s.isRace ? `font-weight:600;color:#e63946;` : "";

    return `
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:11px;">
          <div style="width:${dotSize};height:${dotSize};border-radius:50%;background:${dotColor};border:2px solid var(--surface-1);margin-top:3px;flex-shrink:0;"></div>
          ${!isLast ? `<div style="width:1.5px;background:var(--border);flex:1;min-height:24px;margin:2px 0;"></div>` : ""}
        </div>
        <div style="padding-bottom:${isLast ? "0" : "12px"};">
          <p style="font-size:11px;color:var(--text-secondary);margin:0 0 1px;">${date} · ${time} local</p>
          <p style="font-size:13px;margin:0;${nameStyle}">${s.label}</p>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="font-size:14px;font-weight:600;">🏁 ${race.raceName}</span>
      ${badge}
    </div>
    ${rows}
    ${isPast ? `<div id="schedule-winner-row" style="margin-top:10px;padding:10px 12px;background:var(--card-bg);border-radius:8px;border-left:3px solid #e63946;">
      <p style="font-size:11px;color:var(--text-secondary);margin:0 0 2px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;">Race winner</p>
      <p style="font-size:13px;margin:0;color:var(--text-muted);">Loading…</p>
    </div>` : ""}
    <p style="font-size:11px;color:var(--text-muted);margin:12px 0 0;padding-top:8px;border-top:.5px solid var(--border);">
      Times shown in circuit local time.
    </p>
  `;

  // Fetch the winner asynchronously and update the DOM in-place once it arrives
  if (isPast && race.round) {
    fetchWinner(race.round).then((winner) => {
      const el = container.querySelector("#schedule-winner-row p:last-child");
      if (!el) return;
      if (winner) {
        el.style.color = "var(--text-primary)";
        el.style.fontWeight = "600";
        el.innerHTML = `🏆 ${winner.name} <span style="font-weight:400;color:var(--text-secondary);">(${winner.team})</span>`;
      } else {
        el.textContent = "Results not yet available.";
      }
    });
  }
}
