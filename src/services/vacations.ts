import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type { Logger } from "pino";

dayjs.extend(utc);
dayjs.extend(timezone);

const API_BASE =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records";
const POPULATION_VALUE = "Élèves";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type VacationRecord = {
  description: string;
  population: string;
  start_date: string;
  end_date: string;
  location: string;
  zones?: string;
  annee_scolaire?: string;
};

type CachedVacations = {
  expiresAt: number;
  academy: string;
  records: VacationRecord[];
};

let cache: CachedVacations | null = null;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function fetchVacations(academy: string, logger: Logger): Promise<VacationRecord[]> {
  if (cache && cache.academy === academy && Date.now() < cache.expiresAt) {
    return cache.records;
  }

  const records: VacationRecord[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const url = new URL(API_BASE);

    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.append("refine", `location:${academy}`);
    url.searchParams.append("refine", `population:${POPULATION_VALUE}`);
    url.searchParams.set("timezone", "Europe/Paris");

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Vacation API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { results?: VacationRecord[]; total_count?: number };
    const batch = data.results ?? [];

    records.push(...batch);

    if (batch.length < limit) {
      break;
    }

    offset += limit;
  }

  const academyNorm = normalize(academy);
  const populationNorm = normalize(POPULATION_VALUE);
  const filtered = records.filter((record) => {
    return (
      normalize(record.location) === academyNorm && normalize(record.population) === populationNorm
    );
  });

  cache = {
    academy,
    records: filtered,
    expiresAt: Date.now() + CACHE_TTL_MS
  };

  logger.info({ academy, records: filtered.length }, "Vacation records cached");

  return filtered;
}

export type ClosureInfo = {
  closed: boolean;
  reason?: string;
  period?: {
    description: string;
    start: string;
    end: string;
  };
};

export async function getClosureInfo(
  date: dayjs.Dayjs,
  academy: string,
  tz: string,
  logger: Logger
): Promise<ClosureInfo> {
  try {
    const records = await fetchVacations(academy, logger);

    for (const record of records) {
      const start = dayjs.tz(record.start_date, tz).startOf("day");
      const end = dayjs.tz(record.end_date, tz).startOf("day");

      if (date.isSame(start.subtract(1, "day"), "day")) {
        return {
          closed: true,
          reason: "Veille de vacances scolaires",
          period: {
            description: record.description,
            start: start.format("DD/MM/YYYY"),
            end: end.format("DD/MM/YYYY")
          }
        };
      }

      if (
        date.isSame(start, "day") ||
        (date.isAfter(start) && date.isBefore(end)) ||
        date.isSame(end, "day")
      ) {
        return {
          closed: true,
          reason: "Vacances scolaires",
          period: {
            description: record.description,
            start: start.format("DD/MM/YYYY"),
            end: end.format("DD/MM/YYYY")
          }
        };
      }
    }

    return { closed: false };
  } catch (err) {
    logger.error({ err }, "Failed to fetch vacation calendar");
    return { closed: false, reason: "Calendrier indisponible" };
  }
}
