function getNextRace(raceSchedule) {
    var currentDate = new Date();
    var nextRace;
    var minTimeDiff = Number.MAX_VALUE;
    for (var i = 0; i < raceSchedule.length; i++) {
        var race = raceSchedule[i];
        var raceDate = new Date(race.date);
        var timeDiff = raceDate - currentDate;
        if (timeDiff > 0 && timeDiff < minTimeDiff) {
            nextRace = race;
            minTimeDiff = timeDiff;
        }
    }
    return nextRace;
};

var raceSchedule = [
    {
        "country": "United States",
        "location": "Circuit of the Americas",
        "date": "2023-11-19",
        "time": "14:00"
    },
    {
        "country": "Mexico",
        "location": "Autodromo Hermanos Rodriguez",
        "date": "2023-11-26",
        "time": "14:00"
    }
];

var nextRace = getNextRace(raceSchedule);
console.log(nextRace);