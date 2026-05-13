import { Client, GatewayIntentBits, Partials } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { incrementMetric } from "../services/metrics";
import { startSchedulers } from "../services/scheduler";

import {
  handleButtonInteraction,
  handleInteraction,
  handleModalSubmit,
  handleSelectMenuInteraction
} from "./interactions";
import { handleMatchMessage } from "./messages";

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
    startSchedulers(client, config, logger);
  });

  client.on("interactionCreate", async (interaction) => {
    const ageMs = Date.now() - interaction.createdTimestamp;
    incrementMetric("discordInteractions");

    if (ageMs > 2000) {
      incrementMetric("discordLateInteractions");
      logger.warn({ ageMs, type: interaction.type }, "Interaction received late");
    }

    try {
      if (interaction.isChatInputCommand()) {
        await handleInteraction(interaction, config, logger);
        return;
      }

      if (interaction.isButton()) {
        await handleButtonInteraction(interaction, config, logger);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction, config, logger);
        return;
      }

      if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        await handleSelectMenuInteraction(interaction, config, logger);
      }
    } catch (err) {
      incrementMetric("discordInteractionErrors");
      logger.error({ err, ageMs }, "Failed to handle interaction");
    }
  });

  client.on("messageCreate", (message) => {
    handleMatchMessage(message, config, logger).catch((err) => {
      incrementMetric("discordMessageErrors");
      logger.error({ err }, "Failed to handle match message");
    });
  });

  client.on("error", (err) => {
    incrementMetric("discordClientErrors");
    logger.error({ err }, "Discord client error");
  });

  return client;
}
