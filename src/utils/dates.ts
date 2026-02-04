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
