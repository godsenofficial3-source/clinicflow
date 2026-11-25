// Store only the timing and a generic reminder label. The treating practitioner
// provides any prescription or recovery instructions through their usual channel.
const { ymd } = require("./db");
const { toDate } = require("./estimates");

function daysAfter(date, count) {
  const day = toDate(date + " 12:00");
  day.setDate(day.getDate() + count);
  return ymd(day);
}

function occurrences(reminder, from, days) {
  const out = [];
  for (let offset = 0; offset < days; offset++) {
    const date = daysAfter(from, offset);
    if (date < reminder.start_date || date > reminder.end_date) continue;
    for (const time of reminder.times) out.push({ date, time });
  }
  return out;
}

module.exports = { daysAfter, occurrences };
