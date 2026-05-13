import dayjs from "dayjs";
import type { Client, InteractionReplyOptions, Message } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";

import {
  type AutomationSettings,
  buildMonthlyAutomationRunDate,
  buildWeeklyAutomationRunDate,
  buildWeeklyReviewRunDate,
  getAutomationSettings
} from "./automation-settings";
import { buildPostgresBackupSummary, runPostgresBackup } from "./backups";
import { buildFinalNotificationSummary, sendFinalMatchNotifications } from "./final-notifications";
import { buildWeeklyMatchReviewSummary, reviewUpcomingMatches } from "./match-review";
import { buildMonthlySlotGenerationSummary, generateCurrentMonthSlots } from "./monthly-slots";

const MONTHLY_SLOTS_LAST_RUN_SETTING = "monthly_slots_last_auto_run";
const WEEKLY_MATCH_REVIEW_LAST_RUN_SETTING = "weekly_match_review_last_auto_run";
const FINAL_NOTIFICATIONS_LAST_RUN_SETTING = "final_notifications_last_auto_run";
const POSTGRES_BACKUP_LAST_RUN_SETTING = "postgres_backup_last_auto_run";
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
let schedulerGeneration = 0;
const scheduledTimeouts = new Set<NodeJS.Timeout>();

type ReplyComponents = InteractionReplyOptions["components"];

type SendableChannel = {
  send: (payload: { content: string; components?: ReplyComponents }) => Promise<Message>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  return "send" in channel && typeof (channel as SendableChannel).send === "function";
}

function isAtOrAfterTime(date: dayjs.Dayjs, time: string): boolean {
  const [hour, minute] = time.split(":").map(Number);
  return date.hour() > hour || (date.hour() === hour && date.minute() >= minute);
}

export function startSchedulers(client: Client, config: AppConfig, logger: Logger): void {
  schedulerGeneration += 1;
  clearScheduledTimeouts();
  const generation = schedulerGeneration;

  void runStartupCatchUp(client, config, logger).catch((err) => {
    logger.error({ err }, "Scheduler startup catch-up failed");
  });

  planSchedulerJobs(client, config, logger, generation);
}

export function refreshSchedulers(client: Client, config: AppConfig, logger: Logger): void {
  schedulerGeneration += 1;
  clearScheduledTimeouts();
  planSchedulerJobs(client, config, logger, schedulerGeneration);
}

function planSchedulerJobs(
  client: Client,
  config: AppConfig,
  logger: Logger,
  generation: number
): void {
  scheduleJob(
    config,
    logger,
    "monthly_slots",
    () => getNextMonthlySlotsRun(config),
    async () => {
      await maybeGenerateMonthlySlots(client, config, logger);
    },
    generation
  );

  scheduleJob(
    config,
    logger,
    "weekly_match_review",
    () => getNextWeeklyMatchReviewRun(config),
    async () => {
      await maybeReviewUpcomingMatches(client, config, logger);
    },
    generation
  );

  scheduleJob(
    config,
    logger,
    "final_notifications",
    () => getNextFinalNotificationsRun(config),
    async () => {
      await maybeSendFinalNotifications(client, config, logger);
    },
    generation
  );

  scheduleJob(
    config,
    logger,
    "postgres_backup",
    () => getNextPostgresBackupRun(config),
    async () => {
      await maybeRunPostgresBackup(client, config, logger);
    },
    generation
  );
}

function clearScheduledTimeouts(): void {
  for (const timeout of scheduledTimeouts) {
    clearTimeout(timeout);
  }
  scheduledTimeouts.clear();
}

async function runStartupCatchUp(client: Client, config: AppConfig, logger: Logger): Promise<void> {
  const now = dayjs().tz(config.timezone);
  const settings = await getAutomationSettings(getPrisma());

  if (isMonthlyAutomationDay(now, settings) && isAtOrAfterTime(now, settings.monthlyTime)) {
    await maybeGenerateMonthlySlots(client, config, logger);
  }

  if (
    now.day() === settings.weeklyReviewWeekday &&
    isAtOrAfterTime(now, settings.weeklyReviewTime)
  ) {
    await maybeReviewUpcomingMatches(client, config, logger);
  }

  if (
    now.day() === settings.finalNotificationWeekday &&
    isAtOrAfterTime(now, settings.finalNotificationTime)
  ) {
    await maybeSendFinalNotifications(client, config, logger);
  }

  if (now.day() === settings.backupWeekday && isAtOrAfterTime(now, settings.backupTime)) {
    await maybeRunPostgresBackup(client, config, logger);
  }
}

