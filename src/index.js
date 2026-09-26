// XClub: public, read-only league coverage. No Sleeper credentials are used.
import BUNDLE from "../public/data/players.json";
import HISTORY from "../public/data/history.json";
import {
  round,
  rosterPoints,
  projection,
  scoreOf,
  weekWindow,
  pairGames,
  rankStandings,
  bestBenchSwap,
  weekMode,
  weeklyAwards,
  injuryDesk,
  teamForm,
  seasonTopPerformers,
  weekendHype,
  weekendNarrative,
  featuredMatchup,
  refreshWindow,
  waiverDesk,
  ogMeta,
  buildEditorial,
  slateArticles,
  slateFinalArticles,
} from "./domain.js";
import { rewrittenHtmlHeaders } from "./http-headers.js";
import { forceRefreshDue, schedulePayloadRefresh } from "./refresh-policy.js";

const LID = "1371971946459201536";
const API = "https://api.sleeper.app/v1";
const BUILD = "2026-09-26-fixes2";
const ORIGIN = "https://xclubfantasy.robsplex.com";
const escAttr = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
// A metadata refresh changes the imported bundle even when the Worker code does not.
// Include its verified snapshot timestamp so a new deployment cannot reuse the old
// KV payload created under the previous static bundle.
const BUNDLE_KEY_VERSION = String(BUNDLE.generated_at || "unknown").replace(
  /[^A-Za-z0-9_-]/g,
  "",
);
const CACHE_KEY = `payload:v4-${BUILD}-${BUNDLE_KEY_VERSION}`;
// Live game windows refresh on a much faster cadence than the rest of the
// season: the cached payload is only trusted for five minutes, and a client
// ?refresh=1 request can force a Sleeper rebuild every five minutes (instead
// of ten). Outside game windows the hourly cron keeps the data fresh enough.
const LIVE_TTL_MS = 5 * 60000;
const LIVE_FORCE_MIN_MS = 5 * 60000;
const DAY_TTL_MS = 3600000;
const DAY_FORCE_MIN_MS = 600000;
const isLivePayload = (p) =>
  !!p &&
  (p.week_mode?.mode === "live" ||
    (p.next_week?.status === "in_progress" &&
      (p.next_week?.games || []).length > 0));
const norm = (pid) => String(pid ?? "").replace(/^TEAM_/, "");
const image = (pid) =>
  /^\d+$/.test(pid) && pid !== "0"
    ? `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`
    : null;
