// Self-hosted page-view counters (no cookies, no third parties, no
// identifiers).
//
// The client sends one small beacon per page per visit to POST /api/track;
// this module keeps a per-day counter in KV keyed by
// "views:YYYY-MM-DD:page:week" (America/Toronto days, matching the rest of
// the site). Counts are approximate — they include bots and cannot be
// attributed to anyone — and are published as aggregates only.
import { trackPageKey } from "./domain.js";

export function torontoDay(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const jsonBody = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export async function trackView(req, env) {
  // A same-origin beacon: a JSON POST whose Origin (when present) matches
  // the request's own origin. Cross-site pages cannot inflate the counters,
  // and no identifiers, cookies, or IPs are stored — only aggregate counts.
  const sentOrigin = req.headers.get("origin");
  const sameOrigin = sentOrigin == null || sentOrigin === new URL(req.url).origin;
  const allowed =
    req.method === "POST" &&
    env.XCF_KV &&
    req.headers.get("content-type") === "application/json" &&
    sameOrigin;
  if (!allowed) return new Response("Not found", { status: 404 });
  if (Number(req.headers.get("content-length")) > 512)
    return new Response("Bad request", { status: 400 });
  let data;
  try {
    const reader = req.body?.getReader();
    if (!reader) return new Response("Bad request", { status: 400 });
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) {
        await reader.cancel();
        return new Response("Bad request", { status: 400 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data))
      return new Response("Bad request", { status: 400 });
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const day = torontoDay();
  const key = `views:${day}:${trackPageKey(data.page, data.week)}`;
  let count = 0;
  const stored = await env.XCF_KV.get(key);
  if (stored != null) {
    const n = Number(stored);
    count = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  count = Math.min(count + 1, 100000);
  await env.XCF_KV.put(key, String(count), { expirationTtl: 60 * 60 * 24 * 16 });
  return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function viewsSummary(env) {
  const empty = { days: [], totals: {}, total: 0, generated: torontoDay() };
  if (!env.XCF_KV) return jsonBody(empty);
  const keys = [];
  let cursor;
  try {
    do {
      const page = await env.XCF_KV.list({
        prefix: "views:",
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      keys.push(...(page.keys || []));
      if (page.list_complete !== false || !page.cursor || page.cursor === cursor) break;
      cursor = page.cursor;
    } while (true);
  } catch {
    return jsonBody(empty);
  }
  const days = new Set();
  for (const k of keys) {
    const rest = k.name.slice("views:".length);
    if (/^\d{4}-\d{2}-\d{2}:/.test(rest)) days.add(rest.slice(0, 10));
  }
  const dayList = [...days].sort().reverse().slice(0, 14);
  const daysOut = await Promise.all(
    dayList.map(async (day) => {
      const prefix = `views:${day}:`;
      const rows = keys.filter((k) => k.name.startsWith(prefix));
      const pages = {};
      await Promise.all(rows.map(async (k) => {
        const pageKey = k.name.slice(prefix.length);
        const n = Number(await env.XCF_KV.get(k.name)) || 0;
        pages[pageKey] = pages[pageKey] ? pages[pageKey] + n : n;
      }));
      return { day, pages };
    }),
  );
  const totals = {};
  let all = 0;
  for (const d of daysOut)
    for (const [pageKey, n] of Object.entries(d.pages)) {
      totals[pageKey] = (totals[pageKey] || 0) + n;
      all += n;
    }
  return jsonBody({ generated: torontoDay(), days: daysOut, totals, total: all });
}
