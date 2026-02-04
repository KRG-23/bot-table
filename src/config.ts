import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  discordToken: string;
  discordGuildId: string;
  discordChannelId: string;
  discordAppId: string;
  discordPublicKey?: string;
  adminRoleId?: string;
  mentionInThread: boolean;
  logLevel: string;
  timezone: string;
  databaseUrl?: string;
  vacationAcademy: string;
  allowInsecureTls: boolean;
  dnsResultOrder: "ipv4first" | "ipv6first" | "verbatim";
  discordForceIpv4: boolean;
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
    adminRoleId: process.env.ADMIN_ROLE_ID,
    mentionInThread: process.env.MENTION_IN_THREAD === "true",
    logLevel: process.env.LOG_LEVEL || "info",
    timezone: process.env.TZ || "Europe/Paris",
    databaseUrl: process.env.DATABASE_URL,
    vacationAcademy: process.env.VACATION_ACADEMY || "Nantes",
    allowInsecureTls: process.env.ALLOW_INSECURE_TLS === "true",
    dnsResultOrder: resolveDnsResultOrder(process.env.DNS_RESULT_ORDER),
    discordForceIpv4: process.env.DISCORD_FORCE_IPV4 !== "false"
  };
}

function resolveDnsResultOrder(value?: string): "ipv4first" | "ipv6first" | "verbatim" {
  if (!value) {
    return "ipv4first";
  }

  if (value === "ipv4first" || value === "ipv6first" || value === "verbatim") {
    return value;
  }

  return "ipv4first";
}
