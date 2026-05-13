import assert from "node:assert/strict";
import test from "node:test";

import { formatSlotDays, normalizeSlotDays, parseSlotDaysInput } from "./slots";

test("parseSlotDaysInput accepts French labels and numeric weekdays", () => {
  assert.deepEqual(parseSlotDaysInput("mercredi, vendredi; 7"), [3, 5, 7]);
});

test("normalizeSlotDays deduplicates and maps Sunday to day zero", () => {
  assert.deepEqual(normalizeSlotDays([5, 7, 5, 3]), [0, 3, 5]);
});

test("formatSlotDays renders configured weekdays in French short labels", () => {
  assert.equal(formatSlotDays([5, 3]), "Mer, Ven");
});
