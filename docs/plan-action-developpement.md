# Plan d’action pour démarrer le développement du bot

## Phase 0 — Préparation (jour 0)
- Choisir la stack : Node.js + TypeScript, discord.js v14, Prisma + PostgreSQL, dayjs (timezone Europe/Paris), bullmq ou node-cron pour les tâches planifiées.
- Initialiser le repo : `npm init -y`, TypeScript, ts-node-dev, eslint/prettier, husky + lint-staged (optionnel).
- Créer `docker-compose.yml` (services : bot, postgres, volume data, volume backups) + `.env.example` (dev/prod).

## Phase 1 — Modèle et persistance (jour 1)
- Définir le schéma Prisma : tables `users`, `events`, `matches`, `notifications`, `settings` (option mention thread), enum `game_system`.
- Générer et appliquer la première migration sur Postgres (dev).
- Ajouter seeds minimales (game systems).

## Phase 2 — Socle bot Discord (jour 1-2)
- Bootstrap discord.js : login, intents requis (Guilds, GuildMessages, DirectMessages, MessageContent si nécessaire, GuildMembers pour rôles admin), gestion des erreurs.
- Enregistrer les slash commands de base : `/health`, `/config show`.
- Mettre en place un logger structuré (pino/winston) et un service de config lisant `.env`.

## Phase 3 — Gestion des tables et événements (jour 2)
- Implémenter `/tables set|show <date>` (admin) avec validation de date vendredi.
- Service calendrier : calcul des vendredis, détection vacances/veille vacances académie Nantes (source API ou fichier calendrier à charger).
- Modèle `events` : création/maj du nombre de tables, statut ouvert/fermé.

## Phase 4 — Collecte des parties (jour 3)
- Listener de messages dans les fils ciblés : extraction des deux mentions + jeu, contrôle doublon joueur, création `match` en `en_attente`.
- Réponses thread + DM récapitulatif.
- Slash/boutons : `Valider/Refuser/Annuler` sur un match (admin ou joueurs concernés pour annulation) via composants interactifs.

## Phase 5 — Automatisations hebdo (jour 3-4)
- Job « premier dimanche du mois » : création des fils par jeu pour chaque vendredi du mois, sauf vendredis fermés (vacances/veille).
- Job « mercredi 21h » : récap aux admins + auto-validation si capacité OK.
- Job « vendredi 17h » : notification finale aux matches validés.
- Job « samedi 23h » : dump Postgres, rotation (garder 4 dernières).

## Phase 6 — Notifications et règles métier (jour 4)
- Implémenter option de mention dans le fil (setting admin) lors de validation.
- Bloquer validation/creation de match sur dates fermées, message explicatif.
- Auto-validation immédiate quand capacité suffisante ; recalcul après annulation.
- Empêcher double réservation d’un joueur sur un même vendredi.

## Phase 7 — Observabilité et qualité (jour 4-5)
- Logs structurés (correlation ids), métriques simples (Prom client + /metrics optionnel).
- Tests : unités sur règles métier (capacité, doublons, annulation), intégration légère sur commandes.
- Script `npm run check` (lint + tests).

## Phase 8 — Emballage et docs (jour 5)
- Finaliser `docker-compose.yml`, Dockerfile prod (node:alpine), entrypoint avec migrations auto (`prisma migrate deploy`).
- Scripts npm : `dev`, `build`, `start`, `lint`, `test`, `db:seed`, `backup`.
- Documenter : README (setup, env, commandes), guide d’exploitation (restore backup, rotation), manuel admin Discord (permissions, commandes, cas d’usage).

## Phase 9 — Vérifications finales
- Scénarios d’acceptation (section 12 du cahier) joués sur serveur de test avec canaux/IDs fournis.
- Vérifier gestion fuseau + changement d’heure.
- Vérifier purge des backups et re-lancement après redémarrage (persistance volumes).
