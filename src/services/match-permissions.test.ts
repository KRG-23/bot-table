import assert from "node:assert/strict";
import test from "node:test";

import { canUseMatchAction, isMatchPlayer, type MatchPlayers } from "./match-permissions";

const PLAYER_1 = "111111111111111111";
const PLAYER_2 = "222222222222222222";
const OUTSIDER = "333333333333333333";

const match: MatchPlayers = {
  player1: { discordId: PLAYER_1 },
  player2: { discordId: PLAYER_2 }
};

test("isMatchPlayer detects both players", () => {
  assert.equal(isMatchPlayer(PLAYER_1, match), true);
  assert.equal(isMatchPlayer(PLAYER_2, match), true);
  assert.equal(isMatchPlayer(OUTSIDER, match), false);
});

test("validate and refuse actions are admin-only", () => {
  assert.equal(canUseMatchAction("validate", true, OUTSIDER, match), true);
  assert.equal(canUseMatchAction("refuse", true, OUTSIDER, match), true);

  assert.equal(canUseMatchAction("validate", false, PLAYER_1, match), false);
  assert.equal(canUseMatchAction("refuse", false, PLAYER_1, match), false);
  assert.equal(canUseMatchAction("validate", false, OUTSIDER, match), false);
  assert.equal(canUseMatchAction("refuse", false, OUTSIDER, match), false);
});

test("cancel action is allowed for admins and involved players only", () => {
  assert.equal(canUseMatchAction("cancel", true, OUTSIDER, match), true);
  assert.equal(canUseMatchAction("cancel", false, PLAYER_1, match), true);
  assert.equal(canUseMatchAction("cancel", false, PLAYER_2, match), true);
  assert.equal(canUseMatchAction("cancel", false, OUTSIDER, match), false);
});
