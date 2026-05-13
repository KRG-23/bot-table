import type { Event, Game } from "@prisma/client";
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
  formatMentionInThread,
  getAppSettings,
  saveMentionInThread
} from "../services/app-settings";
import {
  type AutomationSettings,
  DEFAULT_AUTOMATION_SETTINGS,
  formatAutomationSettings,
  formatWeekday,
  getAutomationSettings,
  parseLookaheadInput,
  parseRetentionDaysInput,
  parseTimeInput,
  parseWeekInput,
  parseWeekdayInput,
  saveAutomationSettings
} from "../services/automation-settings";
import {
  closeEventThreads,
  closeEventThreadsForGames,
  closeThreadsByIds,
  ensureEventThreads
} from "../services/event-threads";
import {
  listActiveGames,
  listAllGames,
  normalizeGameInput,
  resolveGameFromInput
} from "../services/games";
import { buildPendingValidationDm, buildPendingValidationNotice } from "../services/match-notices";
import { canUseMatchAction } from "../services/match-permissions";
import { autoValidatePendingMatchesForGame } from "../services/match-review";
import { BLOCKING_MATCH_STATUSES } from "../services/matches";
import {
  buildMonthlySlotGenerationSummary,
  generateCurrentMonthSlots
} from "../services/monthly-slots";
import { refreshSchedulers } from "../services/scheduler";
import {
  SLOT_DAYS_SETTING,
  buildMonthSlots,
  formatSlotDays,
  getSlotDays,
  isSlotDay,
  parseSlotDaysInput
} from "../services/slots";
import {
  type GameTableAllocation,
  buildDefaultGameTableAllocations,
  formatGameTableCapacities,
  formatTableCount,
  getDefaultGameTableCount,
  getEventTableCapacity,
  getGameTableCapacity,
  inferInitialGameDefaultTableCount,
  recalculateEventTables,
  replaceGameTableCapacities,
  upsertGameTableCapacity
} from "../services/table-capacity";
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
type ParsedGameTableAllocations = GameTableAllocation[];

type ChannelLike = {
  id: string;
  type: ChannelType;
};

