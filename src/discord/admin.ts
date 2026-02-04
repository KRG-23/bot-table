import type { APIInteractionGuildMember, GuildMember } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type { AppConfig } from "../config";

type InteractionMember = GuildMember | APIInteractionGuildMember;

function hasAdminRole(member: InteractionMember, roleId: string): boolean {
  if ("roles" in member) {
    if (Array.isArray(member.roles)) {
      return member.roles.includes(roleId);
    }

    return member.roles.cache.has(roleId);
  }

  return false;
}

export function isAdminMember(member: InteractionMember, config: AppConfig): boolean {
  if (config.adminRoleId) {
    return hasAdminRole(member, config.adminRoleId);
  }

  if ("permissions" in member) {
    return member.permissions.has(PermissionFlagsBits.Administrator);
  }

  return false;
}
