import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";

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

  if (interaction.commandName === "health") {
    await interaction.reply({
      content: "✅ Munitorum opérationnel.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "config") {
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
}
