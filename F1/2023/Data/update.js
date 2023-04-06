const racesFilePath = '/races.json';
const nextRaceFilePath = '/racesmini.json';

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

// Create an object with the next race data
const nextRaceData = {
Country: nextRace.Country,
City: nextRace.City,
Qual: nextRace.Qual,
Race: nextRace.Race,
TimeToQualify: timeToQualify,
TimeToRace: timeToRace
};

// Write the next race data to a JSON file
const fs = require('fs');
const json = JSON.stringify(nextRaceData);
fs.writeFileSync(nextRaceFilePath, json);
