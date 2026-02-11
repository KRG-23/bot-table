import type { Game } from "@prisma/client";
import { MatchStatus, NotificationType } from "@prisma/client";
import dayjs from "dayjs";
import { ButtonStyle, ChannelType, MessageFlags, TextInputStyle } from "discord.js";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ChannelSelectMenuInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  ModalSubmitInteraction,
  StringSelectMenuInteraction
} from "discord.js";
import type { Message } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import {
  listActiveGames,
  listAllGames,
  normalizeGameInput,
  resolveGameFromInput
} from "../services/games";
import {
  SLOT_DAYS_SETTING,
  buildMonthSlots,
  formatSlotDays,
  getSlotDays,
  isSlotDay,
  parseSlotDaysInput
} from "../services/slots";
import { getClosureInfo } from "../services/vacations";
import { formatFrenchDate, parseFrenchDate } from "../utils/dates";

import { isAdminMember } from "./admin";

type EphemeralInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

type PublicInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

type ConfigMenuInteraction = StringSelectMenuInteraction | ChannelSelectMenuInteraction;

type ReplyComponents = InteractionReplyOptions["components"];
type ReplyComponentRow = NonNullable<ReplyComponents>[number];

type ReplyPayload = {
  content: string;
  components?: ReplyComponents;
};

type ChannelLike = {
  id: string;
  type: ChannelType;
};

