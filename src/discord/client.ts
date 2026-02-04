import { Client, GatewayIntentBits, Partials } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";

import { handleInteraction } from "./interactions";

export function createClient(config: AppConfig, logger: Logger): Client {
  const instanceId = process.env.HOSTNAME || `local-${process.pid}`;
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
        guildId: config.discordGuildId,
        instanceId
      },
      "Discord client ready"
    );
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const ageMs = Date.now() - interaction.createdTimestamp;
    if (ageMs > 2000) {
      logger.warn({ ageMs, command: interaction.commandName }, "Interaction received late");
    }

    try {
      await handleInteraction(interaction, config, logger);
    } catch (err) {
      logger.error(
        { err, ageMs, command: interaction.commandName },
        "Failed to handle interaction"
      );
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  return client;
}
