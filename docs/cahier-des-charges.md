# Cahier des charges – Bot Discord de réservation de tables

## 1. Contexte et objectifs
- Serveur Discord de club (test : serveur ID `795965281105215519`, canal `recherche-de-parties` ID `1419649993471426650`).
- Langue : français. Fuseau horaire : Europe/Paris.
- Créneau unique de jeu : chaque **vendredi** 18h30–01h00.
- Jeux pris en charge : Warhammer 40k, Age of Sigmar, Kill Team, Autre.
- Objectif : automatiser l’annonce des tables disponibles, la collecte des parties, la validation (auto ou manuelle) et la notification des joueurs.

## 2. Rôles et permissions
- **Membre/joueur** : propose une partie et une fois validée avec l'adversaire, prévient en notifiant le bot dans un fil dédié.
- **Admin** : rôle « Bureau » en prod (sur test, rôle admin du serveur). Peut valider/invalider manuellement, ajuster les tables, activer/désactiver les mentions dans les fils.
- **Bot** : crée/entretient les fils, enregistre les parties, applique la validation, notifie joueurs et admins.

## 3. Flux hebdomadaire cible
1) **Dimanche (automatique)**
   - Création ou réactivation d’un fil par jeu au format « Soirée <Jeu> - <date du vendredi> » pour les vendredis du mois. Les fils du mois sont créés le **premier dimanche du mois** uniquement.
   - Si le vendredi correspondant est **veille de vacances scolaires de l’académie de Nantes** ou pendant ces vacances, le fil n’est pas créé et aucune partie n’est autorisée.
   - Un admin saisit le **nombre total de tables** disponibles (incluant la table Billard) via commande.

2) **Dimanche → Mercredi**
   - Les joueurs s’entendent et **notent le bot** dans le fil avec la mention des deux pseudos (ex. `@Bot @Joueur1 vs @Joueur2`), en indiquant le système de jeu.
   - Le bot enregistre la demande en statut `en_attente` et incrémente le compteur de parties.

3) **Mercredi 21h (automatique)**
   - Rappel aux admins : récap des parties en attente et nombre de tables restantes.
   - Auto-validation si `nombre_parties <= tables_disponibles` (toutes passent en `valide`).

4) **Validation manuelle (à tout moment)**
   - Un admin peut valider ou refuser une partie spécifique, même après le mercredi.

5) **Vendredi 17h (automatique)**
   - Notification finale aux joueurs dont la partie est validée.

## 4. Exigences fonctionnelles
- **Collecte des tables** : commande admin pour saisir/modifier le nombre de tables d’un vendredi (valeur entière). La table Billard n’a pas de traitement spécial autre que d’être comptée.
- **Création automatique des fils** : un fil par jeu pour chaque vendredi du mois, créé le 1er dimanche du mois ; réutiliser le fil s’il existe déjà.
- **Saisie d’une partie** : message mentionnant le bot + les deux joueurs + le jeu. Le bot répond avec un récap et le statut (`en_attente` ou `valide`).
- **Validation automatique** : si le total des parties enregistrées ≤ tables, bascule en `valide` sans action admin.
- **Validation manuelle** : commandes admin pour valider/refuser/annuler une partie.
- **Notifications** :
  - DM aux joueurs validés (par défaut).
  - Option admin pour ajouter une **mention dans le fil** au moment de la validation.
- **Annulation** : joueur ou admin peut annuler une partie avant le vendredi 18h ; libère une table.
- **Journal** : conserver l’historique des validations/refus/annulations avec horodatage et auteur.
- **Fermeture exceptionnelle** : si un vendredi tombe en veille ou pendant vacances scolaires (académie de Nantes), les validations sont bloquées et un message d’information est posté.

## 5. Modèle de données (proposé)
- `users` : id Discord, pseudo, dates de première/dernière interaction.
- `game_systems` : enum {40k, AoS, KillTeam, Autre}.
- `events` : date du vendredi, nb_tables, statut (ouvert/fermé), métadonnées vacances.
- `matches` : event_id, joueur1_id, joueur2_id, jeu, statut {en_attente, valide, refuse, annule}, timestamps, message_id du fil.
- `notifications` : match_id, type {dm, thread}, date_envoi, succès/erreur.