type ModalPayload = Parameters<ButtonInteraction["showModal"]>[0];
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

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (interaction.commandName === "mu_health") {
    await handleHealth(interaction);
    return;
  }

  if (interaction.commandName === "mu_config") {
    await handleConfigMenu(interaction, config, logger);
    return;
  }

  if (interaction.commandName === "mu_tables") {
    if (!interaction.inGuild()) {
      await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
      return;
    }

    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const dateInput = interaction.options.getString("date", true);
    const parsedDate = parseFrenchDate(dateInput, config.timezone);

    if (!parsedDate) {
      await replyEphemeral(interaction, {
        content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
      });
      return;
    }

    if (subcommand === "set") {
      const count = interaction.options.getInteger("count", true);
      await handleTablesSet(interaction, config, logger, parsedDate, count);
      return;
    }

    if (subcommand === "show") {
      await handleTablesShow(interaction, config, logger, parsedDate);
      return;
    }
  }

  if (interaction.commandName === "mu_slots") {
    if (!interaction.inGuild()) {
      await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
      return;
    }

    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "generate") {
      await handleGenerateSlots(interaction, config, logger);
      return;
    }

    if (subcommand === "set_days") {
      const daysInput = interaction.options.getString("days", true);
      await handleSlotDaysUpdate(interaction, daysInput);
      return;
    }

    if (subcommand === "delete_date") {
      const dateInput = interaction.options.getString("date", true);
      const parsedDate = parseFrenchDate(dateInput, config.timezone);

      if (!parsedDate) {
        await replyEphemeral(interaction, {
          content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
        });
        return;
      }

      await handleDeleteDateRequest(interaction, config, parsedDate.startOf("day"));
      return;
    }

    if (subcommand === "delete_month") {
      await handleDeleteMonthRequest(interaction, config);
    }
  }

  if (interaction.commandName === "mu_games") {
    if (!interaction.inGuild()) {
      await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
      return;
    }

    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "list") {
      await handleGamesList(interaction);
      return;
    }

    if (subcommand === "add") {
      const code = interaction.options.getString("code", true);
      const label = interaction.options.getString("label", true);
      const selected = interaction.options.getChannel("channel", true);
      const channel: ChannelLike = { id: selected.id, type: selected.type };
      await handleGamesAdd(interaction, config, { code, label, channel });
      return;
    }

    if (subcommand === "set_channel") {
      const gameInput = interaction.options.getString("game", true);
      const selected = interaction.options.getChannel("channel", true);
      const channel: ChannelLike = { id: selected.id, type: selected.type };
      await handleGamesSetChannel(interaction, { gameInput, channel });
      return;
    }

    if (subcommand === "disable") {
      const gameInput = interaction.options.getString("game", true);
      await handleGamesToggle(interaction, { gameInput, active: false });
      return;
    }

    if (subcommand === "enable") {
      const gameInput = interaction.options.getString("game", true);
      await handleGamesToggle(interaction, { gameInput, active: true });
      return;
    }
  }

  if (interaction.commandName === "mu_match") {
    if (!interaction.inGuild()) {
      await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "panel") {
      const panel = buildMatchPanel();
      await replyEphemeral(interaction, panel);
      return;
    }

    if (subcommand === "create") {
      const dateInput = interaction.options.getString("date", true);
      const player1 = interaction.options.getUser("player1", true);
      const player2 = interaction.options.getUser("player2", true);
      const gameInput = interaction.options.getString("game", true);

      await handleMatchCreate(interaction, config, logger, {
        dateInput,
        player1Id: player1.id,
        player2Id: player2.id,
        gameInput
      });
      return;
    }

    const dateInput = interaction.options.getString("date", true);
    const player1 = interaction.options.getUser("player1", true);
    const player2 = interaction.options.getUser("player2", true);
    const reason = interaction.options.getString("reason")?.trim() ?? "";

    const match = await findMatchForAction(interaction, config, {
      dateInput,
      player1Id: player1.id,
      player2Id: player2.id
    });

    if (!match) {
      return;
    }

    if (subcommand === "validate") {
      await performMatchValidate(interaction, config, logger, match.id, false);
      return;
    }

    if (subcommand === "refuse") {
      await performMatchRefuse(interaction, config, logger, match.id, reason);
      return;
    }

    if (subcommand === "cancel") {
      await performMatchCancel(interaction, config, logger, match.id, reason);
      return;
    }
  }
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (interaction.customId === "mu_health:check") {
    await handleHealth(interaction);
    return;
  }

  if (interaction.customId === "mu_config:show") {
    await handleConfigMenu(interaction, config, logger);
    return;
  }

  if (interaction.customId === "mu_match:panel") {
    const panel = buildMatchPanel();
    await replyEphemeral(interaction, panel);
    return;
  }

  if (interaction.customId === "mu_match:create") {
    await showMatchCreateModal(interaction);
    return;
  }

  if (interaction.customId === "mu_match:validate_request") {
    await showMatchActionModal(interaction, config, "validate");
    return;
  }

  if (interaction.customId === "mu_match:refuse_request") {
    await showMatchActionModal(interaction, config, "refuse");
    return;
  }

  if (interaction.customId === "mu_match:cancel_request") {
    await showMatchActionModal(interaction, config, "cancel");
    return;
  }

  if (interaction.customId === "mu_tables:set") {
    await showTablesSetModal(interaction, config);
    return;
  }

  if (interaction.customId === "mu_tables:show") {
    await showTablesShowModal(interaction, config);
    return;
  }

  if (interaction.customId === "mu_slots:delete_month") {
    await handleDeleteMonthRequest(interaction, config);
    return;
  }

  if (interaction.customId === "mu_slots:delete_date") {
    await showDeleteDateModal(interaction, config);
    return;
  }

  if (interaction.customId === "mu_slots:configure_days") {
    await showSlotDaysModal(interaction, config);
    return;
  }

  if (interaction.customId === "mu_games:configure") {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const panel = await buildGamesConfigPayload({});
    await replyEphemeral(interaction, panel);
    return;
  }

  if (interaction.customId === "mu_games:add") {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    await showGameAddModal(interaction);
    return;
  }

  if (interaction.customId.startsWith("mu_games:save:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const [gameIdStr, channelId] = interaction.customId.replace("mu_games:save:", "").split(":");
    const gameId = Number(gameIdStr);

    if (!Number.isInteger(gameId) || !channelId) {
      await replyEphemeral(interaction, { content: "❌ Configuration invalide." });
      return;
    }

    const payload = await handleGamesSaveFromPanel(interaction, {
      gameId,
      channelId
    });
    await interaction.update(toUpdatePayload(payload));
    return;
  }

  if (interaction.customId.startsWith("mu_games:disable:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const gameId = Number(interaction.customId.replace("mu_games:disable:", ""));
    if (!Number.isInteger(gameId)) {
      await replyEphemeral(interaction, { content: "❌ Jeu invalide." });
      return;
    }

    const payload = await handleGamesToggleById({
      gameId,
      active: false,
      notice: "✅ Jeu désactivé."
    });
    await interaction.update(toUpdatePayload(payload));
    return;
  }

  if (interaction.customId.startsWith("mu_games:enable:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const gameId = Number(interaction.customId.replace("mu_games:enable:", ""));
    if (!Number.isInteger(gameId)) {
      await replyEphemeral(interaction, { content: "❌ Jeu invalide." });
      return;
    }

    const payload = await handleGamesToggleById({
      gameId,
      active: true,
      notice: "✅ Jeu réactivé."
    });
    await interaction.update(toUpdatePayload(payload));
    return;
  }

  if (interaction.customId === "mu_slots:confirm_delete_month") {
    await handleDeleteMonthConfirm(interaction, config, logger);
    return;
  }

  if (interaction.customId.startsWith("mu_slots:confirm_delete_date:")) {
    const dateStr = interaction.customId.replace("mu_slots:confirm_delete_date:", "");
    const parsedDate = dayjs.tz(dateStr, "YYYY-MM-DD", config.timezone).startOf("day");
    if (!parsedDate.isValid()) {
      await replyEphemeral(interaction, { content: "❌ Date invalide." });
      return;
    }
    await handleDeleteDateConfirm(interaction, config, logger, parsedDate);
    return;
  }

  if (interaction.customId === "mu_slots:cancel_delete") {
    await replyEphemeral(interaction, { content: "❎ Suppression annulée." });
    return;
  }

  if (interaction.customId === "mu_slots:generate_current_month") {
    await handleGenerateSlots(interaction, config, logger);
    return;
  }

  if (interaction.customId.startsWith("mu_match:validate:")) {
    const matchId = Number(interaction.customId.replace("mu_match:validate:", ""));
    await handleMatchValidate(interaction, config, logger, matchId);
    return;
  }

  if (interaction.customId.startsWith("mu_match:refuse:")) {
    const matchId = Number(interaction.customId.replace("mu_match:refuse:", ""));
    await showMatchReasonModal(interaction, config, logger, matchId, "refuse");
    return;
  }

  if (interaction.customId.startsWith("mu_match:cancel:")) {
    const matchId = Number(interaction.customId.replace("mu_match:cancel:", ""));
    await showMatchReasonModal(interaction, config, logger, matchId, "cancel");
    return;
  }

  if (interaction.customId.startsWith("mu_tables:quick_show:")) {
    if (!interaction.inGuild()) {
      await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
      return;
    }

    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const dateStr = interaction.customId.replace("mu_tables:quick_show:", "");
    const parsedDate = dayjs.tz(dateStr, "YYYY-MM-DD", config.timezone);

    if (!parsedDate.isValid()) {
      await replyEphemeral(interaction, { content: "❌ Date invalide." });
      return;
    }

    await handleTablesShow(interaction, config, logger, parsedDate.startOf("day"));
  }
}

export async function handleSelectMenuInteraction(
  interaction: ConfigMenuInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (interaction.customId === "mu_config:menu") {
    await interaction.deferUpdate();
    const selection = interaction.values[0] as ConfigCategory | undefined;
    if (!selection || !CONFIG_CATEGORIES.some((category) => category.value === selection)) {
      await interaction.editReply(
        toEditPayload({
          content: "❌ Catégorie inconnue.",
          components: [buildConfigMenuSelect()]
        })
      );
      return;
    }

    const payload = await buildConfigCategoryResponse(selection, config, logger);
    await interaction.editReply(toEditPayload(payload));
    scheduleConfigMenuExpiry(interaction.message as Message, logger);
    return;
  }

  if (interaction.customId === "mu_games:select") {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const selectedId = Number(interaction.values[0]);
    if (!Number.isInteger(selectedId)) {
      await replyEphemeral(interaction, { content: "❌ Jeu invalide." });
      return;
    }

    const payload = await buildGamesConfigPayload({
      gameId: selectedId
    });
    await interaction.update(toUpdatePayload(payload));
    return;
  }

  if (interaction.customId.startsWith("mu_games:channel:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const gameIdStr = interaction.customId.replace("mu_games:channel:", "");
    const gameId = Number(gameIdStr);
    const channelId = interaction.values[0];

    if (!Number.isInteger(gameId) || !channelId) {
      await replyEphemeral(interaction, { content: "❌ Sélection invalide." });
      return;
    }

    const payload = await buildGamesConfigPayload({
      gameId,
      channelId
    });
    await interaction.update(toUpdatePayload(payload));
  }
}

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  if (interaction.customId === "mu_tables:set_modal") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const dateInput = interaction.fields.getTextInputValue("date");
    const countInput = interaction.fields.getTextInputValue("count");
    const parsedDate = parseFrenchDate(dateInput, config.timezone);
    const count = Number(countInput);

    if (!parsedDate) {
      await replyEphemeral(interaction, {
        content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
      });
      return;
    }

    if (!Number.isInteger(count) || count < 0) {
      await replyEphemeral(interaction, { content: "❌ Nombre de tables invalide." });
      return;
    }

    await handleTablesSet(interaction, config, logger, parsedDate, count);
    return;
  }

  if (interaction.customId === "mu_tables:show_modal") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const dateInput = interaction.fields.getTextInputValue("date");
    const parsedDate = parseFrenchDate(dateInput, config.timezone);

    if (!parsedDate) {
      await replyEphemeral(interaction, {
        content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
      });
      return;
    }

    await handleTablesShow(interaction, config, logger, parsedDate);
  }

  if (interaction.customId === "mu_slots:delete_date_modal") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const dateInput = interaction.fields.getTextInputValue("date");
    const parsedDate = parseFrenchDate(dateInput, config.timezone);

    if (!parsedDate) {
      await replyEphemeral(interaction, {
        content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
      });
      return;
    }

    await handleDeleteDateRequest(interaction, config, parsedDate.startOf("day"));
  }

  if (interaction.customId === "mu_slots:configure_days_modal") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const daysInput = interaction.fields.getTextInputValue("days");
    await handleSlotDaysUpdate(interaction, daysInput);
    return;
  }

  if (interaction.customId === "mu_games:add_modal") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    const codeInput = interaction.fields.getTextInputValue("code");
    const labelInput = interaction.fields.getTextInputValue("label");
    await handleGamesAdd(interaction, config, {
      code: codeInput,
      label: labelInput
    });
    return;
  }

  if (interaction.customId === "mu_match:create_modal") {
    const dateInput = interaction.fields.getTextInputValue("date");
    const player1Raw = interaction.fields.getTextInputValue("player1");
    const player2Raw = interaction.fields.getTextInputValue("player2");
    const gameInput = interaction.fields.getTextInputValue("game");

    const player1Id = parseUserIdInput(player1Raw);
    const player2Id = parseUserIdInput(player2Raw);

    if (!player1Id || !player2Id) {
      await replyEphemeral(interaction, {
        content: "❌ Merci d'indiquer deux joueurs valides (mention ou ID)."
      });
      return;
    }

    await handleMatchCreate(interaction, config, logger, {
      dateInput,
      player1Id,
      player2Id,
      gameInput
    });
    return;
  }

  if (interaction.customId === "mu_match:validate_request_modal") {
    const dateInput = interaction.fields.getTextInputValue("date");
    const player1Raw = interaction.fields.getTextInputValue("player1");
    const player2Raw = interaction.fields.getTextInputValue("player2");

    const player1Id = parseUserIdInput(player1Raw);
    const player2Id = parseUserIdInput(player2Raw);

    if (!player1Id || !player2Id) {
      await replyEphemeral(interaction, {
        content: "❌ Merci d'indiquer deux joueurs valides (mention ou ID)."
      });
      return;
    }

    const match = await findMatchForAction(interaction, config, {
      dateInput,
      player1Id,
      player2Id
    });

    if (!match) {
      return;
    }

    await performMatchValidate(interaction, config, logger, match.id, false);
    return;
  }

  if (interaction.customId === "mu_match:refuse_request_modal") {
    const dateInput = interaction.fields.getTextInputValue("date");
    const player1Raw = interaction.fields.getTextInputValue("player1");
    const player2Raw = interaction.fields.getTextInputValue("player2");
    const reason = interaction.fields.getTextInputValue("reason").trim();

    const player1Id = parseUserIdInput(player1Raw);
    const player2Id = parseUserIdInput(player2Raw);

    if (!player1Id || !player2Id) {
      await replyEphemeral(interaction, {
        content: "❌ Merci d'indiquer deux joueurs valides (mention ou ID)."
      });
      return;
    }

    const match = await findMatchForAction(interaction, config, {
      dateInput,
      player1Id,
      player2Id
    });

    if (!match) {
      return;
    }

    await performMatchRefuse(interaction, config, logger, match.id, reason);
    return;
  }

  if (interaction.customId === "mu_match:cancel_request_modal") {
    const dateInput = interaction.fields.getTextInputValue("date");
    const player1Raw = interaction.fields.getTextInputValue("player1");
    const player2Raw = interaction.fields.getTextInputValue("player2");
    const reason = interaction.fields.getTextInputValue("reason").trim();

    const player1Id = parseUserIdInput(player1Raw);
    const player2Id = parseUserIdInput(player2Raw);

    if (!player1Id || !player2Id) {
      await replyEphemeral(interaction, {
        content: "❌ Merci d'indiquer deux joueurs valides (mention ou ID)."
      });
      return;
    }

    const match = await findMatchForAction(interaction, config, {
      dateInput,
      player1Id,
      player2Id
    });

    if (!match) {
      return;
    }

    await performMatchCancel(interaction, config, logger, match.id, reason);
    return;
  }

  if (interaction.customId.startsWith("mu_match:refuse_modal:")) {
    const matchId = Number(interaction.customId.replace("mu_match:refuse_modal:", ""));
    const reason = interaction.fields.getTextInputValue("reason").trim();
    await performMatchRefuse(interaction, config, logger, matchId, reason);
    return;
  }

  if (interaction.customId.startsWith("mu_match:cancel_modal:")) {
    const matchId = Number(interaction.customId.replace("mu_match:cancel_modal:", ""));
    const reason = interaction.fields.getTextInputValue("reason").trim();
    await performMatchCancel(interaction, config, logger, matchId, reason);
    return;
  }
}

