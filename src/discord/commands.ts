import { ApplicationCommandOptionType, ApplicationCommandType } from "discord.js";

export const commands = [
  {
    name: "mu_health",
    description: "Vérifie l'état du bot",
    type: ApplicationCommandType.ChatInput
  },
  {
    name: "mu_config",
    description: "Ouvre le menu de configuration",
    type: ApplicationCommandType.ChatInput
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
        name: "set_days",
        description: "Configurer les jours actifs des créneaux",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "days",
            description: "Jours (ex: ven, lun/mer, 1,5,7)",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
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
            description: "Code ou libellé du jeu",
            type: ApplicationCommandOptionType.String,
            required: true
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
  },
  {
    name: "mu_games",
    description: "Gérer les jeux et canaux",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "list",
        description: "Lister les jeux configurés",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "add",
        description: "Ajouter un jeu",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "code",
            description: "Code court (ex: W40K)",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "label",
            description: "Libellé (ex: Warhammer 40k)",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "channel",
            description: "Canal où créer les fils",
            type: ApplicationCommandOptionType.Channel,
            required: true
          }
        ]
      },
      {
        name: "set_channel",
        description: "Associer un canal à un jeu",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "game",
            description: "Code ou libellé du jeu",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "channel",
            description: "Canal où créer les fils",
            type: ApplicationCommandOptionType.Channel,
            required: true
          }
        ]
      },
      {
        name: "disable",
        description: "Désactiver un jeu",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "game",
            description: "Code ou libellé du jeu",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      },
      {
        name: "enable",
        description: "Réactiver un jeu",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "game",
            description: "Code ou libellé du jeu",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      }
    ]
  }
];
