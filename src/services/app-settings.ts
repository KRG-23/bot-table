import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../config";

export const APP_SETTINGS_KEYS = {
  mentionInThread: "notifications_mention_in_thread"
} as const;

export type AppSettings = {
  mentionInThread: boolean;
};

export async function getAppSettings(
  prisma: PrismaClient,
  config: AppConfig
): Promise<AppSettings> {
  const setting = await prisma.setting.findUnique({
    where: { key: APP_SETTINGS_KEYS.mentionInThread }
  });

  return {
    mentionInThread: parseBooleanSetting(setting?.value) ?? config.mentionInThread
  };
}

export async function saveMentionInThread(prisma: PrismaClient, enabled: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: APP_SETTINGS_KEYS.mentionInThread },
    create: { key: APP_SETTINGS_KEYS.mentionInThread, value: String(enabled) },
    update: { value: String(enabled) }
  });
}

export function formatMentionInThread(enabled: boolean): string {
  return enabled ? "Activées" : "Désactivées";
}

function parseBooleanSetting(value?: string | null): boolean | null {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}
