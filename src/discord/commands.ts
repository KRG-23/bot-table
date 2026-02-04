import { ApplicationCommandOptionType, ApplicationCommandType } from "discord.js";

export const commands = [
  {
    name: "mu_health",
    description: "Vérifie l'état du bot",
    type: ApplicationCommandType.ChatInput
  },
  {
    name: "mu_config",
    description: "Affiche la configuration courante",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "show",
        description: "Voir la configuration active",
        type: ApplicationCommandOptionType.Subcommand
      }
    ]
  },
  {
    name: "mu_tables",
    description: "Gérer le nombre de tables",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "set",
        description: "Définir le nombre de tables pour un vendredi",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "date",
            description: "Date au format JJ/MM/AAAA",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "count",
            description: "Nombre de tables disponibles",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 0
          }
        ]
      },
      {
        name: "show",
        description: "Afficher le nombre de tables pour un vendredi",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "date",
            description: "Date au format JJ/MM/AAAA",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      }
    ]
  }
];
