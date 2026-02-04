import { SlashCommandBuilder } from "discord.js";

const healthCommand = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Vérifie l'état du bot");

const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Affiche la configuration courante")
  .addSubcommand((sub) => sub.setName("show").setDescription("Voir la configuration active"));

export const commands = [healthCommand, configCommand].map((command) => command.toJSON());