async function handleHealth(interaction: EphemeralInteraction): Promise<void> {
  await replyEphemeral(interaction, {
    content: "✅ Munitorum opérationnel.",
    components: [buildHealthRow()]
  });
}

async function handleConfigMenu(
  interaction: PublicInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if ("inGuild" in interaction && !interaction.inGuild()) {
    await replyPublic(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  let acknowledged = false;
  if ("replied" in interaction && interaction.replied) {
    acknowledged = true;
  } else if ("deferred" in interaction && interaction.deferred) {
    acknowledged = true;
  } else {
    try {
      await interaction.reply({ content: "Menu en cours de chargement…" });
      acknowledged = true;
    } catch (err) {
      logger.warn({ err }, "Failed to reply loading message for config menu");
    }
  }

  const content = await buildConfigMenuContent(config, logger);
  const components = [buildConfigMenuSelect()];

  if (acknowledged) {
    try {
      await interaction.editReply(toEditPayload({ content, components }));
      const message = await interaction.fetchReply();
      scheduleConfigMenuExpiry(message as Message, logger);
      return;
    } catch (err) {
      logger.warn({ err }, "Failed to edit config menu reply");
    }
  }

  if (interaction.channel?.isTextBased()) {
    const message = await interaction.channel.send({ content, components });
    scheduleConfigMenuExpiry(message, logger);
  }
}

type GameAddInput = {
  code: string;
  label: string;
  channel?: ChannelLike;
};

type GameChannelInput = {
  gameInput: string;
  channel: ChannelLike;
};

type GameToggleInput = {
  gameInput: string;
  active: boolean;
};

type GameToggleByIdInput = {
  gameId: number;
  active: boolean;
  notice: string;
};

type GameSaveInput = {
  gameId: number;
  channelId: string;
};

function sanitizeGameCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isValidGameChannel(channel: ChannelLike): boolean {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

async function handleGamesList(interaction: EphemeralInteraction): Promise<void> {
  const prisma = getPrisma();
  const games = await listAllGames(prisma);
  const orderedGames = [...games].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, "fr")
  );

  if (orderedGames.length === 0) {
    await replyEphemeral(interaction, {
      content: "Aucun jeu configuré. Utilise /mu_games add ou le menu /mu_config."
    });
    return;
  }

  await replyEphemeral(interaction, {
    content: [
      `Jeux configurés (${orderedGames.length}) :`,
      orderedGames.map(formatGameLine).join("\n")
    ].join("\n")
  });
}

async function handleGamesAdd(
  interaction: EphemeralInteraction,
  config: AppConfig,
  input: GameAddInput
): Promise<void> {
  const code = sanitizeGameCode(input.code);
  const label = input.label.trim();

  if (!code || !label) {
    await replyEphemeral(interaction, {
      content: "❌ Code ou libellé invalide. Ex: code W40K, libellé Warhammer 40k."
    });
    return;
  }

  if (input.channel && !isValidGameChannel(input.channel)) {
    await replyEphemeral(interaction, {
      content: "❌ Canal invalide. Choisis un canal texte ou d'annonces."
    });
    return;
  }

  const prisma = getPrisma();
  const existing = await prisma.game.findMany();
  const normalizedCode = normalizeGameInput(code);
  const normalizedLabel = normalizeGameInput(label);
  const duplicate = existing.find(
    (game) =>
      normalizeGameInput(game.code) === normalizedCode ||
      normalizeGameInput(game.label) === normalizedLabel
  );

  if (duplicate) {
    await replyEphemeral(interaction, {
      content: "❌ Ce code ou libellé est déjà utilisé."
    });
    return;
  }

  const channelId = input.channel?.id ?? config.discordChannelId;
  const game = await prisma.game.create({
    data: {
      code,
      label,
      channelId,
      active: true
    }
  });

  const panel = await buildGamesConfigPayload({
    gameId: game.id,
    channelId: game.channelId,
    notice: "✅ Jeu ajouté."
  });
  await replyEphemeral(interaction, panel);
}

async function handleGamesSetChannel(
  interaction: EphemeralInteraction,
  input: GameChannelInput
): Promise<void> {
  if (!isValidGameChannel(input.channel)) {
    await replyEphemeral(interaction, {
      content: "❌ Canal invalide. Choisis un canal texte ou d'annonces."
    });
    return;
  }

  const prisma = getPrisma();
  const game = await resolveGameFromInput(prisma, input.gameInput, true);

  if (!game) {
    await replyEphemeral(interaction, {
      content: "❌ Jeu introuvable."
    });
    return;
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { channelId: input.channel.id }
  });

  const panel = await buildGamesConfigPayload({
    gameId: game.id,
    channelId: input.channel.id,
    notice: "✅ Canal mis à jour."
  });
  await replyEphemeral(interaction, panel);
}

async function handleGamesToggle(
  interaction: EphemeralInteraction,
  input: GameToggleInput
): Promise<void> {
  const prisma = getPrisma();
  const game = await resolveGameFromInput(prisma, input.gameInput, true);

  if (!game) {
    await replyEphemeral(interaction, {
      content: "❌ Jeu introuvable."
    });
    return;
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { active: input.active }
  });

  const panel = await buildGamesConfigPayload({
    gameId: game.id,
    channelId: game.channelId,
    notice: input.active ? "✅ Jeu réactivé." : "✅ Jeu désactivé."
  });
  await replyEphemeral(interaction, panel);
}

async function handleGamesSaveFromPanel(
  interaction: ButtonInteraction,
  input: GameSaveInput
): Promise<ReplyPayload> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: input.gameId } });

  if (!game) {
    return {
      content: "❌ Jeu introuvable.",
      components: []
    };
  }

  const channel =
    input.channelId === "none"
      ? null
      : await interaction.client.channels.fetch(input.channelId).catch(() => null);

  if (!channel || !isValidGameChannel(channel)) {
    return buildGamesConfigPayload({
      gameId: game.id,
      channelId: game.channelId,
      notice: "❌ Canal invalide."
    });
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { channelId: channel.id }
  });

  return buildGamesConfigPayload({
    gameId: game.id,
    channelId: channel.id,
    notice: "✅ Canal mis à jour."
  });
}

async function handleGamesToggleById(input: GameToggleByIdInput): Promise<ReplyPayload> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: input.gameId } });

  if (!game) {
    return {
      content: "❌ Jeu introuvable.",
      components: []
    };
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { active: input.active }
  });

  return buildGamesConfigPayload({
    gameId: game.id,
    channelId: game.channelId,
    notice: input.notice
  });
}

async function handleTablesSet(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  parsedDate: ReturnType<typeof parseFrenchDate>,
  count: number
): Promise<void> {
  if (!parsedDate) {
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Traitement en cours..." });

  const closure = await getClosureInfo(parsedDate, config.vacationAcademy, config.timezone, logger);
  const eventDate = parsedDate.toDate();
  const prisma = getPrisma();
  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(parsedDate, slotDays)) {
    await interaction.editReply({
      content: `❌ La date ne correspond pas à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`
    });
    return;
  }
  const isClosed = closure.closed || count <= 0;
  const tables = isClosed ? 0 : count;

  const event = await prisma.event.upsert({
    where: { date: eventDate },
    create: {
      date: eventDate,
      tables,
      status: isClosed ? "FERME" : "OUVERT",
      isVacation: closure.closed
    },
    update: {
      tables,
      status: isClosed ? "FERME" : "OUVERT",
      isVacation: closure.closed
    }
  });

  const closureText = closure.closed
    ? `⚠️ ${closure.reason ?? "Fermeture"} (${closure.period?.description ?? "Vacances"})`
    : isClosed
      ? "⚠️ Fermé (tables à 0)"
      : "✅ Ouvert";

  await interaction.editReply({
    content: [
      `📅 ${formatFrenchDate(parsedDate)}`,
      `Tables: ${tables}`,
      `Statut: ${closureText}`
    ].join("\n"),
    components: [buildTablesRow()]
  });

  if (isClosed) {
    await closeEventThreads(interaction, logger, event.id);
  } else {
    await ensureEventThreads(interaction, config, logger, event);
  }
}

