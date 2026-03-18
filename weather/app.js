const fallbackConfig = {
  latitude: 47.4979,
  longitude: 19.0402,
};

const previewPhases = new Set(["dawn", "morning", "day", "golden-hour", "dusk", "night"]);

function getParams() {
  const params = new URLSearchParams(window.location.search);
  const latitude = Number(params.get("lat") || fallbackConfig.latitude);
  const longitude = Number(params.get("lon") || fallbackConfig.longitude);
  const previewPhase = params.get("phase");

  return {
    latitude: Number.isFinite(latitude) ? latitude : fallbackConfig.latitude,
    longitude: Number.isFinite(longitude) ? longitude : fallbackConfig.longitude,
    previewPhase: previewPhases.has(previewPhase) ? previewPhase : null,
  };
}

function applyPhase(phase) {
  document.getElementById("weather-widget").dataset.phase = phase;
}

function getPhase(now, sunriseIso, sunsetIso) {
  const current = now.getTime();
  const sunrise = new Date(sunriseIso).getTime();
  const sunset = new Date(sunsetIso).getTime();
  const hour = 60 * 60 * 1000;

  if (current < sunrise - hour || current > sunset + hour) return "night";
  if (current < sunrise + hour) return "dawn";
  if (current < sunrise + 3 * hour) return "morning";
  if (current < sunset - 2 * hour) return "day";
  if (current < sunset - 45 * 60 * 1000) return "golden-hour";
  if (current <= sunset + hour) return "dusk";
  return "night";
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
  applyPhase(getPhase(now, sunrise.toISOString(), sunset.toISOString()));
}

async function init() {
  const params = getParams();

  if (params.previewPhase) {
    applyPhase(params.previewPhase);
    return;
  }

  try {
    const data = await fetchSunTimes();
    applyPhase(getPhase(new Date(), data.daily.sunrise[0], data.daily.sunset[0]));
  } catch (error) {
    console.error("Daylight gradient fallback activated.", error);
    applyFallbackPhase();
  }
}

init();
