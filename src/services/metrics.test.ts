import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMetricsSnapshot,
  getMetricsSnapshot,
  incrementMetric,
  resetMetricsForTests
} from "./metrics";

test("metrics counters start at zero and can be incremented", () => {
  resetMetricsForTests();

  incrementMetric("matchCreated");
  incrementMetric("matchAutoValidated", 3);

  const snapshot = getMetricsSnapshot();
  assert.equal(snapshot.counters.matchCreated, 1);
  assert.equal(snapshot.counters.matchAutoValidated, 3);
  assert.equal(snapshot.counters.dmFailures, 0);
});

test("formatMetricsSnapshot renders the key counters", () => {
  resetMetricsForTests();
  incrementMetric("discordInteractions", 2);
  incrementMetric("dmFailures");

  const output = formatMetricsSnapshot(getMetricsSnapshot());

  assert.match(output, /Interactions Discord : 2/);
  assert.match(output, /Échecs DM : 1/);
});