async function handleTablesShow(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  parsedDate: ReturnType<typeof parseFrenchDate>
): Promise<void> {
  if (!parsedDate) {
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Traitement en cours..." });

  const closure = await getClosureInfo(parsedDate, config.vacationAcademy, config.timezone, logger);
  const eventDate = parsedDate.toDate();
  const prisma = getPrisma();
  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(parsedDate, slotDays)) {
    await interaction.editReply({
      content: `❌ La date ne correspond pas à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`
    });
    return;
  }
  const event = await prisma.event.findUnique({ where: { date: eventDate } });
  const closureText = closure.closed
    ? `⚠️ ${closure.reason ?? "Fermeture"} (${closure.period?.description ?? "Vacances"})`
    : "✅ Ouvert";

  if (!event) {
    await interaction.editReply({
      content: [
        `📅 ${formatFrenchDate(parsedDate)}`,
        "Créneau: ❌ Non créé",
        `Statut: ${closureText}`
      ].join("\n"),
      components: [buildTablesRow()]
    });
    return;
  }

  const statusText =
    event.status === "FERME" ? (event.isVacation ? closureText : "⚠️ Fermé (annulé)") : "✅ Ouvert";

  await interaction.editReply({
    content: [
      `📅 ${formatFrenchDate(parsedDate)}`,
      `Tables: ${event.tables}`,
      `Statut: ${statusText}`
    ].join("\n"),
    components: [buildTablesRow()]
  });
}

async function handleGenerateSlots(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  await replyEphemeral(interaction, { content: "⏳ Génération des créneaux en cours..." });

  const prisma = getPrisma();
  const monthName = dayjs().tz(config.timezone).format("MMMM YYYY");
  const slotDays = await getSlotDays(prisma);
  const slots = buildMonthSlots(config.timezone, slotDays);

  let created = 0;
  let skipped = 0;
  let closedSkipped = 0;

  for (const slotDate of slots) {
    const existing = await prisma.event.findUnique({ where: { date: slotDate.toDate() } });
    if (existing) {
      if (existing.status === "OUVERT") {
        await ensureEventThreads(interaction, config, logger, existing);
      }
      skipped += 1;
      continue;
    }

    const closure = await getClosureInfo(slotDate, config.vacationAcademy, config.timezone, logger);
    if (closure.closed) {
      closedSkipped += 1;
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

    await ensureEventThreads(interaction, config, logger, event);
    created += 1;
  }

  const summary = [
    `📅 Créneaux du mois (${monthName})`,
    `Nouveaux créneaux : ${created}`,
    `Déjà présents : ${skipped}`,
    `Fermés (vacances/veille, non créés) : ${closedSkipped}`
  ].join("\n");

  await interaction.editReply({
    content: summary,
    components: [buildSlotsRow()]
  });
}

async function handleDeleteDateRequest(
  interaction: EphemeralInteraction,
  config: AppConfig,
  date: dayjs.Dayjs
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { date: date.toDate() } });

  if (!event) {
    await replyEphemeral(interaction, {
      content: `ℹ️ Aucun créneau trouvé pour le ${formatFrenchDate(date)}.`
    });
    return;
  }

  const matches = await prisma.match.count({ where: { eventId: event.id } });
  const notifications = await prisma.notification.count({
    where: { match: { eventId: event.id } }
  });

  await replyEphemeral(interaction, {
    content: [
      `⚠️ Suppression du créneau du ${formatFrenchDate(date)}`,
      `Parties supprimées : ${matches}`,
      `Notifications supprimées : ${notifications}`,
      "Confirmer la suppression ?"
    ].join("\n"),
    components: [buildConfirmRow(`mu_slots:confirm_delete_date:${date.format("YYYY-MM-DD")}`)]
  });
}

async function handleDeleteMonthRequest(
  interaction: EphemeralInteraction,
  config: AppConfig
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const prisma = getPrisma();
  const now = dayjs().tz(config.timezone);
  const monthStart = now.startOf("month").startOf("day");
  const monthEnd = now.endOf("month").endOf("day");

  const events = await prisma.event.findMany({
    where: {
      date: {
        gte: monthStart.toDate(),
        lte: monthEnd.toDate()
      }
    }
  });

  if (events.length === 0) {
    await replyEphemeral(interaction, {
      content: `ℹ️ Aucun créneau trouvé pour ${now.format("MM/YYYY")}.`
    });
    return;
  }

  const eventIds = events.map((event) => event.id);
  const matches = await prisma.match.count({ where: { eventId: { in: eventIds } } });
  const notifications = await prisma.notification.count({
    where: { match: { eventId: { in: eventIds } } }
  });

  await replyEphemeral(interaction, {
    content: [
      `⚠️ Suppression des créneaux du mois ${now.format("MM/YYYY")}`,
      `Créneaux supprimés : ${events.length}`,
      `Parties supprimées : ${matches}`,
      `Notifications supprimées : ${notifications}`,
      "Confirmer la suppression ?"
    ].join("\n"),
    components: [buildConfirmRow("mu_slots:confirm_delete_month")]
  });
}

async function handleSlotDaysUpdate(
  interaction: EphemeralInteraction,
  daysInput: string
): Promise<void> {
  const parsedDays = parseSlotDaysInput(daysInput);

  if (parsedDays.length === 0) {
    await replyEphemeral(interaction, {
      content: "❌ Jours invalides. Utilise des numéros 1-7 ou des jours (ex: lun, mer, ven)."
    });
    return;
  }

  const prisma = getPrisma();
  await prisma.setting.upsert({
    where: { key: SLOT_DAYS_SETTING },
    create: { key: SLOT_DAYS_SETTING, value: parsedDays.join(",") },
    update: { value: parsedDays.join(",") }
  });

  await replyEphemeral(interaction, {
    content: `✅ Jours des créneaux mis à jour : ${formatSlotDays(parsedDays)}`
  });
}

async function handleDeleteDateConfirm(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  date: dayjs.Dayjs
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Suppression du créneau en cours..." });

  const prisma = getPrisma();
  const event = await prisma.event.findUnique({ where: { date: date.toDate() } });

  if (!event) {
    await interaction.editReply({
      content: `ℹ️ Aucun créneau trouvé pour le ${formatFrenchDate(date)}.`
    });
    return;
  }

  const matchIds = await prisma.match.findMany({
    where: { eventId: event.id },
    select: { id: true }
  });
  const threads = await prisma.eventThread.findMany({
    where: { eventId: event.id },
    select: { threadId: true }
  });

  await prisma.$transaction([
    prisma.notification.deleteMany({
      where: { matchId: { in: matchIds.map((match) => match.id) } }
    }),
    prisma.match.deleteMany({ where: { eventId: event.id } }),
    prisma.eventThread.deleteMany({ where: { eventId: event.id } }),
    prisma.event.delete({ where: { id: event.id } })
  ]);

  await closeThreadsByIds(
    interaction,
    logger,
    threads.map((thread) => thread.threadId)
  );
  await interaction.editReply({
    content: `🗑️ Créneau du ${formatFrenchDate(date)} supprimé (parties et notifications incluses).`
  });
}

async function handleDeleteMonthConfirm(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Suppression des créneaux du mois en cours..." });

  const prisma = getPrisma();
  const now = dayjs().tz(config.timezone);
  const monthStart = now.startOf("month").startOf("day");
  const monthEnd = now.endOf("month").endOf("day");

  const events = await prisma.event.findMany({
    where: {
      date: {
        gte: monthStart.toDate(),
        lte: monthEnd.toDate()
      }
    }
  });

  if (events.length === 0) {
    await interaction.editReply({
      content: `ℹ️ Aucun créneau trouvé pour ${now.format("MM/YYYY")}.`
    });
    return;
  }

  const eventIds = events.map((event) => event.id);
  const matchIds = await prisma.match.findMany({
    where: { eventId: { in: eventIds } },
    select: { id: true }
  });
  const threads = await prisma.eventThread.findMany({
    where: { eventId: { in: eventIds } },
    select: { threadId: true }
  });

  await prisma.$transaction([
    prisma.notification.deleteMany({
      where: { matchId: { in: matchIds.map((match) => match.id) } }
    }),
    prisma.match.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.eventThread.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.event.deleteMany({ where: { id: { in: eventIds } } })
  ]);

  await closeThreadsByIds(
    interaction,
    logger,
    threads.map((thread) => thread.threadId)
  );
  await interaction.editReply({
    content: `🗑️ Créneaux du mois ${now.format("MM/YYYY")} supprimés (parties et notifications incluses).`
  });
}

