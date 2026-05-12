import type { Event } from "@prisma/client";
import dayjs from "dayjs";
import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";

import { ensureEventThreads } from "./event-threads";
import { buildMonthSlots, getSlotDays } from "./slots";
import { buildDefaultGameTableAllocations, replaceGameTableCapacities } from "./table-capacity";
import { getClosureInfo } from "./vacations";

export type MonthlySlotGenerationResult = {
  monthName: string;
  created: number;
  skipped: number;
  closedSkipped: number;
  threadsCreated: number;
  threadsExisting: number;
  threadsFailed: number;
};

export function buildMonthlySlotGenerationSummary(result: MonthlySlotGenerationResult): string {
  return [
    `📅 Créneaux du mois (${result.monthName})`,
    `Nouveaux créneaux : ${result.created}`,
    `Déjà présents : ${result.skipped}`,
    `Fermés (vacances/veille, non créés) : ${result.closedSkipped}`,
    `Fils créés : ${result.threadsCreated}`,
    `Fils déjà présents : ${result.threadsExisting}`,
    `Échecs création de fils : ${result.threadsFailed}`
  ].join("\n");
}

export async function generateCurrentMonthSlots(
  client: Client,
  config: AppConfig,
  logger: Logger
): Promise<MonthlySlotGenerationResult> {
  const prisma = getPrisma();
  const monthName = dayjs().tz(config.timezone).format("MMMM YYYY");
  const slotDays = await getSlotDays(prisma);
  const slots = buildMonthSlots(config.timezone, slotDays);
  const result: MonthlySlotGenerationResult = {
    monthName,
    created: 0,
    skipped: 0,
    closedSkipped: 0,
    threadsCreated: 0,
    threadsExisting: 0,
    threadsFailed: 0
  };

  for (const slotDate of slots) {
    const existing = await prisma.event.findUnique({ where: { date: slotDate.toDate() } });
    if (existing) {
      if (existing.status === "OUVERT") {
        const event = await applyDefaultTablesIfMissing(existing);
        if (event.tables > 0) {
          const threads = await ensureEventThreads(client, config, logger, event);
          result.threadsCreated += threads.created;
          result.threadsExisting += threads.existing;
          result.threadsFailed += threads.failed;
        }
      }
      result.skipped += 1;
      continue;
    }

    const closure = await getClosureInfo(slotDate, config.vacationAcademy, config.timezone, logger);
    if (closure.closed) {
      result.closedSkipped += 1;
      continue;
    }

    const event = await prisma.event.create({
      data: {
        date: slotDate.toDate(),
        tables: 0,
        status: "OUVERT",
        isVacation: false
      }
    });

    const eventWithDefaults = await applyDefaultTablesIfMissing(event);
    if (eventWithDefaults.tables > 0) {
      const threads = await ensureEventThreads(client, config, logger, eventWithDefaults);
      result.threadsCreated += threads.created;
      result.threadsExisting += threads.existing;
      result.threadsFailed += threads.failed;
    }

    result.created += 1;
  }

  return result;

  async function applyDefaultTablesIfMissing(event: Event): Promise<Event> {
    const configuredTables = await prisma.eventGameCapacity.count({
      where: { eventId: event.id }
    });

    if (configuredTables > 0 || event.tables > 0) {
      return event;
    }

    const allocations = await buildDefaultGameTableAllocations(prisma);
    const totalTables = allocations.reduce((total, allocation) => total + allocation.tables, 0);

    if (totalTables <= 0) {
      return event;
    }

    await replaceGameTableCapacities(prisma, event.id, allocations);

    return prisma.event.update({
      where: { id: event.id },
      data: {
        tables: totalTables,
        status: "OUVERT",
        isVacation: false
      }
    });
  }
}
