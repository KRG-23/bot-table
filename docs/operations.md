# Guide d'exploitation

## Déploiement production

1. Préparer l'environnement :

```bash
cp .env.example .env.prod
```

Renseigner au minimum `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`,
`DISCORD_APP_ID`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` et `DATABASE_URL`.
En production, `DATABASE_URL` doit pointer vers le service Compose `postgres`.

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
