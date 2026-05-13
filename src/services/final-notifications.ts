import { MatchStatus, NotificationType } from "@prisma/client";
import dayjs from "dayjs";
import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import { formatFrenchDate } from "../utils/dates";

import { incrementMetric } from "./metrics";

type FinalNotificationMatch = {
  id: number;
  player1: { discordId: string };
  player2: { discordId: string };
  game: { label: string };
  event: { date: Date };
};

export type FinalNotificationResult = {
  reviewedEvents: number;
  notifiedMatches: number;
  dmSent: number;
  dmFailed: number;
  lines: string[];
};

export function buildFinalNotificationSummary(result: FinalNotificationResult): string {
  const header = [
    "🔔 Notifications finales",
    `Créneaux analysés : ${result.reviewedEvents}`,
    `Parties confirmées notifiées : ${result.notifiedMatches}`,
    `DM envoyés : ${result.dmSent}`,
    `DM en échec : ${result.dmFailed}`
  ];

  if (result.lines.length === 0) {
    return [...header, "", "Aucune partie validée à notifier aujourd'hui."].join("\n");
  }

  return [...header, "", ...result.lines].join("\n");
}

export async function sendFinalMatchNotifications(
  client: Client,
  config: AppConfig,
  logger: Logger
): Promise<FinalNotificationResult> {
  const prisma = getPrisma();
  const now = dayjs().tz(config.timezone);
  const dayStart = now.startOf("day");
  const dayEnd = now.endOf("day");

  const events = await prisma.event.findMany({
    where: {
      status: "OUVERT",
      tables: { gt: 0 },
      date: {
        gte: dayStart.toDate(),
        lte: dayEnd.toDate()
      }
    },
    include: {
      matches: {
        where: { status: MatchStatus.VALIDE },
        include: {
          player1: true,
          player2: true,
          game: true,
          event: true
        },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { date: "asc" }
  });

  const result: FinalNotificationResult = {
    reviewedEvents: events.length,
    notifiedMatches: 0,
    dmSent: 0,
    dmFailed: 0,
    lines: []
  };

  for (const event of events) {
    const date = formatFrenchDate(dayjs(event.date).tz(config.timezone));
    if (event.matches.length === 0) {
      result.lines.push(`• ${date} : aucune partie validée.`);
      continue;
    }

    const matchesByGame = new Map<string, FinalNotificationMatch[]>();
    for (const match of event.matches) {
      const matches = matchesByGame.get(match.game.label) ?? [];
      matches.push(match);
      matchesByGame.set(match.game.label, matches);
      const sent = await notifyPlayers(client, config, logger, match);
      result.dmSent += sent.success;
      result.dmFailed += sent.failed;
      result.notifiedMatches += 1;
    }

    for (const [gameLabel, matches] of matchesByGame) {
      result.lines.push(`• ${date} — ${gameLabel} : ${matches.length} partie(s) notifiée(s).`);
    }
  }

  return result;
}

async function notifyPlayers(
  client: Client,
  config: AppConfig,
  logger: Logger,
  match: FinalNotificationMatch
): Promise<{ success: number; failed: number }> {
  const prisma = getPrisma();
  const date = formatFrenchDate(dayjs(match.event.date).tz(config.timezone));
  const content = [
    `🔔 Rappel : votre partie ${match.game.label} est confirmée pour le ${date}.`,
    `Joueurs : <@${match.player1.discordId}> vs <@${match.player2.discordId}>.`,
    "Merci de prévenir le club rapidement en cas d'empêchement."
  ].join("\n");

  const results = await Promise.all(
    [match.player1.discordId, match.player2.discordId].map(async (discordId) => {
      try {
        const user = await client.users.fetch(discordId);
        await user.send(content);
        return { success: true };
      } catch (err) {
        incrementMetric("dmFailures");
        logger.warn({ err, userId: discordId }, "Failed to send final notification DM");
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  await prisma.notification.createMany({
    data: results.map((notification) => ({
      matchId: match.id,
      type: NotificationType.DM,
      success: notification.success,
      error: notification.success ? null : notification.error
    }))
  });

  return {
    success: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length
  };
}
