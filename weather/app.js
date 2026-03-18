const fallbackConfig = {
  latitude: 47.4979,
  longitude: 19.0402,
};

const paletteStops = [
  {
    t: 0,
    top: "#06101f",
    mid: "#123153",
    bottom: "#2f5175",
    tintTop: "rgba(73, 118, 184, 0.12)",
    tintBottom: "rgba(255, 255, 255, 0.02)",
    poolA: "rgba(93, 128, 182, 0.12)",
    poolB: "rgba(174, 205, 255, 0.08)",
    horizon: "rgba(106, 148, 197, 0.12)",
    vignetteTop: "rgba(0, 0, 0, 0.18)",
    vignetteBottom: "rgba(0, 0, 0, 0.2)",
  },
  {
    t: 0.23,
    top: "#355b8d",
    mid: "#f19a83",
    bottom: "#ffe2bf",
    tintTop: "rgba(132, 163, 255, 0.12)",
    tintBottom: "rgba(255, 255, 255, 0.02)",
    poolA: "rgba(255, 192, 126, 0.28)",
    poolB: "rgba(255, 223, 190, 0.14)",
    horizon: "rgba(255, 214, 167, 0.34)",
    vignetteTop: "rgba(19, 32, 61, 0.08)",
    vignetteBottom: "rgba(88, 54, 60, 0.08)",
  },
  {
    t: 0.32,
    top: "#5f9ddb",
    mid: "#95c7f1",
    bottom: "#e3f3ff",
    tintTop: "rgba(255, 255, 255, 0.05)",
    tintBottom: "rgba(255, 255, 255, 0)",
    poolA: "rgba(255, 222, 160, 0.2)",
    poolB: "rgba(255, 255, 255, 0.12)",
    horizon: "rgba(255, 239, 204, 0.24)",
    vignetteTop: "rgba(16, 28, 42, 0.04)",
    vignetteBottom: "rgba(16, 28, 42, 0.06)",
  },
  {
    t: 0.5,
    top: "#4f87cb",
    mid: "#7fa3c1",
    bottom: "#c3d1dc",
    tintTop: "rgba(255, 255, 255, 0.03)",
    tintBottom: "rgba(255, 255, 255, 0)",
    poolA: "rgba(240, 214, 166, 0.1)",
    poolB: "rgba(255, 255, 255, 0.08)",
    horizon: "rgba(244, 226, 194, 0.16)",
    vignetteTop: "rgba(13, 26, 44, 0.08)",
    vignetteBottom: "rgba(13, 26, 44, 0.12)",
  },
  {
    t: 0.72,
    top: "#4f77b3",
    mid: "#efa06d",
    bottom: "#ffd0a5",
    tintTop: "rgba(126, 151, 224, 0.1)",
    tintBottom: "rgba(255, 205, 164, 0.06)",
    poolA: "rgba(255, 188, 108, 0.24)",
    poolB: "rgba(255, 214, 179, 0.12)",
    horizon: "rgba(255, 192, 136, 0.34)",
    vignetteTop: "rgba(22, 28, 54, 0.06)",
    vignetteBottom: "rgba(88, 44, 34, 0.1)",
  },
  {
    t: 0.8,
    top: "#1d2f5b",
    mid: "#845f96",
    bottom: "#e29a8a",
    tintTop: "rgba(118, 134, 235, 0.12)",
    tintBottom: "rgba(255, 214, 187, 0.06)",
    poolA: "rgba(255, 163, 113, 0.18)",
    poolB: "rgba(209, 185, 255, 0.1)",
    horizon: "rgba(255, 176, 134, 0.26)",
    vignetteTop: "rgba(7, 12, 25, 0.14)",
    vignetteBottom: "rgba(36, 22, 28, 0.14)",
  },
  {
    t: 1,
    top: "#06101f",
    mid: "#123153",
    bottom: "#2f5175",
    tintTop: "rgba(73, 118, 184, 0.12)",
    tintBottom: "rgba(255, 255, 255, 0.02)",
    poolA: "rgba(93, 128, 182, 0.12)",
    poolB: "rgba(174, 205, 255, 0.08)",
    horizon: "rgba(106, 148, 197, 0.12)",
    vignetteTop: "rgba(0, 0, 0, 0.18)",
    vignetteBottom: "rgba(0, 0, 0, 0.2)",
  },
];

function getParams() {
  const params = new URLSearchParams(window.location.search);
  const latitude = Number(params.get("lat") || fallbackConfig.latitude);
  const longitude = Number(params.get("lon") || fallbackConfig.longitude);
  const previewProgress = Number(params.get("progress"));

  return {
    latitude: Number.isFinite(latitude) ? latitude : fallbackConfig.latitude,
    longitude: Number.isFinite(longitude) ? longitude : fallbackConfig.longitude,
    previewProgress: Number.isFinite(previewProgress) ? Math.min(1, Math.max(0, previewProgress)) : null,
  };
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function parseRgba(input) {
  const match = input.match(/rgba?\(([^)]+)\)/);
  if (!match) return { r: 255, g: 255, b: 255, a: 1 };
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  return {
    r: parts[0],
    g: parts[1],
    b: parts[2],
    a: parts[3] ?? 1,
  };
}

