const defaultWeather = {
  location: "Budapest",
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
    label: "Részben felhős",
    icon: "#icon-cloud-sun",
    theme: "cloudy-day",
  },
  cloudy: {
    label: "Felhős",
    icon: "#icon-cloud",
    theme: "cloudy-day",
  },
  rain: {
    label: "Eső",
    icon: "#icon-rain",
    theme: "rainy",
  },
  storm: {
    label: "Vihar",
    icon: "#icon-storm",
    theme: "storm",
  },
  snow: {
    label: "Hó",
    icon: "#icon-snow",
    theme: "snow",
  },
  sunrise: {
    label: "Napkelte",
    icon: "#icon-sunrise",
    theme: "sunny-day",
  },
};

function getParams() {
  const params = new URLSearchParams(window.location.search);

  return {
    location: params.get("location") || defaultWeather.location,
    temperature: Number(params.get("temp") || defaultWeather.temperature),
    high: Number(params.get("high") || defaultWeather.high),
    low: Number(params.get("low") || defaultWeather.low),
    condition: params.get("condition") || defaultWeather.condition,
    hourly: defaultWeather.hourly,
  };
}

function formatTemperature(value) {
  return Number.isFinite(value) ? Math.round(value) : "--";
}

function getConditionConfig(condition) {
  return conditionConfig[condition] || conditionConfig.cloudy;
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

renderWidget(getParams());