function player(pid) {
  pid = norm(pid);
  if (!pid || pid === "0")
    return {
      pid: "0",
      name: "Empty slot",
      pos: "",
      positions: [],
      team: "",
      img: null,
      injury: null,
    };
  const p = BUNDLE.players[pid] || BUNDLE.players[`TEAM_${pid}`];
  const def = /^[A-Z]{2,3}$/.test(pid);
  return {
    pid,
    name: p?.n || (def ? `${pid} D/ST` : `Player ${pid}`),
    pos: p?.p || (def ? "DEF" : ""),
    positions: p?.fp || [p?.p],
    team: p?.t || "",
    injury: p?.i || null,
    img: image(pid),
  };
}
async function j(path) {
  const res = await fetch(`${API}${path}`, {
    signal: AbortSignal.timeout(15000),
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Sleeper ${res.status} (${path.split("?")[0]})`);
  return res.json();
}

export async function buildPayload() {
  const [league, users, rosters, state] = await Promise.all([
    j(`/league/${LID}`),
    j(`/league/${LID}/users`),
    j(`/league/${LID}/rosters`),
    j("/state/nfl"),
  ]);
  const season = league.season;
  const { current: cw, completed: lw, matchup: matchupWeek } = weekWindow(league, state);
  const slots = (league.roster_positions || []).filter(
    (p) => !["BN", "IR"].includes(p),
  );
  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const notices = [];
  const optional = async (path, fallback, label) => {
    try {
      return await j(path);
    } catch {
      notices.push(`${label} is temporarily unavailable.`);
      return fallback;
    }
  };
  const teams = {};
  const ownership = new Map();
  for (const r of rosters) {
    const u = userMap.get(r.owner_id),
      s = r.settings || {};
    teams[r.roster_id] = {
      rid: r.roster_id,
      uid: r.owner_id,
      name: (
        u?.metadata?.team_name ||
        u?.display_name ||
        `Team ${r.roster_id}`
      ).trim(),
      manager: u?.display_name || "",
      avatar: u?.avatar
        ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}`
        : null,
      wins: s.wins || 0,
      losses: s.losses || 0,
      ties: s.ties || 0,
      fpts: rosterPoints(s, "fpts"),
      pa: rosterPoints(s, "fpts_against"),
      moves: s.total_moves || 0,
      faab_used: s.waiver_budget_used || 0,
      streak: r.metadata?.streak || "",
    };
    for (const pid of r.players || []) ownership.set(norm(pid), r.roster_id);
  }
  const activeWeeks = Array.from({ length: lw }, (_, i) => i + 1);
  const txWeeks = [...new Set([cw, cw - 1].filter((w) => w >= 1))];
  const [completedRows, currentRows, proj, trending, txData, drafts] =
    await Promise.all([
      Promise.all(activeWeeks.map((w) => j(`/league/${LID}/matchups/${w}`))),
      j(`/league/${LID}/matchups/${matchupWeek}`),
      optional(`/projections/nfl/regular/${season}/${matchupWeek}`, {}, "Projections"),
      optional(
        "/players/nfl/trending/add?lookback_hours=168&limit=25",
        [],
        "Trending adds",
      ),
      Promise.all(
        txWeeks.map((w) =>
          optional(`/league/${LID}/transactions/${w}`, [], "Transactions"),
        ),
      ),
      optional(`/league/${LID}/drafts`, [], "Draft data"),
    ]);
  const projOf = (pid) =>
    projection(proj[norm(pid)] || proj[`TEAM_${norm(pid)}`]);
  const pointsOf = (m, pid) =>
    Number.isFinite(m.players_points?.[pid])
      ? round(m.players_points[pid])
      : null;
  const makeSide = (m, preview = false) => {
    const t = teams[m.roster_id];
    const starters = (m.starters || []).map((pid, i) => ({
      ...player(pid),
      slot: slots[i] || "",
      pts: Number.isFinite(m.starters_points?.[i])
        ? round(m.starters_points[i])
        : pointsOf(m, pid),
      proj: projOf(pid),
    }));
    const bench = (m.players || Object.keys(m.players_points || {}))
      .filter((pid) => !(m.starters || []).includes(pid))
      .map((pid) => ({
        ...player(pid),
        pts: pointsOf(m, pid),
        proj: projOf(pid),
      }));
    const covered = starters.filter((p) => p.proj != null).length;
    const complete =
      covered === slots.length && starters.length === slots.length;
    const side = {
      rid: m.roster_id,
      team: t?.name || `Team ${m.roster_id}`,
      avatar: t?.avatar,
      pts: scoreOf(m),
      starters,
      bench,
      proj_total: complete
        ? round(starters.reduce((s, p) => s + p.proj, 0))
        : null,
      proj_covered: covered,
      proj_slots: slots.length,
    };
    if (!preview) side.bench_swap = bestBenchSwap(side);
    return side;
  };
  const makeGames = (rows, preview = false) =>
    pairGames(rows)
      .map(([a, b]) => ({
        mid: a.matchup_id,
        a: makeSide(a, preview),
        b: makeSide(b, preview),
        margin: round(Math.abs(scoreOf(a) - scoreOf(b))),
        total: round(scoreOf(a) + scoreOf(b)),
      }))
      .sort((a, b) => a.mid - b.mid);
  const lastRows = lw ? completedRows[lw - 1] || [] : [];
  const lastGames = makeGames(lastRows);
  const lastSides = lastGames.flatMap((g) => [g.a, g.b]);
  const topSides = [...lastSides].sort((a, b) => b.pts - a.pts);
  const lastPoints = new Map();
  for (const m of lastRows)
    for (const [pid, pts] of Object.entries(m.players_points || {}))
      lastPoints.set(norm(pid), pts);
  const last_week =
    lw && lastGames.length
      ? {
          week: lw,
          games: lastGames,
          top_performers: lastSides
            .flatMap((s) =>
              s.starters.map((p) => ({ ...p, rid: s.rid, teamName: s.team })),
            )
            .filter((p) => p.pts != null)
            .sort((a, b) => b.pts - a.pts)
            .slice(0, 12),
          team_of_the_week: topSides[0]
            ? {
                rid: topSides[0].rid,
                name: topSides[0].team,
                pts: topSides[0].pts,
              }
            : null,
          blowout: [...lastGames].sort((a, b) => b.margin - a.margin)[0],
          nail_biter: [...lastGames].sort((a, b) => a.margin - b.margin)[0],
          average: round(
            lastSides.reduce((s, t) => s + t.pts, 0) /
              Math.max(1, lastSides.length),
          ),
        }
      : null;
  const nextGames = makeGames(currentRows, true);
  const status =
    lw >= matchupWeek
      ? "complete"
      : currentRows.some(
            (m) =>
              scoreOf(m) !== 0 ||
              Object.values(m.players_points || {}).some((p) => p !== 0),
          )
        ? "in_progress"
        : "upcoming";
  const standings = rankStandings(Object.values(teams));

  // Scoring form: points per completed regular-season game, not fake editorial power rankings.
  const regularEnd = (league.settings?.playoff_week_start || 15) - 1;
  const form = new Map(
    rosters.map((r) => [
      r.roster_id,
      { games: 0, points: 0, previous: 0, aw: 0, al: 0, at: 0 },
    ]),
  );
  for (let i = 0; i < completedRows.length && i < regularEnd; i++) {
    const rows = pairGames(completedRows[i]).flat();
    for (const m of rows) {
      const f = form.get(m.roster_id);
      if (!f) continue;
      f.games++;
      f.points += scoreOf(m);
      if (i < completedRows.length - 1) f.previous += scoreOf(m);
      for (const o of rows)
        if (o.roster_id !== m.roster_id) {
          f.aw += Number(scoreOf(m) > scoreOf(o));
          f.al += Number(scoreOf(m) < scoreOf(o));
          f.at += Number(scoreOf(m) === scoreOf(o));
        }
    }
  }
  const prev = [...form].sort((a, b) => b[1].previous - a[1].previous);
  const power_rankings = standings
    .map((t) => {
      const f = form.get(t.rid);
      return {
        ...t,
        ppg: f.games ? round(f.points / f.games) : null,
        all_play: `${f.aw}-${f.al}${f.at ? `-${f.at}` : ""}`,
        record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
      };
    })
    .sort(
      (a, b) => (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.rid - b.rid,
    )
    .map((t, i) => ({
      ...t,
      rank: i + 1,
      delta: lw > 1 ? prev.findIndex((p) => p[0] === t.rid) - i : null,
    }));

  // Archive excludes the current season. Fold in only completed regular-season games.
  const h2h = new Map(
    HISTORY.h2h.map((h) => [
      `${h.a}|${h.b}`,
      { ...h, big: h.big ? { ...h.big } : null },
    ]),
  );
  for (let i = 0; i < completedRows.length && i < regularEnd; i++)
    for (const [a, b] of pairGames(completedRows[i])) {
      let ua = teams[a.roster_id]?.uid,
        ub = teams[b.roster_id]?.uid,
        pa = scoreOf(a),
        pb = scoreOf(b);
      if (!ua || !ub || ua === ub) continue;
      if (ua > ub) [ua, ub, pa, pb] = [ub, ua, pb, pa];
      const key = `${ua}|${ub}`;
      const h = h2h.get(key) || {
        a: ua,
        b: ub,
        gp: 0,
        w_a: 0,
        w_b: 0,
        t: 0,
        p_a: 0,
        p_b: 0,
        big: null,
      };
      h.gp++;
      h.w_a += Number(pa > pb);
      h.w_b += Number(pb > pa);
      h.t += Number(pa === pb);
      h.p_a = round(h.p_a + pa);
      h.p_b = round(h.p_b + pb);
      const m = round(Math.abs(pa - pb));
      if (!h.big || m > h.big.m) h.big = { m, season, week: i + 1 };
      h2h.set(key, h);
    }
  const byUid = new Map(Object.values(teams).map((t) => [t.uid, t]));
  const historicalName = (uid) =>
    HISTORY.seasons.flatMap((s) => s.table).find((t) => t.uid === uid)?.name ||
    "Former manager";
  const rivalries = [...h2h.values()]
    .filter((h) => byUid.has(h.a) && byUid.has(h.b))
    .map((h) => {
      const a = byUid.get(h.a),
        b = byUid.get(h.b);
      return {
        a: a.name,
        b: b.name,
        a_rid: a.rid,
        b_rid: b.rid,
        a_wins: h.w_a,
        b_wins: h.w_b,
        ties: h.t,
        gp: h.gp,
        pa: h.p_a,
        pb: h.p_b,
        rec: `${h.w_a}-${h.w_b}${h.t ? `-${h.t}` : ""}`,
        big: h.big ? { margin: h.big.m, season: h.big.season } : null,
        this_week:
          status !== "complete" &&
          nextGames.some(
            (g) =>
              [g.a.rid, g.b.rid].includes(a.rid) &&
              [g.a.rid, g.b.rid].includes(b.rid),
          ),
      };
    })
    .sort((a, b) => Number(b.this_week) - Number(a.this_week) || b.gp - a.gp);
  const champions = HISTORY.seasons
    .filter((s) => s.champion && Number(s.season) < Number(season))
    .map((s) => ({
      season: s.season,
      name: s.champion.name,
      current_team:
        byUid.get(s.champion.uid)?.name || historicalName(s.champion.uid),
      uid: s.champion.uid,
      source_url: s.champion_source,
    }));

  const txMap = new Map();
  txData.forEach((rows, i) => {
    for (const t of rows || []) {
      if (t.status !== "complete") continue;
      const transfer = (entries) =>
        Object.entries(entries || {}).map(([pid, rid]) => ({
          ...player(pid),
          rid,
          teamName: teams[rid]?.name || `Team ${rid}`,
        }));
      const adds = transfer(t.adds),
        drops = transfer(t.drops);
      const lines = adds.map((p) => `${p.name} → ${p.teamName}`);
      for (const p of drops)
        if (t.type !== "trade") lines.push(`${p.teamName} dropped ${p.name}`);
      for (const pick of t.draft_picks || [])
        lines.push(
          `${pick.season} Round ${pick.round} pick → ${teams[pick.owner_id]?.name || `Team ${pick.owner_id}`}`,
        );
      for (const cash of t.waiver_budget || [])
        lines.push(
          `$${cash.amount} FAAB → ${teams[cash.receiver]?.name || `Team ${cash.receiver}`}`,
        );
      if (lines.length)
        txMap.set(t.transaction_id, {
          id: t.transaction_id,
          week: txWeeks[i],
          type: t.type,
          when: t.status_updated || t.created,
          bid: t.settings?.waiver_bid ?? null,
          adds,
          drops,
          lines,
        });
    }
  });
  const transactions = [...txMap.values()]
    .sort((a, b) => b.when - a.when)
    .slice(0, 30);
  let draft = null;
  if (drafts?.length) {
    const picks = await optional(
      `/draft/${drafts[0].draft_id}/picks`,
      [],
      "Draft picks",
    );
    const all = picks.map((p) => {
      const pl = player(p.player_id);
      return {
        ...pl,
        name: pl.name.startsWith("Player ")
          ? `${p.metadata?.first_name || ""} ${p.metadata?.last_name || ""}`.trim()
          : pl.name,
        pick_no: p.pick_no,
        round: p.round,
        owner:
          byUid.get(p.picked_by)?.name ||
          userMap.get(p.picked_by)?.display_name ||
          "Former manager",
        rid: byUid.get(p.picked_by)?.rid ?? p.picked_by,
        pts: lastPoints.has(norm(p.player_id))
          ? round(lastPoints.get(norm(p.player_id)))
          : null,
      };
    });
    draft = {
      picks: all,
      steals: all
        .filter((p) => p.round >= 8 && p.pts != null)
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 5),
      busts: all
        .filter((p) => p.round <= 3 && p.pts != null)
        .sort((a, b) => a.pts - b.pts)
        .slice(0, 5),
      first_round: all
        .filter((p) => p.round === 1)
        .sort((a, b) => a.pick_no - b.pick_no),
    };
  }
  const players = Object.keys(BUNDLE.players)
    .map((pid) => {
      const rid = ownership.get(norm(pid)) ?? null;
      return {
        ...player(pid),
        rid,
        teamName: rid != null ? teams[rid]?.name : null,
        last_pts: lastPoints.has(norm(pid))
          ? round(lastPoints.get(norm(pid)))
          : null,
        proj: projOf(pid),
      };
    })
    .filter((p) => p.pos)
    .sort(
      (a, b) =>
        (b.proj ?? -Infinity) - (a.proj ?? -Infinity) ||
        a.name.localeCompare(b.name),
    );
  const trendingPlayers = (trending || [])
    .slice(0, 12)
    .map((t) => ({
      ...player(t.player_id),
      count: t.count,
      rid: ownership.get(norm(t.player_id)) ?? null,
      teamName: teams[ownership.get(norm(t.player_id))]?.name || null,
    }));
  const payload = {
    build: BUILD,
    asof: Date.now(),
    player_metadata_asof: BUNDLE.generated_at || null,
    notices,
    league: {
      name: league.name,
      url: `https://sleeper.com/leagues/${LID}`,
      id: LID,
      size: league.total_rosters,
      scoring:
        league.scoring_settings?.rec === 0
          ? "Standard"
          : league.scoring_settings?.rec === 0.5
            ? "Half PPR"
            : "PPR",
      qb: slots.includes("SUPER_FLEX")
        ? "Superflex"
        : `${slots.filter((p) => p === "QB").length}QB`,
      faab: league.settings?.waiver_budget || 0,
      trade_deadline: league.settings?.trade_deadline || 0,
      regular_end: (league.settings?.playoff_week_start || 15) - 1,
      playoff_teams: league.settings?.playoff_teams || 6,
      roster_positions: league.roster_positions,
    },
    season,
    current_week: cw,
    completed_week: lw,
    last_week,
    next_week: { week: matchupWeek, status, games: nextGames },
    standings,
    power_rankings,
    rivalries,
    champions,
    reigning_champ: champions.at(-1) || null,
    draft,
    transactions,
    trending: trendingPlayers,
    players,
    methodology: {
      projections:
        "Sleeper standard-scoring estimates. League-specific rules, especially kicker scoring, may differ. A missing player estimate makes the team total unavailable.",
      rankings:
        "Scoring form ranks teams by points per completed regular-season game. All-play compares each weekly score with every other team that week.",
      history:
        "Completed regular-season meetings only. Champions are winners of the first-place playoff game, not the regular-season standings.",
      editorial:
        "Automated, data-based league analysis. No reported interviews or invented quotes. The Cheap Seats is labelled league banter.",
    },
  };
  payload.team_form = {};
  payload.season_top = {};
  for (const r of rosters) {
    payload.team_form[r.roster_id] = teamForm(
      completedRows.slice(0, regularEnd),
      r.roster_id,
    );
    const top = seasonTopPerformers(completedRows.slice(0, regularEnd), r.roster_id, 5);
    if (top.length) payload.season_top[r.roster_id] = top;
  }
  payload.awards = weeklyAwards(payload);
  payload.injuries = injuryDesk(payload);
  payload.week_mode = weekMode(payload);
  payload.weekend = weekendHype(payload);
  payload.weekend_narrative = weekendNarrative(payload);
  payload.featured = featuredMatchup(payload, payload.weekend_narrative);
  payload.waivers = waiverDesk(payload);
  payload.articles = buildEditorial(payload);
  // The Slate desk: the Sunday article queue for the slate being covered
  // right now (preview -> live). slate_final keeps the previous week's queue
  // alive (final phase) so deep links like #story/w2-slate survive rollover.
  payload.slate = slateArticles(payload);
  payload.slate_final = slateFinalArticles(payload);
  return payload;
}

