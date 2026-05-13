import type { Game } from "@prisma/client";
import { NotificationType } from "@prisma/client";
import dayjs from "dayjs";
import type { Message } from "discord.js";
import { ButtonStyle } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import { getAutomationSettings } from "../services/automation-settings";
import { listActiveGames, resolveGameFromInput } from "../services/games";
import { buildPendingValidationDm, buildPendingValidationNotice } from "../services/match-notices";
import { getSlotDays, formatSlotDays, isSlotDay } from "../services/slots";
import { getGameTableCapacity } from "../services/table-capacity";
import { formatFrenchDate, parseFrenchDayMonth } from "../utils/dates";

const BASE_USAGE =
  "Format attendu : @Munitorum @Joueur1 vs @Joueur2 [jeu]. Les joueurs doivent être une mention, un ID Discord ou un nom exact du serveur.";

type ParsedMatch = {
  player1Id: string;
  player2Id: string;
  gameInput?: string;
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

  const botId = message.client.user?.id;
  if (!botId) {
    return;
  }

  if (!message.mentions.users.has(botId)) {
    return;
  }

  const parsed = await parseMatchMessage(message, botId);
  if (!parsed) {
    await message.reply(BASE_USAGE);
    return;
  }

  if (parsed.player1Id === parsed.player2Id) {
    await message.reply("⛔ Les deux joueurs doivent être différents.");
    return;
  }

  const extraMentionIds = message.mentions.users.filter(
    (user) => ![botId, parsed.player1Id, parsed.player2Id].includes(user.id)
  );
  if (extraMentionIds.size > 0) {
    await message.reply("⛔ Merci d'indiquer exactement deux joueurs.");
    return;
  }

  if (!config.allowBotPlayers) {
    const botPlayers = await findBotPlayers(message, [parsed.player1Id, parsed.player2Id]);

    if (botPlayers.length > 0) {
      await message.reply(
        "⛔ Les bots ne peuvent pas être joueurs. Active `ALLOW_BOT_PLAYERS=true` en environnement de test."
      );
      return;
    }
  }

  const prisma = getPrisma();
  const threadContext = await findEventThreadContext(prisma, message.channel.id);
  const threadDate = threadContext
    ? dayjs(threadContext.event.date).tz(config.timezone).startOf("day")
    : resolveThreadDate(message.channel.name, config.timezone);

  if (!threadDate) {
    await message.reply(
      "❌ Impossible de lire la date du fil. Utilise un fil créé par Munitorum ou un nom du type “Soirée 40k le 23 janvier”."
    );
    return;
  }

  const games = await listActiveGames(prisma);

  if (!games.length) {
    await message.reply("❌ Aucun jeu configuré. Demande à un admin de configurer les jeux.");
    return;
  }

  const parentGames = message.channel.parentId
    ? games.filter((gameItem) => gameItem.channelId === message.channel.parentId)
    : [];

  if (!threadContext && parentGames.length === 0) {
    return;
  }

  const game = await resolveMessageGame(prisma, parsed, parentGames, threadContext?.game);

  if (!game) {
    if (!parsed.gameInput && parentGames.length > 1) {
      await message.reply(
        "❌ Plusieurs jeux utilisent ce canal. Précise le jeu à la fin du message."
      );
      return;
    }

    const gameList = games.map((item) => item.label).join(", ");
    await message.reply(`❌ Jeu invalide. Jeux disponibles : ${gameList}.`);
    return;
  }

  if (threadContext && game.id !== threadContext.gameId) {
    await message.reply(
      `❌ Ce fil est réservé à ${threadContext.game.label}. Retire le jeu du message ou utilise ${threadContext.game.label}.`
    );
    return;
  }

  if (!game.active) {
    await message.reply(`❌ Le jeu ${game.label} est désactivé.`);
    return;
  }

  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(threadDate, slotDays)) {
    await message.reply(
      `❌ La date du fil doit correspondre à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`
    );
    return;
  }
  const event = threadContext?.event ?? (await findEventForDate(prisma, threadDate));
  if (!event) {
    await message.reply(
      `❌ Aucune soirée trouvée pour le ${formatFrenchDate(
        threadDate
      )}. Demande à un admin de saisir les tables via /mu_tables set.`
    );
    return;
  }

  if (event.status === "FERME") {
    await message.reply("⛔ Soirée fermée : les réservations sont impossibles.");
    return;
  }

  if (event.tables <= 0) {
    await message.reply(
      "⏳ Les tables ne sont pas encore configurées pour cette soirée. Les réservations ouvriront dès qu'un admin aura défini les tables."
    );
    return;
  }

  const gameCapacity = await getGameTableCapacity(prisma, event, game.id);
  if (gameCapacity <= 0) {
    await message.reply(`⏳ Aucune table n'est configurée pour ${game.label} sur cette soirée.`);
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
      gameId: game.id,
      messageId: message.id
    }
  });

  const gameLabel = game.label;
  const automationSettings = await getAutomationSettings(prisma);
  await message.reply({
    content: [
      `✅ Partie enregistrée : <@${parsed.player1Id}> vs <@${parsed.player2Id}> (${gameLabel}).`,
      buildPendingValidationNotice(automationSettings)
    ].join("\n"),
    components: [buildMatchActionRow(match.id)]
  });

  await sendDmsAndStoreNotifications(
    message,
    match.id,
    [parsed.player1Id, parsed.player2Id],
    gameLabel,
    automationSettings,
    logger
  );
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

