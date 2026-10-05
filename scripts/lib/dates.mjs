const TZ = 'Europe/London';

/** Date, hour and weekday in UK time. */
export function londonParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      weekday: 'long',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

/** Hours UK time is ahead of UTC: 0 (GMT) or 1 (BST). */
export function londonOffsetHours(date = new Date()) {
  return (((londonParts(date).hour - date.getUTCHours()) % 24) + 24) % 24;
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Tuesday 6 October" */
export function formatDay(isoDate) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T12:00:00Z`),
  );
}
