export function cairoDayTimestamp(date: string, endOfDay = false) {
  const target = endOfDay
    ? new Date(Date.parse(`${date}T00:00:00Z`) + 86400000)
        .toISOString()
        .slice(0, 10)
    : date;
  const calendar = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Find the actual first instant of the day, including Cairo's midnight DST changes.
  const center = Date.parse(`${target}T00:00:00Z`);
  let before = center - 86400000;
  let after = center + 86400000;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (calendar.format(middle) < target) before = middle;
    else after = middle;
  }
  return new Date(after - (endOfDay ? 1 : 0)).toISOString();
}