type ModalPayload = Parameters<ButtonInteraction["showModal"]>[0];
type ChannelWithText = { isTextBased: () => boolean } | null;
type SendableChannel = {
  send: (payload: { content: string; components?: ReplyComponents }) => Promise<Message>;
};
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
      const gameInput = interaction.options.getString("game");
      if (gameInput) {
        await handleGameTablesSet(interaction, config, logger, parsedDate, gameInput, count);
      } else {
        await handleTablesSet(interaction, config, logger, parsedDate, count);
      }
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
      const defaultTables = interaction.options.getInteger("default_tables") ?? undefined;
      const channel: ChannelLike = { id: selected.id, type: selected.type };
      await handleGamesAdd(interaction, config, { code, label, channel, defaultTables });
      return;
    }

    if (subcommand === "set_channel") {
      const gameInput = interaction.options.getString("game", true);
      const selected = interaction.options.getChannel("channel", true);
      const channel: ChannelLike = { id: selected.id, type: selected.type };
      await handleGamesSetChannel(interaction, { gameInput, channel });
      return;
    }

    if (subcommand === "set_default_tables") {
      const gameInput = interaction.options.getString("game", true);
      const count = interaction.options.getInteger("count", true);
      await handleGamesSetDefaultTables(interaction, { gameInput, count });
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

function getSendableChannel(channel: ChannelWithText): SendableChannel | null {
  if (!channel || !channel.isTextBased()) {
    return null;
  }
  if ("send" in channel && typeof channel.send === "function") {
    return channel as SendableChannel;
  }
  return null;
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

  if (interaction.customId === "mu_config:home") {
    const payload = await buildConfigCategoryResponse("home", config, logger);
    await interaction.update(toUpdatePayload(payload));
    return;
  }

  if (interaction.customId.startsWith("mu_lang:set:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const language = normalizeLanguage(interaction.customId.replace("mu_lang:set:", ""));
    const prisma = getPrisma();

    let deferred = false;
    try {
      await interaction.deferUpdate();
      deferred = true;
    } catch (err) {
      logger.warn({ err }, "Failed to defer language update");
    }

    await setBotLanguage(prisma, language);
    const payload = await buildConfigCategoryResponse("home", config, logger);

    if (deferred) {
      await interaction.editReply(toEditPayload(payload));
      scheduleConfigMenuExpiry(interaction.message as Message, logger);
      return;
    }

    const channel = getSendableChannel(interaction.channel);
    if (channel) {
      const message = await channel.send({
        content: payload.content,
        components: payload.components as ReplyComponents
      });
      scheduleConfigMenuExpiry(message, logger);
    }

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
    await showTablesDateSelect(interaction, config, "set");
    return;
  }

  if (interaction.customId === "mu_tables:show") {
    await showTablesDateSelect(interaction, config, "show");
    return;
  }

  if (interaction.customId.startsWith("mu_tables:set_game:")) {
    await showTablesGameModal(interaction, config);
    return;
  }

  if (interaction.customId.startsWith("mu_tables:apply_defaults:")) {
    await handleTablesApplyDefaults(interaction, config, logger);
    return;
  }

  if (interaction.customId.startsWith("mu_thread:status:")) {
    await handleThreadStatus(interaction, config);
    return;
  }

  if (interaction.customId.startsWith("mu_thread:tables:")) {
    await showThreadTablesModal(interaction, config);
    return;
  }

  if (interaction.customId.startsWith("mu_thread:validate:")) {
    await handleThreadValidatePossible(interaction, config, logger);
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

  if (interaction.customId === "mu_automation:configure") {
    await showAutomationSettingsModal(interaction, config);
    return;
  }

  if (interaction.customId === "mu_automation:reset_defaults") {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    await saveAutomationSettings(getPrisma(), DEFAULT_AUTOMATION_SETTINGS);
    refreshSchedulers(interaction.client, config, logger);
    const payload = await buildConfigCategoryResponse("automations", config, logger);
    await interaction.update(toUpdatePayload(payload));
    return;
  }

  if (interaction.customId.startsWith("mu_notifications:mention_thread:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const enabled = interaction.customId.endsWith(":on");
    await saveMentionInThread(getPrisma(), enabled);

    const payload = await buildConfigCategoryResponse("notifications", config, logger);
    await interaction.update(toUpdatePayload(payload));
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

  if (interaction.customId.startsWith("mu_games:default_tables:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    await showGameDefaultTablesModal(interaction);
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
    await replyEphemeral(interaction, {
      content: "❎ Suppression annulée.",
      components: [buildBackToConfigRow()]
    });
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
    return;
  }
}

export async function handleSelectMenuInteraction(
  interaction: ConfigMenuInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (interaction.customId === "mu_config:menu") {
    const ageMs = Date.now() - interaction.createdTimestamp;
    if (ageMs > 2500) {
      return;
    }
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
    return;
  }

  if (interaction.customId.startsWith("mu_tables:date_select:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const action = parseTablesDateAction(interaction.customId);
    const selectedDate = interaction.values[0];
    const parsedDate = parseTableDateKey(selectedDate, config.timezone);

    if (!action || !parsedDate) {
      await replyEphemeral(interaction, { content: "❌ Sélection invalide." });
      return;
    }

    const payload =
      action === "set"
        ? await buildTablesGameConfigPayload(config, parsedDate)
        : await buildTablesShowPayload(config, logger, parsedDate);

    await interaction.update(toUpdatePayload(payload));
    return;
  }

  if (interaction.customId.startsWith("mu_tables:game_select:")) {
    if (!(await ensureAdmin(interaction, config))) {
      return;
    }

    const dateKey = interaction.customId.replace("mu_tables:game_select:", "");
    const parsedDate = parseTableDateKey(dateKey, config.timezone);
    const selectedGameId = Number(interaction.values[0]);

    if (!parsedDate || !Number.isInteger(selectedGameId)) {
      await replyEphemeral(interaction, { content: "❌ Sélection invalide." });
      return;
    }

    const payload = await buildTablesGameConfigPayload(config, parsedDate, selectedGameId);
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
    const parsedDate = parseFrenchDate(dateInput, config.timezone);

    if (!parsedDate) {
      await replyEphemeral(interaction, {
        content: "❌ Date invalide. Format attendu : JJ/MM/AAAA."
      });
      return;
    }

    const payload = await buildTablesGameConfigPayload(config, parsedDate);
    await replyEphemeral(interaction, payload);
    return;
  }

  if (interaction.customId.startsWith("mu_tables:set_game_modal:")) {
    await handleTablesGameModal(interaction, config, logger);
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
    return;
  }

  if (interaction.customId.startsWith("mu_thread:tables_modal:")) {
    await handleThreadTablesModal(interaction, config, logger);
    return;
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

  if (interaction.customId === "mu_automation:configure_modal") {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    await handleAutomationSettingsUpdate(interaction, config, logger);
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
    const defaultTablesInput = interaction.fields.getTextInputValue("defaultTables");
    const defaultTables = parseOptionalNonNegativeInteger(defaultTablesInput);
    if (defaultTables === null) {
      await replyEphemeral(interaction, {
        content: "❌ Nombre de tables par défaut invalide."
      });
      return;
    }

    await handleGamesAdd(interaction, config, {
      code: codeInput,
      label: labelInput,
      defaultTables
    });
    return;
  }

  if (interaction.customId.startsWith("mu_games:default_tables_modal:")) {
    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await replyEphemeral(interaction, {
        content: "⛔ Cette commande est réservée aux administrateurs."
      });
      return;
    }

    await handleGameDefaultTablesModal(interaction);
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

  const ageMs = Date.now() - interaction.createdTimestamp;
  if (ageMs > 2500) {
    const payload = await buildConfigCategoryResponse("home", config, logger);
    const channel = getSendableChannel(interaction.channel);
    if (channel) {
      const message = await channel.send({
        content: payload.content,
        components: payload.components as ReplyComponents
      });
      scheduleConfigMenuExpiry(message, logger);
    }
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

  const payload = await buildConfigCategoryResponse("home", config, logger);

  if (acknowledged) {
    try {
      await interaction.editReply(toEditPayload(payload));
      const message = await interaction.fetchReply();
      scheduleConfigMenuExpiry(message as Message, logger);
      return;
    } catch (err) {
      logger.warn({ err }, "Failed to edit config menu reply");
    }
  }

  const channel = getSendableChannel(interaction.channel);
  if (channel) {
    const message = await channel.send({
      content: payload.content,
      components: payload.components as ReplyComponents
    });
    scheduleConfigMenuExpiry(message, logger);
  }
}

type GameAddInput = {
  code: string;
  label: string;
  channel?: ChannelLike;
  defaultTables?: number;
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

type GameDefaultTablesInput = {
  gameInput: string;
  count: number;
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

function parseOptionalNonNegativeInteger(input: string): number | undefined | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : null;
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

  const inferredDefaultTables = inferInitialGameDefaultTableCount({ code, label });
  const defaultTables = input.defaultTables ?? inferredDefaultTables;
  if (!Number.isInteger(defaultTables) || defaultTables < 0) {
    await replyEphemeral(interaction, {
      content: "❌ Nombre de tables par défaut invalide."
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
      defaultTables,
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

async function handleGamesSetDefaultTables(
  interaction: EphemeralInteraction,
  input: GameDefaultTablesInput
): Promise<void> {
  if (!Number.isInteger(input.count) || input.count < 0) {
    await replyEphemeral(interaction, {
      content: "❌ Nombre de tables par défaut invalide."
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
    data: { defaultTables: input.count }
  });

  const panel = await buildGamesConfigPayload({
    gameId: game.id,
    channelId: game.channelId,
    notice: `✅ Tables par défaut mises à jour : ${formatTableCount(input.count)}.`
  });
  await replyEphemeral(interaction, panel);
}

async function handleGameDefaultTablesModal(interaction: ModalSubmitInteraction): Promise<void> {
  const gameId = Number(interaction.customId.replace("mu_games:default_tables_modal:", ""));
  const count = Number(interaction.fields.getTextInputValue("count"));

  if (!Number.isInteger(gameId) || !Number.isInteger(count) || count < 0) {
    await replyEphemeral(interaction, {
      content: "❌ Nombre de tables par défaut invalide."
    });
    return;
  }

  const prisma = getPrisma();
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    await replyEphemeral(interaction, {
      content: "❌ Jeu introuvable."
    });
    return;
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { defaultTables: count }
  });

  const panel = await buildGamesConfigPayload({
    gameId: game.id,
    channelId: game.channelId,
    notice: `✅ Tables par défaut mises à jour : ${formatTableCount(count)}.`
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
      )}.`,
      components: [buildBackToConfigRow()]
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
  await replaceGameTableCapacities(prisma, event.id, []);

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
    components: [buildTablesRow(), buildBackToConfigRow()]
  });

  if (isClosed) {
    await closeEventThreads(interaction.client, logger, event.id);
  } else {
    await ensureEventThreads(interaction.client, config, logger, event);
  }
}

function formatTableDateKey(date: dayjs.Dayjs): string {
  return date.format("YYYY-MM-DD");
}

function parseTableDateKey(dateKey: string, timezone: string): dayjs.Dayjs | null {
  const parsedDate = dayjs.tz(dateKey, "YYYY-MM-DD", timezone).startOf("day");
  return parsedDate.isValid() ? parsedDate : null;
}

type TablesDateAction = "set" | "show";

function parseTablesDateAction(customId: string): TablesDateAction | null {
  const action = customId.replace("mu_tables:date_select:", "");
  return action === "set" || action === "show" ? action : null;
}

async function showTablesDateSelect(
  interaction: ButtonInteraction,
  config: AppConfig,
  action: TablesDateAction
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

  const payload = await buildTablesDateSelectPayload(config, action);
  await replyEphemeral(interaction, payload);
}

async function buildTablesDateSelectPayload(
  config: AppConfig,
  action: TablesDateAction
): Promise<ReplyPayload> {
  const events = await listSelectableTableEvents(config);
  const actionLabel = action === "set" ? "définir" : "voir";

  if (events.length === 0) {
    return {
      content: [
        "**Jeux & tables**",
        "Aucun créneau créé pour le moment.",
        "Génère d'abord les créneaux depuis le menu “Créneaux”."
      ].join("\n"),
      components: [buildBackToConfigRow()]
    };
  }

  return {
    content: ["**Jeux & tables**", `Choisis le créneau pour ${actionLabel} les tables.`].join("\n"),
    components: [buildTablesDateSelectRow(config, action, events), buildBackToConfigRow()]
  };
}

async function listSelectableTableEvents(config: AppConfig): Promise<Event[]> {
  const lowerBound = dayjs().tz(config.timezone).startOf("day").subtract(1, "month");
  const prisma = getPrisma();

  const recentOrUpcoming = await prisma.event.findMany({
    where: { date: { gte: lowerBound.toDate() } },
    orderBy: { date: "asc" },
    take: 25
  });

  if (recentOrUpcoming.length > 0) {
    return recentOrUpcoming;
  }

  const latestPast = await prisma.event.findMany({
    orderBy: { date: "desc" },
    take: 25
  });

  return latestPast.reverse();
}

function buildTablesDateSelectRow(
  config: AppConfig,
  action: TablesDateAction,
  events: Event[]
): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `mu_tables:date_select:${action}`,
        placeholder: "Choisir un créneau",
        min_values: 1,
        max_values: 1,
        options: events.map((event) => {
          const date = dayjs(event.date).tz(config.timezone);
          const status = event.status === "OUVERT" ? "Ouvert" : "Fermé";

          return {
            label: formatFrenchDate(date).slice(0, 100),
            value: formatTableDateKey(date),
            description: `${status} · ${formatTableCount(event.tables)}`.slice(0, 100)
          };
        })
      }
    ]
  } as ReplyComponentRow;
}

async function buildTablesGameConfigPayload(
  config: AppConfig,
  parsedDate: dayjs.Dayjs,
  selectedGameId?: number
): Promise<ReplyPayload> {
  const prisma = getPrisma();
  const activeGames = await listActiveGames(prisma);
  const event = await prisma.event.findUnique({ where: { date: parsedDate.toDate() } });
  const capacity = event ? await getEventTableCapacity(prisma, event) : null;
  const capacityByGame = new Map(
    capacity?.gameTables.map((entry) => [entry.game.id, entry.tables]) ?? []
  );

  if (activeGames.length === 0) {
    return {
      content: [
        "**Définir les tables par jeu**",
        `Date : ${formatFrenchDate(parsedDate)}`,
        "",
        "Aucun jeu actif configuré. Ajoute d'abord un jeu dans “Jeux & tables”."
      ].join("\n"),
      components: [buildBackToConfigRow()]
    };
  }

  const selectedGame = activeGames.find((game) => game.id === selectedGameId) ?? activeGames[0];
  const dateKey = formatTableDateKey(parsedDate);
  const defaultsSummary = formatDefaultGameTableSummary(activeGames);
  const tableLines = activeGames.map((game) => {
    const current = capacity?.usesGameCapacities ? (capacityByGame.get(game.id) ?? 0) : 0;
    const fallback = getDefaultGameTableCount(game);
    const defaultText = fallback > 0 ? ` — défaut ${fallback}` : "";
    return `• ${game.label} : ${formatTableCount(current)}${defaultText}`;
  });
  const globalNotice =
    event && !capacity?.usesGameCapacities && event.tables > 0
      ? `⚠️ Ce créneau utilise encore un total non réparti : ${formatTableCount(event.tables)}.`
      : null;

  return {
    content: [
      "**Définir les tables par jeu**",
      `Date : ${formatFrenchDate(parsedDate)}`,
      globalNotice,
      "",
      "Choisis un jeu dans la liste, puis saisis son nombre de tables.",
      `Tu peux aussi appliquer les valeurs par défaut : ${defaultsSummary}.`,
      "",
      `Jeu sélectionné : ${selectedGame.label}`,
      "",
      "Répartition actuelle :",
      ...tableLines
    ]
      .filter(Boolean)
      .join("\n"),
    components: [
      buildTablesGameSelectRow(dateKey, activeGames, selectedGame.id, capacityByGame),
      buildTablesGameActionRow(dateKey, selectedGame.id),
      buildBackToConfigRow()
    ]
  };
}

function buildTablesGameSelectRow(
  dateKey: string,
  games: Game[],
  selectedGameId: number,
  capacityByGame: Map<number, number>
): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `mu_tables:game_select:${dateKey}`,
        placeholder: "Choisir un jeu",
        min_values: 1,
        max_values: 1,
        options: games.slice(0, 25).map((game) => {
          const current = capacityByGame.get(game.id) ?? 0;
          const fallback = getDefaultGameTableCount(game);
          const description =
            fallback > 0
              ? `Actuel ${current} table(s), défaut ${fallback}`
              : `Actuel ${current} table(s)`;

          return {
            label: game.label.slice(0, 100),
            value: String(game.id),
            description: description.slice(0, 100),
            default: game.id === selectedGameId
          };
        })
      }
    ]
  } as ReplyComponentRow;
}

function buildTablesGameActionRow(dateKey: string, gameId: number): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: `mu_tables:set_game:${dateKey}:${gameId}`,
        label: "Saisir les tables",
        style: ButtonStyle.Primary
      },
      {
        type: 2,
        custom_id: `mu_tables:apply_defaults:${dateKey}`,
        label: "Appliquer défauts",
        style: ButtonStyle.Secondary
      }
    ]
  } as ReplyComponentRow;
}

async function showTablesGameModal(
  interaction: ButtonInteraction,
  config: AppConfig
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const context = parseTablesGameContext(interaction.customId, "mu_tables:set_game:");
  if (!context) {
    await replyEphemeral(interaction, { content: "❌ Contexte invalide." });
    return;
  }

  const parsedDate = parseTableDateKey(context.dateKey, config.timezone);
  if (!parsedDate) {
    await replyEphemeral(interaction, { content: "❌ Date invalide." });
    return;
  }

  const prisma = getPrisma();
  const [event, game] = await Promise.all([
    prisma.event.findUnique({ where: { date: parsedDate.toDate() } }),
    prisma.game.findUnique({ where: { id: context.gameId } })
  ]);

  if (!game) {
    await replyEphemeral(interaction, { content: "❌ Jeu introuvable." });
    return;
  }

  const current = event ? await getGameTableCapacity(prisma, event, game.id) : 0;
  const defaultValue = current > 0 ? current : getDefaultGameTableCount(game);
  const modal = {
    custom_id: `mu_tables:set_game_modal:${context.dateKey}:${game.id}`,
    title: `Tables ${game.label}`.slice(0, 45),
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "count",
            label: `Tables pour ${game.label}`.slice(0, 45),
            style: TextInputStyle.Short,
            required: true,
            value: String(defaultValue),
            placeholder: String(getDefaultGameTableCount(game))
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function handleTablesGameModal(
  interaction: ModalSubmitInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const context = parseTablesGameContext(interaction.customId, "mu_tables:set_game_modal:");
  const parsedDate = context ? parseTableDateKey(context.dateKey, config.timezone) : null;
  const count = Number(interaction.fields.getTextInputValue("count"));

  if (!context || !parsedDate || !Number.isInteger(count) || count < 0) {
    await replyEphemeral(interaction, { content: "❌ Saisie invalide." });
    return;
  }

  const game = await getPrisma().game.findUnique({ where: { id: context.gameId } });
  if (!game) {
    await replyEphemeral(interaction, { content: "❌ Jeu introuvable." });
    return;
  }

  await handleGameTablesSet(interaction, config, logger, parsedDate, game.code, count);
}

async function handleTablesApplyDefaults(
  interaction: ButtonInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const dateKey = interaction.customId.replace("mu_tables:apply_defaults:", "");
  const parsedDate = parseTableDateKey(dateKey, config.timezone);
  if (!parsedDate) {
    await replyEphemeral(interaction, { content: "❌ Date invalide." });
    return;
  }

  const allocations = await buildDefaultGameTableAllocations(getPrisma());
  if (allocations.length === 0) {
    await replyEphemeral(interaction, {
      content: "❌ Aucun jeu actif n'a de tables par défaut configurées."
    });
    return;
  }

  await handleGameTablesSet(interaction, config, logger, parsedDate, allocations);
}

function parseTablesGameContext(
  customId: string,
  prefix: string
): { dateKey: string; gameId: number } | null {
  const [dateKey, gameIdRaw] = customId.replace(prefix, "").split(":");
  const gameId = Number(gameIdRaw);

  if (!dateKey || !Number.isInteger(gameId)) {
    return null;
  }

  return { dateKey, gameId };
}

async function handleGameTablesSet(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger,
  parsedDate: ReturnType<typeof parseFrenchDate>,
  gameOrAllocations: string | ParsedGameTableAllocations,
  count?: number
): Promise<void> {
  if (!parsedDate) {
    return;
  }

  const prisma = getPrisma();
  let allocations: ParsedGameTableAllocations;

  if (typeof gameOrAllocations === "string") {
    const tableCount = count;
    if (tableCount === undefined || !Number.isInteger(tableCount) || tableCount < 0) {
      await replyEphemeral(interaction, { content: "❌ Nombre de tables invalide." });
      return;
    }

    const game = await resolveGameFromInput(prisma, gameOrAllocations);
    if (!game) {
      const games = await listActiveGames(prisma);
      const gameList = games.length ? games.map((item) => item.label).join(", ") : "Aucun";
      await replyEphemeral(interaction, {
        content: `❌ Jeu invalide. Jeux disponibles : ${gameList}.`
      });
      return;
    }

    allocations = [{ game, tables: tableCount }];
  } else {
    allocations = gameOrAllocations;
  }

  await replyEphemeral(interaction, { content: "⏳ Traitement en cours..." });

  const closure = await getClosureInfo(parsedDate, config.vacationAcademy, config.timezone, logger);
  const eventDate = parsedDate.toDate();
  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(parsedDate, slotDays)) {
    await interaction.editReply({
      content: `❌ La date ne correspond pas à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`,
      components: [buildBackToConfigRow()]
    });
    return;
  }

  const event = await prisma.event.upsert({
    where: { date: eventDate },
    create: {
      date: eventDate,
      tables: 0,
      status: "FERME",
      isVacation: closure.closed
    },
    update: {
      isVacation: closure.closed
    }
  });

  let removedGameIds: number[] = [];

  if (typeof gameOrAllocations === "string") {
    const allocation = allocations[0];
    if (!allocation) {
      await interaction.editReply({ content: "❌ Répartition invalide." });
      return;
    }
    if (allocation.tables <= 0) {
      removedGameIds = [allocation.game.id];
    }

    await upsertGameTableCapacity(prisma, event.id, allocation.game.id, allocation.tables);
  } else {
    const previousCapacities = await prisma.eventGameCapacity.findMany({
      where: { eventId: event.id },
      select: { gameId: true }
    });
    const configuredGameIds = new Set(
      allocations
        .filter((allocation) => allocation.tables > 0)
        .map((allocation) => allocation.game.id)
    );
    removedGameIds = previousCapacities
      .filter((capacity) => !configuredGameIds.has(capacity.gameId))
      .map((capacity) => capacity.gameId);

    await replaceGameTableCapacities(prisma, event.id, allocations);
  }

  const totalTables = await recalculateEventTables(prisma, event.id);
  const isClosed = closure.closed || totalTables <= 0;
  const updatedEvent = await prisma.event.update({
    where: { id: event.id },
    data: {
      tables: isClosed ? 0 : totalTables,
      status: isClosed ? "FERME" : "OUVERT",
      isVacation: closure.closed
    }
  });

  const capacity = await getEventTableCapacity(prisma, updatedEvent);
  const closureText = closure.closed
    ? `⚠️ ${closure.reason ?? "Fermeture"} (${closure.period?.description ?? "Vacances"})`
    : isClosed
      ? "⚠️ Fermé (aucune table configurée)"
      : "✅ Ouvert";

  if (isClosed) {
    await closeEventThreads(interaction.client, logger, updatedEvent.id);
  } else {
    if (removedGameIds.length > 0) {
      await closeEventThreadsForGames(interaction.client, logger, updatedEvent.id, removedGameIds);
    }
    await ensureEventThreads(interaction.client, config, logger, updatedEvent);
  }

  await interaction.editReply({
    content: [
      `📅 ${formatFrenchDate(parsedDate)}`,
      `Tables: ${formatTableCount(capacity.totalTables)}`,
      formatGameTableCapacities(capacity),
      `Statut: ${closureText}`
    ].join("\n"),
    components: [buildTablesRow(), buildBackToConfigRow()]
  });
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
  const payload = await buildTablesShowPayload(config, logger, parsedDate);
  await interaction.editReply(toEditPayload(payload));
}

async function buildTablesShowPayload(
  config: AppConfig,
  logger: Logger,
  parsedDate: dayjs.Dayjs
): Promise<ReplyPayload> {
  const closure = await getClosureInfo(parsedDate, config.vacationAcademy, config.timezone, logger);
  const eventDate = parsedDate.toDate();
  const prisma = getPrisma();
  const slotDays = await getSlotDays(prisma);

  if (!isSlotDay(parsedDate, slotDays)) {
    return {
      content: `❌ La date ne correspond pas à un jour de créneau. Jours actifs : ${formatSlotDays(
        slotDays
      )}.`,
      components: [buildBackToConfigRow()]
    };
  }

  const event = await prisma.event.findUnique({ where: { date: eventDate } });
  const closureText = closure.closed
    ? `⚠️ ${closure.reason ?? "Fermeture"} (${closure.period?.description ?? "Vacances"})`
    : "✅ Ouvert";

  if (!event) {
    return {
      content: [
        `📅 ${formatFrenchDate(parsedDate)}`,
        "Créneau: ❌ Non créé",
        `Statut: ${closureText}`
      ].join("\n"),
      components: [buildTablesRow(), buildBackToConfigRow()]
    };
  }

  const statusText =
    event.status === "FERME" ? (event.isVacation ? closureText : "⚠️ Fermé (annulé)") : "✅ Ouvert";
  const capacity = await getEventTableCapacity(prisma, event);

  return {
    content: [
      `📅 ${formatFrenchDate(parsedDate)}`,
      `Tables: ${formatTableCount(capacity.totalTables)}`,
      formatGameTableCapacities(capacity),
      `Statut: ${statusText}`
    ].join("\n"),
    components: [buildTablesRow(), buildBackToConfigRow()]
  };
}

type ThreadAdminContext = {
  eventId: number;
  gameId: number;
};

function parseThreadAdminContext(customId: string, prefix: string): ThreadAdminContext | null {
  const [eventIdRaw, gameIdRaw] = customId.replace(prefix, "").split(":");
  const eventId = Number(eventIdRaw);
  const gameId = Number(gameIdRaw);

  if (!Number.isInteger(eventId) || !Number.isInteger(gameId)) {
    return null;
  }

  return { eventId, gameId };
}

async function buildThreadStatusContent(
  config: AppConfig,
  context: ThreadAdminContext
): Promise<string | null> {
  const prisma = getPrisma();
  const [event, game] = await Promise.all([
    prisma.event.findUnique({ where: { id: context.eventId } }),
    prisma.game.findUnique({ where: { id: context.gameId } })
  ]);

  if (!event || !game) {
    return null;
  }

  const [capacity, validatedCount, pendingCount, refusedCount, cancelledCount] = await Promise.all([
    getGameTableCapacity(prisma, event, game.id),
    prisma.match.count({
      where: { eventId: event.id, gameId: game.id, status: MatchStatus.VALIDE }
    }),
    prisma.match.count({
      where: { eventId: event.id, gameId: game.id, status: MatchStatus.EN_ATTENTE }
    }),
    prisma.match.count({
      where: { eventId: event.id, gameId: game.id, status: MatchStatus.REFUSE }
    }),
    prisma.match.count({
      where: { eventId: event.id, gameId: game.id, status: MatchStatus.ANNULE }
    })
  ]);
  const remainingAfterValidated = Math.max(capacity - validatedCount, 0);
  const validatableNow = Math.min(pendingCount, remainingAfterValidated);

  return [
    `📅 ${formatFrenchDate(dayjs(event.date).tz(config.timezone))}`,
    `Jeu : ${game.label}`,
    `Statut : ${event.status === "OUVERT" ? "✅ Ouvert" : "⛔ Fermé"}`,
    `Tables ${game.label} : ${formatTableCount(capacity)}`,
    `Tables restantes après validations : ${formatTableCount(remainingAfterValidated)}`,
    "",
    `Parties validées : ${validatedCount}`,
    `Parties en attente : ${pendingCount}`,
    `Validables maintenant : ${validatableNow}`,
    `Parties refusées : ${refusedCount}`,
    `Parties annulées : ${cancelledCount}`
  ].join("\n");
}

async function handleThreadStatus(
  interaction: ButtonInteraction,
  config: AppConfig
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const context = parseThreadAdminContext(interaction.customId, "mu_thread:status:");
  if (!context) {
    await replyEphemeral(interaction, { content: "❌ Contexte du fil invalide." });
    return;
  }

  const content = await buildThreadStatusContent(config, context);
  await replyEphemeral(interaction, {
    content: content ?? "❌ Soirée ou jeu introuvable."
  });
}

async function showThreadTablesModal(
  interaction: ButtonInteraction,
  config: AppConfig
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const context = parseThreadAdminContext(interaction.customId, "mu_thread:tables:");
  if (!context) {
    await replyEphemeral(interaction, { content: "❌ Contexte du fil invalide." });
    return;
  }

  const prisma = getPrisma();
  const [event, game] = await Promise.all([
    prisma.event.findUnique({ where: { id: context.eventId } }),
    prisma.game.findUnique({ where: { id: context.gameId } })
  ]);

  if (!event || !game) {
    await replyEphemeral(interaction, { content: "❌ Soirée ou jeu introuvable." });
    return;
  }

  const capacity = await getGameTableCapacity(prisma, event, game.id);
  const modal = {
    custom_id: `mu_thread:tables_modal:${event.id}:${game.id}`,
    title: `Tables ${game.label}`.slice(0, 45),
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "count",
            label: `Tables pour ${game.label}`.slice(0, 45),
            style: TextInputStyle.Short,
            required: true,
            value: String(capacity),
            placeholder: "5"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function handleThreadTablesModal(
  interaction: ModalSubmitInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const context = parseThreadAdminContext(interaction.customId, "mu_thread:tables_modal:");
  if (!context) {
    await replyEphemeral(interaction, { content: "❌ Contexte du fil invalide." });
    return;
  }

  const count = Number(interaction.fields.getTextInputValue("count"));
  if (!Number.isInteger(count) || count < 0) {
    await replyEphemeral(interaction, { content: "❌ Nombre de tables invalide." });
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Mise à jour des tables du fil..." });

  const prisma = getPrisma();
  const [event, game] = await Promise.all([
    prisma.event.findUnique({ where: { id: context.eventId } }),
    prisma.game.findUnique({ where: { id: context.gameId } })
  ]);

  if (!event || !game) {
    await interaction.editReply({ content: "❌ Soirée ou jeu introuvable." });
    return;
  }

  const eventDate = dayjs(event.date).tz(config.timezone);
  const closure = await getClosureInfo(eventDate, config.vacationAcademy, config.timezone, logger);

  await upsertGameTableCapacity(prisma, event.id, game.id, count);
  const totalTables = await recalculateEventTables(prisma, event.id);
  const isClosed = closure.closed || totalTables <= 0;
  const updatedEvent = await prisma.event.update({
    where: { id: event.id },
    data: {
      tables: isClosed ? 0 : totalTables,
      status: isClosed ? "FERME" : "OUVERT",
      isVacation: closure.closed
    }
  });

  if (closure.closed || totalTables <= 0) {
    await closeEventThreads(interaction.client, logger, updatedEvent.id);
  } else {
    if (count <= 0) {
      await closeEventThreadsForGames(interaction.client, logger, updatedEvent.id, [game.id]);
    }
    await ensureEventThreads(interaction.client, config, logger, updatedEvent);
  }

  const content = await buildThreadStatusContent(config, context);
  await interaction.editReply({
    content: [`✅ Tables ${game.label} mises à jour : ${formatTableCount(count)}.`, "", content]
      .filter(Boolean)
      .join("\n")
  });
}

async function handleThreadValidatePossible(
  interaction: ButtonInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  if (!(await ensureAdmin(interaction, config))) {
    return;
  }

  const context = parseThreadAdminContext(interaction.customId, "mu_thread:validate:");
  if (!context) {
    await replyEphemeral(interaction, { content: "❌ Contexte du fil invalide." });
    return;
  }

  await replyEphemeral(interaction, { content: "⏳ Validation des parties possibles..." });

  const prisma = getPrisma();
  const [event, game] = await Promise.all([
    prisma.event.findUnique({ where: { id: context.eventId } }),
    prisma.game.findUnique({ where: { id: context.gameId } })
  ]);

  if (!event || !game) {
    await interaction.editReply({ content: "❌ Soirée ou jeu introuvable." });
    return;
  }

  if (event.status === "FERME") {
    await interaction.editReply({ content: "⛔ Soirée fermée : validation impossible." });
    return;
  }

  const capacity = await getGameTableCapacity(prisma, event, game.id);
  const validatedCount = await prisma.match.count({
    where: { eventId: event.id, gameId: game.id, status: MatchStatus.VALIDE }
  });
  const remaining = Math.max(capacity - validatedCount, 0);

  if (remaining <= 0) {
    await interaction.editReply({
      content: `⛔ Aucune table disponible pour ${game.label}.`
    });
    return;
  }

  const pending = await prisma.match.findMany({
    where: { eventId: event.id, gameId: game.id, status: MatchStatus.EN_ATTENTE },
    include: { player1: true, player2: true, event: true, game: true },
    orderBy: { createdAt: "asc" }
  });
  const selected = pending.slice(0, remaining);

  if (selected.length === 0) {
    await interaction.editReply({
      content: `ℹ️ Aucune partie en attente pour ${game.label}.`
    });
    return;
  }

  await prisma.match.updateMany({
    where: { id: { in: selected.map((match) => match.id) } },
    data: { status: MatchStatus.VALIDE }
  });

  await Promise.all(
    selected.map(async (match) => {
      const summary = buildMatchSummary(match, config);
      await notifyMatchStatus(
        interaction,
        config,
        logger,
        match,
        `✅ Partie validée depuis le fil : ${summary}`,
        `✅ Votre partie est validée : ${summary}`
      );
    })
  );

  const content = await buildThreadStatusContent(config, context);
  await interaction.editReply({
    content: [
      `✅ ${selected.length} partie(s) validée(s) pour ${game.label}.`,
      pending.length > selected.length
        ? `ℹ️ ${pending.length - selected.length} partie(s) restent en attente faute de table.`
        : null,
      "",
      content
    ]
      .filter(Boolean)
      .join("\n")
  });
}

async function handleGenerateSlots(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  await replyEphemeral(interaction, { content: "⏳ Génération des créneaux en cours..." });

  const result = await generateCurrentMonthSlots(interaction.client, config, logger);

  await interaction.editReply({
    content: buildMonthlySlotGenerationSummary(result),
    components: [buildSlotsRow(), buildBackToConfigRow()]
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
      content: `ℹ️ Aucun créneau trouvé pour le ${formatFrenchDate(date)}.`,
      components: [buildBackToConfigRow()]
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
      content: `ℹ️ Aucun créneau trouvé pour ${now.format("MM/YYYY")}.`,
      components: [buildBackToConfigRow()]
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
    content: `✅ Jours des créneaux mis à jour : ${formatSlotDays(parsedDays)}`,
    components: [buildBackToConfigRow()]
  });
}

async function handleAutomationSettingsUpdate(
  interaction: ModalSubmitInteraction,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  const settings = parseAutomationSettingsFromModal(interaction);

  if (!settings) {
    await replyEphemeral(interaction, {
      content: [
        "❌ Paramètres invalides.",
        "- Jour : nom français ou numéro 0-6 (0 = dimanche)",
        "- Génération mensuelle : `dimanche, 1, 09:00`",
        "- Récap parties : `mercredi, 21:00, 7`",
        "- Notifications finales : `vendredi, 17:00`",
        "- Backup : `samedi, 23:00, 30`",
        "- Heure : HH:MM ou HHhMM",
        "- Fenêtre : 1 à 30 jours ; rétention backup : 1 à 365 jours"
      ].join("\n")
    });
    return;
  }

  await saveAutomationSettings(getPrisma(), settings);
  refreshSchedulers(interaction.client, config, logger);

  const payload = await buildConfigCategoryResponse("automations", config, logger);
  await replyEphemeral(interaction, {
    content: ["✅ Automatisations mises à jour.", "", payload.content].join("\n"),
    components: payload.components
  });
}

function parseAutomationSettingsFromModal(
  interaction: ModalSubmitInteraction
): AutomationSettings | null {
  const monthly = parseMonthlyScheduleInput(
    interaction.fields.getTextInputValue("monthly_schedule")
  );
  const review = parseReviewScheduleInput(interaction.fields.getTextInputValue("review_schedule"));
  const finalNotification = parseWeekdayTimeInput(
    interaction.fields.getTextInputValue("final_notification_schedule")
  );
  const backup = parseBackupScheduleInput(interaction.fields.getTextInputValue("backup_schedule"));

  if (!monthly || !review || !finalNotification || !backup) {
    return null;
  }

  return {
    monthlyWeekday: monthly.weekday,
    monthlyWeek: monthly.week,
    monthlyTime: monthly.time,
    weeklyReviewWeekday: review.weekday,
    weeklyReviewTime: review.time,
    weeklyReviewLookaheadDays: review.lookaheadDays,
    finalNotificationWeekday: finalNotification.weekday,
    finalNotificationTime: finalNotification.time,
    backupWeekday: backup.weekday,
    backupTime: backup.time,
    backupRetentionDays: backup.retentionDays
  };
}

function splitScheduleInput(input: string, expectedParts: number): string[] | null {
  const parts = input
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length === expectedParts ? parts : null;
}

function parseMonthlyScheduleInput(
  input: string
): { weekday: number; week: number; time: string } | null {
  const parts = splitScheduleInput(input, 3);
  if (!parts) {
    return null;
  }

  const weekday = parseWeekdayInput(parts[0]);
  const week = parseWeekInput(parts[1]);
  const time = parseTimeInput(parts[2]);

  if (weekday === null || week === null || !time) {
    return null;
  }

  return { weekday, week, time };
}

function parseReviewScheduleInput(
  input: string
): { weekday: number; time: string; lookaheadDays: number } | null {
  const parts = splitScheduleInput(input, 3);
  if (!parts) {
    return null;
  }

  const weekday = parseWeekdayInput(parts[0]);
  const time = parseTimeInput(parts[1]);
  const lookaheadDays = parseLookaheadInput(parts[2]);

  if (weekday === null || !time || lookaheadDays === null) {
    return null;
  }

  return { weekday, time, lookaheadDays };
}

function parseWeekdayTimeInput(input: string): { weekday: number; time: string } | null {
  const parts = splitScheduleInput(input, 2);
  if (!parts) {
    return null;
  }

  const weekday = parseWeekdayInput(parts[0]);
  const time = parseTimeInput(parts[1]);

  if (weekday === null || !time) {
    return null;
  }

  return { weekday, time };
}

function parseBackupScheduleInput(
  input: string
): { weekday: number; time: string; retentionDays: number } | null {
  const parts = splitScheduleInput(input, 3);
  if (!parts) {
    return null;
  }

  const weekday = parseWeekdayInput(parts[0]);
  const time = parseTimeInput(parts[1]);
  const retentionDays = parseRetentionDaysInput(parts[2]);

  if (weekday === null || !time || retentionDays === null) {
    return null;
  }

  return { weekday, time, retentionDays };
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
      content: `ℹ️ Aucun créneau trouvé pour le ${formatFrenchDate(date)}.`,
      components: [buildBackToConfigRow()]
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
    interaction.client,
    logger,
    threads.map((thread) => thread.threadId)
  );
  await interaction.editReply({
    content: `🗑️ Créneau du ${formatFrenchDate(date)} supprimé (parties et notifications incluses).`,
    components: [buildBackToConfigRow()]
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
      content: `ℹ️ Aucun créneau trouvé pour ${now.format("MM/YYYY")}.`,
      components: [buildBackToConfigRow()]
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
    interaction.client,
    logger,
    threads.map((thread) => thread.threadId)
  );
  await interaction.editReply({
    content: `🗑️ Créneaux du mois ${now.format("MM/YYYY")} supprimés (parties et notifications incluses).`,
    components: [buildBackToConfigRow()]
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

  if (!(await ensureBotPlayersAllowed(interaction, config, [input.player1Id, input.player2Id]))) {
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

  if (event.status === "FERME") {
    await interaction.editReply({
      content: "⛔ Soirée fermée : les réservations sont impossibles."
    });
    return;
  }

  if (event.tables <= 0) {
    await interaction.editReply({
      content:
        "⏳ Les tables ne sont pas encore configurées pour cette soirée. Les réservations ouvriront dès qu'un admin aura défini les tables."
    });
    return;
  }

  const gameCapacity = await getGameTableCapacity(prisma, event, game.id);
  if (gameCapacity <= 0) {
    await interaction.editReply({
      content: `⏳ Aucune table n'est configurée pour ${game.label} sur cette soirée.`
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
      status: { in: BLOCKING_MATCH_STATUSES },
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
  const automationSettings = await getAutomationSettings(prisma);
  await interaction.editReply({
    content: [
      `✅ Partie enregistrée : <@${input.player1Id}> vs <@${input.player2Id}> (${gameLabel}).`,
      buildPendingValidationNotice(automationSettings)
    ].join("\n"),
    components: [buildMatchActionRow(match.id)]
  });

  await notifyMatchCreated(
    interaction,
    logger,
    match.id,
    [input.player1Id, input.player2Id],
    gameLabel,
    automationSettings
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
      await refreshed.edit({ content: "💡 Les 60 secondes sont écoulées !", components: [] });
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
        label: "Définir une soirée",
        style: ButtonStyle.Primary
      },
      {
        type: 2,
        custom_id: "mu_tables:show",
        label: "Voir une soirée",
        style: ButtonStyle.Secondary
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

function buildBackToConfigRow(): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_config:show",
        label: "Retour au menu",
        style: ButtonStyle.Secondary
      }
    ]
  } as ReplyComponentRow;
}

function buildBackToHomeRow(): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_config:home",
        label: "Retour à l'accueil",
        style: ButtonStyle.Secondary
      }
    ]
  } as ReplyComponentRow;
}

type ConfigCategory = "home" | "slots" | "games" | "matches" | "notifications" | "automations";

const CONFIG_CATEGORIES: { value: ConfigCategory; label: string; description: string }[] = [
  { value: "home", label: "Accueil", description: "Vue d'ensemble" },
  { value: "slots", label: "Créneaux", description: "Gérer les créneaux" },
  { value: "games", label: "Jeux & tables", description: "Gérer jeux, canaux et tables" },
  { value: "matches", label: "Parties", description: "Gérer les parties" },
  { value: "notifications", label: "Notifications", description: "Gérer les mentions" },
  { value: "automations", label: "Automatisations", description: "Planifier les actions" }
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

function buildLanguageRow(current: BotLanguage): ReplyComponentRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_lang:set:fr",
        label: "Français",
        style: ButtonStyle.Primary,
        disabled: current === "fr"
      },
      {
        type: 2,
        custom_id: "mu_lang:set:en",
        label: "English",
        style: ButtonStyle.Secondary,
        disabled: current === "en"
      }
    ]
  } as ReplyComponentRow;
}

function buildSlotsCategoryRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_slots:generate_current_month",
          label: "Générer le mois",
          style: ButtonStyle.Success
        }
      ]
    },
    {
      type: 1,
      components: [
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
        },
        {
          type: 2,
          custom_id: "mu_slots:configure_days",
          label: "Configurer les jours",
          style: ButtonStyle.Primary
        }
      ]
    }
  ];
}

function buildGamesCategoryRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_games:configure",
          label: "Configurer jeux & canaux",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_games:add",
          label: "Ajouter un jeu",
          style: ButtonStyle.Secondary
        }
      ]
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_tables:set",
          label: "Définir les tables d'une soirée",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_tables:show",
          label: "Voir les tables d'une soirée",
          style: ButtonStyle.Secondary
        }
      ]
    },
    buildBackToHomeRow()
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

function buildNotificationsCategoryRows(settings: { mentionInThread: boolean }) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_notifications:mention_thread:on",
          label: "Activer mentions fil",
          style: ButtonStyle.Success,
          disabled: settings.mentionInThread
        },
        {
          type: 2,
          custom_id: "mu_notifications:mention_thread:off",
          label: "Désactiver mentions fil",
          style: ButtonStyle.Secondary,
          disabled: !settings.mentionInThread
        }
      ]
    }
  ];
}

function buildAutomationsCategoryRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_automation:configure",
          label: "Configurer",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_automation:reset_defaults",
          label: "Valeurs par défaut",
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

type BotLanguage = "fr" | "en";
const LANGUAGE_SETTING = "bot_language";

function normalizeLanguage(input?: string | null): BotLanguage {
  if (input === "en") {
    return "en";
  }
  return "fr";
}

