# TODO – Plan d’action (suivi)

## Phase 0 — Préparation

- [x] Choisir la stack (Node.js 20, TypeScript, discord.js v14, Prisma + PostgreSQL)
- [x] Initialiser le repo (TypeScript, scripts npm, bootstrap `src/index.ts`)
- [x] Ajouter ESLint/Prettier + Husky + lint-staged
- [x] Ajouter `docker-compose.yml` + `Dockerfile` + `.env.example`
- [x] Ajouter `.gitignore` et créer `data/backups/`

## Phase 1 — Modèle et persistance

- [x] Définir le schéma Prisma (users, events, matches, notifications, settings)
- [x] Ajouter Prisma CLI + `@prisma/client`
- [x] Générer le client Prisma
- [x] Appliquer la migration init (Postgres)
- [x] Ajuster Docker (base image + openssl) pour Prisma
- [x] Ajuster `docker-compose.yml` pour les identifiants `.env.dev`
- [x] Porter Postgres host sur `5433` (pour éviter conflit local)
- [x] Ajouter `DATABASE_URL` à `.env.example` et `.env.dev`

## Phase 2 — Socle bot Discord

- [x] Définir intents requis (Guilds, GuildMessages, MessageContent, DirectMessages, GuildMembers)
- [x] Initialiser client discord.js (login, events `ready`, `error`)
- [x] Charger config (env validation + valeurs par défaut)
- [x] Enregistrer slash commands de base (`/health`, `/config show`)
- [x] Logger structuré (pino/winston) + niveaux + format JSON
  - [ ] Bloquant : confirmer les permissions OAuth2 nécessaires (scopes + intents)
  - [ ] Bloquant : valider IDs serveur/canal (test + prod)

## Phase 3 — Gestion des tables & événements

- [x] Implémenter `/tables set|show <date>` (admin)
- [x] Validation date (vendredi) + timezone Europe/Paris
- [x] Service calendrier (vacances académie Nantes via API)
- [x] Source vacances (API officielle)
- [x] Créer/mettre à jour `events` (tables, statut, fermeture)
  - [x] Bloquant : choisir la source officielle des vacances (API Education/Nantes vs fichier)

## Phase 4 — Collecte des parties

- [ ] Listener messages dans threads (mention bot + 2 joueurs + jeu)
- [ ] Parsing message + validation (2 mentions, jeu reconnu)
- [ ] Créer match `en_attente`, refuser doublons (1 match/joueur/jour)
- [ ] Réponse de confirmation (thread + DM)
- [ ] Boutons/modales : valider/refuser/annuler
- [ ] Gestion permissions (admin vs joueur concerné)
  - [ ] Bloquant : valider le format exact du message (mention bot + 2 joueurs + jeu)

## Phase 5 — Automatisations hebdo

- [ ] Job “1er dimanche” : création des fils par jeu
- [ ] Nom des fils : “Soirée <Jeu> - <date>”
- [ ] Skip vacances/veille vacances + message d’info
- [ ] Job “mercredi 21h” : récap + auto-validation si capacité OK
- [ ] Job “vendredi 17h” : notifications finales
- [ ] Job “samedi 23h” : backup + rétention 1 mois
- [ ] Script backup Postgres + purge old dumps
  - [ ] Bloquant : définir le moteur de scheduling (node-cron vs bullmq) et son déploiement

## Phase 6 — Notifications & règles métier

- [ ] Option mention dans le fil (setting admin)
- [ ] DM systématique + option mention thread
- [ ] Blocage sur dates fermées (vacances)
- [ ] Auto-validation à la demande (après annulation)
- [ ] Empêcher double réservation joueur
- [ ] Gestion “abandon” (nouvelle notification possible)
  - [ ] Bloquant : clarifier si mention dans thread est activable par serveur ou par événement

## Phase 7 — Observabilité & qualité

- [ ] Logs structurés + rotation
- [ ] Métriques basiques (parties, erreurs Discord)
- [ ] Tests unitaires règles métier
- [ ] Tests parsing messages + permissions
- [ ] Script `npm run check` (lint + tests)
  - [ ] Bloquant : définir le niveau minimal de tests avant prod (smoke vs unit)

## Phase 8 — Packaging & docs

- [ ] Dockerfile prod final + migrations auto
- [ ] `docker-compose` prod (bot + postgres + volumes)
- [ ] Scripts npm (`dev`, `build`, `start`, `backup`)
- [ ] README setup + guide d’exploitation (backup/restore)
- [ ] Manuel admin Discord

## Phase 9 — Vérifications finales

- [ ] Scénarios d’acceptation (section 12)
- [ ] Vérifier fuseau + changement d’heure
- [ ] Vérifier persistance & redémarrage
