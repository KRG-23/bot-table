import { MatchStatus, NotificationType } from "@prisma/client";
import dayjs from "dayjs";
import type { Client, InteractionReplyOptions, Message } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import { formatFrenchDate } from "../utils/dates";

import { getAppSettings } from "./app-settings";
import { getEventTableCapacity, getGameTableCapacity } from "./table-capacity";

type ReplyComponents = InteractionReplyOptions["components"];

type SendableChannel = {
  send: (payload: { content: string; components?: ReplyComponents }) => Promise<Message>;
};

type PendingMatch = {
  id: number;
  eventId: number;
  gameId: number;
  player1: { discordId: string };
  player2: { discordId: string };
  game: { label: string };
  event: { date: Date };
};

export type WeeklyMatchReviewResult = {
  reviewedEvents: number;
  autoValidated: number;
  pendingAfterReview: number;
  lines: string[];
};

export type GameAutoValidationResult = {
  autoValidated: number;
  pendingAfterReview: number;
  remainingTables: number;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  return "send" in channel && typeof (channel as SendableChannel).send === "function";
}

function buildMatchSummary(match: PendingMatch, config: AppConfig): string {
  const eventDate = dayjs(match.event.date).tz(config.timezone);
  return `${formatFrenchDate(eventDate)} — <@${match.player1.discordId}> vs <@${
    match.player2.discordId
  }> (${match.game.label})`;
}

export function buildWeeklyMatchReviewSummary(
  result: WeeklyMatchReviewResult,
  lookaheadDays = 7
): string {
  const header = [
    "📋 Récapitulatif des parties",
    `Créneaux analysés : ${result.reviewedEvents}`,
    `Parties auto-validées : ${result.autoValidated}`,
    `Parties encore en attente : ${result.pendingAfterReview}`
  ];

  if (result.lines.length === 0) {
    return [
      ...header,
      "",
      `Aucun créneau ouvert à analyser sur les ${lookaheadDays} prochain(s) jour(s).`
    ].join("\n");
  }

  return [...header, "", ...result.lines].join("\n");
}