function formatLanguageLabel(language: BotLanguage): string {
  return language === "en" ? "English" : "Français";
}

async function getBotLanguage(prisma: ReturnType<typeof getPrisma>): Promise<BotLanguage> {
  const setting = await prisma.setting.findUnique({ where: { key: LANGUAGE_SETTING } });
  return normalizeLanguage(setting?.value);
}

async function setBotLanguage(
  prisma: ReturnType<typeof getPrisma>,
  language: BotLanguage
): Promise<void> {
  await prisma.setting.upsert({
    where: { key: LANGUAGE_SETTING },
    update: { value: language },
    create: { key: LANGUAGE_SETTING, value: language }
  });
}

function formatGameStatus(game: Game): string {
  return game.active ? "actif" : "désactivé";
}

function formatGameDefaultTables(game: Game): string {
  return formatTableCount(getDefaultGameTableCount(game));
}

function formatDefaultGameTableSummary(games: Game[]): string {
  const defaults = games
    .map((game) => ({ game, tables: getDefaultGameTableCount(game) }))
    .filter((entry) => entry.tables > 0);

  if (defaults.length === 0) {
    return "aucune valeur configurée";
  }

  return defaults.map((entry) => `${entry.game.label} = ${entry.tables}`).join(", ");
}

function formatGameLine(game: Game): string {
  return `• ${game.label} (${game.code}) — <#${game.channelId}> — défaut ${formatGameDefaultTables(
    game
  )} — ${formatGameStatus(game)}`;
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
          description: `${game.code} · défaut ${getDefaultGameTableCount(game)} · ${formatGameStatus(
            game
          )}`,
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
      {
        type: 2,
        custom_id: `mu_games:default_tables:${game.id}`,
        label: "Tables par défaut",
        style: ButtonStyle.Secondary
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
        "**Jeux & tables**",
        state.notice,
        "Aucun jeu configuré pour le moment.",
        "Ajoute un jeu et associe-lui un canal."
      ]
        .filter(Boolean)
        .join("\n"),
      components: [buildGamesEmptyRow(), buildBackToHomeRow()]
    };
  }

  const selectedGame =
    orderedGames.find((game) => game.id === state.gameId) ??
    orderedGames.find((game) => game.active) ??
    orderedGames[0];
  const selectedChannelId = state.channelId ?? selectedGame.channelId;

  return {
    content: [
      "**Jeux & tables**",
      "Sélectionne un jeu puis le canal où créer les fils de discussion.",
      "Chaque jeu doit avoir un canal associé.",
      state.notice,
      "",
      `Jeu sélectionné : ${selectedGame.label} (${selectedGame.code})`,
      `Canal sélectionné : <#${selectedChannelId}>`,
      `Tables par défaut : ${formatGameDefaultTables(selectedGame)}`,
      "",
      "Jeux configurés :",
      orderedGames.map(formatGameLine).join("\n")
    ]
      .filter(Boolean)
      .join("\n"),
    components: [
      buildGamesSelectRow(orderedGames, selectedGame.id),
      buildGamesChannelRow(selectedGame.id, selectedChannelId),
      buildGamesActionRow(selectedGame, selectedChannelId),
      buildBackToHomeRow()
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

  return games
    .map((game) => `${game.label} (${formatGameDefaultTables(game)} par défaut)`)
    .join(", ");
}

async function buildConfigMenuContent(config: AppConfig): Promise<string> {
  const prisma = getPrisma();
  const slotDays = await getSlotDays(prisma);
  const games = await listActiveGames(prisma);
  const language = await getBotLanguage(prisma);
  const appSettings = await getAppSettings(prisma, config);
  const automationSettings = await getAutomationSettings(prisma);
  const now = dayjs().tz(config.timezone);
  const offset = now.format("Z");
  const slotsTable = await buildRegisteredSlotsTable(config);

  const baseLines = [
    "Paramètres de base :",
    `Langue : ${formatLanguageLabel(language)}`,
    `Fuseau horaire : (UTC${offset}) ${config.timezone}`,
    `Jours des créneaux : ${formatSlotDays(slotDays)}`,
    `Jeux actifs : ${formatGamesInline(games)}`,
    `Mentions dans les fils : ${formatMentionInThread(appSettings.mentionInThread)}`,
    ...formatAutomationSettings(automationSettings)
  ];

  const baseQuote = baseLines.map((line) => `> ${line}`).join("\n");

  return [
    "**Accueil**",
    "Bienvenue dans la commande de configuration de @Munitorum.",
    "Choisis une catégorie ci-dessous ou règle la langue du bot.",
    "",
    baseQuote,
    "",
    `Créneaux enregistrés (${formatFrenchMonthYear(now)})`,
    slotsTable
  ].join("\n");
}

async function buildConfigCategoryResponse(
  category: ConfigCategory,
  config: AppConfig,
  logger: Logger
): Promise<ReplyPayload> {
  if (category === "home") {
    const prisma = getPrisma();
    const language = await getBotLanguage(prisma);
    const content = await buildConfigMenuContent(config);

    return {
      content,
      components: [buildConfigMenuSelect("home"), buildLanguageRow(language)]
    };
  }

  if (category === "slots") {
    const prisma = getPrisma();
    const slotDays = await getSlotDays(prisma);
    const slotsOverview = await buildMonthSlotsOverview(config, logger, slotDays);

    return {
      content: [
        buildConfigCategoryContent("**Créneaux**"),
        `Jours actifs : ${formatSlotDays(slotDays)}`,
        "",
        `Créneaux du mois (${formatFrenchMonthYear(dayjs().tz(config.timezone))})`,
        slotsOverview
      ].join("\n"),
      components: [buildConfigMenuSelect("slots"), ...buildSlotsCategoryRows()]
    };
  }

  if (category === "games") {
    const games = await listAllGames(getPrisma());
    const orderedGames = [...games].sort(
      (a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, "fr")
    );
    const gameLines =
      orderedGames.length > 0
        ? orderedGames.map(formatGameLine).join("\n")
        : "Aucun jeu configuré.";

    return {
      content: [
        buildConfigCategoryContent("**Jeux & tables**"),
        "Associez chaque jeu à son canal de fils, réglez ses tables par défaut, puis ajustez les tables des soirées créées.",
        "",
        `Jeux configurés (${orderedGames.length}) :`,
        gameLines
      ].join("\n"),
      components: [buildConfigMenuSelect("games"), ...buildGamesCategoryRows()]
    };
  }

  if (category === "matches") {
    return {
      content: buildConfigCategoryContent("**Parties**"),
      components: [buildConfigMenuSelect("matches"), ...buildMatchesCategoryRows()]
    };
  }

  if (category === "notifications") {
    const appSettings = await getAppSettings(getPrisma(), config);

    return {
      content: [
        buildConfigCategoryContent("**Notifications**"),
        "",
        `Mentions dans les fils : ${formatMentionInThread(appSettings.mentionInThread)}`,
        "Les joueurs reçoivent toujours un DM quand une partie est validée.",
        "Cette option ajoute ou retire le message de validation directement dans le fil de soirée."
      ].join("\n"),
      components: [
        buildConfigMenuSelect("notifications"),
        ...buildNotificationsCategoryRows(appSettings)
      ]
    };
  }

  const automationSettings = await getAutomationSettings(getPrisma());
  return {
    content: [
      buildConfigCategoryContent("**Automatisations**"),
      "",
      ...formatAutomationSettings(automationSettings)
    ].join("\n"),
    components: [buildConfigMenuSelect("automations"), ...buildAutomationsCategoryRows()]
  };
}

async function buildRegisteredSlotsTable(config: AppConfig): Promise<string> {
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
    },
    orderBy: { date: "asc" }
  });

  if (events.length === 0) {
    return "Aucun créneau enregistré.";
  }

  const lines = await Promise.all(
    events.map(async (event) => {
      const date = dayjs(event.date).tz(config.timezone);
      const capacity = await getEventTableCapacity(prisma, event);
      return `• ${formatFrenchDate(date)} — ${formatEventStatus(event, capacity)}`;
    })
  );

  return lines.join("\n");
}

