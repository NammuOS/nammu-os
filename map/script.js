const CONFIG = Object.freeze({
  center: [41.2257, 1.7249],
  zoom: 13,
  googleTimeout: 5000,
  proxyTimeout: 3000,
  styleTimeout: 3000,
  snazzyCount: 15,

  // map-proxy.php — Google Maps API key
  // https://gist.github.com/arenagroove/2a1f27f87168136f25a876a878034504#file-map-proxy-php
  proxyUrl: "https://www.lessrain.com/dev/leaflet-snazzy/map-proxy.php",
  directKey: "",

  // snazzy-proxy.php — Snazzy Maps styles list
  // https://gist.github.com/arenagroove/2a1f27f87168136f25a876a878034504#file-snazzy-proxy-php
  // Option A: proxy URL (recommended). Set to null to skip.
  snazzyProxyUrl:
    "https://www.lessrain.com/dev/leaflet-snazzy/snazzy-proxy.php",

  // Option B: hardcoded styles (fallback or local dev). Set to null to skip.
  //           Each entry: { name: "Style name", json: [...] }
  directStyles: null,

  cartoUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  cartoAttr:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
});

let map = null;
let baseLayer = null;
let _timer = null;
let _timedOut = false;
let _googleLoading = false;
let _googleScriptInjected = false;

const state = {
  mode: "loading",
  styles: [],
  active: null
};

const dom = {
  statusLabel: document.getElementById("status_label"),
  styleSelect: document.getElementById("style_select")
};

function googleReady() {
  return Boolean(
    window.google &&
      window.google.maps &&
      window.L &&
      L.gridLayer &&
      L.gridLayer.googleMutant
  );
}

function render() {
  if (!dom.statusLabel) return;
  const labels = {
    google: "google styled",
    carto: "carto fallback",
    loading: "loading"
  };
  dom.statusLabel.textContent = labels[state.mode] ?? "carto fallback";
}

function removeBaseLayer() {
  if (!map || !baseLayer) return;
  map.removeLayer(baseLayer);
  baseLayer = null;
}

async function _fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveApiKey() {
  if (CONFIG.proxyUrl) {
    try {
      const res = await _fetchWithTimeout(CONFIG.proxyUrl, CONFIG.proxyTimeout);
      if (!res.ok) throw new Error(`proxy ${res.status}`);
      const cfg = await res.json();
      if (typeof cfg.key === "string" && cfg.key.trim()) return cfg.key.trim();
    } catch (err) {
      console.warn("[map] proxy failed, trying direct key", err);
    }
  }

  return CONFIG.directKey?.trim() || null;
}

function isValidStyleEntry(s) {
  return (
    s &&
    typeof s.name === "string" &&
    Boolean(s.name.trim()) &&
    (Array.isArray(s.json) || typeof s.json === "string")
  );
}

function disableSelect() {
  if (!dom.styleSelect) return;
  dom.styleSelect.innerHTML = "";
  dom.styleSelect.disabled = true;
  dom.styleSelect.onchange = null;
}

function applyCartoFallback() {
  removeBaseLayer();
  state.mode = "carto";
  state.styles = [];
  state.active = null;
  baseLayer = _cartoLayer();
  disableSelect();
}