function scheduleJob(
  config: AppConfig,
  logger: Logger,
  name: string,
  getNextRun: () => Promise<dayjs.Dayjs>,
  task: () => Promise<void>,
  generation: number
): void {
  let running = false;

  const scheduleNext = async (): Promise<void> => {
    if (generation !== schedulerGeneration) {
      return;
    }

    const now = dayjs().tz(config.timezone);
    const nextRun = await getNextRun();
    const delayMs = Math.max(0, nextRun.valueOf() - now.valueOf());
    const currentDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);

    logger.info({ job: name, nextRun: nextRun.toISOString() }, "Scheduler job planned");

    const timeout = setTimeout(() => {
      scheduledTimeouts.delete(timeout);
      if (generation !== schedulerGeneration) {
        return;
      }

      if (delayMs > MAX_TIMEOUT_MS) {
        void scheduleNext().catch((err) => {
          logger.error({ err, job: name }, "Failed to schedule job");
        });
        return;
      }

      const run = async (): Promise<void> => {
        if (running) {
          return;
        }

        running = true;
        try {
          await task();
        } catch (err) {
          logger.error({ err, job: name }, "Scheduled job failed");
        } finally {
          running = false;
          if (generation === schedulerGeneration) {
            void scheduleNext().catch((err) => {
              logger.error({ err, job: name }, "Failed to schedule job");
            });
          }
        }
      };

      void run();
    }, currentDelayMs);
    scheduledTimeouts.add(timeout);
  };

  void scheduleNext().catch((err) => {
    logger.error({ err, job: name }, "Failed to schedule job");
  });
}

async function getNextMonthlySlotsRun(config: AppConfig): Promise<dayjs.Dayjs> {
  const settings = await getAutomationSettings(getPrisma());
  return buildMonthlyAutomationRunDate(dayjs().tz(config.timezone), settings);
}

async function getNextWeeklyMatchReviewRun(config: AppConfig): Promise<dayjs.Dayjs> {
  const settings = await getAutomationSettings(getPrisma());
  return buildWeeklyReviewRunDate(dayjs().tz(config.timezone), settings);
}

async function getNextFinalNotificationsRun(config: AppConfig): Promise<dayjs.Dayjs> {
  const settings = await getAutomationSettings(getPrisma());
  return buildWeeklyAutomationRunDate(
    dayjs().tz(config.timezone),
    settings.finalNotificationWeekday,
    settings.finalNotificationTime
  );
}

async function getNextPostgresBackupRun(config: AppConfig): Promise<dayjs.Dayjs> {
  const settings = await getAutomationSettings(getPrisma());
  return buildWeeklyAutomationRunDate(
    dayjs().tz(config.timezone),
    settings.backupWeekday,
    settings.backupTime
  );
}

async function maybeGenerateMonthlySlots(
  client: Client,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  const now = dayjs().tz(config.timezone);
  const prisma = getPrisma();
  const settings = await getAutomationSettings(prisma);

  if (!isMonthlyAutomationDay(now, settings)) {
    return;
  }

  const monthKey = now.format("YYYY-MM");
  const lastRun = await prisma.setting.findUnique({
    where: { key: MONTHLY_SLOTS_LAST_RUN_SETTING }
  });

  if (lastRun?.value === monthKey) {
    return;
  }

  logger.info({ month: monthKey }, "Starting automatic monthly slot generation");
  const result = await generateCurrentMonthSlots(client, config, logger);

  await prisma.setting.upsert({
    where: { key: MONTHLY_SLOTS_LAST_RUN_SETTING },
    create: {
      key: MONTHLY_SLOTS_LAST_RUN_SETTING,
      value: monthKey
    },
    update: {
      value: monthKey
    }
  });

  await sendScheduledSummary(client, config, logger, buildMonthlySlotGenerationSummary(result));
  logger.info({ month: monthKey, result }, "Automatic monthly slot generation completed");
}

