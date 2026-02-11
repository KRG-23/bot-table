import { GameSystem, NotificationType } from "@prisma/client";
import dayjs from "dayjs";
import type { Message } from "discord.js";
import { ButtonStyle } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import { getSlotDays, formatSlotDays, isSlotDay } from "../services/slots";
import { formatFrenchDate, parseFrenchDayMonth } from "../utils/dates";

const GAME_ALIASES = new Map<string, GameSystem>([
  ["40k", GameSystem.W40K],
  ["w40k", GameSystem.W40K],
  ["wh40k", GameSystem.W40K],
  ["warhammer 40k", GameSystem.W40K],
  ["warhammer 40000", GameSystem.W40K],
  ["aos", GameSystem.AOS],
  ["age of sigmar", GameSystem.AOS],
  ["kill team", GameSystem.KILLTEAM],
  ["killteam", GameSystem.KILLTEAM],
  ["kt", GameSystem.KILLTEAM],
  ["autre", GameSystem.AUTRE],
  ["other", GameSystem.AUTRE]
]);

const GAME_LABELS: Record<GameSystem, string> = {
  [GameSystem.W40K]: "40k",
  [GameSystem.AOS]: "AoS",
  [GameSystem.KILLTEAM]: "Kill Team",
  [GameSystem.AUTRE]: "Autre"
};

const USAGE =
  "Format attendu : @Munitorum @Joueur1 vs @Joueur2 <jeu> (ex: @Munitorum @Alice vs @Bob 40k). Jeux: 40k, AoS, Kill Team, Autre.";

type ParsedMatch = {
  player1Id: string;
  player2Id: string;
  gameSystem: GameSystem;
};

export async function handleMatchMessage(
  message: Message,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (!message.inGuild() || message.author.bot) {
    return;
  }

  if (!message.channel.isThread()) {
    return;
  }

  if (message.channel.parentId !== config.discordChannelId) {
    return;
  }

  const botId = message.client.user?.id;
  if (!botId) {
    return;
  }

  if (!message.mentions.users.has(botId)) {
    return;
  }

  const parsed = parseMatchMessage(message.content, botId);
  if (!parsed) {
    await message.reply(USAGE);
    return;
  }

  if (parsed.player1Id === parsed.player2Id) {
    await message.reply("⛔ Les deux joueurs doivent être différents.");
    return;
  }

  const nonBotMentions = message.mentions.users.filter((user) => user.id !== botId);
  if (nonBotMentions.size !== 2) {
    await message.reply("⛔ Merci de mentionner exactement deux joueurs.");
    return;
  }

  const threadDate = resolveThreadDate(message.channel.name, config.timezone);
  if (!threadDate) {
    await message.reply(
      "❌ Impossible de lire la date du fil. Utilise un format du type “Soirée 40k - 23 janvier”."
    );
    return;
  }

  const prisma = getPrisma();
  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(threadDate, slotDays)) {
    await message.reply(
      `❌ La date du fil doit correspondre à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`
    );
    return;
  }
  const event = await findEventForDate(prisma, threadDate);
  if (!event) {
    await message.reply(
      `❌ Aucune soirée trouvée pour le ${formatFrenchDate(
        threadDate
      )}. Demande à un admin de saisir les tables via /mu_tables set.`
    );
    return;
  }

  if (event.status === "FERME" || event.tables <= 0) {
    await message.reply("⛔ Soirée fermée : les réservations sont impossibles.");
    return;
  }

  const [player1, player2] = await Promise.all([
    upsertUser(prisma, parsed.player1Id, message),
    upsertUser(prisma, parsed.player2Id, message)
  ]);

  const duplicate = await prisma.match.findFirst({
    where: {
      eventId: event.id,
      OR: [
        { player1Id: player1.id },
        { player2Id: player1.id },
        { player1Id: player2.id },
        { player2Id: player2.id }
      ]
    }
  });

  if (duplicate) {
    await message.reply("⛔ Un des joueurs a déjà une partie enregistrée pour cette soirée.");
    return;
  }

  const match = await prisma.match.create({
    data: {
      eventId: event.id,
      player1Id: player1.id,
      player2Id: player2.id,
      gameSystem: parsed.gameSystem,
      messageId: message.id
    }
  });

  const gameLabel = GAME_LABELS[parsed.gameSystem];
  await message.reply({
    content: `✅ Partie enregistrée : <@${parsed.player1Id}> vs <@${parsed.player2Id}> (${gameLabel}).`,
    components: [buildMatchActionRow(match.id)]
  });

  await sendDmsAndStoreNotifications(message, match.id, parsed, gameLabel, logger);
}

