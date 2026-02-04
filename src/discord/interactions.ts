import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";
import { getClosureInfo } from "../services/vacations";
import { formatFrenchDate, isFriday, parseFrenchDate } from "../utils/dates";

import { isAdminMember } from "./admin";

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
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "mu_health") {
    await interaction.reply({
      content: "✅ Munitorum opérationnel.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "mu_config") {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "show") {
      await interaction.reply({
        content: formatConfig(config),
        ephemeral: true
      });
      return;
    }

    logger.warn({ subcommand }, "Unknown config subcommand");
  }

  if (interaction.commandName === "mu_tables") {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Commande réservée au serveur.", ephemeral: true });
      return;
    }

    if (!interaction.member || !isAdminMember(interaction.member, config)) {
      await interaction.reply({
        content: "⛔ Cette commande est réservée aux administrateurs.",
        ephemeral: true
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const dateInput = interaction.options.getString("date", true);
    const parsedDate = parseFrenchDate(dateInput, config.timezone);

    if (!parsedDate) {
      await interaction.reply({
        content: "❌ Date invalide. Format attendu : JJ/MM/AAAA.",
        ephemeral: true
      });
      return;
    }

    if (!isFriday(parsedDate)) {
      await interaction.reply({
        content: "❌ La date doit être un vendredi.",
        ephemeral: true
      });
      return;
    }

    const closure = await getClosureInfo(
      parsedDate,
      config.vacationAcademy,
      config.timezone,
      logger
    );
    const eventDate = parsedDate.toDate();

    if (subcommand === "set") {
      const prisma = getPrisma();
      const count = interaction.options.getInteger("count", true);
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

      await interaction.reply({
        content: [
          `📅 ${formatFrenchDate(parsedDate)}`,
          `Tables: ${tables}`,
          `Statut: ${closureText}`
        ].join("\n"),
        ephemeral: true
      });
      return;
    }

    if (subcommand === "show") {
      const prisma = getPrisma();
      const event = await prisma.event.findUnique({ where: { date: eventDate } });
      const tables = event?.tables ?? 0;
      const status = event?.status ?? (closure.closed ? "FERME" : "OUVERT");

      const closureText = closure.closed
        ? `⚠️ ${closure.reason ?? "Fermeture"} (${closure.period?.description ?? "Vacances"})`
        : "✅ Ouvert";

      await interaction.reply({
        content: [
          `📅 ${formatFrenchDate(parsedDate)}`,
          `Tables: ${tables}`,
          `Statut: ${status === "FERME" ? closureText : "✅ Ouvert"}`
        ].join("\n"),
        ephemeral: true
      });
      return;
    }
  }
}
