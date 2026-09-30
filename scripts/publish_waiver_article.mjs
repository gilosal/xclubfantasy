#!/usr/bin/env node
// Publish one Wednesday-after-waivers newsroom edition per season/week.
// The only external write is the single season manifest in the production
// XCF_KV namespace. No LLM, credentials, or guessed transaction details.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waiverDispatchArticle } from "../src/domain.js";
import { BUILD } from "../src/build.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = "https://xclubfantasy.robsplex.com";
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const dry = process.argv.includes("--dry-run");
const now = new Date();
const zoned = (date, options) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", ...options }).format(date);
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(now);
const part = (name) => parts.find((p) => p.type === name)?.value;
const day = `${part("year")}-${part("month")}-${part("day")}`;
const weekday = zoned(now, { weekday: "short" });

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function kv(args) {
  if (!existsSync(wrangler)) throw new Error("Pinned local Wrangler installation is missing; no publication was attempted");
  return run(process.execPath, [wrangler, "kv", "key", ...args, "--binding", "XCF_KV", "--remote", "--config", "wrangler.jsonc"]);
}
function livePayload() {
  const raw = run("curl.exe", ["-fsSL", "--max-time", "45", "-H", "Accept: application/json", `${site}/api/data?refresh=1`]);
  const d = JSON.parse(raw);
  if (d.build !== BUILD || d.stale || !Array.isArray(d.transactions)) throw new Error("Production build or transaction feed is not ready; publication aborted");
  if (String(d.season) !== part("year") || !Number.isInteger(Number(d.current_week))) throw new Error("Season/week mismatch; publication aborted");
  if (!Number.isFinite(Number(d.asof)) || now.getTime() - Number(d.asof) > 90 * 60 * 1000 || Number(d.asof) > now.getTime() + 60000) throw new Error("League feed is stale or future-dated; publication aborted");
  return d;
}

async function main() {
  if (weekday !== "Wed") return; // scheduler may retry on another day; never reuse old claims
  const d = livePayload();
  const article = waiverDispatchArticle(d, day);
  if (!article) return; // no completed claims in today's batch: no fabricated article
  if (dry) {
    console.log(JSON.stringify({ day, season: d.season, week: d.current_week, headline: article.headline, dek: article.dek, body: article.body }, null, 2));
    return;
  }
  const key = `published-articles:${d.season}`;
  const listing = JSON.parse(kv(["list", "--prefix", key]));
  const exists = listing.some((item) => item.name === key);
  const old = exists ? JSON.parse(kv(["get", key, "--text"])) : [];
  if (!Array.isArray(old)) throw new Error("Existing newsroom manifest is invalid; refusing overwrite");
  const entry = { season: String(d.season), week: Number(d.current_week), article };
  const prior = old.find((item) => Number(item.week) === entry.week && String(item.season) === entry.season);
  if (prior) {
    if (prior.article?.id !== article.id) throw new Error("Conflicting published edition; refusing overwrite");
    return; // idempotent: an already-released article is never revised or announced twice
  }
  const next = [...old, entry];
  const scratch = join(process.env.LOCALAPPDATA || dirname(root), "hermes", "cache", "scratch");
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, "xcf-waiver-"));
  try {
    const file = join(tmp, "manifest.json");
    writeFileSync(file, JSON.stringify(next), { encoding: "utf8", flag: "wx" });
    kv(["put", key, "--path", file]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const stored = JSON.parse(kv(["get", key, "--text"]));
  if (!Array.isArray(stored) || !stored.some((item) => item.week === entry.week && item.article?.headline === article.headline)) throw new Error("KV read-back does not contain the new edition");
  // The API overlays the manifest on both cached and refreshed league payloads.
  // KV is eventually consistent (~60 s), so poll the live read-back a few times
  // before declaring failure; the article itself is never written twice.
  let live = null;
  for (let attempt = 1; attempt <= 5 && !live; attempt++) {
    if (attempt > 1) await sleep(20000);
    const probe = livePayload();
    if ((probe.articles || []).some((item) => item.id === article.id && item.headline === article.headline) &&
        (probe.archive || []).some((week) => Number(week.week) === entry.week && (week.articles || []).some((item) => item.id === article.id))) {
      live = probe;
    }
  }
  if (!live) throw new Error("KV write succeeded, but production article/archive read-back has not propagated after retries; no duplicate write");
  console.log(`📰 **${article.headline}**\n${article.dek}\n\nRead the full Onion-style waiver dispatch: ${site}/#story/${article.id}\nFiled in the archive: ${site}/#archive`);
}
main().catch((err) => {
  console.error(`XClub waiver publication failed: ${err.message}`);
  process.exitCode = 1;
});
