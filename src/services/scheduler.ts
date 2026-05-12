import dayjs from "dayjs";
import type { Client, InteractionReplyOptions, Message } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config";
import { getPrisma } from "../db";

import { buildMonthlySlotGenerationSummary, generateCurrentMonthSlots } from "./monthly-slots";

const MONTHLY_SLOTS_LAST_RUN_SETTING = "monthly_slots_last_auto_run";
const SCHEDULER_CHECK_INTERVAL_MS = 60 * 60 * 1000;

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

export function startMonthlySlotsScheduler(
  client: Client,
  config: AppConfig,
  logger: Logger
): void {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      await maybeGenerateMonthlySlots(client, config, logger);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, SCHEDULER_CHECK_INTERVAL_MS);
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

  await notifyMonthlySlotGeneration(
    client,
    config,
    logger,
    buildMonthlySlotGenerationSummary(result)
  );
  logger.info({ month: monthKey, result }, "Automatic monthly slot generation completed");
}

async function notifyMonthlySlotGeneration(
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
        "Monthly slot generation notification channel is not sendable"
      );
      return;
    }

    await channel.send({ content });
  } catch (err) {
    logger.warn(
      { err, channelId: config.discordChannelId },
      "Failed to send monthly slots summary"
    );
  }
}