type MatchCreateInput = {
  dateInput: string;
  player1Id: string;
  player2Id: string;
  gameInput: string;
};

type MatchActionInput = {
  dateInput: string;
  player1Id: string;
  player2Id: string;
};

async function handleMatchCreate(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  input: MatchCreateInput
): Promise<void> {
  const parsedDate = parseFrenchDate(input.dateInput, config.timezone);
  if (!parsedDate) {
    await replyEphemeral(interaction, {
      content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
    });
    return;
  }

  if (input.player1Id === input.player2Id) {
    await replyEphemeral(interaction, { content: "⛔ Les deux joueurs doivent être différents." });
    return;
  }

  const prisma = getPrisma();
  const game = await resolveGameFromInput(prisma, input.gameInput);
  if (!game) {
    const games = await listActiveGames(prisma);
    const gameList = games.length ? games.map((item) => item.label).join(", ") : "Aucun";
    await replyEphemeral(interaction, {
      content: `❌ Jeu invalide. Jeux disponibles : ${gameList}.`
    });
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Création de la partie..." });

  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(parsedDate, slotDays)) {
    await replyEphemeral(interaction, {
      content: `❌ La date ne correspond pas à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`
    });
    return;
  }
  const event = await prisma.event.findUnique({ where: { date: parsedDate.toDate() } });

  if (!event) {
    await interaction.editReply({
      content: `❌ Aucune soirée trouvée pour le ${formatFrenchDate(
        parsedDate
      )}. Demande à un admin de saisir les tables via /mu_tables set.`
    });
    return;
  }

  if (event.status === "FERME" || event.tables <= 0) {
    await interaction.editReply({
      content: "⛔ Soirée fermée : les réservations sont impossibles."
    });
    return;
  }

  const [player1, player2] = await Promise.all([
    upsertUserFromInteraction(prisma, interaction, input.player1Id),
    upsertUserFromInteraction(prisma, interaction, input.player2Id)
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
    await interaction.editReply({
      content: "⛔ Un des joueurs a déjà une partie enregistrée pour cette soirée."
    });
    return;
  }

  const match = await prisma.match.create({
    data: {
      eventId: event.id,
      player1Id: player1.id,
      player2Id: player2.id,
      gameId: game.id
    }
  });

  const gameLabel = game.label;
  await interaction.editReply({
    content: `✅ Partie enregistrée : <@${input.player1Id}> vs <@${input.player2Id}> (${gameLabel}).`,
    components: [buildMatchActionRow(match.id)]
  });

  await notifyMatchCreated(
    interaction,
    logger,
    match.id,
    [input.player1Id, input.player2Id],
    gameLabel
  );
}

async function findMatchForAction(
  interaction: EphemeralInteraction,
  config: AppConfig,
  input: MatchActionInput
): Promise<{ id: number } | null> {
  const parsedDate = parseFrenchDate(input.dateInput, config.timezone);
  if (!parsedDate) {
    await replyEphemeral(interaction, {
      content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
    });
    return null;
  }

  if (input.player1Id === input.player2Id) {
    await replyEphemeral(interaction, { content: "⛔ Les deux joueurs doivent être différents." });
    return null;
  }

  const prisma = getPrisma();
  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(parsedDate, slotDays)) {
    await replyEphemeral(interaction, {
      content: `❌ La date ne correspond pas à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`
    });
    return null;
  }
  const event = await prisma.event.findUnique({ where: { date: parsedDate.toDate() } });
  if (!event) {
    await replyEphemeral(interaction, {
      content: `❌ Aucun créneau pour le ${formatFrenchDate(parsedDate)}.`
    });
    return null;
  }

  const match = await prisma.match.findFirst({
    where: {
      eventId: event.id,
      OR: [
        {
          player1: { discordId: input.player1Id },
          player2: { discordId: input.player2Id }
        },
        {
          player1: { discordId: input.player2Id },
          player2: { discordId: input.player1Id }
        }
      ]
    },
    select: { id: true }
  });

  if (!match) {
    await replyEphemeral(interaction, { content: "❌ Partie introuvable." });
    return null;
  }

  return match;
}

async function replyEphemeral(
  interaction: EphemeralInteraction,
  payload: ReplyPayload
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(toEditPayload(payload));
    return;
  }

  await interaction.reply({
    content: payload.content,
    components: payload.components as InteractionReplyOptions["components"],
    flags: MessageFlags.Ephemeral
  });
}

async function replyPublic(
  interaction: PublicInteraction,
  payload: ReplyPayload
): Promise<Message> {
  if ("replied" in interaction && (interaction.replied || interaction.deferred)) {
    await interaction.editReply(toEditPayload(payload));
    const message = await interaction.fetchReply();
    return message as Message;
  }

  await interaction.reply(toReplyPayload(payload));

  const message = await interaction.fetchReply();
  return message as Message;
}

function toReplyPayload(payload: ReplyPayload): InteractionReplyOptions {
  return {
    content: payload.content,
    components: payload.components as InteractionReplyOptions["components"]
  };
}

function toEditPayload(payload: ReplyPayload): InteractionEditReplyOptions {
  return {
    content: payload.content,
    components: payload.components as InteractionEditReplyOptions["components"]
  };
}

function toUpdatePayload(payload: ReplyPayload): InteractionUpdateOptions {
  return {
    content: payload.content,
    components: payload.components as InteractionUpdateOptions["components"]
  };
}

function scheduleConfigMenuExpiry(message: Message, logger: Logger): void {
  setTimeout(async () => {
    try {
      const refreshed = await message.fetch();
      const content = [refreshed.content, "", "💡 Les 60 secondes sont écoulées !"]
        .filter(Boolean)
        .join("\n");
      await refreshed.edit({ content, components: [] });
    } catch (err) {
      logger.warn({ err }, "Failed to expire config menu");
    }
  }, 60_000);
}

async function ensureAdmin(interaction: EphemeralInteraction, config: AppConfig): Promise<boolean> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return false;
  }

  if (!interaction.member || !isAdminMember(interaction.member, config)) {
    await replyEphemeral(interaction, {
      content: "⛔ Cette commande est réservée aux administrateurs."
    });
    return false;
  }

  return true;
}

function buildHealthRow() {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_health:check",
        label: "Vérifier à nouveau",
        style: ButtonStyle.Secondary
      }
    ]
  };
}

function buildTablesRow() {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_tables:set",
        label: "Définir les tables",
        style: ButtonStyle.Primary
      },
      {
        type: 2,
        custom_id: "mu_tables:show",
        label: "Voir les tables",
        style: ButtonStyle.Secondary
      },
      {
        type: 2,
        custom_id: "mu_slots:generate_current_month",
        label: "Générer les créneaux du mois",
        style: ButtonStyle.Secondary
      },
      {
        type: 2,
        custom_id: "mu_slots:delete_month",
        label: "Supprimer créneaux du mois",
        style: ButtonStyle.Danger
      }
    ]
  };
}

function buildSlotsRow() {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_slots:generate_current_month",
        label: "Relancer la génération",
        style: ButtonStyle.Secondary
      },
      {
        type: 2,
        custom_id: "mu_slots:delete_month",
        label: "Supprimer créneaux du mois",
        style: ButtonStyle.Danger
      }
    ]
  };
}

type ConfigCategory = "slots" | "matches" | "tables";

const CONFIG_CATEGORIES: { value: ConfigCategory; label: string; description: string }[] = [
  { value: "slots", label: "Créneaux", description: "Gérer les créneaux" },
  { value: "matches", label: "Parties", description: "Gérer les parties" },
  { value: "tables", label: "Tables", description: "Gérer les tables" }
];

function buildConfigMenuSelect(selected?: ConfigCategory) {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: "mu_config:menu",
        placeholder: "Choisir une catégorie",
        min_values: 1,
        max_values: 1,
        options: CONFIG_CATEGORIES.map((category) => ({
          label: category.label,
          value: category.value,
          description: category.description,
          default: category.value === selected
        }))
      }
    ]
  };
}

