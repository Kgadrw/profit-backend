/**
 * Curated Rwanda public holidays.
 * Fixed dates + Easter-relative rules. Source of truth for the calendar layer.
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Anonymous Gregorian algorithm for Easter Sunday. */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function addDays(year, month, day, delta) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function holiday(date, name, type = 'public') {
  return { date, name, type };
}

/** Fixed-date Rwanda public holidays for a given year. */
function fixedHolidays(year) {
  return [
    holiday(toIsoDate(year, 1, 1), "New Year's Day"),
    holiday(toIsoDate(year, 1, 2), "New Year Holiday"),
    holiday(toIsoDate(year, 2, 1), 'National Heroes Day'),
    holiday(toIsoDate(year, 4, 7), 'Genocide Memorial Day'),
    holiday(toIsoDate(year, 5, 1), 'Labour Day'),
    holiday(toIsoDate(year, 7, 1), 'Independence Day'),
    holiday(toIsoDate(year, 7, 4), 'Liberation Day'),
    holiday(toIsoDate(year, 8, 15), 'Assumption Day'),
    holiday(toIsoDate(year, 12, 25), 'Christmas Day'),
    holiday(toIsoDate(year, 12, 26), 'Boxing Day'),
  ];
}

/** Movable Christian holidays observed in Rwanda. */
function movableHolidays(year) {
  const easter = easterSunday(year);
  const goodFriday = addDays(easter.year, easter.month, easter.day, -2);
  const easterMonday = addDays(easter.year, easter.month, easter.day, 1);
  return [
    holiday(
      toIsoDate(goodFriday.year, goodFriday.month, goodFriday.day),
      'Good Friday',
    ),
    holiday(
      toIsoDate(easter.year, easter.month, easter.day),
      'Easter Sunday',
    ),
    holiday(
      toIsoDate(easterMonday.year, easterMonday.month, easterMonday.day),
      'Easter Monday',
    ),
  ];
}

/**
 * Umuganura (National Harvest Day) — first Friday of August.
 */
function umuganura(year) {
  // Find first Friday in August
  let day = 1;
  while (true) {
    const dt = new Date(Date.UTC(year, 7, day)); // August = month 7
    if (dt.getUTCDay() === 5) {
      return holiday(toIsoDate(year, 8, day), 'Umuganura Day');
    }
    day += 1;
    if (day > 7) break;
  }
  return holiday(toIsoDate(year, 8, 1), 'Umuganura Day');
}

export function getRwandaHolidaysForYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return [];

  const list = [...fixedHolidays(y), ...movableHolidays(y), umuganura(y)];
  list.sort((a, b) => a.date.localeCompare(b.date));
  return list;
}

/**
 * Holidays overlapping [fromIso, toIso] inclusive (YYYY-MM-DD).
 */
export function getRwandaHolidaysInRange(fromIso, toIso) {
  const from = String(fromIso || '').slice(0, 10);
  const to = String(toIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const year = new Date().getFullYear();
    return [
      ...getRwandaHolidaysForYear(year),
      ...getRwandaHolidaysForYear(year + 1),
    ];
  }

  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  const years = [];
  for (let y = startYear; y <= endYear; y += 1) years.push(y);

  const all = years.flatMap((y) => getRwandaHolidaysForYear(y));
  return all.filter((h) => h.date >= from && h.date <= to);
}