async function loadSnazzyStyles() {
  const direct = Array.isArray(CONFIG.directStyles)
    ? CONFIG.directStyles.filter(isValidStyleEntry)
    : [];

  if (direct.length) return direct;

  if (!CONFIG.snazzyProxyUrl) return [];

  const url =
    CONFIG.snazzyProxyUrl + "?sort=popular&count=" + CONFIG.snazzyCount;

  const res = await _fetchWithTimeout(url, CONFIG.styleTimeout);
  if (!res.ok) throw new Error(`snazzy proxy ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data.styles))
    throw new Error("unexpected snazzy response");

  return data.styles.filter(isValidStyleEntry);
}

function normalizeStyleJson(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function populateSelect(styles) {
  if (!dom.styleSelect) return;

  dom.styleSelect.innerHTML = "";
  dom.styleSelect.disabled = false;

  styles.forEach((s, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = s.name;
    dom.styleSelect.appendChild(opt);
  });

  dom.styleSelect.onchange = () => {
    const idx = Number(dom.styleSelect.value);
    state.active = state.styles[idx] ?? null;
    if (googleReady() && state.active) applySnazzyStyle(state.active.json);
  };
}

function applySnazzyStyle(styleJson) {
  const styles = normalizeStyleJson(styleJson);
  if (!styles.length) {
    console.warn("[map] invalid style JSON, ignoring");
    return;
  }
  removeBaseLayer();
  state.mode = "google";
  baseLayer = L.gridLayer.googleMutant({ type: "roadmap", styles });
  if (map && baseLayer) baseLayer.addTo(map);
  render();
}

async function applyBaseLayer() {
  removeBaseLayer();

  if (googleReady()) {
    try {
      const styles = await loadSnazzyStyles();

      if (!styles.length) throw new Error("no styles available");

      state.styles = styles;
      state.active = styles[0] ?? null;

      populateSelect(styles);

      const firstStyle = normalizeStyleJson(state.active?.json);
      if (!firstStyle.length) throw new Error("invalid initial style");

      state.mode = "google";
      baseLayer = L.gridLayer.googleMutant({
        type: "roadmap",
        styles: firstStyle
      });
    } catch (err) {
      console.warn("[map] snazzy styles failed, falling back to Carto", err);
      applyCartoFallback();
    }
  } else {
    applyCartoFallback();
  }

  if (map && baseLayer) baseLayer.addTo(map);
  render();
}

function _cartoLayer() {
  return L.tileLayer(CONFIG.cartoUrl, {
    attribution: CONFIG.cartoAttr,
    subdomains: "abcd",
    maxZoom: 20
  });
}

function _applyBaseLayerSafe() {
  applyBaseLayer().catch((err) =>
    console.error("[map] applyBaseLayer failed", err)
  );
}

function _clearTimer() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

function _injectGoogleScript(key) {
  if (_googleScriptInjected) return;
  _googleScriptInjected = true;
  _timedOut = false;

  const cbName = `__googleMapCallback_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

  _timer = setTimeout(() => {
    _timedOut = true;
    _googleLoading = false;
    _googleScriptInjected = false;
    delete window[cbName];
    _applyBaseLayerSafe();
  }, CONFIG.googleTimeout);

  window[cbName] = function () {
    if (_timedOut) {
      delete window[cbName];
      return;
    }
    _clearTimer();
    _googleLoading = false;
    delete window[cbName];
    _applyBaseLayerSafe();
  };

  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.src =
    "https://maps.googleapis.com/maps/api/js" +
    "?key=" +
    encodeURIComponent(key) +
    "&callback=" +
    cbName +
    "&loading=async";

  script.onerror = function () {
    _googleScriptInjected = false;
    if (_timedOut) return;
    _clearTimer();
    _googleLoading = false;
    delete window[cbName];
    _applyBaseLayerSafe();
  };

  document.head.appendChild(script);
}

async function loadGoogle() {
  if (_googleLoading) return;
  _googleLoading = true;

  let scriptInjected = false;

  try {
    if (googleReady()) {
      _applyBaseLayerSafe();
      return;
    }

    const key = await resolveApiKey();

    if (!key) {
      _applyBaseLayerSafe();
      return;
    }

    scriptInjected = true;
    _injectGoogleScript(key);
  } catch (err) {
    console.warn("[map] google loader failed", err);
    _applyBaseLayerSafe();
  } finally {
    if (!scriptInjected) _googleLoading = false;
  }
}

function init() {
  const mapEl = document.getElementById("map_canvas");
  if (!mapEl || !window.L) {
    console.error("[map] missing #map_canvas or Leaflet");
    return;
  }

  map = L.map(mapEl, { zoomControl: true }).setView(CONFIG.center, CONFIG.zoom);

  L.marker(CONFIG.center).addTo(map).bindPopup("Map center");

  render();
  loadGoogle();
}

init();
