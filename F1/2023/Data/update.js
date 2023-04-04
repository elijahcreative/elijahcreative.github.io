const fetch = require("node-fetch"); // require the 'node-fetch' library for making HTTP requests
const fs = require("fs"); // require the 'fs' library for file operations

// set the URL of your JSON file
const url = "https://elijahcreative.github.io/F1/2023/Data/races.json";

// set the path and name of the file to update
const updateFile = "https://elijahcreative.github.io/F1/2023/Data/racesmini.json";

// set the interval in milliseconds for how often to update the file (e.g. every hour)
const updateInterval = 60 * 60 * 1000;

// function to get the next race from the race schedule
function getNextRace(raceSchedule) {
  const now = new Date();
  let nextRace = null;
  for (let i = 0; i < raceSchedule.length; i++) {
    const race = raceSchedule[i];
    const raceDate = new Date(race.Race);
    if (raceDate > now && (!nextRace || raceDate < nextRace.Race)) {
      nextRace = race;
    }
  }
  return nextRace;
}

// function to update the file with the next race data
function updateNextRaceFile() {
  fetch(url)
    .then(response => response.json())
    .then(raceSchedule => {
      const nextRace = getNextRace(raceSchedule.Races);
      if (nextRace) {
        const data = JSON.stringify(nextRace, null, 2);
        fs.writeFile(updateFile, data, err => {
          if (err) {
            console.error("Error writing to file:", err);
          } else {
            console.log("Next race updated:", nextRace.Country);
          }
        });
      } else {
        console.error("No upcoming races found");
      }
    })
    .catch(error => console.error("Error fetching race schedule:", error));
}

// update the file initially
updateNextRaceFile();

// set the interval to update the file periodically
setInterval(updateNextRaceFile, updateInterval);
