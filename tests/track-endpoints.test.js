import test from "node:test";
import assert from "node:assert/strict";
import { trackView, viewsSummary, torontoDay } from "../src/track.js";

// In-memory stand-in for the XCF_KV namespace.
const memKV = () => {
  const store = new Map();
  const putOptions = new Map();
  return {
    putOptions,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v, options = {}) => {
      store.set(k, String(v));
      putOptions.set(k, options);
    },
    list: async ({ prefix = "", limit = 1000, cursor } = {}) => {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix));
      const offset = cursor ? Number(cursor) || 0 : 0;
      const keys = all.slice(offset, offset + limit).map((name) => ({ name }));
      const list_complete = offset + limit >= all.length;
      return {
        keys,
        list_complete,
        ...(list_complete ? {} : { cursor: String(offset + limit) }),
      };
    },
  };
};
const env = (kv = memKV()) => ({ XCF_KV: kv });
const ORIGIN = "https://xclubfantasy.robsplex.com";

const post = (body, { origin, ct = "application/json", method = "POST" } = {}) =>
  new Request(`${ORIGIN}/api/track`, {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": ct, ...(origin ? { origin } : {}) },
  });

test("one beacon per call, same origin or no origin header, lands in one bucket", async () => {
  const kv = memKV();
  for (const origin of ["https://xclubfantasy.robsplex.com", null]) {
    const r = await trackView(post({ page: "home" }, { origin }), env(kv));
    assert.equal(r.status, 202);
  }
  const keys = await kv.list({ prefix: "views:" });
  assert.equal(keys.keys.length, 1);
  assert.match(keys.keys[0].name, /^views:\d{4}-\d{2}-\d{2}:home:0$/);
  assert.equal(await kv.get(keys.keys[0].name), "2");
  assert.equal(kv.putOptions.get(keys.keys[0].name).expirationTtl, 60 * 60 * 24 * 16);
});

test("rejects cross-origin, non-JSON and non-POST traffic", async () => {
  const kv = memKV();
  const e = env(kv);
  assert.equal((await trackView(post({ page: "home" }, { origin: "https://evil.example" }), e)).status, 404);
  assert.equal((await trackView(post({ page: "home" }, { ct: "text/plain" }), e)).status, 404);
  assert.equal((await trackView(post("not json {}", {}), e)).status, 400);
  assert.equal((await trackView(new Request(`${ORIGIN}/api/track`, { method: "GET" }), e)).status, 404);
  assert.equal((await kv.list({ prefix: "views:" })).keys.length, 0);
});

test("malformed, null, and oversized tracking payloads never throw or write", async () => {
  const kv = memKV();
  const e = env(kv);
  for (const body of ["null", "[]", "not json {}", " ".repeat(513)]) {
    assert.equal((await trackView(post(body), e)).status, 400);
  }
  assert.equal((await kv.list({ prefix: "views:" })).keys.length, 0);
});

test("unknown pages are bucketed as other; oversized bodies are rejected", async () => {
  const kv = memKV();
  const e = env(kv);
  assert.equal((await trackView(post({ page: "zzz" }), e)).status, 202);
  assert.equal((await trackView(post({ page: "home", x: "a".repeat(600) }), e)).status, 400);
  const keys = await kv.list({ prefix: "views:" });
  assert.equal(keys.keys.length, 1);
  assert.match(keys.keys[0].name, /:other:0$/);
});

test("the week bucket is honoured and clamped to the season range", async () => {
  const kv = memKV();
  const e = env(kv);
  assert.equal((await trackView(post({ page: "home", week: 3 }), e)).status, 202);
  assert.equal((await trackView(post({ page: "home", week: 42 }), e)).status, 202);
  const names = (await kv.list({ prefix: "views:" })).keys.map((k) => k.name);
  assert.ok(names.some((n) => n.endsWith(":home:3")));
  assert.ok(names.some((n) => n.endsWith(":home:0")));
  assert.equal(names.length, 2);
});

test("viewsSummary aggregates per page and lists recent days newest first", async () => {
  const kv = memKV();
  const e = env(kv);
  const today = torontoDay();
  await kv.put(`views:${today}:home:0`, "7");
  await kv.put(`views:${today}:story:0`, "3");
  assert.equal((await trackView(post({ page: "matchups" }), e)).status, 202);
  const r = await viewsSummary(e);
  assert.equal(r.status, 200);
  const v = await r.json();
  assert.equal(v.total, 11);
  assert.equal(v.totals["home:0"], 7);
  assert.equal(v.totals["story:0"], 3);
  assert.equal(v.totals["matchups:0"], 1);
  assert.ok(Array.isArray(v.days) && v.days.length >= 1);
  assert.equal(v.days[0].day, today);
});

test("viewsSummary paginates beyond KV's 1,000-key page", async () => {
  const kv = memKV();
  const today = torontoDay();
  for (let i = 0; i < 1001; i++) await kv.put(`views:${today}:other:${i}`, "1");
  const v = await (await viewsSummary(env(kv))).json();
  assert.equal(v.total, 1001);
  assert.equal(v.days[0].day, today);
});

test("viewsSummary degrades to an empty summary without a KV binding", async () => {
  const v = await (await viewsSummary({})).json();
  assert.deepEqual(v.days, []);
  assert.deepEqual(v.totals, {});
  assert.equal(v.total, 0);
});

test("day buckets follow the America/Toronto calendar, not UTC", () => {
  // 2026-09-29T02:30:00Z is still 2026-09-28 in Toronto (EDT, UTC-4).
  assert.equal(torontoDay(Date.UTC(2026, 8, 29, 2, 30)), "2026-09-28");
  // 2026-09-29T05:30:00Z is already 2026-09-29 in Toronto.
  assert.equal(torontoDay(Date.UTC(2026, 8, 29, 5, 30)), "2026-09-29");
});
