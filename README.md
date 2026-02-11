# Munitorum

![Munitorum icon](./munitorum.png)

Munitorum is a Discord bot for tabletop reservations (Warhammer 40k / AoS / Kill Team). It automates table availability, match submissions, validation, and player notifications.

## Features (current / planned)
- Slash commands: `/mu_health`, `/mu_config`, `/mu_tables set|show`, `/mu_slots generate|delete_date|delete_month`, `/mu_match ...`
- Table capacity management
- Auto thread creation per game when a slot is created (and cleanup on cancellation)
- Match submissions + validation/refusal/cancellation (buttons + `/mu_match`)
- Config menu with category selector (créneaux / parties / tables)
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
This will run `prisma generate` on startup to keep the client in sync.

### TLS note (DEV only)
If your network uses TLS inspection (self-signed certs), local dev may fail with
`self-signed certificate in certificate chain`. For **DEV only**, you can disable
TLS verification via:
```
ALLOW_INSECURE_TLS=true
NODE_TLS_REJECT_UNAUTHORIZED=0
```
Never use this in production. For PROD, install the proper root CA.

### DNS note (DEV only)
If the bot fails to reach Discord with `EAI_AGAIN discord.com`, Docker’s internal
DNS resolver may be failing. Two quick fixes:

Option A (preferred): force TCP DNS inside Docker.
Add to `docker-compose.yml` under the `bot` service:
```
dns_opt:
  - use-vc
  - timeout:1
  - attempts:3
```
Then recreate:
```
docker compose --env-file .env.dev up -d --force-recreate bot
```

Option B (fast workaround): use host networking.
Set in `docker-compose.yml`:
```
network_mode: host
```
Update `.env.dev` to use localhost for Postgres:
```
PGHOST=localhost
DATABASE_URL=postgresql://munitorum_dbuser:munitorum_dbpassword@localhost:5433/munitorum_dbname
```
Then recreate:
```
docker compose --env-file .env.dev up -d --force-recreate bot
```

## Discord configuration
Enable the following **Privileged Gateway Intents** in the Discord Developer Portal:
- Message Content Intent
- Server Members Intent

## Commands
- `/mu_health` — check bot status
- `/mu_config` — open the public configuration menu (expires after 60s)
- `/mu_tables set <date> <count>` — set tables for a Friday (date format `DD/MM/YYYY`)
- `/mu_tables show <date>` — show tables for a Friday
- `/mu_slots generate` — create missing Friday slots for the current month
- `/mu_slots delete_date <date>` — delete a slot and related matches for a specific date
- `/mu_slots delete_month` — delete all slots and related matches for the current month
- `/mu_match panel` — show match management panel
- `/mu_match create <date> <player1> <player2> <game>` — create a match
- `/mu_match validate <date> <player1> <player2>` — validate a match
- `/mu_match refuse <date> <player1> <player2> [reason]` — refuse a match
- `/mu_match cancel <date> <player1> <player2> [reason]` — cancel a match (admin or player)

The `/mu_config` menu also lets admins configure slot days (multiple weekdays), and provides category buttons for slots, matches, and tables.

## Scenarios (slash + buttons parity)
All core actions have both a slash command and a button/modals path:
- Health + config: `/mu_health`, `/mu_config show` or their buttons
- Tables + slots: `/mu_tables`, `/mu_slots` or their buttons/modals
- Match creation: `/mu_match create` or match panel button (modal)
- Match validate/refuse/cancel: `/mu_match validate|refuse|cancel` or match buttons

## Environment variables
See `.env.example` for all options.

Key vars:
- `DISCORD_TOKEN` — bot token
- `DISCORD_GUILD_ID` — target server ID
- `DISCORD_CHANNEL_ID` — target channel ID
- `DISCORD_APP_ID` — application ID
- `ADMIN_ROLE_ID` — role ID allowed to manage tables (optional; defaults to server admin)
- `DATABASE_URL` — Postgres connection string
- `MENTION_IN_THREAD` — `true`/`false`
- `LOG_LEVEL` — `info`, `debug`, etc.
- `VACATION_ACADEMY` — academy used for school holidays (default: Nantes)
- `ALLOW_INSECURE_TLS` — DEV only: disable TLS verification (default: false)

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