function mixNumber(a, b, t) {
  return a + (b - a) * t;
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(mixNumber(ca.r, cb.r, t));
  const g = Math.round(mixNumber(ca.g, cb.g, t));
  const bValue = Math.round(mixNumber(ca.b, cb.b, t));
  return `rgb(${r}, ${g}, ${bValue})`;
}

function mixRgba(a, b, t) {
  const ca = parseRgba(a);
  const cb = parseRgba(b);
  const r = Math.round(mixNumber(ca.r, cb.r, t));
  const g = Math.round(mixNumber(ca.g, cb.g, t));
  const bValue = Math.round(mixNumber(ca.b, cb.b, t));
  const alpha = mixNumber(ca.a, cb.a, t).toFixed(3);
  return `rgba(${r}, ${g}, ${bValue}, ${alpha})`;
}

function getInterpolatedPalette(progress) {
  const upperIndex = paletteStops.findIndex((stop) => stop.t >= progress);
  if (upperIndex <= 0) return paletteStops[0];
  if (upperIndex === -1) return paletteStops[paletteStops.length - 1];

  const start = paletteStops[upperIndex - 1];
  const end = paletteStops[upperIndex];
  const range = end.t - start.t || 1;
  const t = (progress - start.t) / range;

  return {
    top: mixHex(start.top, end.top, t),
    mid: mixHex(start.mid, end.mid, t),
    bottom: mixHex(start.bottom, end.bottom, t),
    tintTop: mixRgba(start.tintTop, end.tintTop, t),
    tintBottom: mixRgba(start.tintBottom, end.tintBottom, t),
    poolA: mixRgba(start.poolA, end.poolA, t),
    poolB: mixRgba(start.poolB, end.poolB, t),
    horizon: mixRgba(start.horizon, end.horizon, t),
    vignetteTop: mixRgba(start.vignetteTop, end.vignetteTop, t),
    vignetteBottom: mixRgba(start.vignetteBottom, end.vignetteBottom, t),
  };
}

function getDaylightProgress(now, sunriseIso, sunsetIso) {
  const current = now.getTime();
  const sunrise = new Date(sunriseIso).getTime();
  const sunset = new Date(sunsetIso).getTime();

  if (current >= sunrise && current <= sunset) {
    const dayProgress = (current - sunrise) / (sunset - sunrise || 1);
    return 0.23 + dayProgress * (0.8 - 0.23);
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const previousSunset = current > sunset ? sunset : sunset - dayMs;
  const nextSunrise = current < sunrise ? sunrise : sunrise + dayMs;
  const nightProgress = (current - previousSunset) / (nextSunrise - previousSunset || 1);

  if (current > sunset) {
    return 0.8 + nightProgress * 0.2;
  }

  return nightProgress * 0.23;
}

function applyPalette(progress) {
  const widget = document.getElementById("weather-widget");
  const palette = getInterpolatedPalette(progress);

  widget.style.setProperty("--sky-top", palette.top);
  widget.style.setProperty("--sky-mid", palette.mid);
  widget.style.setProperty("--sky-bottom", palette.bottom);
  widget.style.setProperty("--tint-top", palette.tintTop);
  widget.style.setProperty("--tint-bottom", palette.tintBottom);
  widget.style.setProperty("--pool-a", palette.poolA);
  widget.style.setProperty("--pool-b", palette.poolB);
  widget.style.setProperty("--horizon", palette.horizon);
  widget.style.setProperty("--vignette-top", palette.vignetteTop);
  widget.style.setProperty("--vignette-bottom", palette.vignetteBottom);
}

async function fetchSunTimes() {
  const params = getParams();
  const url = new URL("https://api.open-meteo.com/v1/forecast");

  url.searchParams.set("latitude", params.latitude);
  url.searchParams.set("longitude", params.longitude);
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Sun request failed with status ${response.status}`);
  }

  return response.json();
}

function applyFallbackPhase() {
  const now = new Date();
  const sunrise = new Date(now);
  const sunset = new Date(now);
  sunrise.setHours(6, 0, 0, 0);
  sunset.setHours(18, 0, 0, 0);
  applyPalette(getDaylightProgress(now, sunrise.toISOString(), sunset.toISOString()));
}

async function init() {
  const params = getParams();

  if (params.previewProgress !== null) {
    applyPalette(params.previewProgress);
    return;
  }

  try {
    const data = await fetchSunTimes();
    applyPalette(getDaylightProgress(new Date(), data.daily.sunrise[0], data.daily.sunset[0]));
  } catch (error) {
    console.error("Daylight gradient fallback activated.", error);
    applyFallbackPhase();
  }
}

init();
