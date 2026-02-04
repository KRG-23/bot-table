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
  },
  {
    name: "mu_slots",
    description: "Générer les créneaux du mois",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "generate",
        description: "Créer les créneaux manquants du mois en cours",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "delete_date",
        description: "Supprimer un créneau (et ses parties) pour une date précise",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "date",
            description: "Date au format JJ/MM/AAAA",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      },
      {
        name: "delete_month",
        description: "Supprimer tous les créneaux (et parties) du mois en cours",
        type: ApplicationCommandOptionType.Subcommand
      }
    ]
  },
  {
    name: "mu_panel",
    description: "Afficher le panneau d'administration",
    type: ApplicationCommandType.ChatInput
  }
];
