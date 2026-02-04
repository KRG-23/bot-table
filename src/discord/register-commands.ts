import { REST, Routes } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";

import { commands } from "./commands";

export async function registerCommands(config: AppConfig, logger: Logger): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const maxAttempts = 5;
  const baseDelayMs = 500;

  logger.info(
    {
      guildId: config.discordGuildId,
      commands: commands.length
    },
    "Registering guild slash commands"
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId), {
        body: commands
      });
      return;
    } catch (err) {
      logger.warn({ err, attempt }, "Failed to register commands");
      if (attempt === maxAttempts) {
        throw err;
      }
      const delayMs = baseDelayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
