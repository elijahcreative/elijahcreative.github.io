const defaultWeather = {
  location: "Budapest",
  latitude: 47.4979,
  longitude: 19.0402,
  temperature: 10,
  high: 12,
  low: 5,
  condition: "cloudy",
  hourly: [
    { time: "17", temp: 9, condition: "cloudy" },
    { time: "17:51", temp: 9, condition: "sunrise", highlight: true },
    { time: "18", temp: 9, condition: "cloudy" },
    { time: "19", temp: 8, condition: "cloudy" },
    { time: "20", temp: 8, condition: "cloudy" },
    { time: "21", temp: 7, condition: "cloudy" },
  ],
};

const conditionConfig = {
  sunny: {
    label: "Napos",
    icon: "#icon-sun",
    theme: "sunny-day",
  },
  "clear-night": {
    label: "Tiszta",
    icon: "#icon-sun",
    theme: "clear-night",
  },
  "partly-cloudy": {
    label: "Reszben felhos",
    icon: "#icon-cloud-sun",
    theme: "cloudy-day",
  },
  cloudy: {
    label: "Felhos",
    icon: "#icon-cloud",
    theme: "cloudy-day",
  },
  rain: {
    label: "Eso",
    icon: "#icon-rain",
    theme: "rainy",
  },
  storm: {
    label: "Vihar",
    icon: "#icon-storm",
    theme: "storm",
  },
  snow: {
    label: "Ho",
    icon: "#icon-snow",
    theme: "snow",
  },
  sunrise: {
    label: "Napkelte",
    icon: "#icon-sunrise",
    theme: "sunny-day",
  },
  sunset: {
    label: "Napnyugta",
    icon: "#icon-sunrise",
    theme: "sunny-day",
  },
};

function getParams() {
  const params = new URLSearchParams(window.location.search);
  const latitude = Number(params.get("lat") || defaultWeather.latitude);
  const longitude = Number(params.get("lon") || defaultWeather.longitude);

  return {
    location: params.get("location") || defaultWeather.location,
    latitude: Number.isFinite(latitude) ? latitude : defaultWeather.latitude,
    longitude: Number.isFinite(longitude) ? longitude : defaultWeather.longitude,
    units: params.get("units") === "fahrenheit" ? "fahrenheit" : "celsius",
  };
}

function formatTemperature(value) {
  return Number.isFinite(value) ? Math.round(value) : "--";
}

function getConditionConfig(condition) {
  return conditionConfig[condition] || conditionConfig.cloudy;
}

function mapWeatherCode(code, isDay = 1) {
  if (code === 0) {
    return isDay ? "sunny" : "clear-night";
  }

  if ([1, 2].includes(code)) {
    return "partly-cloudy";
  }

  if ([3, 45, 48].includes(code)) {
    return "cloudy";
  }

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return "rain";
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return "snow";
  }

  if ([95, 96, 99].includes(code)) {
    return "storm";
  }

  return "cloudy";
}

function formatHourLabel(isoDate, locale = "hu-HU") {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
  }).format(date);
}

function formatClockLabel(isoDate, locale = "hu-HU") {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function findSpecialEvent(targetDate, sunriseIso, sunsetIso) {
  const targetMs = new Date(targetDate).getTime();
  const candidates = [
    { iso: sunriseIso, type: "sunrise" },
    { iso: sunsetIso, type: "sunset" },
  ].filter((entry) => entry.iso);

  return candidates.find((entry) => {
    const diff = Math.abs(new Date(entry.iso).getTime() - targetMs);
    return diff <= 30 * 60 * 1000;
  });
}

function buildHourlyForecast(data) {
  const now = Date.now();
  const hourlyTimes = data.hourly.time || [];
  const hourlyTemps = data.hourly.temperature_2m || [];
  const hourlyCodes = data.hourly.weather_code || [];
  const sunriseIso = data.daily.sunrise?.[0];
  const sunsetIso = data.daily.sunset?.[0];

  const nextEntries = hourlyTimes
    .map((time, index) => ({
      time,
      temp: hourlyTemps[index],
      code: hourlyCodes[index],
    }))
    .filter((entry) => new Date(entry.time).getTime() >= now)
    .slice(0, 6);

  return nextEntries.map((entry) => {
    const specialEvent = findSpecialEvent(entry.time, sunriseIso, sunsetIso);

    if (specialEvent) {
      return {
        time: formatClockLabel(specialEvent.iso),
        temp: entry.temp,
        condition: specialEvent.type,
        highlight: true,
      };
    }

    return {
      time: formatHourLabel(entry.time),
      temp: entry.temp,
      condition: mapWeatherCode(entry.code, data.current.is_day),
      highlight: false,
    };
  });
}

async function fetchWeather(params) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", params.latitude);
  url.searchParams.set("longitude", params.longitude);
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("hourly", "temperature_2m,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("temperature_unit", params.units);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Weather request failed with status ${response.status}`);
  }

  const data = await response.json();
  return {
    location: params.location,
    temperature: data.current.temperature_2m,
    high: data.daily.temperature_2m_max?.[0],
    low: data.daily.temperature_2m_min?.[0],
    condition: mapWeatherCode(data.current.weather_code, data.current.is_day),
    hourly: buildHourlyForecast(data),
  };
}

function renderHourlyItem(entry) {
  const config = getConditionConfig(entry.condition);

  return `
    <article class="hourly-item" data-highlight="${entry.highlight ? "true" : "false"}">
      <p class="hourly-time">${entry.time}</p>
      <svg class="hourly-icon" viewBox="0 0 64 64" aria-hidden="true">
        <use href="${config.icon}"></use>
      </svg>
      <p class="hourly-temp">${formatTemperature(entry.temp)}°</p>
    </article>
  `;
}

function renderWidget(weather) {
  const config = getConditionConfig(weather.condition);
  const widget = document.getElementById("weather-widget");

  widget.dataset.theme = config.theme;
  document.getElementById("location").textContent = weather.location;
  document.getElementById("temperature").textContent = formatTemperature(weather.temperature);
  document.getElementById("condition-label").textContent = config.label;
  document.getElementById("high-temp").textContent = `${formatTemperature(weather.high)}°`;
  document.getElementById("low-temp").textContent = `${formatTemperature(weather.low)}°`;
  document.querySelector("#weather-icon use").setAttribute("href", config.icon);
  document.getElementById("hourly-strip").innerHTML = weather.hourly.map(renderHourlyItem).join("");
}

async function init() {
  const params = getParams();

  try {
    const weather = await fetchWeather(params);
    renderWidget(weather);
  } catch (error) {
    console.error("Weather widget fallback activated.", error);
    renderWidget(defaultWeather);
  }
}

init();
