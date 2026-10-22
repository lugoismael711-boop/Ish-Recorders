/* Train Home — find the quickest train home using the Google Routes API. */
(() => {
  "use strict";

  const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
  const FIELD_MASK = [
    "routes.duration",
    "routes.localizedValues",
    "routes.polyline.encodedPolyline",
    "routes.legs.steps.travelMode",
    "routes.legs.steps.staticDuration",
    "routes.legs.steps.transitDetails",
  ].join(",");
  const VEHICLE_ICONS = {
    SUBWAY: "🚇", METRO_RAIL: "🚇", HEAVY_RAIL: "🚆", COMMUTER_TRAIN: "🚆", RAIL: "🚆",
    HIGH_SPEED_TRAIN: "🚄", LONG_DISTANCE_TRAIN: "🚆", MONORAIL: "🚝", TRAM: "🚊",
    BUS: "🚌", INTERCITY_BUS: "🚌", TROLLEYBUS: "🚎", FERRY: "⛴️",
  };

  // ---- Element refs ----
  const $ = (sel) => document.querySelector(sel);
  const setupEl = $("#setup");
  const setupForm = $("#setupForm");
  const homeInput = $("#homeInput");
  const keyInput = $("#keyInput");
  const cancelSetup = $("#cancelSetup");
  const finderEl = $("#finder");
  const searchForm = $("#searchForm");
  const fromInput = $("#fromInput");
  const trainsOnly = $("#trainsOnly");
  const goBtn = $("#goBtn");
  const statusEl = $("#status");
  const resultsEl = $("#results");
  const bestEl = $("#best");
  const mapEl = $("#map");
  const othersWrap = $("#othersWrap");
  const othersEl = $("#others");

  // ---- Settings (browser-only storage) ----
  const store = {
    get(k) { try { return localStorage.getItem("trainhome." + k) || ""; } catch { return ""; } },
    set(k, v) { try { localStorage.setItem("trainhome." + k, v); } catch { /* private mode */ } },
  };
  // Keep values in memory too, so the app still works when storage is blocked.
  const settings = { home: store.get("home"), key: store.get("key") };

  function showSetup(editing) {
    homeInput.value = settings.home;
    keyInput.value = settings.key;
    cancelSetup.hidden = !editing;
    setupEl.hidden = false;
    finderEl.hidden = true;
  }

  function showFinder() {
    setupEl.hidden = true;
    finderEl.hidden = false;
  }

  setupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    settings.home = homeInput.value.trim();
    settings.key = keyInput.value.trim();
    store.set("home", settings.home);
    store.set("key", settings.key);
    showFinder();
  });
  cancelSetup.addEventListener("click", showFinder);
  $("#editSetup").addEventListener("click", () => showSetup(true));

  // ---- Helpers ----
  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  const secs = (d) => parseInt(String(d || "0").replace("s", ""), 10) || 0;
  const mins = (s) => Math.max(1, Math.round(s / 60));
  const fmtTime = (date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Location isn't available in this browser — type a starting point instead."));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => reject(new Error("Couldn't get your location — allow location access or type a starting point.")),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    });
  }

  // ---- Routes API ----
  async function fetchRoutes(origin) {
    const body = {
      origin,
      destination: { address: settings.home },
      travelMode: "TRANSIT",
      computeAlternativeRoutes: true,
      transitPreferences: trainsOnly.checked ? { allowedTravelModes: ["RAIL"] } : {},
    };
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `Google returned HTTP ${res.status}.`);
    return data.routes || [];
  }

  // Turn a raw route into a trip: walking legs merged, with leave-by / arrive-by times.
  function toTrip(route) {
    const steps = (route.legs || []).flatMap((l) => l.steps || []);
    const parts = [];
    for (const s of steps) {
      if (s.transitDetails) {
        parts.push({ type: "transit", t: s.transitDetails });
      } else {
        const last = parts[parts.length - 1];
        if (last && last.type === "walk") last.seconds += secs(s.staticDuration);
        else parts.push({ type: "walk", seconds: secs(s.staticDuration) });
      }
    }
    const rides = parts.filter((p) => p.type === "transit");
    if (!rides.length) return null; // walking-only route: not a train

    const lead = parts[0].type === "walk" ? parts[0].seconds : 0;
    const tail = parts[parts.length - 1].type === "walk" ? parts[parts.length - 1].seconds : 0;
    const firstDep = new Date(rides[0].t.stopDetails.departureTime);
    const lastArr = new Date(rides[rides.length - 1].t.stopDetails.arrivalTime);
    return {
      route,
      parts,
      rides,
      leaveBy: new Date(firstDep.getTime() - lead * 1000),
      arriveBy: new Date(lastArr.getTime() + tail * 1000),
      fare: route.localizedValues && route.localizedValues.transitFare && route.localizedValues.transitFare.text,
    };
  }

  // ---- Rendering ----
  function linePill(t) {
    const line = t.transitLine || {};
    const name = line.nameShort || line.name || (line.vehicle && line.vehicle.name && line.vehicle.name.text) || "Train";
    const pill = el("span", { className: "pill", textContent: name });
    if (line.color) {
      pill.style.background = line.color;
      pill.style.borderColor = line.color;
      pill.style.color = line.textColor || "#fff";
    }
    return pill;
  }

  function vehicleIcon(t) {
    const type = t.transitLine && t.transitLine.vehicle && t.transitLine.vehicle.type;
    return VEHICLE_ICONS[type] || "🚆";
  }

  function leaveText(leaveBy) {
    const m = Math.round((leaveBy - Date.now()) / 60000);
    if (m <= 0) return "Leave now";
    return `Leave in ${m} min`;
  }

  function renderBest(trip, origin) {
    const total = mins((trip.arriveBy - Date.now()) / 1000);
    const steps = el("ul", { className: "steps" });
    for (const p of trip.parts) {
      if (p.type === "walk") {
        if (p.seconds < 30) continue;
        steps.append(el("li", {}, el("span", { className: "icon", textContent: "🚶" }), `Walk ${mins(p.seconds)} min`));
        continue;
      }
      const t = p.t;
      const sd = t.stopDetails || {};
      const lv = t.localizedValues || {};
      const dep = (lv.departureTime && lv.departureTime.time && lv.departureTime.time.text) || fmtTime(new Date(sd.departureTime));
      const arr = (lv.arrivalTime && lv.arrivalTime.time && lv.arrivalTime.time.text) || fmtTime(new Date(sd.arrivalTime));
      const stops = t.stopCount ? ` · ${t.stopCount} stop${t.stopCount === 1 ? "" : "s"}` : "";
      steps.append(el("li", {},
        el("span", { className: "icon", textContent: vehicleIcon(t) }),
        el("div", {},
          el("div", {}, linePill(t), ` ${t.headsign ? "toward " + t.headsign : ""}`),
          el("div", { className: "sub", textContent: `${dep} from ${sd.departureStop && sd.departureStop.name} → ${arr} at ${sd.arrivalStop && sd.arrivalStop.name}${stops}` }),
        ),
      ));
    }

    const gmaps = new URL("https://www.google.com/maps/dir/");
    gmaps.searchParams.set("api", "1");
    gmaps.searchParams.set("origin", origin.address || `${origin.location.latLng.latitude},${origin.location.latLng.longitude}`);
    gmaps.searchParams.set("destination", settings.home);
    gmaps.searchParams.set("travelmode", "transit");

    bestEl.replaceChildren(
      el("div", { className: "eyebrow", textContent: "Quickest way home" }),
      el("div", { className: "leave", textContent: `${leaveText(trip.leaveBy)} · home by ${fmtTime(trip.arriveBy)}` }),
      el("p", { className: "summary", textContent: `${total} min total${trip.fare ? " · " + trip.fare : ""}` }),
      steps,
      el("a", { className: "btn btn-ghost", href: gmaps.toString(), target: "_blank", rel: "noopener", textContent: "Open in Google Maps" }),
    );
  }

  function renderOthers(trips) {
    othersEl.replaceChildren(...trips.map((trip) => el("li", {},
      el("span", { className: "times", textContent: `${fmtTime(trip.leaveBy)} → ${fmtTime(trip.arriveBy)}` }),
      el("span", { className: "lines" }, ...trip.rides.map((r) => linePill(r.t))),
    )));
    othersWrap.hidden = trips.length === 0;
  }

  // ---- Map (optional: results still show if it fails to load) ----
  let mapsPromise = null;
  let mapsKey = "";
  function loadMaps() {
    if (window.google && window.google.maps && mapsKey === settings.key) return Promise.resolve();
    if (mapsPromise && mapsKey === settings.key) return mapsPromise;
    mapsKey = settings.key;
    mapsPromise = new Promise((resolve, reject) => {
      window.__trainHomeMapsReady = resolve;
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(settings.key)}&libraries=geometry&loading=async&callback=__trainHomeMapsReady`;
      s.async = true;
      s.onerror = () => reject(new Error("Maps failed to load"));
      document.head.append(s);
    });
    return mapsPromise;
  }

  let map = null;
  let line = null;
  async function drawRoute(route) {
    const encoded = route.polyline && route.polyline.encodedPolyline;
    if (!encoded) return;
    try {
      await loadMaps();
    } catch {
      return;
    }
    const g = window.google.maps;
    const path = g.geometry.encoding.decodePath(encoded);
    mapEl.hidden = false;
    if (!map) map = new g.Map(mapEl, { disableDefaultUI: true, zoomControl: true, colorScheme: "DARK" });
    if (line) line.setMap(null);
    line = new g.Polyline({ path, map, strokeColor: "#6c8cff", strokeWeight: 5 });
    const bounds = new g.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 24);
  }

  // ---- Search ----
  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    goBtn.disabled = true;
    resultsEl.hidden = true;
    try {
      const typed = fromInput.value.trim();
      let origin;
      if (typed) {
        origin = { address: typed };
      } else {
        setStatus("Finding your location…");
        origin = { location: { latLng: await getPosition() } };
      }
      setStatus("Checking trains…");
      const trips = (await fetchRoutes(origin)).map(toTrip).filter(Boolean);
      if (!trips.length) {
        setStatus(trainsOnly.checked
          ? "No train routes found right now. Try unticking “Trains only”."
          : "No transit routes found right now.", true);
        return;
      }
      trips.sort((a, b) => a.arriveBy - b.arriveBy);
      renderBest(trips[0], origin);
      renderOthers(trips.slice(1));
      resultsEl.hidden = false;
      setStatus(`Updated ${fmtTime(new Date())}`);
      drawRoute(trips[0].route);
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      goBtn.disabled = false;
    }
  });

  // ---- Init ----
  if (settings.home && settings.key) showFinder();
  else showSetup(false);
})();
