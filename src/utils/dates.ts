import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export function parseFrenchDate(input: string, tz: string): dayjs.Dayjs | null {
  const parsed = dayjs.tz(input, "DD/MM/YYYY", tz);

  if (!parsed.isValid()) {
    return null;
  }

  return parsed.startOf("day");
}

export function isFriday(date: dayjs.Dayjs): boolean {
  return date.day() === 5;
}

export function formatFrenchDate(date: dayjs.Dayjs): string {
  return date.format("DD/MM/YYYY");
}

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 0,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11
};

export function parseFrenchDayMonth(input: string): { day: number; month: number } | null {
  const normalized = normalizeFrench(input);
  const match = normalized.match(
    /(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)/
  );

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = FRENCH_MONTHS[match[2]];

  if (!Number.isInteger(day) || day < 1 || day > 31 || month === undefined) {
    return null;
  }

  return { day, month };
}

function normalizeFrench(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