export async function reviewUpcomingMatches(
  client: Client,
  config: AppConfig,
  logger: Logger,
  lookaheadDays: number
): Promise<WeeklyMatchReviewResult> {
  const prisma = getPrisma();
  const now = dayjs().tz(config.timezone);
  const windowStart = now.startOf("day");
  const windowEnd = now.add(lookaheadDays, "day").endOf("day");

  const events = await prisma.event.findMany({
    where: {
      status: "OUVERT",
      tables: { gt: 0 },
      date: {
        gte: windowStart.toDate(),
        lte: windowEnd.toDate()
      }
    },
    include: {
      matches: {
        where: {
          status: { in: [MatchStatus.EN_ATTENTE, MatchStatus.VALIDE] }
        },
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

  const result: WeeklyMatchReviewResult = {
    reviewedEvents: events.length,
    autoValidated: 0,
    pendingAfterReview: 0,
    lines: []
  };

  for (const event of events) {
    if (event.matches.length === 0) {
      const capacity = await getEventTableCapacity(prisma, event);
      result.lines.push(
        `• ${formatFrenchDate(
          dayjs(event.date).tz(config.timezone)
        )} : aucune partie en attente, ${capacity.totalTables} table(s) restante(s).`
      );
      continue;
    }

    const gameIds = [...new Set(event.matches.map((match) => match.gameId))];

    for (const gameId of gameIds) {
      const gameMatches = event.matches.filter((match) => match.gameId === gameId);
      const gameLabel = gameMatches[0]?.game.label ?? "Jeu";
      const gameCapacity = await getGameTableCapacity(prisma, event, gameId);
      const validated = gameMatches.filter((match) => match.status === MatchStatus.VALIDE);
      const pending = gameMatches.filter((match) => match.status === MatchStatus.EN_ATTENTE);
      const activeCount = validated.length + pending.length;
      const remainingBeforeReview = Math.max(gameCapacity - validated.length, 0);

      if (pending.length > 0 && activeCount <= gameCapacity) {
        await prisma.match.updateMany({
          where: { id: { in: pending.map((match) => match.id) } },
          data: { status: MatchStatus.VALIDE }
        });

        await Promise.all(
          pending.map((match) => notifyAutoValidatedMatch(client, config, logger, match))
        );

        result.autoValidated += pending.length;
        result.lines.push(
          `• ${formatFrenchDate(dayjs(event.date).tz(config.timezone))} — ${gameLabel} : ${
            pending.length
          } partie(s) auto-validée(s), ${gameCapacity - activeCount} table(s) restante(s).`
        );
        continue;
      }

      result.pendingAfterReview += pending.length;

      if (pending.length > 0) {
        result.lines.push(
          `• ${formatFrenchDate(dayjs(event.date).tz(config.timezone))} — ${gameLabel} : ${
            pending.length
          } partie(s) en attente, ${remainingBeforeReview} table(s) restante(s). Action admin requise.`
        );
      } else {
        result.lines.push(
          `• ${formatFrenchDate(dayjs(event.date).tz(config.timezone))} — ${gameLabel} : aucune partie en attente, ${remainingBeforeReview} table(s) restante(s).`
        );
      }
    }
  }

  return result;
}

export async function autoValidatePendingMatchesForGame(
  client: Client,
  config: AppConfig,
  logger: Logger,
  eventId: number,
  gameId: number
): Promise<GameAutoValidationResult> {
  const prisma = getPrisma();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      matches: {
        where: {
          gameId,
          status: { in: [MatchStatus.EN_ATTENTE, MatchStatus.VALIDE] }
        },
        include: {
          player1: true,
          player2: true,
          game: true,
          event: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!event || event.status !== "OUVERT" || event.tables <= 0) {
    return { autoValidated: 0, pendingAfterReview: 0, remainingTables: 0 };
  }

  const gameCapacity = await getGameTableCapacity(prisma, event, gameId);
  const validated = event.matches.filter((match) => match.status === MatchStatus.VALIDE);
  const pending = event.matches.filter((match) => match.status === MatchStatus.EN_ATTENTE);
  const activeCount = validated.length + pending.length;
  const remainingBeforeReview = Math.max(gameCapacity - validated.length, 0);

  if (pending.length === 0) {
    return { autoValidated: 0, pendingAfterReview: 0, remainingTables: remainingBeforeReview };
  }

  if (gameCapacity <= 0 || activeCount > gameCapacity) {
    return {
      autoValidated: 0,
      pendingAfterReview: pending.length,
      remainingTables: remainingBeforeReview
    };
  }

  await prisma.match.updateMany({
    where: {
      id: { in: pending.map((match) => match.id) },
      status: MatchStatus.EN_ATTENTE
    },
    data: { status: MatchStatus.VALIDE }
  });

  await Promise.all(
    pending.map((match) => notifyAutoValidatedMatch(client, config, logger, match))
  );

  return {
    autoValidated: pending.length,
    pendingAfterReview: 0,
    remainingTables: gameCapacity - activeCount
  };
}

async function notifyAutoValidatedMatch(
  client: Client,
  config: AppConfig,
  logger: Logger,
  match: PendingMatch
): Promise<void> {
  const prisma = getPrisma();
  const summary = buildMatchSummary(match, config);
  const dmMessage = `✅ Votre partie est validée automatiquement : ${summary}`;
  const dmResults = await Promise.all(
    [match.player1.discordId, match.player2.discordId].map(async (discordId) => {
      try {
        const user = await client.users.fetch(discordId);
        await user.send(dmMessage);
        return { success: true };
      } catch (err) {
        logger.warn({ err, userId: discordId }, "Failed to send auto-validation DM");
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  await prisma.notification.createMany({
    data: dmResults.map((notification) => ({
      matchId: match.id,
      type: NotificationType.DM,
      success: notification.success,
      error: notification.success ? null : notification.error
    }))
  });

  const appSettings = await getAppSettings(prisma, config);

  if (!appSettings.mentionInThread) {
    return;
  }

  try {
    const thread = await prisma.eventThread.findFirst({
      where: {
        eventId: match.eventId,
        gameId: match.gameId
      }
    });

    if (!thread) {
      return;
    }

    const channel = await client.channels.fetch(thread.threadId);
    if (!isSendableChannel(channel)) {
      return;
    }

    await channel.send({ content: `✅ Partie validée automatiquement : ${summary}` });
    await prisma.notification.create({
      data: { matchId: match.id, type: NotificationType.THREAD, success: true }
    });
  } catch (err) {
    logger.warn({ err, matchId: match.id }, "Failed to send auto-validation thread message");
    await prisma.notification.create({
      data: {
        matchId: match.id,
        type: NotificationType.THREAD,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    });
  }
}
