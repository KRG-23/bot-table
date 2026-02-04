import { REST, Routes } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";

import { commands } from "./commands";

export async function registerCommands(config: AppConfig, logger: Logger): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  logger.info(
    {
      guildId: config.discordGuildId,
      commands: commands.length
    },
    "Registering guild slash commands"
  );

  await rest.put(Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId), {
    body: commands
  });
}