async function maybeReviewUpcomingMatches(
  client: Client,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  const now = dayjs().tz(config.timezone);
  const runKey = now.format("YYYY-MM-DD");
  const prisma = getPrisma();
  const settings = await getAutomationSettings(prisma);
  const lastRun = await prisma.setting.findUnique({
    where: { key: WEEKLY_MATCH_REVIEW_LAST_RUN_SETTING }
  });

  if (lastRun?.value === runKey) {
    return;
  }

  logger.info({ runKey }, "Starting weekly match review");
  const result = await reviewUpcomingMatches(
    client,
    config,
    logger,
    settings.weeklyReviewLookaheadDays
  );

  await prisma.setting.upsert({
    where: { key: WEEKLY_MATCH_REVIEW_LAST_RUN_SETTING },
    create: {
      key: WEEKLY_MATCH_REVIEW_LAST_RUN_SETTING,
      value: runKey
    },
    update: {
      value: runKey
    }
  });

  await sendScheduledSummary(
    client,
    config,
    logger,
    buildWeeklyMatchReviewSummary(result, settings.weeklyReviewLookaheadDays)
  );
  logger.info({ runKey, result }, "Weekly match review completed");
}

async function maybeSendFinalNotifications(
  client: Client,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  const now = dayjs().tz(config.timezone);
  const runKey = now.format("YYYY-MM-DD");
  const prisma = getPrisma();
  const lastRun = await prisma.setting.findUnique({
    where: { key: FINAL_NOTIFICATIONS_LAST_RUN_SETTING }
  });

  if (lastRun?.value === runKey) {
    return;
  }

  logger.info({ runKey }, "Starting final match notifications");
  const result = await sendFinalMatchNotifications(client, config, logger);

  await prisma.setting.upsert({
    where: { key: FINAL_NOTIFICATIONS_LAST_RUN_SETTING },
    create: {
      key: FINAL_NOTIFICATIONS_LAST_RUN_SETTING,
      value: runKey
    },
    update: {
      value: runKey
    }
  });

  await sendScheduledSummary(client, config, logger, buildFinalNotificationSummary(result));
  logger.info({ runKey, result }, "Final match notifications completed");
}

async function maybeRunPostgresBackup(
  client: Client,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  const now = dayjs().tz(config.timezone);
  const runKey = now.format("YYYY-MM-DD");
  const prisma = getPrisma();
  const settings = await getAutomationSettings(prisma);
  const lastRun = await prisma.setting.findUnique({
    where: { key: POSTGRES_BACKUP_LAST_RUN_SETTING }
  });

  if (lastRun?.value === runKey) {
    return;
  }

  logger.info({ runKey, retentionDays: settings.backupRetentionDays }, "Starting Postgres backup");
  const result = await runPostgresBackup(config, logger, settings.backupRetentionDays);

  await prisma.setting.upsert({
    where: { key: POSTGRES_BACKUP_LAST_RUN_SETTING },
    create: {
      key: POSTGRES_BACKUP_LAST_RUN_SETTING,
      value: runKey
    },
    update: {
      value: runKey
    }
  });

  await sendScheduledSummary(client, config, logger, buildPostgresBackupSummary(result));
  logger.info({ runKey, result }, "Postgres backup completed");
}

function isMonthlyAutomationDay(now: dayjs.Dayjs, settings: AutomationSettings): boolean {
  return (
    now.day() === settings.monthlyWeekday && Math.ceil(now.date() / 7) === settings.monthlyWeek
  );
}

async function sendScheduledSummary(
  client: Client,
  config: AppConfig,
  logger: Logger,
  content: string
): Promise<void> {
  try {
    const channel = await client.channels.fetch(config.discordChannelId);
    if (!isSendableChannel(channel)) {
      logger.warn(
        { channelId: config.discordChannelId },
        "Scheduled summary notification channel is not sendable"
      );
      return;
    }

    await channel.send({ content });
  } catch (err) {
    logger.warn({ err, channelId: config.discordChannelId }, "Failed to send scheduled summary");
  }
}
