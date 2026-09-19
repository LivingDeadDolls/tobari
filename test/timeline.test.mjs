import test from "node:test";
import assert from "node:assert/strict";
import { observedIntervals, active } from "../web/model.js";
test("長い無通知区間を稼働として塗り続けない", () => {
  const start = Date.parse("2026-09-20T00:00:00Z");
  const events = [
    {
      actor: "a",
      kind: "UserPromptSubmit",
      received: new Date(start).toISOString(),
    },
    {
      actor: "a",
      kind: "Stop",
      received: new Date(start + 90000).toISOString(),
    },
  ];
  assert.deepEqual(observedIntervals(events, "a", start + 120000), [
    { start, end: start + 30000, state: "running" },
    { start: start + 30000, end: start + 90000, state: "unknown" },
  ]);
  assert.equal(
    active(
      { operational: "running", last_observed: events[0].received },
      start + 90000,
    ),
    false,
  );
  assert.deepEqual(observedIntervals(events, "other", start + 120000), []);
});
