import { loadConfig } from "./config";
import { createClient } from "./discord/client";
import { registerCommands } from "./discord/register-commands";
import { createLogger } from "./logger";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (config.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    logger.warn("TLS verification disabled for outbound HTTPS requests");
  }

  await registerCommands(config, logger);

  const client = createClient(config, logger);
  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error("Erreur au démarrage :", err);
  process.exit(1);
});
