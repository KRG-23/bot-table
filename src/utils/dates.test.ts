import assert from "node:assert/strict";
import test from "node:test";

import { formatFrenchDate, parseFrenchDate, parseFrenchDayMonth } from "./dates";

const TZ = "Europe/Paris";

test("parseFrenchDate keeps French day boundaries before and after DST start", () => {
  const beforeDst = parseFrenchDate("28/03/2026", TZ);
  const dstDay = parseFrenchDate("29/03/2026", TZ);
  const afterDst = parseFrenchDate("30/03/2026", TZ);

  assert.equal(beforeDst?.format("YYYY-MM-DD HH:mm Z"), "2026-03-28 00:00 +01:00");
  assert.equal(dstDay?.format("YYYY-MM-DD HH:mm Z"), "2026-03-29 00:00 +01:00");
  assert.equal(afterDst?.format("YYYY-MM-DD HH:mm Z"), "2026-03-30 00:00 +02:00");
});

test("parseFrenchDate keeps French day boundaries before and after DST end", () => {
  const beforeEnd = parseFrenchDate("24/10/2026", TZ);
  const dstEndDay = parseFrenchDate("25/10/2026", TZ);
  const afterEnd = parseFrenchDate("26/10/2026", TZ);

  assert.equal(beforeEnd?.format("YYYY-MM-DD HH:mm Z"), "2026-10-24 00:00 +02:00");
  assert.equal(dstEndDay?.format("YYYY-MM-DD HH:mm Z"), "2026-10-25 00:00 +02:00");
  assert.equal(afterEnd?.format("YYYY-MM-DD HH:mm Z"), "2026-10-26 00:00 +01:00");
});

test("formatFrenchDate renders parsed dates in JJ/MM/AAAA", () => {
  const parsed = parseFrenchDate("13/05/2026", TZ);

  assert.equal(parsed ? formatFrenchDate(parsed) : null, "13/05/2026");
});

test("parseFrenchDayMonth accepts accented French month names", () => {
  assert.deepEqual(parseFrenchDayMonth("Soirée Warhammer le 15 février"), {
    day: 15,
    month: 1
  });
  assert.deepEqual(parseFrenchDayMonth("Soirée AoS le 3 août"), {
    day: 3,
    month: 7
  });
});
