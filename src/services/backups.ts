import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import dayjs from "dayjs";
import type { Logger } from "pino";

import type { AppConfig } from "../config";

const execFileAsync = promisify(execFile);
const BACKUP_PREFIX = "munitorum";
const BACKUP_EXTENSION = ".dump";

export type PostgresBackupResult = {
  filePath: string;
  deletedFiles: number;
  retentionDays: number;
};

export function buildPostgresBackupSummary(result: PostgresBackupResult): string {
  return [
    "💾 Backup Postgres",
    `Fichier : ${result.filePath}`,
    `Rétention : ${result.retentionDays} jour(s)`,
    `Anciens backups supprimés : ${result.deletedFiles}`
  ].join("\n");
}

export async function runPostgresBackup(
  config: AppConfig,
  logger: Logger,
  retentionDays: number
): Promise<PostgresBackupResult> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run pg_dump backups");
  }

  const backupDir = path.resolve(config.backupDir);
  await fs.mkdir(backupDir, { recursive: true });

  const timestamp = dayjs().tz(config.timezone).format("YYYYMMDD_HHmmss");
  const filePath = path.join(backupDir, `${BACKUP_PREFIX}_${timestamp}${BACKUP_EXTENSION}`);

  await execFileAsync("pg_dump", [
    "--dbname",
    config.databaseUrl,
    "--format",
    "custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    filePath
  ]);

  const deletedFiles = await purgeOldBackups(backupDir, retentionDays, logger);

  return { filePath, deletedFiles, retentionDays };
}

async function purgeOldBackups(
  backupDir: string,
  retentionDays: number,
  logger: Logger
): Promise<number> {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !isManagedBackupFile(entry.name)) {
      continue;
    }

    const filePath = path.join(backupDir, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs >= cutoff) {
      continue;
    }

    try {
      await fs.unlink(filePath);
      deleted += 1;
    } catch (err) {
      logger.warn({ err, filePath }, "Failed to delete old backup");
    }
  }

  return deleted;
}

function isManagedBackupFile(fileName: string): boolean {
  return fileName.startsWith(`${BACKUP_PREFIX}_`) && fileName.endsWith(BACKUP_EXTENSION);
}
