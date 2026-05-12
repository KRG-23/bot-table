import dayjs from "dayjs";
import type { Client, InteractionReplyOptions, Message } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";

import { buildWeeklyMatchReviewSummary, reviewUpcomingMatches } from "./match-review";
import { buildMonthlySlotGenerationSummary, generateCurrentMonthSlots } from "./monthly-slots";

const MONTHLY_SLOTS_LAST_RUN_SETTING = "monthly_slots_last_auto_run";
const WEEKLY_MATCH_REVIEW_LAST_RUN_SETTING = "weekly_match_review_last_auto_run";
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

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

function isFirstSunday(date: dayjs.Dayjs): boolean {
  return date.date() <= 7 && date.day() === 0;
}

function isAtOrAfterHour(date: dayjs.Dayjs, hour: number): boolean {
  return date.hour() >= hour;
}

export function startSchedulers(client: Client, config: AppConfig, logger: Logger): void {
  void runStartupCatchUp(client, config, logger).catch((err) => {
    logger.error({ err }, "Scheduler startup catch-up failed");
  });

  scheduleJob(config, logger, "monthly_slots", getNextMonthlySlotsRun, async () => {
    await maybeGenerateMonthlySlots(client, config, logger);
  });

  scheduleJob(config, logger, "weekly_match_review", getNextWeeklyMatchReviewRun, async () => {
    await maybeReviewUpcomingMatches(client, config, logger);
  });
}

async function runStartupCatchUp(client: Client, config: AppConfig, logger: Logger): Promise<void> {
  const now = dayjs().tz(config.timezone);

  if (isFirstSunday(now) && isAtOrAfterHour(now, 9)) {
    await maybeGenerateMonthlySlots(client, config, logger);
  }

  if (now.day() === 3 && isAtOrAfterHour(now, 21)) {
    await maybeReviewUpcomingMatches(client, config, logger);
  }
}

function scheduleJob(
  config: AppConfig,
  logger: Logger,
  name: string,
  getNextRun: (now: dayjs.Dayjs) => dayjs.Dayjs,
  task: () => Promise<void>
): void {
  let running = false;

  const scheduleNext = (): void => {
    const now = dayjs().tz(config.timezone);
    const nextRun = getNextRun(now);
    const delayMs = Math.max(0, nextRun.valueOf() - now.valueOf());
    const currentDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);

    logger.info({ job: name, nextRun: nextRun.toISOString() }, "Scheduler job planned");

    setTimeout(() => {
      if (delayMs > MAX_TIMEOUT_MS) {
        scheduleNext();
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
          scheduleNext();
        }
      };

      void run();
    }, currentDelayMs);
  };

  scheduleNext();
}

function getNextMonthlySlotsRun(now: dayjs.Dayjs): dayjs.Dayjs {
  let cursor = now.startOf("month");

  while (true) {
    let candidate = cursor.hour(9).minute(0).second(0).millisecond(0);
    while (candidate.day() !== 0) {
      candidate = candidate.add(1, "day");
    }

    if (candidate.isAfter(now)) {
      return candidate;
    }

    cursor = cursor.add(1, "month").startOf("month");
  }
}

function getNextWeeklyMatchReviewRun(now: dayjs.Dayjs): dayjs.Dayjs {
  let candidate = now.day(3).hour(21).minute(0).second(0).millisecond(0);

  if (!candidate.isAfter(now)) {
    candidate = candidate.add(7, "day");
  }

  return candidate;
}

async function maybeGenerateMonthlySlots(
  client: Client,
  config: AppConfig,
  logger: Logger
): Promise<void> {
  const now = dayjs().tz(config.timezone);
  if (!isFirstSunday(now)) {
    return;
  }

  const monthKey = now.format("YYYY-MM");
  const prisma = getPrisma();
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
  const lastRun = await prisma.setting.findUnique({
    where: { key: WEEKLY_MATCH_REVIEW_LAST_RUN_SETTING }
  });

  if (lastRun?.value === runKey) {
    return;
  }

  logger.info({ runKey }, "Starting weekly match review");
  const result = await reviewUpcomingMatches(client, config, logger);

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

  await sendScheduledSummary(client, config, logger, buildWeeklyMatchReviewSummary(result));
  logger.info({ runKey, result }, "Weekly match review completed");
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