function buildMatchActionRow(matchId: number) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: `mu_match:validate:${matchId}`,
        label: "Valider",
        style: ButtonStyle.Success
      },
      {
        type: 2,
        custom_id: `mu_match:refuse:${matchId}`,
        label: "Refuser",
        style: ButtonStyle.Danger
      },
      {
        type: 2,
        custom_id: `mu_match:cancel:${matchId}`,
        label: "Annuler",
        style: ButtonStyle.Secondary
      }
    ]
  };
}

function parseMatchMessage(content: string, botId: string): ParsedMatch | null {
  const pattern = new RegExp(`<@!?${botId}>\\s+<@!?([0-9]+)>\\s+vs\\s+<@!?([0-9]+)>\\s+(.+)`, "i");
  const match = content.match(pattern);
  if (!match) {
    return null;
  }

  const player1Id = match[1];
  const player2Id = match[2];
  const gameRaw = match[3].trim();
  const gameSystem = resolveGameSystem(gameRaw);

  if (!gameSystem) {
    return null;
  }

  return { player1Id, player2Id, gameSystem };
}

function resolveGameSystem(input: string): GameSystem | null {
  const normalized = normalizeGame(input);
  return GAME_ALIASES.get(normalized) ?? null;
}

function normalizeGame(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveThreadDate(name: string, tz: string): dayjs.Dayjs | null {
  const dayMonth = parseFrenchDayMonth(name);
  if (!dayMonth) {
    return null;
  }

  const now = dayjs().tz(tz);
  const currentYear = dayjs.tz(
    `${dayMonth.day}/${dayMonth.month + 1}/${now.year()}`,
    "D/M/YYYY",
    tz
  );

  if (!currentYear.isValid()) {
    return null;
  }

  if (currentYear.isBefore(now.subtract(30, "day"))) {
    const nextYear = currentYear.add(1, "year");
    return nextYear.startOf("day");
  }

  return currentYear.startOf("day");
}

async function findEventForDate(prisma: ReturnType<typeof getPrisma>, date: dayjs.Dayjs) {
  const event = await prisma.event.findUnique({ where: { date: date.toDate() } });
  if (event) {
    return event;
  }

  const nextYear = date.add(1, "year");
  return prisma.event.findUnique({ where: { date: nextYear.toDate() } });
}

async function upsertUser(
  prisma: ReturnType<typeof getPrisma>,
  discordId: string,
  message: Message
) {
  const member = message.mentions.members?.get(discordId);
  const user = message.mentions.users.get(discordId);
  const displayName = member?.displayName ?? user?.username ?? null;

  return prisma.user.upsert({
    where: { discordId },
    create: { discordId, displayName },
    update: { displayName, lastSeenAt: new Date() }
  });
}

async function sendDmsAndStoreNotifications(
  message: Message,
  matchId: number,
  parsed: ParsedMatch,
  gameLabel: string,
  logger: Logger
): Promise<void> {
  const prisma = getPrisma();
  const player1 = message.mentions.users.get(parsed.player1Id);
  const player2 = message.mentions.users.get(parsed.player2Id);
  const dmContent = `✅ Votre partie ${gameLabel} est enregistrée et en attente de validation.`;

  const results = await Promise.all(
    [player1, player2].map(async (user) => {
      if (!user) {
        return { success: false, error: "Utilisateur introuvable" };
      }

      try {
        await user.send(dmContent);
        return { success: true };
      } catch (err) {
        logger.warn({ err, userId: user.id }, "Failed to send DM");
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  await prisma.notification.createMany({
    data: results.map((result) => ({
      matchId,
      type: NotificationType.DM,
      success: result.success,
      error: result.success ? null : result.error
    }))
  });
}
