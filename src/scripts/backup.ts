import pino from "pino";

import { loadConfig } from "../config";
import { getPrisma } from "../db";
import { getAutomationSettings } from "../services/automation-settings";
import { buildPostgresBackupSummary, runPostgresBackup } from "../services/backups";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const prisma = getPrisma();
  const settings = await getAutomationSettings(prisma);
  const result = await runPostgresBackup(config, logger, settings.backupRetentionDays);

  logger.info({ result }, "Manual Postgres backup completed");
  console.log(buildPostgresBackupSummary(result));
  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error(err);
  await getPrisma()
    .$disconnect()
    .catch(() => undefined);
  process.exitCode = 1;
});
