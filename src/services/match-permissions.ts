export type MatchAction = "validate" | "refuse" | "cancel";

export type MatchPlayers = {
  player1: { discordId: string };
  player2: { discordId: string };
};

export function isMatchPlayer(userId: string, match: MatchPlayers): boolean {
  return userId === match.player1.discordId || userId === match.player2.discordId;
}

export function canUseMatchAction(
  action: MatchAction,
  isAdmin: boolean,
  userId: string,
  match: MatchPlayers
): boolean {
  if (action === "cancel") {
    return isAdmin || isMatchPlayer(userId, match);
  }

  return isAdmin;
}
