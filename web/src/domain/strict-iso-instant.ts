/** Parse a real ISO local calendar/clock with an explicit offset, without normalization of invalid days. */
export function strictIsoInstant(value: unknown, invalid: () => never): number {
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid();
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const local = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ?? ''}Z`);
  if (!Number.isFinite(local.getTime()) || local.getUTCFullYear() !== Number(year) || local.getUTCMonth() + 1 !== Number(month)
    || local.getUTCDate() !== Number(day) || local.getUTCHours() !== Number(hour) || local.getUTCMinutes() !== Number(minute) || local.getUTCSeconds() !== Number(second)) invalid();
  if (zone !== 'Z') { const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6)); if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) invalid(); }
  const time = Date.parse(value); if (!Number.isFinite(time)) invalid(); return time;
}
