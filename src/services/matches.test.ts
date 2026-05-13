import assert from "node:assert/strict";
import test from "node:test";

import { MatchStatus } from "@prisma/client";

import { BLOCKING_MATCH_STATUSES, isBlockingMatchStatus } from "./matches";

test("blocking match statuses only include pending and validated matches", () => {
  assert.deepEqual(BLOCKING_MATCH_STATUSES, [MatchStatus.EN_ATTENTE, MatchStatus.VALIDE]);
});

test("isBlockingMatchStatus releases refused and cancelled matches", () => {
  assert.equal(isBlockingMatchStatus(MatchStatus.EN_ATTENTE), true);
  assert.equal(isBlockingMatchStatus(MatchStatus.VALIDE), true);
  assert.equal(isBlockingMatchStatus(MatchStatus.REFUSE), false);
  assert.equal(isBlockingMatchStatus(MatchStatus.ANNULE), false);
});
