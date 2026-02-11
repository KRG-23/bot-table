# Scénarios Discord (slash + boutons)

Ce document liste les actions disponibles et leur équivalent en commande slash et/ou en boutons/modals.
Objectif : s'assurer qu'un admin peut tout faire via les commandes **ou** via l'UI.

## Tableau de parité

| Domaine       | Action                 | Commande slash           | Bouton / Modal / Menu                                  |
| ------------- | ---------------------- | ------------------------ | ------------------------------------------------------ |
| Santé         | Vérifier l’état du bot | `/mu_health`             | _N/A (slash uniquement par choix)_                     |
| Configuration | Ouvrir le menu         | `/mu_config`             | Menu public (expire 60s après la dernière interaction) |
| Créneaux      | Générer le mois        | `/mu_slots generate`     | Bouton “Générer le mois”                               |
| Créneaux      | Supprimer une date     | `/mu_slots delete_date`  | Bouton “Supprimer une date” + modal                    |
| Créneaux      | Supprimer le mois      | `/mu_slots delete_month` | Bouton “Supprimer le mois” + confirmation              |
| Créneaux      | Configurer les jours   | `/mu_slots set_days`     | Bouton “Configurer les jours” + modal                  |
| Jeux & canaux | Lister les jeux        | `/mu_games list`         | Menu “Configurer jeux & canaux”                        |
| Jeux & canaux | Ajouter un jeu         | `/mu_games add`          | Bouton “Ajouter un jeu” + modal                        |
| Jeux & canaux | Assigner un canal      | `/mu_games set_channel`  | Sélecteur de canal + bouton “Enregistrer”              |
| Jeux & canaux | Désactiver un jeu      | `/mu_games disable`      | Bouton “Désactiver”                                    |
| Jeux & canaux | Réactiver un jeu       | `/mu_games enable`       | Bouton “Réactiver”                                     |
| Tables        | Définir les tables     | `/mu_tables set`         | Bouton “Définir” + modal                               |
| Tables        | Voir les tables        | `/mu_tables show`        | Bouton “Voir” + modal                                  |
| Parties       | Créer une partie       | `/mu_match create`       | Bouton “Créer une partie” + modal                      |
| Parties       | Valider une partie     | `/mu_match validate`     | Bouton “Valider” + modal                               |
| Parties       | Refuser une partie     | `/mu_match refuse`       | Bouton “Refuser” + modal                               |
| Parties       | Annuler une partie     | `/mu_match cancel`       | Bouton “Annuler” + modal                               |

## Notes

- Le menu `/mu_config` est public, mais les actions admin restent protégées par rôle.
- Les jeux sont configurés dynamiquement et chaque jeu doit avoir un canal associé.