## 6. Règles métier
- Une partie = 2 joueurs (pas d’équipes ni multi-table pour l’instant).
- Pas de double réservation d’un joueur sur le même vendredi (refus ou avertissement configurable).
- Auto-validation seulement si **toutes** les parties enregistrées tiennent dans la capacité restante.
- Les admins peuvent toujours valider/refuser même si la capacité est dépassée (warning affiché).
- Annulation d’une partie validée libère une table et peut déclencher auto-validation des parties en attente.
- En cas d'abandon d'un joueur, l'autre peut refaire une notification pour validation de la réservation de la table.
- Un joueur ne peut pas faire 2 parties le même jour.
- Horaires : toutes les échéances se calculent sur le fuseau Europe/Paris ; changement d’heure à respecter.

## 7. Interfaces utilisateur (Discord)
- **Slash commands** (proposé) :
  - `/tables set <date_vendredi> <nombre>` (admin)
  - `/tables show <date_vendredi>`
  - `/match list <date_vendredi>` (admin ou public limité)
  - `/match validate <match_id>` (admin)
  - `/match refuse <match_id>` (admin)
  - `/match cancel <match_id>` (joueur impliqué ou admin)
  - `/notif thread on|off` (admin) pour activer les mentions dans les fils.
- **Boutons avec modale** préférés
- **Messages libres** : mention du bot dans un fil de la semaine avec deux pseudos + jeu pour créer une demande.

## 8. Non-fonctionnel
- Charge cible : 50 utilisateurs, quelques dizaines de messages par semaine.
- Temps de réponse attendu < 2 s pour les commandes simples.
- Journalisation structurée (niveau info/erreur) ; rotation quotidienne.
- Observabilité : métriques basiques (nb parties, taux d’auto-validation, erreurs Discord API).
- Robustesse aux coupures : relancer sans perte de données (persistance PostgreSQL).

## 9. Déploiement et configuration
- Conteneurisation : `docker-compose` avec services `bot` et `postgres` (+ volume de données).
- Config via `.env.dev` et `.env.prod` (non commités) : `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `TZ=Europe/Paris`, options mentions.
- Image multi-arch non requise pour le moment.
- Pas de CI/CD initialement ; exécution locale WSL.

## 10. Sauvegardes et rétention
- Sauvegarde PostgreSQL planifiée **tous les samedis à 23h00**.
- Rétention : 4 dernières sauvegardes (≈1 mois), suppression automatique au-delà.
- Stockage des dumps sur volume distinct ou dossier dédié à préciser.

## 11. Sécurité
- Token Discord uniquement en variables d’environnement ; ne jamais le loguer.
- Scope OAuth minimal : gestion des messages/threads dans le canal ciblé, envoi de DM.
- Droits admin limités au rôle « Bureau » (prod) / admin serveur (test).
- Conserver les horodatages et auteurs des actions admin pour audit.

## 12. Cas d’usage à tester (acceptation)
- Création auto des fils le 1er dimanche du mois ; absence de fil pour un vendredi férié/vacances, création à la demande d'un fil avec un bouton.
- Saisie d’une partie par mention ; enregistrement en `en_attente`.
- Auto-validation lorsque capacité suffisante ; validation manuelle sinon. Envoi d'un message prévenant les joueurs concernés d'une modification
- Annulation d’une partie validée puis auto-validation d’une autre en attente.
- Basculer l’option « mention dans le fil » et vérifier la notification.
- Sauvegarde du samedi et purge après un mois.

## 13. Ouvertures / évolutions futures
- Gestion des parties à plus de deux joueurs ou multi-tables.
- CI/CD GitHub Actions (lint, tests, build, publish image).
- Tableau de bord web ou slash command de reporting hebdomadaire.
