import { MatchStatus } from "@prisma/client";

export const BLOCKING_MATCH_STATUSES: MatchStatus[] = [MatchStatus.EN_ATTENTE, MatchStatus.VALIDE];

export function isBlockingMatchStatus(status: MatchStatus): boolean {
  return BLOCKING_MATCH_STATUSES.includes(status);
}
