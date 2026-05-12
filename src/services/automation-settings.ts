import type { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

export const AUTOMATION_SETTINGS_KEYS = {
  monthlyWeekday: "automation_monthly_slots_weekday",
  monthlyWeek: "automation_monthly_slots_week",
  monthlyTime: "automation_monthly_slots_time",
  weeklyReviewWeekday: "automation_weekly_review_weekday",
  weeklyReviewTime: "automation_weekly_review_time",
  weeklyReviewLookaheadDays: "automation_weekly_review_lookahead_days"
} as const;

export type AutomationSettings = {
  monthlyWeekday: number;
  monthlyWeek: number;
  monthlyTime: string;
  weeklyReviewWeekday: number;
  weeklyReviewTime: string;
  weeklyReviewLookaheadDays: number;
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  monthlyWeekday: 0,
  monthlyWeek: 1,
  monthlyTime: "09:00",
  weeklyReviewWeekday: 3,
  weeklyReviewTime: "21:00",
  weeklyReviewLookaheadDays: 7
};

const WEEKDAY_LABELS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const WEEKDAY_INPUTS: Record<string, number> = {
  dim: 0,
  dimanche: 0,
  lun: 1,
  lundi: 1,
  mar: 2,
  mardi: 2,
  mer: 3,
  mercredi: 3,
  jeu: 4,
  jeudi: 4,
  ven: 5,
  vendredi: 5,
  sam: 6,
  samedi: 6
};

export function formatWeekday(day: number): string {
  return WEEKDAY_LABELS[day] ?? String(day);
}

export function formatAutomationSettings(settings: AutomationSettings): string[] {
  return [
    `Génération mensuelle : ${formatOrdinal(settings.monthlyWeek)} ${formatWeekday(
      settings.monthlyWeekday
    )} du mois à ${settings.monthlyTime}`,
    `Récap parties : ${formatWeekday(settings.weeklyReviewWeekday)} à ${settings.weeklyReviewTime}`,
    `Fenêtre d'analyse : ${settings.weeklyReviewLookaheadDays} jour(s)`
  ];
}

export function parseWeekdayInput(input: string): number | null {
  const normalized = normalizeInput(input);
  if (/^[0-6]$/.test(normalized)) {
    return Number(normalized);
  }

  if (normalized === "7") {
    return 0;
  }

  return WEEKDAY_INPUTS[normalized] ?? null;
}

export function parseTimeInput(input: string): string | null {
  const match = input.trim().match(/^([01]?[0-9]|2[0-3])[:h]([0-5][0-9])$/i);
  if (!match) {
    return null;
  }

  const hour = String(Number(match[1])).padStart(2, "0");
  return `${hour}:${match[2]}`;
}

export function parseWeekInput(input: string): number | null {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    return null;
  }
  return value;
}

export function parseLookaheadInput(input: string): number | null {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    return null;
  }
  return value;
}

export function buildMonthlyAutomationRunDate(
  now: dayjs.Dayjs,
  settings: AutomationSettings
): dayjs.Dayjs {
  let cursor = now.startOf("month");

  while (true) {
    const candidate = getNthWeekdayOfMonth(
      cursor,
      settings.monthlyWeekday,
      settings.monthlyWeek,
      settings.monthlyTime
    );

    if (candidate.isAfter(now)) {
      return candidate;
    }

    cursor = cursor.add(1, "month").startOf("month");
  }
}

export function buildWeeklyReviewRunDate(
  now: dayjs.Dayjs,
  settings: AutomationSettings
): dayjs.Dayjs {
  const [hour, minute] = settings.weeklyReviewTime.split(":").map(Number);
  let candidate = now
    .day(settings.weeklyReviewWeekday)
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);

  if (!candidate.isAfter(now)) {
    candidate = candidate.add(7, "day");
  }

  return candidate;
}

export async function getAutomationSettings(prisma: PrismaClient): Promise<AutomationSettings> {
  const settings = await prisma.setting.findMany({
    where: {
      key: { in: Object.values(AUTOMATION_SETTINGS_KEYS) }
    }
  });
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));

  return {
    monthlyWeekday:
      parseWeekdayInput(values.get(AUTOMATION_SETTINGS_KEYS.monthlyWeekday) ?? "") ??
      DEFAULT_AUTOMATION_SETTINGS.monthlyWeekday,
    monthlyWeek:
      parseWeekInput(values.get(AUTOMATION_SETTINGS_KEYS.monthlyWeek) ?? "") ??
      DEFAULT_AUTOMATION_SETTINGS.monthlyWeek,
    monthlyTime:
      parseTimeInput(values.get(AUTOMATION_SETTINGS_KEYS.monthlyTime) ?? "") ??
      DEFAULT_AUTOMATION_SETTINGS.monthlyTime,
    weeklyReviewWeekday:
      parseWeekdayInput(values.get(AUTOMATION_SETTINGS_KEYS.weeklyReviewWeekday) ?? "") ??
      DEFAULT_AUTOMATION_SETTINGS.weeklyReviewWeekday,
    weeklyReviewTime:
      parseTimeInput(values.get(AUTOMATION_SETTINGS_KEYS.weeklyReviewTime) ?? "") ??
      DEFAULT_AUTOMATION_SETTINGS.weeklyReviewTime,
    weeklyReviewLookaheadDays:
      parseLookaheadInput(values.get(AUTOMATION_SETTINGS_KEYS.weeklyReviewLookaheadDays) ?? "") ??
      DEFAULT_AUTOMATION_SETTINGS.weeklyReviewLookaheadDays
  };
}

export async function saveAutomationSettings(
  prisma: PrismaClient,
  settings: AutomationSettings
): Promise<void> {
  await prisma.$transaction([
    upsertSetting(prisma, AUTOMATION_SETTINGS_KEYS.monthlyWeekday, String(settings.monthlyWeekday)),
    upsertSetting(prisma, AUTOMATION_SETTINGS_KEYS.monthlyWeek, String(settings.monthlyWeek)),
    upsertSetting(prisma, AUTOMATION_SETTINGS_KEYS.monthlyTime, settings.monthlyTime),
    upsertSetting(
      prisma,
      AUTOMATION_SETTINGS_KEYS.weeklyReviewWeekday,
      String(settings.weeklyReviewWeekday)
    ),
    upsertSetting(prisma, AUTOMATION_SETTINGS_KEYS.weeklyReviewTime, settings.weeklyReviewTime),
    upsertSetting(
      prisma,
      AUTOMATION_SETTINGS_KEYS.weeklyReviewLookaheadDays,
      String(settings.weeklyReviewLookaheadDays)
    )
  ]);
}

function getNthWeekdayOfMonth(
  monthStart: dayjs.Dayjs,
  weekday: number,
  week: number,
  time: string
): dayjs.Dayjs {
  const [hour, minute] = time.split(":").map(Number);
  let candidate = monthStart.startOf("month").hour(hour).minute(minute).second(0).millisecond(0);

  while (candidate.day() !== weekday) {
    candidate = candidate.add(1, "day");
  }

  return candidate.add(week - 1, "week");
}

function upsertSetting(prisma: PrismaClient, key: string, value: string) {
  return prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value }
  });
}

function formatOrdinal(value: number): string {
  return value === 1 ? "1er" : `${value}e`;
}

function normalizeInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
