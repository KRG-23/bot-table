import { SlashCommandBuilder } from "discord.js";

const healthCommand = new SlashCommandBuilder()
  .setName("mu_health")
  .setDescription("Vérifie l'état du bot");

const configCommand = new SlashCommandBuilder()
  .setName("mu_config")
  .setDescription("Affiche la configuration courante")
  .addSubcommand((sub) => sub.setName("show").setDescription("Voir la configuration active"));

const tablesCommand = new SlashCommandBuilder()
  .setName("mu_tables")
  .setDescription("Gérer le nombre de tables")
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Définir le nombre de tables pour un vendredi")
      .addStringOption((option) =>
        option.setName("date").setDescription("Date au format JJ/MM/AAAA").setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("count")
          .setDescription("Nombre de tables disponibles")
          .setRequired(true)
          .setMinValue(0)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Afficher le nombre de tables pour un vendredi")
      .addStringOption((option) =>
        option.setName("date").setDescription("Date au format JJ/MM/AAAA").setRequired(true)
      )
  );

export const commands = [healthCommand, configCommand, tablesCommand].map((command) =>
  command.toJSON()
);
