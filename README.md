# Munitorum

![Munitorum icon](./munitorum.png)

Munitorum is a Discord bot for tabletop reservations (Warhammer 40k / AoS / Kill Team). It automates table availability, match submissions, validation, and player notifications.

## Features (current / planned)

- Slash commands: `/mu_health`, `/mu_config`, `/mu_tables set|show`, `/mu_slots generate|set_days|delete_date|delete_month`, `/mu_match ...`, `/mu_games ...`
- Table capacity management per game
- Auto thread creation per game when a slot is opened with tables (and cleanup on cancellation)
- Thread-level admin controls for per-game tables and possible match validation
- Dynamic game list with per-game thread channel mapping
- Match submissions + validation/refusal/cancellation (buttons + `/mu_match`)
- Config menu with category selector (créneaux / jeux & tables / parties / automatisations)
- Automatic monthly slot generation on the first Sunday of the month
- PostgreSQL persistence + scheduled backups

## Requirements

- Node.js 20+
- Docker + Docker Compose
- A Discord application + bot token

## Setup (Docker-only)

1. Create your env file:

```bash
cp .env.example .env.dev
```

Fill in at least:

- `DISCORD_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_CHANNEL_ID`
- `DISCORD_APP_ID`

2. Start Postgres (Docker):

```bash
docker compose --env-file .env.dev up -d postgres
```

3. Run migrations (inside Docker network):

```bash
docker compose --env-file .env.dev run --rm bot npm run prisma:migrate
```

4. Start the bot:

```bash
docker compose --env-file .env.dev up bot
```

This will run `prisma generate` on startup to keep the client in sync.

## Production deployment

Production uses `docker-compose.prod.yml` and the `prod` Dockerfile target:

