const ORDINAL_SUFFICES = ["th", "st", "nd", "rd"];
const ALL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PLP_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday"];

const ordinalize = n => n + (ORDINAL_SUFFICES[(n-20)%10] || ORDINAL_SUFFICES[n] || ORDINAL_SUFFICES[0]);

const nicelyFormatDate = date => {
    const d = new Date(date);
    const weekDay = ALL_DAYS[d.getDay()];
    const month = d.toLocaleString('en-us', { month: 'long' });
    const day = ordinalize(d.getDate());
    const year = d.getYear() + 1900;
    return `${weekDay}, ${month} ${day}, ${year}`;
};

const generateDatesArray = (startDate, endDate) => {
    const dates = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        const weekDay = currentDate.toLocaleDateString('en-US', {'weekday': 'long', 'timeZone': 'America/New_York'});
        if (PLP_DAYS.includes(weekDay)) {
            dates.push(new Date(currentDate));
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
}

module.exports = {
    nicelyFormatDate: nicelyFormatDate,
    generateDatesArray: generateDatesArray,
};
