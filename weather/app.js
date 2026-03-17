const fallbackConfig = {
  latitude: 47.4979,
  longitude: 19.0402,
};

function getParams() {
  const params = new URLSearchParams(window.location.search);
  const latitude = Number(params.get("lat") || fallbackConfig.latitude);
  const longitude = Number(params.get("lon") || fallbackConfig.longitude);
  const previewTheme = params.get("theme");
  const previewProgress = Number(params.get("progress"));
  const previewClouds = Number(params.get("clouds"));

  return {
    latitude: Number.isFinite(latitude) ? latitude : fallbackConfig.latitude,
    longitude: Number.isFinite(longitude) ? longitude : fallbackConfig.longitude,
    previewTheme,
    previewProgress: Number.isFinite(previewProgress) ? previewProgress : null,
    previewClouds: Number.isFinite(previewClouds) ? previewClouds : null,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mapWeatherToTheme(code, isDay) {
  if ([95, 96, 99].includes(code)) return "storm";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return isDay ? "rain-day" : "rain-night";
  }
  if ([1, 2, 3, 45, 48].includes(code)) {
    return isDay ? "cloudy-day" : "cloudy-night";
  }
  return isDay ? "clear-day" : "clear-night";
}

function getCloudinessFactor(code, cloudCover = 0) {
  if ([95, 96, 99].includes(code)) return 0.92;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 0.72;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 0.88;
  if ([45, 48].includes(code)) return 0.84;
  if ([3].includes(code)) return 0.78;
  if ([1, 2].includes(code)) return 0.46;
  return clamp(cloudCover / 100, 0.12, 0.92);
}

function getOrbProgress(now, sunrise, sunset, isDay) {
  const current = now.getTime();
  const rise = new Date(sunrise).getTime();
  const set = new Date(sunset).getTime();

  if (isDay && current >= rise && current <= set) {
    return clamp((current - rise) / (set - rise || 1), 0, 1);
  }

  const previousSunset = current > set ? set : set - 24 * 60 * 60 * 1000;
  const nextSunrise = current < rise ? rise : rise + 24 * 60 * 60 * 1000;
  return clamp((current - previousSunset) / (nextSunrise - previousSunset || 1), 0, 1);
}

function applyVisualState(weather, preview = {}) {
  const widget = document.getElementById("weather-widget");
  const derivedIsDay = weather.current.is_day === 1;
  const isDay = preview.theme ? !preview.theme.includes("night") : derivedIsDay;
  const progress = preview.progress ?? getOrbProgress(
    new Date(),
    weather.daily.sunrise[0],
    weather.daily.sunset[0],
    isDay
  );
  const theme = preview.theme || mapWeatherToTheme(weather.current.weather_code, isDay);
  const cloudiness = preview.cloudiness ?? getCloudinessFactor(
    weather.current.weather_code,
    weather.current.cloud_cover
  );
  const orbX = 16 + progress * 68;
  const arc = Math.sin(progress * Math.PI);
  const orbY = isDay ? 64 - arc * 40 : 70 - arc * 24;
  const orbSize = isDay ? 92 - cloudiness * 18 : 74 - cloudiness * 10;

  widget.dataset.theme = theme;
  widget.style.setProperty("--orb-x", `${orbX}%`);
  widget.style.setProperty("--orb-y", `${orbY}%`);
  widget.style.setProperty("--orb-size", `${orbSize}px`);
  widget.style.setProperty("--halo-scale", isDay ? "1.9" : "1.55");
  widget.style.setProperty("--cloud-opacity-back", `${0.08 + cloudiness * 0.24}`);
  widget.style.setProperty("--cloud-opacity-front", `${0.14 + cloudiness * 0.34}`);
  widget.style.setProperty("--cloud-brightness", isDay ? `${1.02 - cloudiness * 0.12}` : `${0.82 - cloudiness * 0.12}`);
  widget.style.setProperty("--haze-opacity", `${isDay ? 0.12 + cloudiness * 0.12 : 0.06 + cloudiness * 0.06}`);
}

async function fetchWeather() {
  const params = getParams();
  const url = new URL("https://api.open-meteo.com/v1/forecast");

  url.searchParams.set("latitude", params.latitude);
  url.searchParams.set("longitude", params.longitude);
  url.searchParams.set("current", "weather_code,is_day,cloud_cover");
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Weather request failed with status ${response.status}`);
  }

  return response.json();
}

function applyFallbackState() {
  applyVisualState({
    current: {
      weather_code: 3,
      is_day: 1,
      cloud_cover: 54,
    },
    daily: {
      sunrise: [new Date().toISOString()],
      sunset: [new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()],
    },
  });
}

async function init() {
  const params = getParams();

  if (params.previewTheme) {
    applyVisualState(
      {
        current: {
          weather_code: 1,
          is_day: params.previewTheme.includes("night") ? 0 : 1,
          cloud_cover: params.previewClouds ?? 40,
        },
        daily: {
          sunrise: [new Date().toISOString()],
          sunset: [new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()],
        },
      },
      {
        theme: params.previewTheme,
        progress: params.previewProgress !== null ? clamp(params.previewProgress, 0, 1) : 0.5,
        cloudiness: params.previewClouds !== null ? clamp(params.previewClouds / 100, 0, 1) : null,
      }
    );
    return;
  }

  try {
    const weather = await fetchWeather();
    applyVisualState(weather);
  } catch (error) {
    console.error("Weather background fallback activated.", error);
    applyFallbackState();
  }
}

init();