```bash
cp .env.example .env.prod
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

The production container runs `prisma migrate deploy` before `node dist/index.js`.
Set `RUN_MIGRATIONS=false` only if migrations are handled externally.
See `docs/operations.md` for update, backup, and restore procedures.

## Quality checks

Run the full local verification before committing:

```bash
npm run check
```

This runs ESLint, TypeScript build, and the Node test suite.

`/mu_health` also returns basic in-memory metrics since the last bot restart:
Discord interactions/errors, match lifecycle counters, auto-validations, DM failures,
and thread notification failures.

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
- `/mu_config` — open the public configuration menu (expires 60s after the last interaction, then replaced with a timeout message)
- `/mu_tables set <date> <count> [game]` — set tables for a Friday, globally or for one game (date format `DD/MM/YYYY`)
- `/mu_tables show <date>` — show tables for a Friday, including per-game allocation when configured
- `/mu_slots generate` — create missing Friday slots for the current month
- `/mu_slots set_days <days>` — configure slot weekdays (ex: `ven` or `1,3,5`)
- `/mu_slots delete_date <date>` — delete a slot and related matches for a specific date
- `/mu_slots delete_month` — delete all slots and related matches for the current month
- `/mu_match panel` — show match management panel
- `/mu_match create <date> <player1> <player2> <game>` — create a match
- `/mu_match validate <date> <player1> <player2>` — validate a match
- `/mu_match refuse <date> <player1> <player2> [reason]` — refuse a match
- `/mu_match cancel <date> <player1> <player2> [reason]` — cancel a match (admin or player)
- `/mu_games list` — list configured games
- `/mu_games add <code> <label> <channel> [default_tables]` — add a game
- `/mu_games set_channel <game> <channel>` — update a game's thread channel
- `/mu_games set_default_tables <game> <count>` — update the table count applied by default to new slots
- `/mu_games disable <game>` — disable a game
- `/mu_games enable <game>` — enable a game

The `/mu_config` menu starts on “Accueil” with a language selector and a table of recorded slots. A base settings reminder appears as a quote block. Admins can configure slot days (multiple weekdays), manage games + channels, per-game default table counts, notification mentions, automation timing, and use category buttons for slots, games + tables, matches, notifications, and automations. The `Jeux & tables` category lets admins pick an existing slot date from a dropdown, select a game, and set that game's table count. Defaults can be applied in one click from the values configured on active games. New games created from the menu default to `DISCORD_CHANNEL_ID` until reassigned; W40K and AoS are prefilled with 5 and 2 tables respectively when detected.

Each generated game thread also includes admin-only buttons:

- `État` — show tables, pending/validated matches, and remaining capacity for this game
- `Tables` — update the table count for this game only
- `Confirmer` — validate pending matches for this game up to the available capacity

In a generated game thread, players can create a match with `@Munitorum @Joueur1 vs @Joueur2`; the game is inferred from the thread. Adding the game at the end still works when it matches the thread.
Only pending or validated matches block a player from booking another match on the same slot. Refused or cancelled matches keep their history but release both players for a new booking.

## Automations

When the bot is ready, it schedules the next automation runs in `TZ` (default `Europe/Paris`) without polling continuously. The schedule is configurable from `/mu_config` > “Automatisations”; saved changes refresh the in-memory scheduler.

Monthly slot generation runs by default on the first Sunday of the month at 09:00. It generates the current month's configured slots once, skips school holiday/holiday-eve closures, applies the configured per-game default table counts to new or empty slots, and posts a summary in `DISCORD_CHANNEL_ID`. Per-game threads are created when the corresponding game has tables configured for the slot.

- existing slots are reused
- missing per-game threads are recreated for open slots with configured tables for that game
- the last automatic run month is stored in the `monthly_slots_last_auto_run` setting

Weekly match review runs by default every Wednesday at 21:00. It reviews open slots for the configured window (7 days by default), auto-validates pending matches when validated + pending matches fit within the available tables for their game, sends player DMs, and posts a recap in `DISCORD_CHANNEL_ID`.

When a match is cancelled, Munitorum immediately retries the same auto-validation rule for the affected game and slot.

Final player notifications run by default every Friday at 17:00. They DM players with validated matches for the current day and post a summary in `DISCORD_CHANNEL_ID`.

Postgres backups run by default every Saturday at 23:00. The bot runs `pg_dump` into `BACKUP_DIR` and purges managed backups older than the configured retention.

Default automation values:

- monthly slot generation: first Sunday, 09:00
- weekly match review: Wednesday, 21:00
- review window: 7 days
- final notifications: Friday, 17:00
- Postgres backup: Saturday, 23:00
- backup retention: 30 days

## Scenarios (slash + buttons parity)

All core actions have both a slash command and a button/modals path:

- Tables + slots: `/mu_tables`, `/mu_slots` or their buttons/dropdowns/modals
- Slot days: `/mu_slots set_days` or the config modal
- Games + channels + table defaults: `/mu_games ...` or the `Jeux & tables` config category
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
- `BACKUP_DIR` — directory used by scheduled/manual Postgres backups (default: `data/backups`)
- `MENTION_IN_THREAD` — default `true`/`false` value before the admin changes it in `/mu_config` > “Notifications”
- `ALLOW_BOT_PLAYERS` — DEV/test only: allow Discord bots as players (default: `false`)
- `LOG_LEVEL` — `info`, `debug`, etc.
- `VACATION_ACADEMY` — academy used for school holidays (default: Nantes)
- `ALLOW_INSECURE_TLS` — DEV only: disable TLS verification (default: false)

## Docker notes

- The Postgres host port is mapped to **5433** to avoid conflicts with other local instances.
- If you want to use 5432, edit `docker-compose.yml`.
- Compose rotates `bot` and `postgres` JSON logs at 10 MB with 5 retained files.
- Manual backup: `npm run backup`.

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
- Operations guide: `/docs/operations.md`
- Discord admin guide: `/docs/admin-guide.md`
- Development plan: `/docs/plan-action-developpement.md`
- Discord scenarios: `/docs/scenarios-discord.md`

## License

MIT
