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
  },
  {
    name: "mu_match",
    description: "Gérer une partie",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "panel",
        description: "Afficher le panneau de gestion des parties",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "create",
        description: "Créer une partie",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "date",
            description: "Date au format JJ/MM/AAAA",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "player1",
            description: "Premier joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "player2",
            description: "Second joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "game",
            description: "Jeu",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "Warhammer 40k", value: "W40K" },
              { name: "Age of Sigmar", value: "AOS" },
              { name: "Kill Team", value: "KILLTEAM" },
              { name: "Autre", value: "AUTRE" }
            ]
          }
        ]
      },
      {
        name: "validate",
        description: "Valider une partie",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "date",
            description: "Date au format JJ/MM/AAAA",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "player1",
            description: "Premier joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "player2",
            description: "Second joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          }
        ]
      },
      {
        name: "refuse",
        description: "Refuser une partie",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "date",
            description: "Date au format JJ/MM/AAAA",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "player1",
            description: "Premier joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "player2",
            description: "Second joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "reason",
            description: "Raison du refus (optionnel)",
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      },
      {
        name: "cancel",
        description: "Annuler une partie",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "date",
            description: "Date au format JJ/MM/AAAA",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "player1",
            description: "Premier joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "player2",
            description: "Second joueur",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "reason",
            description: "Raison de l'annulation (optionnel)",
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      }
    ]
  }
];
