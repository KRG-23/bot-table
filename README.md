# Munitorum

Munitorum is a Discord bot for tabletop reservations (Warhammer 40k / AoS / Kill Team). It automates table availability, match submissions, validation, and player notifications.

## Features (current / planned)
- Slash commands: `/health`, `/config show`
- Table capacity management (planned)
- Match submissions + validation (planned)
- Weekly automation (planned)
- PostgreSQL persistence + backups (planned)

## Requirements
- Node.js 20+
- Docker + Docker Compose
- A Discord application + bot token

## Setup (Docker-only)
1) Create your env file:
```bash
cp .env.example .env.dev
```
Fill in at least:
- `DISCORD_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_CHANNEL_ID`
- `DISCORD_APP_ID`

2) Start Postgres (Docker):
```bash
docker compose --env-file .env.dev up -d postgres
```

3) Run migrations (inside Docker network):
```bash
docker compose --env-file .env.dev run --rm bot npm run prisma:migrate
```

4) Start the bot:
```bash
docker compose --env-file .env.dev up bot
```

## Discord configuration
Enable the following **Privileged Gateway Intents** in the Discord Developer Portal:
- Message Content Intent
- Server Members Intent

## Commands
- `/health` — check bot status
- `/config show` — show current config (safe fields only)

## Environment variables
See `.env.example` for all options.

Key vars:
- `DISCORD_TOKEN` — bot token
- `DISCORD_GUILD_ID` — target server ID
- `DISCORD_CHANNEL_ID` — target channel ID
- `DISCORD_APP_ID` — application ID
- `DATABASE_URL` — Postgres connection string
- `MENTION_IN_THREAD` — `true`/`false`
- `LOG_LEVEL` — `info`, `debug`, etc.

## Docker notes
- The Postgres host port is mapped to **5433** to avoid conflicts with other local instances.
- If you want to use 5432, edit `docker-compose.yml`.

## Project structure
```
src/
  config.ts
  logger.ts
  discord/
prisma/
docs/
```

## Documentation
- Terms of Service: `/docs/terms-of-service.md`
- Privacy Policy: `/docs/privacy-policy.md`
- Development plan: `/docs/plan-action-developpement.md`

## License
MIT