function buildConfigCategoryContent(title: string, extra?: string) {
  return [title, "Que souhaitez-vous configurer ?", extra].filter(Boolean).join("\n");
}

function buildSlotsCategoryRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_slots:configure_days",
          label: "Configurer les jours",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_games:configure",
          label: "Configurer jeux & canaux",
          style: ButtonStyle.Secondary
        }
      ]
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_slots:generate_current_month",
          label: "Générer le mois",
          style: ButtonStyle.Secondary
        },
        {
          type: 2,
          custom_id: "mu_slots:delete_month",
          label: "Supprimer le mois",
          style: ButtonStyle.Danger
        },
        {
          type: 2,
          custom_id: "mu_slots:delete_date",
          label: "Supprimer une date",
          style: ButtonStyle.Danger
        }
      ]
    }
  ];
}

function buildMatchesCategoryRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_match:create",
          label: "Créer",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_match:validate_request",
          label: "Valider",
          style: ButtonStyle.Success
        }
      ]
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_match:refuse_request",
          label: "Refuser",
          style: ButtonStyle.Danger
        },
        {
          type: 2,
          custom_id: "mu_match:cancel_request",
          label: "Annuler",
          style: ButtonStyle.Secondary
        }
      ]
    }
  ];
}

function buildTablesCategoryRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_tables:set",
          label: "Définir",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_tables:show",
          label: "Voir",
          style: ButtonStyle.Secondary
        }
      ]
    }
  ];
}

type GameConfigState = {
  gameId?: number;
  channelId?: string;
  notice?: string;
};

function formatGameStatus(game: Game): string {
  return game.active ? "actif" : "désactivé";
}

function formatGameLine(game: Game): string {
  return `• ${game.label} (${game.code}) — <#${game.channelId}> — ${formatGameStatus(game)}`;
}

function buildGamesSelectRow(games: Game[], selectedId: number): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: "mu_games:select",
        placeholder: "Choisir un jeu",
        min_values: 1,
        max_values: 1,
        options: games.map((game) => ({
          label: game.label,
          value: String(game.id),
          description: `${game.code} · ${formatGameStatus(game)}`,
          default: game.id === selectedId
        }))
      }
    ]
  } as ReplyComponentRow;
}

function buildGamesChannelRow(gameId: number, channelId?: string): ReplyComponentRow {
  const component: {
    type: number;
    custom_id: string;
    placeholder: string;
    min_values: number;
    max_values: number;
    channel_types: ChannelType[];
    default_values?: { id: string; type: "channel" }[];
  } = {
    type: 8,
    custom_id: `mu_games:channel:${gameId}`,
    placeholder: "Choisir un canal",
    min_values: 1,
    max_values: 1,
    channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement]
  };

  if (channelId) {
    component.default_values = [{ id: channelId, type: "channel" }];
  }

  return {
    type: 1,
    components: [component]
  } as ReplyComponentRow;
}

function buildGamesActionRow(game: Game, channelId?: string): ReplyComponentRow {
  const canSave = Boolean(channelId);
  const toggle = game.active
    ? {
        type: 2,
        custom_id: `mu_games:disable:${game.id}`,
        label: "Désactiver",
        style: ButtonStyle.Secondary
      }
    : {
        type: 2,
        custom_id: `mu_games:enable:${game.id}`,
        label: "Réactiver",
        style: ButtonStyle.Success
      };

  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: `mu_games:save:${game.id}:${channelId ?? "none"}`,
        label: "Enregistrer",
        style: ButtonStyle.Primary,
        disabled: !canSave
      },
      toggle,
      {
        type: 2,
        custom_id: "mu_games:add",
        label: "Ajouter un jeu",
        style: ButtonStyle.Secondary
      }
    ]
  } as ReplyComponentRow;
}

function buildGamesEmptyRow(): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_games:add",
        label: "Ajouter un jeu",
        style: ButtonStyle.Primary
      }
    ]
  } as ReplyComponentRow;
}

async function buildGamesConfigPayload(state: GameConfigState): Promise<ReplyPayload> {
  const prisma = getPrisma();
  const games = await listAllGames(prisma);
  const orderedGames = [...games].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, "fr")
  );

  if (orderedGames.length === 0) {
    return {
      content: [
        "**Jeux & canaux**",
        state.notice,
        "Aucun jeu configuré pour le moment.",
        "Ajoute un jeu et associe-lui un canal."
      ]
        .filter(Boolean)
        .join("\n"),
      components: [buildGamesEmptyRow()]
    };
  }

  const selectedGame =
    orderedGames.find((game) => game.id === state.gameId) ??
    orderedGames.find((game) => game.active) ??
    orderedGames[0];
  const selectedChannelId = state.channelId ?? selectedGame.channelId;

  return {
    content: [
      "**Jeux & canaux**",
      "Sélectionne un jeu puis le canal où créer les fils de discussion.",
      "Chaque jeu doit avoir un canal associé.",
      state.notice,
      "",
      `Jeu sélectionné : ${selectedGame.label} (${selectedGame.code})`,
      `Canal sélectionné : <#${selectedChannelId}>`,
      "",
      "Jeux configurés :",
      orderedGames.map(formatGameLine).join("\n")
    ]
      .filter(Boolean)
      .join("\n"),
    components: [
      buildGamesSelectRow(orderedGames, selectedGame.id),
      buildGamesChannelRow(selectedGame.id, selectedChannelId),
      buildGamesActionRow(selectedGame, selectedChannelId)
    ]
  };
}

function buildMatchPanel(): ReplyPayload {
  return {
    content: [
      "🎯 Panneau de gestion des parties",
      "Actions disponibles : création de partie, validation/refus/annulation via boutons ou commandes."
    ].join("\n"),
    components: buildMatchPanelRows()
  };
}

function buildMatchPanelRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_match:create",
          label: "Créer une partie",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_match:panel",
          label: "Rafraîchir",
          style: ButtonStyle.Secondary
        }
      ]
    }
  ];
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

function formatFrenchMonthYear(date: dayjs.Dayjs): string {
  const month = FRENCH_MONTHS[date.month()] ?? date.format("MMMM");
  return `${month} ${date.year()}`;
}

function formatGamesInline(games: Game[]): string {
  if (games.length === 0) {
    return "Aucun";
  }

  return games.map((game) => game.label).join(", ");
}

async function buildConfigMenuContent(config: AppConfig, logger: Logger): Promise<string> {
  const prisma = getPrisma();
  const slotDays = await getSlotDays(prisma);
  const games = await listActiveGames(prisma);
  const now = dayjs().tz(config.timezone);
  const offset = now.format("Z");
  const slotsOverview = await buildMonthSlotsOverview(config, logger, slotDays);

  return [
    "**Configuration**",
    "Bienvenue dans la commande de configuration de @Munitorum.",
    "Grâce à cette commande, vous pouvez configurer les différents modules via le sélecteur ci-dessous.",
    "",
    "Paramètres de base :",
    "Langue : Français",
    `Fuseau horaire : (UTC${offset}) ${config.timezone}`,
    `Jours des créneaux : ${formatSlotDays(slotDays)}`,
    `Jeux actifs : ${formatGamesInline(games)}`,
    "",
    `Créneaux du mois (${formatFrenchMonthYear(now)})`,
    slotsOverview
  ].join("\n");
}

async function buildConfigCategoryResponse(
  category: ConfigCategory,
  config: AppConfig,
  logger: Logger
): Promise<ReplyPayload> {
  if (category === "slots") {
    const prisma = getPrisma();
    const slotDays = await getSlotDays(prisma);
    const games = await listActiveGames(prisma);
    const slotsOverview = await buildMonthSlotsOverview(config, logger, slotDays);

    return {
      content: [
        buildConfigCategoryContent("**Créneaux**"),
        `Jours actifs : ${formatSlotDays(slotDays)}`,
        `Jeux actifs : ${formatGamesInline(games)}`,
        "",
        `Créneaux du mois (${formatFrenchMonthYear(dayjs().tz(config.timezone))})`,
        slotsOverview
      ].join("\n"),
      components: [buildConfigMenuSelect("slots"), ...buildSlotsCategoryRows()]
    };
  }

  if (category === "matches") {
    return {
      content: buildConfigCategoryContent("**Parties**"),
      components: [buildConfigMenuSelect("matches"), ...buildMatchesCategoryRows()]
    };
  }

  return {
    content: buildConfigCategoryContent("**Tables**"),
    components: [buildConfigMenuSelect("tables"), ...buildTablesCategoryRows()]
  };
}