/** Read the home page HTML straight from the asset namespace. */
async function homeHtml(env, url) {
  // Use the asset fetcher (the same path that serves the site to browsers)
  // rather than get(), whose shape varies. Always fetch the index explicitly.
  for (const p of ["/", "/index.html"]) {
    try {
      const res = await env.ASSETS.fetch(new Request(`${url.origin}${p}`));
      if (res.ok) {
        const t = await res.text();
        if (t && t.length && t.includes("</html>")) return { html: t, headers: res.headers };
      }
    } catch (e) {
      console.error(`ASSETS fetch(${p}) failed:`, String(e));
    }
  }
  return null;
}

let building;
async function getPayload(env, ctx, { forceRequested = false } = {}) {
  const hit = await env.XCF_KV.get(CACHE_KEY, "json");
  // A cached payload is only as good as its freshness window. During a live
  // game window that's five minutes; otherwise an hour (the hourly cron keeps
  // it current). A forced refresh (manual button or ?refresh=1) is throttled
  // so we don't hammer the Sleeper API — again, shorter while games are live.
  const live = isLivePayload(hit);
  const ttl = live ? LIVE_TTL_MS : DAY_TTL_MS;
  const minSinceBuild = live ? LIVE_FORCE_MIN_MS : DAY_FORCE_MIN_MS;
  const lastBuild = Number(hit?.asof || 0);
  const force = forceRefreshDue(forceRequested, lastBuild, Date.now(), minSinceBuild);
  if (hit && !force && Date.now() - hit.asof < ttl) return hit;
  try {
    if (!building)
      building = buildPayload().finally(() => {
        building = null;
      });
    const payload = await building;
    ctx.waitUntil(
      Promise.all([
        env.XCF_KV.put(CACHE_KEY, JSON.stringify(payload)),
        env.XCF_KV.put("last_build_ts", String(payload.asof)),
      ]),
    );
    return payload;
  } catch (e) {
    console.error("League refresh failed:", String(e));
    if (hit)
      return {
        ...hit,
        stale: true,
        notices: [
          ...(hit.notices || []),
          "Refresh failed. Showing the last successfully fetched league data.",
        ],
      };
    throw e;
  }
}
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/api/data") {
      if (!["GET", "HEAD"].includes(req.method))
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      try {
        const payload = await getPayload(env, ctx, {
          forceRequested: url.searchParams.get("refresh") === "1",
        });
        const body = { ...payload, refresh_window: refreshWindow(payload) };
        return new Response(
          req.method === "HEAD" ? null : JSON.stringify(body),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "public, max-age=60",
              "x-content-type-options": "nosniff",
              "x-xclub-build": BUILD,
            },
          },
        );
      } catch {
        return new Response(
          JSON.stringify({
            error:
              "Sleeper data is temporarily unavailable. Please try again shortly.",
          }),
          {
            status: 502,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      }
    }
    if (url.pathname.startsWith("/api/"))
      return new Response("Not found", { status: 404 });

    // Deep links that lost their "#" fragment (typed in, or forwarded
    // through a handler that strips it) — e.g. /game/2/1, /team/3,
    // /story/weekly-lead. The site is a hash-routed SPA, so 308 these to
    // the canonical /#… URL instead of 404ing on the asset handler.
    const deep = url.pathname.match(/^\/(game|team|story)\/([\w-]+(?:\/[\w-]+)?)\/?$/);
    if (deep) {
      return Response.redirect(`${url.origin}/#${deep[1]}/${deep[2]}`, 308);
    }
    const view = url.pathname.match(/^\/(home|matchups|standings|teams|players|injuries|waivers|history|main)\/?$/);
    if (view) {
      return Response.redirect(`${url.origin}/#${view[1]}`, 308);
    }

    if (url.pathname === "/" || url.pathname === "/weekend") {
      try {
        const [payload, page] = await Promise.all([
          getPayload(env, ctx),
          homeHtml(env, url),
        ]);
        if (page) {
          const meta = ogMeta(url.pathname, payload);
          const injected = page.html
            .replace(
              /<meta property="og:title" content="[^"]*" \/>/,
              `<meta property="og:title" content="${escAttr(meta.title)}" />`,
            )
            .replace(
              /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
              `<meta property="og:description" content="${escAttr(meta.description)}" />`,
            )
            .replace(
              /<meta property="og:url" content="[^"]*" \/>/,
              `<meta property="og:url" content="${escAttr(meta.url)}" />`,
            )
            .replace(
              /<title>[^<]*<\/title>/,
              `<title>${escAttr(meta.title)}</title>`,
            );
          return new Response(injected, {
            status: 200,
            headers: rewrittenHtmlHeaders(page.headers, BUILD),
          });
        }
      } catch (e) {
        console.error("OG meta injection failed:", String(e));
      }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    schedulePayloadRefresh(env, ctx, getPayload);
  },
};