async function parseMatchMessage(message: Message, botId: string): Promise<ParsedMatch | null> {
  const content = message.content;
  const withoutBot = content.replace(new RegExp(`<@!?${botId}>`, "g"), " ").trim();
  const separator = /\s+(?:vs|contre)\s+/i;
  const separatorMatch = withoutBot.match(separator);

  if (!separatorMatch || separatorMatch.index === undefined) {
    return null;
  }

  const player1Input = withoutBot.slice(0, separatorMatch.index).trim();
  const player2Input = withoutBot.slice(separatorMatch.index + separatorMatch[0].length).trim();

  const player1Id = await resolvePlayerInput(message, player1Input);
  const player2Id = await resolvePlayerInput(message, player2Input);

  if (player1Id && player2Id) {
    return { player1Id, player2Id };
  }

  const player2WithGame = await resolvePlayerWithGameInput(message, player2Input);
  if (!player1Id || !player2WithGame) {
    return null;
  }

  return {
    player1Id,
    player2Id: player2WithGame.playerId,
    gameInput: player2WithGame.gameInput
  };
}

async function resolvePlayerWithGameInput(
  message: Message,
  input: string
): Promise<{ playerId: string; gameInput?: string } | null> {
  const mentionMatch = input.match(/^<@!?([0-9]+)>\s*(.*)$/);
  if (mentionMatch) {
    const gameInput = mentionMatch[2].trim();
    return gameInput ? { playerId: mentionMatch[1], gameInput } : { playerId: mentionMatch[1] };
  }

  const idMatch = input.match(/^([0-9]{17,20})\s*(.*)$/);
  if (idMatch) {
    const gameInput = idMatch[2].trim();
    return gameInput ? { playerId: idMatch[1], gameInput } : { playerId: idMatch[1] };
  }

  const playerId = await resolvePlayerInput(message, input);
  return playerId ? { playerId } : null;
}

async function resolvePlayerInput(message: Message, input: string): Promise<string | null> {
  const trimmed = input.trim();
  const mentionMatch = trimmed.match(/^<@!?([0-9]+)>$/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  if (/^[0-9]{17,20}$/.test(trimmed)) {
    return trimmed;
  }

  return resolveMemberByExactName(message, trimmed);
}

async function resolveMemberByExactName(message: Message, input: string): Promise<string | null> {
  const query = input.replace(/^@/, "").trim();
  if (!query || !message.guild) {
    return null;
  }

  const normalizedQuery = normalizeDiscordName(query);
  const cached = message.guild.members.cache.filter((member) =>
    [member.displayName, member.user.username, member.user.globalName]
      .filter(Boolean)
      .some((name) => normalizeDiscordName(name ?? "") === normalizedQuery)
  );

  if (cached.size === 1) {
    return cached.first()?.id ?? null;
  }

  const searched = await message.guild.members.search({ query, limit: 10 }).catch(() => null);
  const exact = searched?.filter((member) =>
    [member.displayName, member.user.username, member.user.globalName]
      .filter(Boolean)
      .some((name) => normalizeDiscordName(name ?? "") === normalizedQuery)
  );

  return exact?.size === 1 ? (exact.first()?.id ?? null) : null;
}

function normalizeDiscordName(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function findBotPlayers(message: Message, playerIds: string[]) {
  const users = await Promise.all(
    playerIds.map((playerId) => message.client.users.fetch(playerId).catch(() => null))
  );

  return users.filter((user) => user?.bot);
}

async function resolveMessageGame(
  prisma: ReturnType<typeof getPrisma>,
  parsed: ParsedMatch,
  parentGames: Game[],
  threadGame?: Game
): Promise<Game | null> {
  if (parsed.gameInput) {
    return resolveGameFromInput(prisma, parsed.gameInput);
  }

  if (threadGame) {
    return threadGame;
  }

  return parentGames.length === 1 ? parentGames[0] : null;
}

function findEventThreadContext(prisma: ReturnType<typeof getPrisma>, threadId: string) {
  return prisma.eventThread.findFirst({
    where: { threadId },
    include: {
      event: true,
      game: true
    }
  });
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
  const member =
    message.mentions.members?.get(discordId) ??
    (await message.guild?.members.fetch(discordId).catch(() => null));
  const user =
    message.mentions.users.get(discordId) ??
    (await message.client.users.fetch(discordId).catch(() => null));
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
  playerIds: string[],
  gameLabel: string,
  automationSettings: Awaited<ReturnType<typeof getAutomationSettings>>,
  logger: Logger
): Promise<void> {
  const prisma = getPrisma();
  const dmContent = buildPendingValidationDm(gameLabel, automationSettings);

  const results = await Promise.all(
    playerIds.map(async (discordId) => {
      try {
        const user = await message.client.users.fetch(discordId);
        await user.send(dmContent);
        return { success: true };
      } catch (err) {
        logger.warn({ err, userId: discordId }, "Failed to send DM");
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
