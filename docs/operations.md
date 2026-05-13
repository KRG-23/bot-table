# Guide d'exploitation

## Déploiement production

Avant le premier démarrage, configurer l'application Discord avec les bons
scopes, permissions et intents. Voir `docs/discord-application.md`.

1. Préparer l'environnement :

```bash
cp .env.example .env.prod
```

Renseigner au minimum `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`,
`DISCORD_APP_ID`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` et `DATABASE_URL`.
En production, `DATABASE_URL` doit pointer vers le service Compose `postgres`.
Définir `COMPOSE_PROJECT_NAME` pour nommer explicitement les ressources Docker
(`otto-table-prod` recommandé en production).

2. Construire et démarrer :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Le conteneur `bot` exécute `prisma migrate deploy` au démarrage, puis lance
`node dist/index.js`. Pour désactiver cette migration automatique, définir
`RUN_MIGRATIONS=false`.

3. Vérifier :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail 50 bot
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

## Mise à jour applicative

```bash
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build bot
```

Les migrations Prisma sont appliquées automatiquement par le point d'entrée du
conteneur `bot`.

## Sauvegardes

Les sauvegardes planifiées utilisent `BACKUP_DIR` et produisent des dumps
PostgreSQL au format custom dans `data/backups`.

Sauvegarde manuelle :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec bot npm run backup:run
```

Les fichiers générés ont la forme `otto_YYYYMMDD_HHmmss.dump`.

## Restauration

1. Arrêter le bot pour éviter des écritures pendant la restauration :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml stop bot
```

2. Restaurer un dump présent dans `data/backups` :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /backups/otto_YYYYMMDD_HHmmss.dump'
```

3. Redémarrer le bot :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d bot
```

## Logs

Les logs Docker `bot` et `postgres` sont limités à 10 MB avec 5 fichiers
conservés. Consultation rapide :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail 100 bot
```

## Checks locaux

Avant commit ou déploiement :

```bash
npm run check
```

## Repartir sur une base neuve

Le nom de projet Compose pilote les noms des conteneurs, réseaux et volumes.
Pour créer une base vide sans supprimer l’ancienne :

1. Définir un nouveau projet dans l’env file :

```env
COMPOSE_PROJECT_NAME=otto-table-dev
PGUSER=otto_dbuser
PGPASSWORD=otto_dbpassword
PGDATABASE=otto_dbname
DATABASE_URL=postgresql://otto_dbuser:otto_dbpassword@postgres:5432/otto_dbname
```

2. Arrêter l’ancienne stack si elle tourne encore :

```bash
docker compose --env-file .env.dev -p bot-table down
```

3. Démarrer la nouvelle stack et appliquer les migrations :

```bash
docker compose --env-file .env.dev up -d postgres
docker compose --env-file .env.dev run --rm bot npm run prisma:migrate
docker compose --env-file .env.dev up -d bot
```

L’ancien volume `bot-table_postgres_data` reste disponible tant qu’il n’est pas
supprimé manuellement.
