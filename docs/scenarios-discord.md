# Scénarios Discord (slash + boutons)

Ce document liste les actions disponibles et leur équivalent en commande slash et/ou en boutons/modals.
Objectif : s'assurer qu'un admin peut tout faire via les commandes **ou** via l'UI.

## Tableau de parité

| Domaine         | Action                     | Commande slash                 | Bouton / Modal / Menu                                  |
| --------------- | -------------------------- | ------------------------------ | ------------------------------------------------------ |
| Santé           | Vérifier l’état du bot     | `/ot_health`                   | _N/A (slash uniquement par choix)_                     |
| Configuration   | Ouvrir le menu             | `/ot_config`                   | Menu public (expire 60s après la dernière interaction) |
| Créneaux        | Générer le mois            | `/ot_slots generate`           | Bouton “Générer le mois”                               |
| Créneaux        | Supprimer une date         | `/ot_slots delete_date`        | Bouton “Supprimer une date” + modal                    |
| Créneaux        | Supprimer le mois          | `/ot_slots delete_month`       | Bouton “Supprimer le mois” + confirmation              |
| Créneaux        | Configurer les jours       | `/ot_slots set_days`           | Bouton “Configurer les jours” + modal                  |
| Jeux & tables   | Lister les jeux            | `/ot_games list`               | Catégorie “Jeux & tables”                              |
| Jeux & tables   | Ajouter un jeu             | `/ot_games add`                | Bouton “Ajouter un jeu” + modal                        |
| Jeux & tables   | Assigner un canal          | `/ot_games set_channel`        | Sélecteur de canal + bouton “Enregistrer”              |
| Jeux & tables   | Tables par défaut          | `/ot_games set_default_tables` | Bouton “Tables par défaut” + modal                     |
| Jeux & tables   | Désactiver un jeu          | `/ot_games disable`            | Bouton “Désactiver”                                    |
| Jeux & tables   | Réactiver un jeu           | `/ot_games enable`             | Bouton “Réactiver”                                     |
| Jeux & tables   | Définir les tables par jeu | `/ot_tables set [game]`        | Dropdown date créée + dropdown jeu + modal tables      |
| Jeux & tables   | Voir les tables par jeu    | `/ot_tables show`              | Dropdown date créée                                    |
| Thread admin    | Voir l’état du fil         | _N/A (fil uniquement)_         | Bouton “État” dans le fil                              |
| Thread admin    | Définir tables du jeu      | `/ot_tables set [game]`        | Bouton “Tables” dans le fil + modal                    |
| Thread admin    | Valider ce qui rentre      | _N/A (fil uniquement)_         | Bouton “Confirmer” dans le fil                         |
| Parties         | Créer une partie           | `/ot_match create`             | Bouton “Créer une partie” + modal                      |
| Parties         | Valider une partie         | `/ot_match validate`           | Bouton “Valider” + modal                               |
| Parties         | Refuser une partie         | `/ot_match refuse`             | Bouton “Refuser” + modal                               |
| Parties         | Annuler une partie         | `/ot_match cancel`             | Bouton “Annuler” + modal                               |
| Notifications   | Mention dans les fils      | _N/A (menu uniquement)_        | Catégorie “Notifications” + boutons On/Off             |
| Automatisations | Configurer le planning     | _N/A (menu uniquement)_        | Catégorie “Automatisations” + modal                    |
| Automatisations | Réinitialiser les valeurs  | _N/A (menu uniquement)_        | Bouton “Valeurs par défaut”                            |

## Notes

- Le menu `/ot_config` est public, mais les actions admin restent protégées par rôle.
- L’onglet “Accueil” propose le choix de langue et un tableau des créneaux enregistrés, avec un rappel des paramètres de base en citation.
- La catégorie “Jeux & tables” regroupe le référentiel jeux/canaux, les tables par défaut et les tables par soirée.
- La catégorie “Notifications” règle l’ajout de messages de validation dans les fils ; les DM joueurs restent envoyés dans tous les cas.
- La génération mensuelle applique les tables par défaut configurées sur les jeux actifs aux nouveaux créneaux et aux créneaux ouverts sans table.
- Les jeux sont configurés dynamiquement et chaque jeu doit avoir un canal associé.
- Les tables d’une soirée se règlent en choisissant une date parmi les créneaux déjà créés, puis un jeu.
- Chaque fil de soirée expose un mini-panneau admin limité au jeu + créneau du fil.
- Dans un fil de soirée créé par jeu, une demande de partie peut omettre le jeu : `@Otto @Joueur1 vs @Joueur2`.
- Une partie annulée ou refusée libère les joueurs ; seuls les statuts en attente et validé bloquent une nouvelle réservation sur le même créneau.
- Après une annulation, le bot tente immédiatement l’auto-validation des parties en attente du même jeu si toute la file rentre dans les tables disponibles.
- Les automatisations ont des valeurs par défaut, mais l’admin peut modifier le jour, l’heure et la fenêtre d’analyse depuis `/ot_config`.
