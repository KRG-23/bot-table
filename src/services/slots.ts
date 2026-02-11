import type { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

export const SLOT_DAYS_SETTING = "slot_days";
export const DEFAULT_SLOT_DAYS = [5];

export function normalizeSlotDays(days: number[]): number[] {
  const normalized = days.map((day) => (day === 7 ? 0 : day)).filter((day) => day >= 0 && day <= 6);

  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

export function buildMonthSlots(tz: string, slotDays: number[]) {
  const now = dayjs().tz(tz);
  const start = now.startOf("month").startOf("day");
  const end = now.endOf("month").startOf("day");
  const dates = [];
  const allowedDays = new Set(normalizeSlotDays(slotDays));
  let cursor = start;

  while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
    if (allowedDays.has(cursor.day())) {
      dates.push(cursor);
    }
    cursor = cursor.add(1, "day");
  }

  return dates;
}

export function formatSlotDays(days: number[]): string {
  const labels = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const normalized = normalizeSlotDays(days);
  return normalized.map((day) => labels[day] ?? String(day)).join(", ");
}

export function parseSlotDaysInput(input: string): number[] {
  const tokens = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[,;]+|\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const mapping: Record<string, number> = {
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
    samedi: 6,
    dim: 7,
    dimanche: 7
  };

  const days: number[] = [];

  for (const token of tokens) {
    if (/^[0-9]+$/.test(token)) {
      const value = Number(token);
      if (value >= 1 && value <= 7) {
        days.push(value);
      }
      continue;
    }

    if (mapping[token]) {
      days.push(mapping[token]);
    }
  }

  return Array.from(new Set(days)).sort((a, b) => a - b);
}

export function isSlotDay(date: dayjs.Dayjs, slotDays: number[]): boolean {
  const allowedDays = new Set(normalizeSlotDays(slotDays));
  return allowedDays.has(date.day());
}

export async function getSlotDays(prisma: PrismaClient): Promise<number[]> {
  const setting = await prisma.setting.findUnique({
    where: { key: SLOT_DAYS_SETTING }
  });

  if (!setting?.value) {
    return DEFAULT_SLOT_DAYS;
  }

  const parsed = parseSlotDaysInput(setting.value);
  return parsed.length > 0 ? parsed : DEFAULT_SLOT_DAYS;
}
