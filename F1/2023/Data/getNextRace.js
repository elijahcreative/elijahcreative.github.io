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
}