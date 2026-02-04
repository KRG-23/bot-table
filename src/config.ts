import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  discordToken: string;
  discordGuildId: string;
  discordChannelId: string;
  discordAppId: string;
  discordPublicKey?: string;
  mentionInThread: boolean;
  logLevel: string;
  timezone: string;
  databaseUrl?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

export function loadConfig(): AppConfig {
  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordGuildId: requireEnv("DISCORD_GUILD_ID"),
    discordChannelId: requireEnv("DISCORD_CHANNEL_ID"),
    discordAppId: requireEnv("DISCORD_APP_ID"),
    discordPublicKey: process.env.DISCORD_PUBLIC_KEY,
    mentionInThread: process.env.MENTION_IN_THREAD === "true",
    logLevel: process.env.LOG_LEVEL || "info",
    timezone: process.env.TZ || "Europe/Paris",
    databaseUrl: process.env.DATABASE_URL
  };
}
