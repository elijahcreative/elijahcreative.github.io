const racesFilePath = '/Users/bali/Library/CloudStorage/OneDrive-Személyes/GitHub/elijahcreative.github.io/F1/2023/Data/races.json';
const nextRaceFilePath = '/Users/bali/Library/CloudStorage/OneDrive-Személyes/GitHub/elijahcreative.github.io/F1/2023/Data/racesmini.json';


const races = require(racesFilePath);

// Find the index of the next race
const now = new Date();
let nextRaceIndex = -1;
for (let i = 0; i < races.Races.length; i++) {
const race = races.Races[i];
if (new Date(race.Race) > now) {
nextRaceIndex = i;
break;
}
}

// Extract the next race data
const nextRace = races.Races[nextRaceIndex];
const timeToQualify = Math.ceil((new Date(nextRace.Qual) - now) / (1000 * 60 * 60 * 24));
const timeToRace = Math.ceil((new Date(nextRace.Race) - now) / (1000 * 60 * 60 * 24));


// Format the dates
const options = { month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' };
const qualDate = new Date(nextRace.Qual).toLocaleString('hu-HU', options);
const sprintDate = new Date(nextRace.Sprint).toLocaleString('hu-HU', options);
const raceDate = new Date(nextRace.Race).toLocaleString('hu-HU', options);


// Create an object with the next race data
const nextRaceData = {
Country: nextRace.Country,
City: nextRace.City,
Qual: qualDate,
Sprint: sprintDate,
Race: raceDate,

Laps: nextRace.Laps,
Length: nextRace.Length,
Distance: nextRace["Race distance"],
Bestlap: nextRace["Best lap"],
Bestlapdriver: nextRace["Best lap driver"],
FirstGP: nextRace["First GP"],
Trackimage: nextRace["Track image"],
Track2: nextRace.Track2,

TimeToQualify: timeToQualify,
TimeToRace: timeToRace
};


// Write the next race data to a JSON file
const fs = require('fs');
const json = JSON.stringify(nextRaceData, null, 2).replace(/,\n\s*(?=[^"]*"[^"]*(?:"[^"]*"[^"]*)*$)/g, ",");
fs.writeFileSync(nextRaceFilePath, json);
