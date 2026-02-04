import { GameSystem, MatchStatus, NotificationType } from "@prisma/client";
import dayjs from "dayjs";
import { ButtonStyle, MessageFlags, TextInputStyle } from "discord.js";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction
} from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import { getClosureInfo } from "../services/vacations";
import { formatFrenchDate, isFriday, parseFrenchDate } from "../utils/dates";

import { isAdminMember } from "./admin";

type EphemeralInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction;

type ReplyPayload = {
  content: string;
  components?: unknown[];
};

type ModalPayload = Parameters<ButtonInteraction["showModal"]>[0];
const GAME_LABELS: Record<GameSystem, string> = {
  [GameSystem.W40K]: "40k",
  [GameSystem.AOS]: "AoS",
  [GameSystem.KILLTEAM]: "Kill Team",
  [GameSystem.AUTRE]: "Autre"
};

function formatConfig(config: AppConfig): string {
  return [
    "```",
    `guildId: ${config.discordGuildId}`,
    `channelId: ${config.discordChannelId}`,
    `timezone: ${config.timezone}`,
    `mentionInThread: ${config.mentionInThread}`,
    "```"
  ].join("\n");
}

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
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "show") {
      await handleConfigShow(interaction, config);
      return;
    }

    logger.warn({ subcommand }, "Unknown config subcommand");
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

    if (!isFriday(parsedDate)) {
      await replyEphemeral(interaction, { content: "❌ La date doit être un vendredi." });
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

  if (interaction.commandName === "mu_panel") {
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

    const panel = await buildPanel(interaction, config, logger);
    await replyEphemeral(interaction, panel);
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
    await handleConfigShow(interaction, config);
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

  if (interaction.customId === "mu_slots:confirm_delete_month") {
    await handleDeleteMonthConfirm(interaction, config);
    return;
  }

  if (interaction.customId.startsWith("mu_slots:confirm_delete_date:")) {
    const dateStr = interaction.customId.replace("mu_slots:confirm_delete_date:", "");
    const parsedDate = dayjs.tz(dateStr, "YYYY-MM-DD", config.timezone).startOf("day");
    if (!parsedDate.isValid()) {
      await replyEphemeral(interaction, { content: "❌ Date invalide." });
      return;
    }
    await handleDeleteDateConfirm(interaction, config, parsedDate);
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

    if (!isFriday(parsedDate)) {
      await replyEphemeral(interaction, { content: "❌ La date doit être un vendredi." });
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

    if (!isFriday(parsedDate)) {
      await replyEphemeral(interaction, { content: "❌ La date doit être un vendredi." });
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

  if (interaction.customId.startsWith("mu_match:refuse_modal:")) {
    const matchId = Number(interaction.customId.replace("mu_match:refuse_modal:", ""));
    const reason = interaction.fields.getTextInputValue("reason").trim();
    await handleMatchRefuse(interaction, config, logger, matchId, reason);
    return;
  }

  if (interaction.customId.startsWith("mu_match:cancel_modal:")) {
    const matchId = Number(interaction.customId.replace("mu_match:cancel_modal:", ""));
    const reason = interaction.fields.getTextInputValue("reason").trim();
    await handleMatchCancel(interaction, config, logger, matchId, reason);
    return;
  }
}

async function handleHealth(interaction: EphemeralInteraction): Promise<void> {
  await replyEphemeral(interaction, {
    content: "✅ Munitorum opérationnel.",
    components: [buildHealthRow()]
  });
}

async function handleConfigShow(
  interaction: EphemeralInteraction,
  config: AppConfig
): Promise<void> {
  await replyEphemeral(interaction, {
    content: formatConfig(config),
    components: [buildConfigRow()]
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
  const tables = closure.closed ? 0 : count;

  await prisma.event.upsert({
    where: { date: eventDate },
    create: {
      date: eventDate,
      tables,
      status: closure.closed ? "FERME" : "OUVERT",
      isVacation: closure.closed
    },
    update: {
      tables,
      status: closure.closed ? "FERME" : "OUVERT",
      isVacation: closure.closed
    }
  });

  const closureText = closure.closed
    ? `⚠️ ${closure.reason ?? "Fermeture"} (${closure.period?.description ?? "Vacances"})`
    : "✅ Ouvert";

  await interaction.editReply({
    content: [
      `📅 ${formatFrenchDate(parsedDate)}`,
      `Tables: ${tables}`,
      `Statut: ${closureText}`
    ].join("\n"),
    components: [buildTablesRow()]
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

  const closure = await getClosureInfo(parsedDate, config.vacationAcademy, config.timezone, logger);
  const eventDate = parsedDate.toDate();
  const prisma = getPrisma();
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

  await interaction.editReply({
    content: [
      `📅 ${formatFrenchDate(parsedDate)}`,
      `Tables: ${event.tables}`,
      `Statut: ${event.status === "FERME" ? closureText : "✅ Ouvert"}`
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
  const fridays = buildMonthFridays(config.timezone);

  let created = 0;
  let skipped = 0;
  let closedSkipped = 0;

  for (const friday of fridays) {
    const existing = await prisma.event.findUnique({ where: { date: friday.toDate() } });
    if (existing) {
      skipped += 1;
      continue;
    }

    const closure = await getClosureInfo(friday, config.vacationAcademy, config.timezone, logger);
    if (closure.closed) {
      closedSkipped += 1;
      continue;
    }

    await prisma.event.create({
      data: {
        date: friday.toDate(),
        tables: 0,
        status: "OUVERT",
        isVacation: false
      }
    });

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

async function handleDeleteDateConfirm(
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

  const matchIds = await prisma.match.findMany({
    where: { eventId: event.id },
    select: { id: true }
  });

  await prisma.$transaction([
    prisma.notification.deleteMany({
      where: { matchId: { in: matchIds.map((match) => match.id) } }
    }),
    prisma.match.deleteMany({ where: { eventId: event.id } }),
    prisma.event.delete({ where: { id: event.id } })
  ]);

  await replyEphemeral(interaction, {
    content: `🗑️ Créneau du ${formatFrenchDate(date)} supprimé (parties et notifications incluses).`
  });
}

async function handleDeleteMonthConfirm(
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
  const matchIds = await prisma.match.findMany({
    where: { eventId: { in: eventIds } },
    select: { id: true }
  });

  await prisma.$transaction([
    prisma.notification.deleteMany({
      where: { matchId: { in: matchIds.map((match) => match.id) } }
    }),
    prisma.match.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.event.deleteMany({ where: { id: { in: eventIds } } })
  ]);

  await replyEphemeral(interaction, {
    content: `🗑️ Créneaux du mois ${now.format("MM/YYYY")} supprimés (parties et notifications incluses).`
  });
}

async function replyEphemeral(
  interaction: EphemeralInteraction,
  payload: ReplyPayload
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload as unknown as Parameters<typeof interaction.editReply>[0]);
    return;
  }

  await interaction.reply({
    ...payload,
    flags: MessageFlags.Ephemeral
  } as unknown as Parameters<typeof interaction.reply>[0]);
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

function buildConfigRow() {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "mu_config:show",
        label: "Rafraîchir la config",
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

async function buildPanel(
  interaction: EphemeralInteraction,
  config: AppConfig,
  logger: Logger
): Promise<ReplyPayload> {
  const summary = await buildMonthSummary(config, logger);
  const quickRows = buildQuickDateRows(config.timezone);

  return {
    content: summary,
    components: [...buildPanelRows(), ...quickRows]
  };
}

function buildPanelRows() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_health:check",
          label: "Health",
          style: ButtonStyle.Secondary
        },
        {
          type: 2,
          custom_id: "mu_config:show",
          label: "Config",
          style: ButtonStyle.Secondary
        },
        {
          type: 2,
          custom_id: "mu_slots:generate_current_month",
          label: "Générer créneaux",
          style: ButtonStyle.Secondary
        },
        {
          type: 2,
          custom_id: "mu_slots:delete_month",
          label: "Supprimer créneaux",
          style: ButtonStyle.Danger
        }
      ]
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "mu_tables:set",
          label: "Définir tables",
          style: ButtonStyle.Primary
        },
        {
          type: 2,
          custom_id: "mu_tables:show",
          label: "Voir tables",
          style: ButtonStyle.Secondary
        },
        {
          type: 2,
          custom_id: "mu_slots:delete_date",
          label: "Supprimer créneau (date)",
          style: ButtonStyle.Danger
        }
      ]
    }
  ];
}

function buildMonthFridays(tz: string) {
  const now = dayjs().tz(tz);
  const start = now.startOf("month").startOf("day");
  const end = now.endOf("month").startOf("day");
  const dates = [];
  let cursor = start;

  while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
    if (cursor.day() === 5) {
      dates.push(cursor);
    }
    cursor = cursor.add(1, "day");
  }

  return dates;
}

async function buildMonthSummary(config: AppConfig, logger: Logger): Promise<string> {
  const prisma = getPrisma();
  const now = dayjs().tz(config.timezone);
  const monthStart = now.startOf("month").startOf("day");
  const monthEnd = now.endOf("month").endOf("day");
  const fridays = buildMonthFridays(config.timezone);

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
  let missing = 0;
  let closed = 0;

  const closures = await Promise.all(
    fridays.map((friday) => getClosureInfo(friday, config.vacationAcademy, config.timezone, logger))
  );

  for (let i = 0; i < fridays.length; i += 1) {
    const friday = fridays[i];
    const closure = closures[i];
    if (closure?.closed) {
      closed += 1;
      continue;
    }

    const key = friday.format("YYYY-MM-DD");
    const event = eventByDate.get(key);
    if (!event) {
      missing += 1;
    }
  }

  return [
    "🧰 Panneau d'administration Munitorum",
    `Mois en cours : ${now.format("MM/YYYY")}`,
    `Vendredis : ${fridays.length}`,
    `Créneaux manquants : ${missing}`,
    `Créneaux fermés : ${closed}`
  ].join("\n");
}

function buildQuickDateRows(tz: string) {
  const now = dayjs().tz(tz).startOf("day");
  const dates = [];
  let cursor = now;

  while (dates.length < 4) {
    if (cursor.day() === 5) {
      dates.push(cursor);
    }
    cursor = cursor.add(1, "day");
  }

  return [
    {
      type: 1,
      components: dates.map((date) => ({
        type: 2,
        custom_id: `mu_tables:quick_show:${date.format("YYYY-MM-DD")}`,
        label: `Voir ${date.format("DD/MM")}`,
        style: ButtonStyle.Secondary
      }))
    }
  ];
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
    gameSystem: GameSystem;
    event: { date: Date };
  },
  config: AppConfig
) {
  const eventDate = dayjs(match.event.date).tz(config.timezone);
  const gameLabel = GAME_LABELS[match.gameSystem];
  return `${formatFrenchDate(eventDate)} — <@${match.player1.discordId}> vs <@${match.player2.discordId}> (${gameLabel})`;
}

async function handleMatchValidate(
  interaction: ButtonInteraction,
  config: AppConfig,
  logger: Logger,
  matchId: number
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
    include: { player1: true, player2: true, event: true }
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
  await disableInteractionButtons(interaction);
}

async function handleMatchRefuse(
  interaction: ModalSubmitInteraction,
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
    include: { player1: true, player2: true, event: true }
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

async function handleMatchCancel(
  interaction: ModalSubmitInteraction,
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
    include: { player1: true, player2: true, event: true }
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
  interaction: ModalSubmitInteraction,
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
