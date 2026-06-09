const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const RACES_NEW_PATH = path.join(REPO_ROOT, "F1", "2023", "Data", "races-new.json");
const SESSION_FIELDS = ["FP1", "FP2", "FP3"];
const ORDERED_SESSION_FIELDS = ["FP1", "FP2", "FP3", "Qual", "Sprint", "Sprintqual", "Race"];
const PRACTICE_MAP = {
  "Practice 1": "FP1",
  "Practice 2": "FP2",
  "Practice 3": "FP3",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 4)}\n`);
}

function parseRaceDate(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLikeRaceDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    MONTHS[date.getUTCMonth()],
    date.getUTCDate(),
    date.getUTCFullYear(),
    `${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, "0")}`,
    "UTC",
  ].join(" ");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .toLowerCase()
    .replace(/\b(gp|grand|prix|circuit|international|autodrome|street)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countryNameFromRace(country) {
  return normalizeName(country).replace(/^[a-z]{2}\s+/, "");
}

function tokenSet(value) {
  return new Set(normalizeName(value).split(" ").filter(Boolean));
}

function hasTokenOverlap(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);

  for (const token of leftTokens) {
    if (token.length > 2 && rightTokens.has(token)) {
      return true;
    }
  }

  return false;
}

function scoreSessionForRace(session, race) {
  let score = 0;
  const raceCountry = countryNameFromRace(race.Country);
  const raceCity = normalizeName(race.City);
  const sessionCountry = normalizeName(session.country_name);
  const sessionLocation = normalizeName(session.location);
  const sessionCircuit = normalizeName(session.circuit_short_name);
  const meetingName = normalizeName(session.meeting_name);

  if (raceCountry && sessionCountry && raceCountry === sessionCountry) {
    score += 3;
  }

  if (raceCity && (raceCity === sessionLocation || raceCity === sessionCircuit)) {
    score += 3;
  } else if (
    raceCity &&
    (hasTokenOverlap(raceCity, sessionLocation) ||
      hasTokenOverlap(raceCity, sessionCircuit) ||
      hasTokenOverlap(raceCity, meetingName))
  ) {
    score += 1;
  }

  return score;
}

function sessionsInRaceWindow(sessions, race) {
  const raceDate = parseRaceDate(race.Race);
  if (!raceDate) {
    return [];
  }

  const windowStart = raceDate.getTime() - 4 * 24 * 60 * 60 * 1000;
  const windowEnd = raceDate.getTime() + 8 * 60 * 60 * 1000;

  return sessions.filter((session) => {
    const sessionStart = new Date(session.date_start).getTime();
    return Number.isFinite(sessionStart) && sessionStart >= windowStart && sessionStart <= windowEnd;
  });
}

function findPracticeSessions(race, sessions) {
  const candidates = sessionsInRaceWindow(sessions, race).filter((session) => PRACTICE_MAP[session.session_name]);
  const bestByField = {};

  for (const session of candidates) {
    const field = PRACTICE_MAP[session.session_name];
    const score = scoreSessionForRace(session, race);
    const current = bestByField[field];

    if (!current || score > current.score) {
      bestByField[field] = { session, score };
    }
  }

  const result = {};
  for (const field of SESSION_FIELDS) {
    const match = bestByField[field];
    result[field] = match ? formatLikeRaceDate(match.session.date_start) : "";
  }

  return result;
}

function reorderRaceFields(race, practiceValues) {
  const nextRace = {};
  const source = {
    ...race,
    FP1: practiceValues.FP1 || race.FP1 || "",
    FP2: practiceValues.FP2 || race.FP2 || "",
    FP3: practiceValues.FP3 || race.FP3 || "",
  };

  for (const [key, value] of Object.entries(race)) {
    if (!ORDERED_SESSION_FIELDS.includes(key)) {
      nextRace[key] = value;
    }

    if (key === "City") {
      for (const sessionKey of ORDERED_SESSION_FIELDS) {
        if (sessionKey in source) {
          nextRace[sessionKey] = source[sessionKey] || "";
        }
      }
    }
  }

  if (!("FP1" in nextRace)) {
    for (const sessionKey of ORDERED_SESSION_FIELDS) {
      nextRace[sessionKey] = source[sessionKey] || "";
    }
  }

  return nextRace;
}

async function fetchOpenF1Sessions(year) {
  const url = `https://api.openf1.org/v1/sessions?year=${year}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OpenF1 returned ${response.status} for ${url}`);
  }

  return response.json();
}

function raceYears(races) {
  return [
    ...new Set(
      races
        .map((race) => parseRaceDate(race.Race)?.getUTCFullYear())
        .filter((year) => Number.isInteger(year))
    ),
  ];
}

async function main() {
  const data = readJson(RACES_NEW_PATH);
  if (!Array.isArray(data.Races)) {
    throw new Error("Expected races-new.json to contain a Races array.");
  }

  const sessionsByYear = new Map();
  for (const year of raceYears(data.Races)) {
    try {
      const sessions = await fetchOpenF1Sessions(year);
      sessionsByYear.set(year, Array.isArray(sessions) ? sessions : []);
      console.log(`Loaded ${sessionsByYear.get(year).length} OpenF1 sessions for ${year}.`);
    } catch (error) {
      sessionsByYear.set(year, []);
      console.log(`Could not load OpenF1 sessions for ${year}: ${error.message}`);
    }
  }

  data.Races = data.Races.map((race) => {
    const year = parseRaceDate(race.Race)?.getUTCFullYear();
    const sessions = sessionsByYear.get(year) || [];
    const practiceValues = findPracticeSessions(race, sessions);
    const updatedRace = reorderRaceFields(race, practiceValues);

    console.log(
      `${race.Country} ${race.City}: FP1="${updatedRace.FP1}" FP2="${updatedRace.FP2}" FP3="${updatedRace.FP3}"`
    );

    return updatedRace;
  });

  writeJson(RACES_NEW_PATH, data);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
