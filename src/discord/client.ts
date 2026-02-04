import { Client, GatewayIntentBits, Partials } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";

import { handleInteraction } from "./interactions";

export function createClient(config: AppConfig, logger: Logger): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
  });

  client.once("ready", () => {
    logger.info(
      {
        user: client.user?.tag,
        guildId: config.discordGuildId
      },
      "Discord client ready"
    );
  });

  client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    handleInteraction(interaction, config, logger).catch((err) => {
      logger.error({ err }, "Failed to handle interaction");
    });
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  return client;
}