function formatEventStatus(
  event: { status: string; tables: number; isVacation: boolean },
  capacity?: Awaited<ReturnType<typeof getEventTableCapacity>>
): string {
  if (event.status === "FERME") {
    return event.isVacation ? "💀 Fermé (vacances)" : "🔴 Fermé";
  }

  if (event.tables <= 0) {
    return "🟡 À configurer — aucune table";
  }

  const allocation = capacity?.usesGameCapacities
    ? ` — ${capacity.gameTables.map((entry) => `${entry.game.label}: ${entry.tables}`).join(", ")}`
    : "";

  return `🟢 Disponible — ${formatTableCount(event.tables)}${allocation}`;
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

      let status = "⚪ Non créé";
      if (closure?.closed) {
        status = "💀 Fermé (vacances)";
      } else if (event) {
        status = formatEventStatus(event);
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

async function ensureBotPlayersAllowed(
  interaction: EphemeralInteraction,
  config: AppConfig,
  playerIds: string[]
): Promise<boolean> {
  if (config.allowBotPlayers) {
    return true;
  }

  const users = await Promise.all(
    playerIds.map((playerId) => interaction.client.users.fetch(playerId).catch(() => null))
  );

  if (!users.some((user) => user?.bot)) {
    return true;
  }

  await replyEphemeral(interaction, {
    content:
      "⛔ Les bots ne peuvent pas être joueurs. Active `ALLOW_BOT_PLAYERS=true` en environnement de test."
  });
  return false;
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

  const gameCapacity = await getGameTableCapacity(prisma, match.event, match.gameId);
  const validatedCount = await prisma.match.count({
    where: {
      eventId: match.eventId,
      gameId: match.gameId,
      status: MatchStatus.VALIDE
    }
  });
  if (gameCapacity <= 0 || validatedCount >= gameCapacity) {
    await interaction.editReply({
      content: `⛔ Aucune table disponible pour ${match.game.label} sur cette soirée.`
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

  const autoValidation = await autoValidatePendingMatchesForGame(
    interaction.client,
    config,
    logger,
    match.eventId,
    match.gameId
  );
  const autoValidationLines =
    autoValidation.autoValidated > 0
      ? [
          "",
          `✅ ${autoValidation.autoValidated} partie(s) en attente auto-validée(s).`,
          `Tables restantes : ${autoValidation.remainingTables}.`
        ]
      : [];

  await interaction.editReply({
    content: ["⚠️ Partie annulée.", ...autoValidationLines].join("\n")
  });
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

    const isAdmin = Boolean(interaction.member && isAdminMember(interaction.member, config));

    if (!canUseMatchAction("cancel", isAdmin, interaction.user.id, match)) {
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
  const isAdmin = Boolean(interaction.member && isAdminMember(interaction.member, config));

  if (!canUseMatchAction("cancel", isAdmin, interaction.user.id, match)) {
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

  const appSettings = await getAppSettings(prisma, config);

  if (appSettings.mentionInThread && interaction.channel?.isTextBased()) {
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
  gameLabel: string,
  automationSettings: AutomationSettings
): Promise<void> {
  const prisma = getPrisma();
  const dmContent = buildPendingValidationDm(gameLabel, automationSettings);

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

async function showAutomationSettingsModal(
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

  const settings = await getAutomationSettings(getPrisma());
  const modal = {
    custom_id: "mu_automation:configure_modal",
    title: "Configurer les automatisations",
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "monthly_schedule",
            label: "Mensuel : jour, semaine, heure",
            style: TextInputStyle.Short,
            required: true,
            value: `${formatWeekday(settings.monthlyWeekday)}, ${settings.monthlyWeek}, ${
              settings.monthlyTime
            }`,
            placeholder: "dimanche, 1, 09:00"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "review_schedule",
            label: "Récap : jour, heure, fenêtre",
            style: TextInputStyle.Short,
            required: true,
            value: `${formatWeekday(settings.weeklyReviewWeekday)}, ${settings.weeklyReviewTime}, ${
              settings.weeklyReviewLookaheadDays
            }`,
            placeholder: "mercredi, 21:00, 7"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "final_notification_schedule",
            label: "Notifications finales : jour, heure",
            style: TextInputStyle.Short,
            required: true,
            value: `${formatWeekday(settings.finalNotificationWeekday)}, ${
              settings.finalNotificationTime
            }`,
            placeholder: "vendredi, 17:00"
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "backup_schedule",
            label: "Backup : jour, heure, rétention",
            style: TextInputStyle.Short,
            required: true,
            value: `${formatWeekday(settings.backupWeekday)}, ${settings.backupTime}, ${
              settings.backupRetentionDays
            }`,
            placeholder: "samedi, 23:00, 30"
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
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "defaultTables",
            label: "Tables par défaut",
            style: TextInputStyle.Short,
            required: false,
            placeholder: "0, 5 pour W40K, 2 pour AoS"
          }
        ]
      }
    ]
  };

  await interaction.showModal(modal as ModalPayload);
}

async function showGameDefaultTablesModal(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, { content: "Commande réservée au serveur." });
    return;
  }

  const gameId = Number(interaction.customId.replace("mu_games:default_tables:", ""));
  if (!Number.isInteger(gameId)) {
    await replyEphemeral(interaction, { content: "❌ Jeu invalide." });
    return;
  }

  const game = await getPrisma().game.findUnique({ where: { id: gameId } });
  if (!game) {
    await replyEphemeral(interaction, { content: "❌ Jeu introuvable." });
    return;
  }

  const modal = {
    custom_id: `mu_games:default_tables_modal:${game.id}`,
    title: `Défaut ${game.label}`.slice(0, 45),
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "count",
            label: `Tables par défaut`.slice(0, 45),
            style: TextInputStyle.Short,
            required: true,
            value: String(getDefaultGameTableCount(game)),
            placeholder: "0"
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