async function buildMonthSlotsOverview(
  config: AppConfig,
  logger: Logger,
  slotDays: number[]
): Promise<string> {
  const prisma = getPrisma();
  const now = dayjs().tz(config.timezone);
  const monthStart = now.startOf("month").startOf("day");
  const monthEnd = now.endOf("month").endOf("day");
  const slots = buildMonthSlots(config.timezone, slotDays);

  const events = await prisma.event.findMany({
    where: {
      date: {
        gte: monthStart.toDate(),
        lte: monthEnd.toDate()
      }
    }
  });

  const eventByDate = new Map(
    events.map((event) => [dayjs(event.date).format("YYYY-MM-DD"), event])
  );

  const closures = await Promise.all(
    slots.map((slotDate) =>
      getClosureInfo(slotDate, config.vacationAcademy, config.timezone, logger)
    )
  );

  if (slots.length === 0) {
    return "Aucun jour configuré.";
  }

  return slots
    .map((slotDate, index) => {
      const key = slotDate.format("YYYY-MM-DD");
      const closure = closures[index];
      const event = eventByDate.get(key);

      let status = "Fermé (non créé)";
      if (closure?.closed) {
        status = "Fermé (vacances)";
      } else if (event && event.status === "OUVERT" && event.tables > 0) {
        status = "Disponible";
      } else if (event) {
        status = "Fermé";
      }

      return `• ${slotDate.format("DD/MM")} : ${status}`;
    })
    .join("\n");
}

function buildConfirmRow(confirmId: string) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: confirmId,
        label: "Confirmer suppression",
        style: ButtonStyle.Danger
      },
      {
        type: 2,
        custom_id: "mu_slots:cancel_delete",
        label: "Annuler",
        style: ButtonStyle.Secondary
      }
    ]
  };
}

function buildMatchSummary(
  match: {
    player1: { discordId: string };
    player2: { discordId: string };
    game: { label: string };
    event: { date: Date };
  },
  config: AppConfig
) {
  const eventDate = dayjs(match.event.date).tz(config.timezone);
  const gameLabel = match.game.label;
  return `${formatFrenchDate(eventDate)} — <@${match.player1.discordId}> vs <@${match.player2.discordId}> (${gameLabel})`;
}

function formatThreadDayMonth(date: dayjs.Dayjs): string {
  const month = FRENCH_MONTHS[date.month()] ?? date.format("MMMM");
  return `${date.date()} ${month}`;
}

function buildThreadName(game: Game, date: dayjs.Dayjs): string {
  return `Soirée ${game.label} le ${formatThreadDayMonth(date)}`;
}

function parseUserIdInput(input: string): string | null {
  const trimmed = input.trim();
  const mentionMatch = trimmed.match(/<@!?([0-9]+)>/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

type SendableChannel = {
  send: (payload: { content: string }) => Promise<unknown>;
  isThread?: () => boolean;
};

type ThreadStarterMessage = {
  startThread: (options: { name: string; autoArchiveDuration?: number }) => Promise<{ id: string }>;
};

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

async function ensureEventThreads(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  event: { id: number; date: Date }
): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.eventThread.findMany({ where: { eventId: event.id } });
  const existingGames = new Set(existing.map((thread) => thread.gameId));
  const eventDate = dayjs(event.date).tz(config.timezone);
  const games = await listActiveGames(prisma);

  for (const game of games) {
    if (existingGames.has(game.id)) {
      continue;
    }

    const threadName = buildThreadName(game, eventDate);
    const starterContent = `Créneau ${game.label} — ${formatFrenchDate(eventDate)}.`;

    const channel = await interaction.client.channels.fetch(game.channelId);

    if (!isSendableChannel(channel)) {
      logger.warn(
        { channelId: game.channelId, gameId: game.id },
        "Channel not found or not sendable"
      );
      continue;
    }

    if (channel.isThread?.()) {
      logger.warn({ channelId: game.channelId, gameId: game.id }, "Configured channel is a thread");
      continue;
    }

    try {
      const starter = await channel.send({ content: starterContent });
      if (!isThreadStarterMessage(starter)) {
        logger.warn({ eventId: event.id }, "Starter message does not support threads");
        continue;
      }

      const thread = await starter.startThread({
        name: threadName,
        autoArchiveDuration: 10080
      });

      await prisma.eventThread.create({
        data: {
          eventId: event.id,
          gameId: game.id,
          threadId: thread.id
        }
      });
    } catch (err) {
      logger.warn({ err, gameId: game.id, eventId: event.id }, "Failed to create thread");
    }
  }
}

async function closeEventThreads(
  interaction: EphemeralInteraction,
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
    interaction,
    logger,
    threads.map((thread) => thread.threadId)
  );
}

async function closeThreadsByIds(
  interaction: EphemeralInteraction,
  logger: Logger,
  threadIds: string[]
): Promise<void> {
  for (const threadId of threadIds) {
    try {
      const channel = await interaction.client.channels.fetch(threadId);
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

async function handleMatchValidate(
  interaction: ButtonInteraction,
  config: AppConfig,
  logger: Logger,
  matchId: number
): Promise<void> {
  await performMatchValidate(interaction, config, logger, matchId, true);
}

async function performMatchValidate(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  matchId: number,
  disableButtons: boolean
): Promise<void> {
  if (!Number.isFinite(matchId)) {
    await replyEphemeral(interaction, { content: "❌ Partie introuvable." });
    return;
  }

  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Validation en cours..." });

  const prisma = getPrisma();
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { player1: true, player2: true, event: true, game: true }
  });

  if (!match) {
    await interaction.editReply({ content: "❌ Partie introuvable." });
    return;
  }

  if (match.status !== MatchStatus.EN_ATTENTE) {
    await interaction.editReply({
      content: `ℹ️ Cette partie est déjà ${match.status.toLowerCase()}.`
    });
    return;
  }

  await prisma.match.update({
    where: { id: match.id },
    data: { status: MatchStatus.VALIDE }
  });

  const summary = buildMatchSummary(match, config);
  await notifyMatchStatus(
    interaction,
    config,
    logger,
    match,
    `✅ Partie validée : ${summary}`,
    `✅ Votre partie est validée : ${summary}`
  );

  await interaction.editReply({ content: "✅ Partie validée." });

  if (disableButtons && "message" in interaction) {
    await disableInteractionButtons(interaction as ButtonInteraction);
  }
}

async function performMatchRefuse(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  matchId: number,
  reason: string
): Promise<void> {
  if (!Number.isFinite(matchId)) {
    await replyEphemeral(interaction, { content: "❌ Partie introuvable." });
    return;
  }

  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Refus en cours..." });

  const prisma = getPrisma();
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { player1: true, player2: true, event: true, game: true }
  });

  if (!match) {
    await interaction.editReply({ content: "❌ Partie introuvable." });
    return;
  }

  if (match.status !== MatchStatus.EN_ATTENTE) {
    await interaction.editReply({
      content: `ℹ️ Cette partie est déjà ${match.status.toLowerCase()}.`
    });
    return;
  }

  await prisma.match.update({
    where: { id: match.id },
    data: { status: MatchStatus.REFUSE }
  });

  const summary = buildMatchSummary(match, config);
  const reasonSuffix = reason ? `\nRaison : ${reason}` : "";

  await notifyMatchStatus(
    interaction,
    config,
    logger,
    match,
    `⛔ Partie refusée : ${summary}${reasonSuffix}`,
    `⛔ Votre partie est refusée : ${summary}${reasonSuffix}`
  );

  await interaction.editReply({ content: "⛔ Partie refusée." });
}

async function performMatchCancel(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  matchId: number,
  reason: string
): Promise<void> {
  if (!Number.isFinite(matchId)) {
    await replyEphemeral(interaction, { content: "❌ Partie introuvable." });
    return;
  }

  const prisma = getPrisma();
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { player1: true, player2: true, event: true, game: true }
  });

  if (!match) {
    await replyEphemeral(interaction, { content: "❌ Partie introuvable." });
    return;
  }

  if (!(await canCancelMatch(interaction, config, match))) {
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Annulation en cours..." });

  if (match.status === MatchStatus.ANNULE) {
    await interaction.editReply({ content: "ℹ️ Cette partie est déjà annulée." });
    return;
  }

  if (match.status === MatchStatus.REFUSE) {
    await interaction.editReply({ content: "ℹ️ Cette partie a déjà été refusée." });
    return;
  }

  await prisma.match.update({
    where: { id: match.id },
    data: { status: MatchStatus.ANNULE }
  });

  const summary = buildMatchSummary(match, config);
  const reasonSuffix = reason ? `\nRaison : ${reason}` : "";

  await notifyMatchStatus(
    interaction,
    config,
    logger,
    match,
    `⚠️ Partie annulée : ${summary}${reasonSuffix}`,
    `⚠️ Votre partie est annulée : ${summary}${reasonSuffix}`
  );

  await interaction.editReply({ content: "⚠️ Partie annulée." });
}

