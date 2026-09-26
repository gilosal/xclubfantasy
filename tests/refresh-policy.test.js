import test from "node:test";
import assert from "node:assert/strict";
import { forceRefreshDue, schedulePayloadRefresh } from "../src/refresh-policy.js";

test("cron explicitly requests a refresh while passing through existing KV throttling", async () => {
  const env = {};
  const ctx = { waitUntil(promise) { this.accepted = promise; } };
  const seen = [];
  schedulePayloadRefresh(env, ctx, async (...args) => { seen.push(args); return "rebuilt"; });
  assert.equal(await ctx.accepted, "rebuilt");
  assert.equal(seen[0][0], env);
  assert.equal(seen[0][1], ctx);
  assert.deepEqual(seen[0][2], { forceRequested: true });
});

test("force refresh still respects its minimum elapsed interval", () => {
  assert.equal(forceRefreshDue(true, 1000, 1200, 100), true);
  assert.equal(forceRefreshDue(true, 1000, 1050, 100), false);
  assert.equal(forceRefreshDue(false, 1000, 5000, 100), false);
});
