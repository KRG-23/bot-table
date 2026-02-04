import dns from "node:dns";

import { Agent, setGlobalDispatcher } from "undici";

import { loadConfig } from "./config";
import { createClient } from "./discord/client";
import { registerCommands } from "./discord/register-commands";
import { createLogger } from "./logger";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (config.dnsResultOrder) {
    dns.setDefaultResultOrder(config.dnsResultOrder);
    logger.info({ dnsResultOrder: config.dnsResultOrder }, "DNS result order set");
  }

  if (config.discordForceIpv4) {
    setGlobalDispatcher(
      new Agent({
        connect: {
          family: 4
        }
      })
    );
    logger.info("Discord HTTP client forced to IPv4");
  }

  if (config.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    logger.warn("TLS verification disabled for outbound HTTPS requests");
  }

  await registerCommands(config, logger).catch((err) => {
    logger.error({ err }, "Command registration failed, continuing startup");
  });

  const client = createClient(config, logger);
  await loginWithRetry(client, config.discordToken, logger);
}

main().catch((err) => {
  console.error("Erreur au démarrage :", err);
  process.exit(1);
});

async function loginWithRetry(
  client: ReturnType<typeof createClient>,
  token: string,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  const maxDelayMs = 10000;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      await client.login(token);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("invalid token")) {
        throw err;
      }
      const delayMs = Math.min(500 * attempt, maxDelayMs);
      logger.warn({ err, attempt, delayMs }, "Discord login failed, retrying");
      await sleep(delayMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