async function showMatchReasonModal(
  interaction: ButtonInteraction,
  config: AppConfig,
  logger: Logger,
  matchId: number,
  action: "refuse" | "cancel"
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  if (!Number.isFinite(matchId)) {
    await replyEphemeral(interaction, { content: "❌ Partie introuvable." });
    return;
  }

  if (action === "refuse") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette action est réservée aux administrateurs."
      });
      return;
    }
  }

  if (action === "cancel") {
    const prisma = getPrisma();
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { player1: true, player2: true }
    });

    if (!match) {
      await replyEphemeral(interaction, { content: "❌ Partie introuvable." });
      return;
    }

    const isAdmin = interaction.member && isAdminMember(interaction.member, config);
    const isPlayer =
      interaction.user.id === match.player1.discordId ||
      interaction.user.id === match.player2.discordId;

    if (!isAdmin && !isPlayer) {
      await replyEphemeral(interaction, {
        content: "⛔ Vous ne pouvez pas annuler cette partie."
      });
      return;
    }
  }

  const modal = {
    custom_id: `mu_match:${action}_modal:${matchId}`,
    title: action === "refuse" ? "Refuser une partie" : "Annuler une partie",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "reason",
            label: "Raison (optionnel)",
            style: TextInputStyle.Paragraph,
            required: false,
            placeholder: "Ex: tables insuffisantes, indisponibilité..."
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function canCancelMatch(
  interaction: EphemeralInteraction,
  config: AppConfig,
  match: {
    player1: { discordId: string };
    player2: { discordId: string };
  }
): Promise<boolean> {
  const isAdmin = interaction.member && isAdminMember(interaction.member, config);
  const isPlayer =
    interaction.user.id === match.player1.discordId ||
    interaction.user.id === match.player2.discordId;

  if (!isAdmin && !isPlayer) {
    await replyEphemeral(interaction, {
      content: "⛔ Vous ne pouvez pas annuler cette partie."
    });
    return false;
  }

  return true;
}

async function notifyMatchStatus(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  match: {
    id: number;
    player1: { discordId: string };
    player2: { discordId: string };
  },
  threadMessage: string,
  dmMessage: string
): Promise<void> {
  const prisma = getPrisma();
  const dmResults = await Promise.all(
    [match.player1.discordId, match.player2.discordId].map(async (discordId) => {
      try {
        const user = await interaction.client.users.fetch(discordId);
        await user.send(dmMessage);
        return { success: true };
      } catch (err) {
        logger.warn({ err, userId: discordId }, "Failed to send DM");
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  await prisma.notification.createMany({
    data: dmResults.map((result) => ({
      matchId: match.id,
      type: NotificationType.DM,
      success: result.success,
      error: result.success ? null : result.error
    }))
  });

  if (config.mentionInThread && interaction.channel?.isTextBased()) {
    try {
      const channel = interaction.channel;
      if ("send" in channel && typeof channel.send === "function") {
        await channel.send(threadMessage);
      }
      await prisma.notification.create({
        data: { matchId: match.id, type: NotificationType.THREAD, success: true }
      });
    } catch (err) {
      logger.warn({ err }, "Failed to send thread notification");
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
}

async function notifyMatchCreated(
  interaction: EphemeralInteraction,
  logger: Logger,
  matchId: number,
  playerIds: string[],
  gameLabel: string
): Promise<void> {
  const prisma = getPrisma();
  const dmContent = `✅ Votre partie ${gameLabel} est enregistrée et en attente de validation.`;

  const results = await Promise.all(
    playerIds.map(async (discordId) => {
      try {
        const user = await interaction.client.users.fetch(discordId);
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

async function upsertUserFromInteraction(
  prisma: ReturnType<typeof getPrisma>,
  interaction: EphemeralInteraction,
  discordId: string
) {
  let displayName: string | null = null;

  if (interaction.inGuild()) {
    try {
      const member = await interaction.guild?.members.fetch(discordId);
      displayName = member?.displayName ?? member?.user.username ?? null;
    } catch {
      displayName = null;
    }
  }

  if (!displayName) {
    try {
      const user = await interaction.client.users.fetch(discordId);
      displayName = user.username;
    } catch {
      displayName = null;
    }
  }

  return prisma.user.upsert({
    where: { discordId },
    create: { discordId, displayName },
    update: { displayName: displayName ?? undefined, lastSeenAt: new Date() }
  });
}

async function disableInteractionButtons(interaction: ButtonInteraction): Promise<void> {
  try {
    if (interaction.message.edit) {
      await interaction.message.edit({ components: [] });
    }
  } catch {
    // Best-effort only
  }
}

async function showDeleteDateModal(
  interaction: ButtonInteraction,
  config: AppConfig
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  if (!interaction.member || !isAdminMember(interaction.member, config)) {
    await replyEphemeral(interaction, {
      content: "⛔ Cette commande est réservée aux administrateurs."
    });
    return;
  }

  const modal = {
    custom_id: "mu_slots:delete_date_modal",
    title: "Supprimer un créneau",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "date",
            label: "Date (JJ/MM/AAAA)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "28/02/2026"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function showSlotDaysModal(interaction: ButtonInteraction, config: AppConfig): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  if (!interaction.member || !isAdminMember(interaction.member, config)) {
    await replyEphemeral(interaction, {
      content: "⛔ Cette commande est réservée aux administrateurs."
    });
    return;
  }

  const modal = {
    custom_id: "mu_slots:configure_days_modal",
    title: "Configurer les jours des créneaux",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "days",
            label: "Jours (ex: lun, mer, ven ou 1,3,5)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "ven"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function showGameAddModal(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  const modal = {
    custom_id: "mu_games:add_modal",
    title: "Ajouter un jeu",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "code",
            label: "Code court (ex: W40K)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "W40K"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "label",
            label: "Libellé",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "Warhammer 40k"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function showMatchCreateModal(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  const modal = {
    custom_id: "mu_match:create_modal",
    title: "Créer une partie",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "date",
            label: "Date (JJ/MM/AAAA)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "28/02/2026"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "player1",
            label: "Joueur 1 (mention ou ID)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "@Alice"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "player2",
            label: "Joueur 2 (mention ou ID)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "@Bob"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "game",
            label: "Jeu (40k, AoS, Kill Team, Autre)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "40k"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function showMatchActionModal(
  interaction: ButtonInteraction,
  config: AppConfig,
  action: "validate" | "refuse" | "cancel"
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  if (action !== "cancel") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette action est réservée aux administrateurs."
      });
      return;
    }
  }

  const requiresReason = action !== "validate";
  const titleMap = {
    validate: "Valider une partie",
    refuse: "Refuser une partie",
    cancel: "Annuler une partie"
  };

  const modal = {
    custom_id: `mu_match:${action}_request_modal`,
    title: titleMap[action],
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "date",
            label: "Date (JJ/MM/AAAA)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "28/02/2026"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "player1",
            label: "Joueur 1 (mention ou ID)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "@Alice"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "player2",
            label: "Joueur 2 (mention ou ID)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "@Bob"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "reason",
            label: "Raison (optionnel)",
            style: TextInputStyle.Paragraph,
            required: false,
            placeholder: "Ex: tables insuffisantes, indisponibilité...",
            min_length: requiresReason ? 0 : 0
          }
        ]
      }
    ]
  };

  if (!requiresReason) {
    modal.components.pop();
  }

  await interaction.showModal(modal as ModalPayload);
}

async function showTablesSetModal(
  interaction: ButtonInteraction,
  config: AppConfig
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  if (!interaction.member || !isAdminMember(interaction.member, config)) {
    await replyEphemeral(interaction, {
      content: "⛔ Cette commande est réservée aux administrateurs."
    });
    return;
  }

  const modal = {
    custom_id: "mu_tables:set_modal",
    title: "Définir les tables",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "date",
            label: "Date (JJ/MM/AAAA)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "28/02/2026"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "count",
            label: "Nombre de tables",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "12"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function showTablesShowModal(
  interaction: ButtonInteraction,
  config: AppConfig
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  if (!interaction.member || !isAdminMember(interaction.member, config)) {
    await replyEphemeral(interaction, {
      content: "⛔ Cette commande est réservée aux administrateurs."
    });
    return;
  }

  const modal = {
    custom_id: "mu_tables:show_modal",
    title: "Voir les tables",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "date",
            label: "Date (JJ/MM/AAAA)",
            style: TextInputStyle.Short,
            required: true,
            placeholder: "28/02/2026"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}
