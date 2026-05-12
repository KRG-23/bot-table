import type { Event, Game } from "@prisma/client";
import dayjs from "dayjs";
import { ButtonStyle } from "discord.js";
import type { Client, InteractionReplyOptions, Message } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import { formatFrenchDate } from "../utils/dates";

import { listGamesWithConfiguredTables } from "./table-capacity";

const FRENCH_MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre"
];

type ReplyComponents = InteractionReplyOptions["components"];

type SendableChannel = {
  send: (payload: { content: string; components?: ReplyComponents }) => Promise<Message>;
  isThread?: () => boolean;
};

type ThreadStarterMessage = {
  startThread: (options: {
    name: string;
    autoArchiveDuration?: number;
  }) => Promise<ThreadStarterResult>;
};

type ThreadStarterResult = {
  id: string;
  send: (payload: { content: string; components?: ReplyComponents }) => Promise<unknown>;
};

export type EventThreadResult = {
  created: number;
  existing: number;
  failed: number;
};

function formatThreadDayMonth(date: dayjs.Dayjs): string {
  const month = FRENCH_MONTHS[date.month()] ?? date.format("MMMM");
  return `${date.date()} ${month}`;
}

function buildThreadName(game: Game, date: dayjs.Dayjs): string {
  return `Soirée ${game.label} le ${formatThreadDayMonth(date)}`;
}

function buildThreadGuideMessage(game: Game, date: dayjs.Dayjs, botName: string): string {
  return [
    `**Bienvenue sur la soirée ${game.label} du ${formatFrenchDate(date)}.**`,
    "",
    "**Réserver une partie**",
    `Écris dans ce fil : \`@${botName} @Joueur1 vs @Joueur2 ${game.label}\``,
    `Exemple : \`@${botName} @Alice vs @Bob ${game.label}\``,
    "",
    "**Validation**",
    "Après l'enregistrement, le bot affiche les boutons **Valider**, **Refuser** et **Annuler**.",
    "Les joueurs peuvent confirmer ou corriger la partie depuis ces boutons.",
    "",
    "**Règles utiles**",
    "• Une seule partie par joueur pour la soirée.",
    "• Les réservations ouvrent quand les tables sont configurées.",
    "• Les réservations sont bloquées si le créneau est fermé.",
    "• Les admins peuvent gérer ce fil avec les boutons ci-dessous ou depuis `/mu_config`."
  ].join("\n");
}

function buildThreadAdminRow(
  eventId: number,
  gameId: number
): NonNullable<ReplyComponents>[number] {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: `mu_thread:status:${eventId}:${gameId}`,
        label: "État",
        style: ButtonStyle.Secondary
      },
      {
        type: 2,
        custom_id: `mu_thread:tables:${eventId}:${gameId}`,
        label: "Tables",
        style: ButtonStyle.Primary
      },
      {
        type: 2,
        custom_id: `mu_thread:validate:${eventId}:${gameId}`,
        label: "Valider possibles",
        style: ButtonStyle.Success
      }
    ]
  };
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  return "send" in channel && typeof (channel as SendableChannel).send === "function";
}

function isThreadStarterMessage(message: unknown): message is ThreadStarterMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  return (
    "startThread" in message && typeof (message as ThreadStarterMessage).startThread === "function"
  );
}

export async function ensureEventThreads(
  client: Client,
  config: AppConfig,
  logger: Logger,
  event: Pick<Event, "id" | "date" | "status" | "tables">
): Promise<EventThreadResult> {
  const result: EventThreadResult = {
    created: 0,
    existing: 0,
    failed: 0
  };

  if (event.status !== "OUVERT" || event.tables <= 0) {
    return result;
  }

  const prisma = getPrisma();
  const existing = await prisma.eventThread.findMany({ where: { eventId: event.id } });
  const existingGames = new Set(existing.map((thread) => thread.gameId));
  const eventDate = dayjs(event.date).tz(config.timezone);
  const games = await listGamesWithConfiguredTables(prisma, event);

  for (const game of games) {
    if (existingGames.has(game.id)) {
      result.existing += 1;
      continue;
    }

    const threadName = buildThreadName(game, eventDate);
    const starterContent = `Créneau ${game.label} — ${formatFrenchDate(eventDate)}.`;

    try {
      const channel = await client.channels.fetch(game.channelId);

      if (!isSendableChannel(channel)) {
        result.failed += 1;
        logger.warn(
          { channelId: game.channelId, gameId: game.id },
          "Channel not found or not sendable"
        );
        continue;
      }

      if (channel.isThread?.()) {
        result.failed += 1;
        logger.warn(
          { channelId: game.channelId, gameId: game.id },
          "Configured channel is a thread"
        );
        continue;
      }

      const starter = await channel.send({ content: starterContent });
      if (!isThreadStarterMessage(starter)) {
        result.failed += 1;
        logger.warn({ eventId: event.id }, "Starter message does not support threads");
        continue;
      }

      const thread = await starter.startThread({
        name: threadName,
        autoArchiveDuration: 10080
      });

      try {
        await thread.send({
          content: buildThreadGuideMessage(game, eventDate, client.user?.username ?? "Munitorum"),
          components: [buildThreadAdminRow(event.id, game.id)]
        });
      } catch (err) {
        logger.warn({ err, gameId: game.id, eventId: event.id }, "Failed to send thread guide");
      }

      await prisma.eventThread.create({
        data: {
          eventId: event.id,
          gameId: game.id,
          threadId: thread.id
        }
      });

      result.created += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, gameId: game.id, eventId: event.id }, "Failed to create thread");
    }
  }

  return result;
}

export async function closeEventThreads(
  client: Client,
  logger: Logger,
  eventId: number
): Promise<void> {
  const prisma = getPrisma();
  const threads = await prisma.eventThread.findMany({
    where: { eventId },
    select: { threadId: true }
  });

  if (threads.length === 0) {
    return;
  }

  await prisma.eventThread.deleteMany({ where: { eventId } });
  await closeThreadsByIds(
    client,
    logger,
    threads.map((thread) => thread.threadId)
  );
}

export async function closeEventThreadsForGames(
  client: Client,
  logger: Logger,
  eventId: number,
  gameIds: number[]
): Promise<void> {
  if (gameIds.length === 0) {
    return;
  }

  const prisma = getPrisma();
  const threads = await prisma.eventThread.findMany({
    where: {
      eventId,
      gameId: { in: gameIds }
    },
    select: { threadId: true }
  });

  if (threads.length === 0) {
    return;
  }

  await prisma.eventThread.deleteMany({
    where: {
      eventId,
      gameId: { in: gameIds }
    }
  });
  await closeThreadsByIds(
    client,
    logger,
    threads.map((thread) => thread.threadId)
  );
}

export async function closeThreadsByIds(
  client: Client,
  logger: Logger,
  threadIds: string[]
): Promise<void> {
  for (const threadId of threadIds) {
    try {
      const channel = await client.channels.fetch(threadId);
      if (!channel || !("isThread" in channel) || !channel.isThread()) {
        continue;
      }

      try {
        await channel.setArchived(true);
      } catch (err) {
        logger.warn({ err, threadId }, "Failed to archive thread");
      }

      try {
        await channel.delete("Soirée annulée");
      } catch (err) {
        logger.warn({ err, threadId }, "Failed to delete thread");
      }
    } catch (err) {
      logger.warn({ err, threadId }, "Failed to fetch thread");
    }
  }
}
