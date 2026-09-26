// Pure, testable league calculations. No invented quotes or inferred injury explanations.
export const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const fmt = (n) => Number(n).toFixed(2);
export const rosterPoints = (s, key) =>
  round((Number(s[key]) || 0) + (Number(s[`${key}_decimal`]) || 0) / 100);
export const projection = (entry) =>
  Number.isFinite(entry?.pts_std) ? entry.pts_std : null;
export const scoreOf = (m) => round(Number(m.custom_points ?? m.points ?? 0));
export const completedWeek = (league, state) => {
  const sameSeason = league.season === state.season;
  const fallback = sameSeason && state.season_type === "regular"
    ? Math.max(0, (Number(state.week) || 1) - 1) : 0;
  return Math.max(0, Math.min(18, Number(league.settings?.last_scored_leg ?? fallback) || 0));
};
export function weekWindow(league, state) {
  const current = Math.max(1, Math.min(18, Number(
    league.season === state.season && state.season_type === "regular"
      ? state.week : league.settings?.leg,
  ) || 1));
  const completed = completedWeek(league, state);
  // Scores can finalize before the NFL-state endpoint rolls into the next week.
  // A completed league stays on its final, even if the NFL calendar continues.
  const matchup = league.status === "complete"
    ? (completed || current) : Math.min(18, Math.max(current, completed + 1));
  return { current, completed, matchup };
}
export function pairGames(rows) {
  const groups = new Map();
  for (const m of rows || []) {
    if (m.matchup_id == null) continue;
    if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
    groups.get(m.matchup_id).push(m);
  }
  return [...groups.values()].filter((g) => g.length === 2);
}
export function rankStandings(teams) {
  const rate = (t) =>
    (t.wins + t.ties * 0.5) / Math.max(1, t.wins + t.losses + t.ties);
  return [...teams]
    .sort((a, b) => rate(b) - rate(a) || b.fpts - a.fpts || a.rid - b.rid)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
const ELIGIBLE = {
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
};
export function bestBenchSwap(side) {
  let best = null;
  for (const bench of side.bench || [])
    for (const starter of side.starters || []) {
      const allowed = ELIGIBLE[starter.slot] || [starter.slot || starter.pos];
      if (!(bench.positions || [bench.pos]).some((p) => allowed.includes(p)))
        continue;
      if (!Number.isFinite(bench.pts) || !Number.isFinite(starter.pts))
        continue;
      const gain = round(bench.pts - starter.pts);
      if (gain > 0 && (!best || gain > best.gain))
        best = { bench, starter, gain };
    }
  return best;
}

export const ELIGIBLE_SLOTS = ELIGIBLE;
export const INJURY_ORDER = ["O", "IR", "IR-R", "SUS", "D", "SSPD", "Q", "DNP", "NA", ""];
const recStr = (t) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
const num2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");

/** Same one-player bench logic as bestBenchSwap, but on projections — the
 *  preview/live equivalent, used by the slate desk before scores exist. */
export function bestProjBenchSwap(side) {
  let best = null;
  for (const bench of side.bench || [])
    for (const starter of side.starters || []) {
      const allowed = ELIGIBLE[starter.slot] || [starter.slot || starter.pos];
      if (!(bench.positions || [bench.pos]).some((p) => allowed.includes(p)))
        continue;
      if (bench.proj == null || starter.proj == null) continue;
      const gain = round(bench.proj - starter.proj);
      if (gain > 0 && (!best || gain > best.gain))
        best = { bench, starter, gain };
    }
  return best;
}

/** Which mode should the homepage lead with? Data-driven, never invented. */
export function weekMode(d) {
  const status = d.next_week?.status || "upcoming";
  const hasGames = (d.next_week?.games || []).length > 0;
  const hasRecap = !!(d.last_week?.games || []).length;
  const live = status === "in_progress" && hasGames;
  // A finished slate outranks a stale "in progress" flag: scores can finalize
  // before Sleeper flips the week status.
  const justFinished = status === "complete" && hasRecap;
  const done = d.completed_week >= 18 || d.current_week > 18;
  const mode = done ? "offseason" : live ? "live" : justFinished ? "recap" : hasRecap ? "recap" : "preview";
  return {
    mode,

    week: mode === "preview" || live ? d.next_week.week : d.last_week.week,
    nextWeek: d.next_week?.week ?? null,
    status,
    leadStory: bakerSpiteMatchup(d)
      ? "baker-decree"
      : mode === "preview" && !hasRecap
        ? "next-week"
        : "weekly-lead",
  };
}

/**
 * Auto-refresh cadence. During an in-progress game window the payload may be
 * up to five minutes old and the client polls every two minutes; otherwise the
 * hourly Worker cron keeps data within an hour and the client re-reads
 * (cheaply, from cache) every fifteen minutes.
 */
export function refreshWindow(d) {
  const live = d.week_mode?.mode === "live" ||
    (d.next_week?.status === "in_progress" && (d.next_week?.games || []).length > 0);
  return { live, poll_ms: live ? 120000 : 900000 };
}

/**
 * True while the upcoming slate features Emery's Hash Browns vs. Tuten Hurts.
 * This is the week gate for the "Baker decree" league-banter lead story: the
 * matchup only exists in `next_week` during that week, so the article and its
 * lead-story status appear and disappear automatically as the week advances.
 */
export function bakerSpiteMatchup(d) {
  const games = d.next_week?.games || [];
  return games.some((g) => {
    const a = g.a?.team || "";
    const b = g.b?.team || "";
    return (
      (a.startsWith("Emery") && b.startsWith("Tuten")) ||
      (a.startsWith("Tuten") && b.startsWith("Emery"))
    );
  });
}

/** Factual weekly awards computed from completed box scores. No fabricated narrative. */
export function weeklyAwards(d) {
  const games = d.last_week?.games || [];
  if (!games.length) return [];
  const sides = games.flatMap((g) => [g.a, g.b]);
  const awards = [];
  const push = (id, rid, label, detail, value, week) =>
    rid != null && awards.push({ id, rid, label, detail, value, week });
  const topSide = [...sides].sort((a, b) => b.pts - a.pts)[0];
  push("team-of-the-week", topSide?.rid, "Team of the week", `Highest score of Week ${d.last_week.week}`, topSide?.pts, d.last_week.week);
  const topPerf = (d.last_week.top_performers || [])[0];
  push("player-of-the-week", topPerf?.rid, "Player of the week", `${topPerf?.name} · ${topPerf?.team || ""} ${topPerf ? Math.round(topPerf.pts * 100) / 100 : ""} pts`, topPerf?.pts, d.last_week.week);
  const blowout = [...games].sort((a, b) => b.margin - a.margin)[0];
  if (blowout?.margin > 0) {
    const w = blowout.a.pts > blowout.b.pts ? blowout.a : blowout.b;
    push("biggest-blowout", w.rid, "Biggest blowout", `${num2(w.pts)}–${num2(w.pts - blowout.margin)} · ${num2(blowout.margin)}-point margin`, blowout.margin, d.last_week.week);
  }
  const close = [...games].filter((g) => g.margin > 0).sort((a, b) => a.margin - b.margin)[0];
  if (close) {
    const w = close.a.pts > close.b.pts ? close.a : close.b;
    push("closest-finish", w.rid, "Closest finish", `Won by ${num2(close.margin)}`, close.margin, d.last_week.week);
  }
  // Biggest upset: winner with the worst record who won.
  const upsets = games
    .filter((g) => g.margin > 0)
    .map((g) => {
      const wa = g.a.pts > g.b.pts, win = wa ? g.a : g.b, lose = wa ? g.b : g.a;
      const wt = d.standings.find((t) => t.rid === win.rid), lt = d.standings.find((t) => t.rid === lose.rid);
      return wt && lt ? { win, lose, rate: (wt.wins + wt.ties * 0.5) / Math.max(1, wt.wins + wt.losses + wt.ties), wrate: (lt.wins + lt.ties * 0.5) / Math.max(1, lt.wins + lt.losses + lt.ties) } : null;
    })
    .filter((x) => x && x.rate < x.wrate)
    .sort((a, b) => (a.rate - a.wrate) - (b.rate - b.wrate))[0];
  if (upsets) push("biggest-upset", upsets.win.rid, "Biggest upset", `Beat ${upsets.lose.team} from a worse record`, null, d.last_week.week);
  const crimes = sides
    .map((s) => ({ s, swap: bestBenchSwap(s) }))
    .filter((x) => x.swap)
    .sort((a, b) => b.swap.gain - a.swap.gain)[0];
  if (crimes) push("bench-crime", crimes.s.rid, "Bench crime", `${crimes.swap.bench.name} left ${num2(crimes.swap.gain)} pts on the bench`, crimes.swap.gain, d.last_week.week);
  // Unluckiest loss: loser whose score beat the most other teams that week.
  const unlucky = sides
    .filter((s) => {
      const g = games.find((g) => g.a.rid === s.rid || g.b.rid === s.rid);
      const o = g.a.rid === s.rid ? g.b : g.a;
      return s.pts < o.pts;
    })
    .map((s) => ({ rid: s.rid, pts: s.pts, beat: sides.filter((o) => o.rid !== s.rid && o.pts < s.pts).length }))
    .sort((a, b) => b.beat - a.beat || b.pts - a.pts)[0];
  if (unlucky) push("unluckiest-loss", unlucky.rid, "Unluckiest loss", `${num2(unlucky.pts)} pts would have beaten ${unlucky.beat} of ${sides.length - 1} opponents`, unlucky.beat, d.last_week.week);
  return awards;
}

/** Rostered players carrying an injury designation, most severe first. */
/** Map any status form (Questionable/Q/Doubtful/D/Injured Reserve/IR...) to a severity rank. */
export function injuryRank(status) {
  const s = String(status || "").trim().toUpperCase();
  if (s === "QUESTIONABLE" || s === "Q") return INJURY_ORDER.indexOf("Q");
  if (s === "DOUBTFUL" || s === "D") return INJURY_ORDER.indexOf("D");
  if (s === "OUT" || s === "O") return INJURY_ORDER.indexOf("O");
  if (s === "INJURED RESERVE" || s === "INJURY RESERVE" || s === "INJURY_RESERVED" || s === "IR") return INJURY_ORDER.indexOf("IR");
  if (s === "INJURED RESERVE - DESIGNATED FOR RETURN" || s === "IR-R") return INJURY_ORDER.indexOf("IR-R");
  if (s === "SUSPENDED" || s === "SUS" || s === "SUSPENSION") return INJURY_ORDER.indexOf("SUS");
  if (s === "SHORT WEEK" || s === "SSPD") return INJURY_ORDER.indexOf("SSPD");
  if (s === "DID NOT PARTICIPATE" || s === "DNP") return INJURY_ORDER.indexOf("DNP");
  if (s === "PUP" || s === "PHYSICALLY UNABLE TO PERFORM") return INJURY_ORDER.indexOf("O"); // PUP = cannot practice; treat as out-level
  if (s === "NON-PARTICIPANT" || s === "NON PARTICIPANT" || s === "NA") return INJURY_ORDER.indexOf("NA");
  return INJURY_ORDER.indexOf("") + 1; // unknown ranks last, still listed
}
/** Short display chip for any status form. */
export function injuryChip(status) {
  const s = String(status || "").trim().toUpperCase();
  if (s === "PUP" || s === "PHYSICALLY UNABLE TO PERFORM") return "PUP";
  const rank = injuryRank(status);
  return ["O", "IR", "IR-R", "SUS", "D", "SSPD", "Q", "DNP", "NA"][rank] ?? "?";
}
export function injuryDesk(d) {
  return (d.players || [])
    .filter((p) => p.rid != null && p.injury)
    .map((p) => ({ ...p, injury_rank: injuryRank(p.injury), injury_chip: injuryChip(p.injury) }))
    .sort(
      (a, b) =>
        a.injury_rank - b.injury_rank ||
        a.name.localeCompare(b.name),
    );
}

/**
 * The wire desk: league deadline + FAAB state, all from league settings and
 * the standings (no estimates).
 *  - trade_week: final week trades are accepted (league settings; defaults to
 *    the last regular-season week when the league leaves it blank).
 *  - regular_end: last regular-season week (the week before playoffs begin).
 *  - faab_teams: each team's used / remaining share of the league's waiver
 *    budget (the pool the team's FAAB draws from).
 *  - counts: how many of the displayed transactions are of each type.
 */
export function waiverDesk(d) {
  const week = d.current_week;
  const tradeWeek = Number(d.league?.trade_deadline) || 0;
  const regularEnd = Number(d.league?.regular_end) || 0;
  const tradeOpen = tradeWeek > 0 && week <= tradeWeek;
  const faab = Number(d.league?.faab) || 0;
  const txs = d.transactions || [];
  const counts = { waiver: 0, free_agent: 0, trade: 0 };
  for (const t of txs) if (counts[t.type] != null) counts[t.type]++;
  // Clamp to a sane range: Sleeper can carry a negative waiver_budget_used
  // (a refund/quirk), which would otherwise show "more left than the pool".
  const faab_teams = (d.standings || []).map((t) => {
    const used = Math.max(0, t.faab_used || 0);
    return { rid: t.rid, name: t.name, used, left: Math.max(0, Math.min(faab, faab - used)) };
  });
  return {
    week,
    trade_week: tradeWeek || null,
    regular_end: regularEnd || null,
    trade_open: tradeOpen,
    trade_weeks_left: tradeOpen ? Math.max(0, tradeWeek - week) : 0,
    faab,
    counts,
    faab_teams,
  };
}

/** Weekly form for one team across all completed weeks, oldest first. */
export function teamForm(weeks, rid) {
  const ridS = String(rid);
  const out = [];
  (weeks || []).forEach((rows, i) => {
    const m = (rows || []).find((x) => String(x.roster_id) === ridS);
    if (!m) return;
    const opp = (rows || []).find((x) => x.matchup_id === m.matchup_id && String(x.roster_id) !== ridS);
    const pts = Number(m.custom_points ?? m.points ?? 0);
    const oppPts = opp ? Number(opp.custom_points ?? opp.points ?? 0) : null;
    out.push({
      week: i + 1,
      pts: round(pts),
      result: oppPts == null ? "W" : pts > oppPts ? "W" : pts < oppPts ? "L" : "T",
      margin: oppPts == null ? round(pts) : round(Math.abs(pts - oppPts)),
      mid: m.matchup_id,
    });
  });
  return out;
}

/** Top recorded performers for one team across completed weeks (cap default 5). */
export function seasonTopPerformers(weeks, rid, cap = 5) {
  const ridS = String(rid);
  const totals = new Map();
  for (const rows of weeks || [])
    for (const m of rows || []) {
      if (String(m.roster_id) !== ridS) continue;
      for (const [raw, pts] of Object.entries(m.players_points || {})) {
        if (!Number.isFinite(pts)) continue;
        const pid = String(raw).replace(/^TEAM_/, "");
        totals.set(pid, round((totals.get(pid) || 0) + pts));
      }
    }
  return [...totals.entries()]
    .map(([pid, pts]) => ({ pid, pts }))
    .sort((a, b) => b.pts - a.pts || a.pid.localeCompare(b.pid))
    .slice(0, cap);
}

/** Weekend preview data for the hype page: edges, close games, top stars. */
export function weekendHype(d) {
  const nw = d.next_week || { week: null, status: "upcoming", games: [] };
  const games = (nw.games || []).map((g) => {
    const a = g.a || {}, b = g.b || {};
    const both =
      Number.isFinite(a.proj_total) && Number.isFinite(b.proj_total);
    const edge = both ? round(Math.abs(a.proj_total - b.proj_total)) : null;
    const close = edge != null && edge <= 5;
    const starOf = (s) => {
      const withProj = (s.starters || []).filter((p) => p.proj != null);
      const top = withProj.sort((x, y) => y.proj - x.proj)[0] || null;
      return top
        ? {
            name: top.name,
            pos: top.pos === "DEF" ? "D/ST" : top.pos,
            team: top.team || null,
            proj: top.proj,
            img: top.img || null,
            injury: top.injury || null,
          }
        : null;
    };
    return {
      mid: g.mid,
      a: { rid: a.rid, team: a.team, proj_total: a.proj_total, star: starOf(a) },
      b: { rid: b.rid, team: b.team, proj_total: b.proj_total, star: starOf(b) },
      edge,
      close,
    };
  });
  const closeCount = games.filter((g) => g.close).length;
  const sorted = [...games].sort(
    (x, y) =>
      Number(y.close) - Number(x.close) ||
      (x.edge ?? Infinity) - (y.edge ?? Infinity),
  );
  const allStars = games.flatMap((g) => [g.a.star, g.b.star]).filter(Boolean);
  const seen = new Set();
  const topStars = allStars
    .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
    .sort((x, y) => y.proj - x.proj)
    .slice(0, 6);
  return {
    week: nw.week,
    status: nw.status,
    games: sorted,
    closeCount,
    topStars,
    projAvailable: games.some((g) => g.edge != null),
  };
}

/** Build a full narrative card for one matchup in either preview or recap mode.
 *  All sentences are assembled from data already in the payload — no invented
 *  quotes, causes, or updates. mode "auto" infers from whether a score exists. */
export function matchupCard(game, d, week, mode = "auto") {
  const a = game.a || {}, b = game.b || {};
  const standings = new Map((d.standings || []).map((s) => [String(s.rid), s]));
  const form = d.team_form || {};
  const inj = d.injuries || [];
  const h2hMap = new Map((d.rivalries || []).map((r) => [`${r.a_rid}|${r.b_rid}`, r]));
  const hasScore = Number(a.pts) > 0 || Number(b.pts) > 0 || Number(game.total) > 0;
  const resolved = mode === "auto" ? (hasScore ? "recap" : "preview") : mode;
  const live =
    resolved === "recap" &&
    hasScore &&
    week === d.next_week?.week &&
    d.next_week?.status === "in_progress";

  const rec = (s) =>
    s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}` : "?-?";
  const teamInfo = (side, st) => {
    const myInj = inj
      .filter((i) => String(i.rid) === String(side.rid))
      .sort((x, y) => (x.injury_rank || 0) - (y.injury_rank || 0))
      .slice(0, 3)
      .map((i) => ({ name: i.name, pos: i.pos, chip: i.injury_chip }));
    const last = (form[String(side.rid)] || []).slice(-1)[0] || null;
    return {
      rid: side.rid,
      team: side.team,
      rec: rec(st),
      rank: st?.rank ?? null,
      streak: st?.streak ?? null,
      pts_last: last?.pts ?? null,
      result_last: last?.result ?? null,
      proj:
        resolved === "preview" && Number.isFinite(side.proj_total)
          ? side.proj_total
          : null,
      injuries: myInj,
    };
  };
  const ai = teamInfo(a, standings.get(String(a.rid)));
  const bi = teamInfo(b, standings.get(String(b.rid)));

  // Head-to-head, oriented to a/b (worker keys rivalries by roster id pair).
  const r =
    h2hMap.get(`${a.rid}|${b.rid}`) || h2hMap.get(`${b.rid}|${a.rid}`) || null;
  let h2hOut = null;
  if (r) {
    const aIsLeft = String(r.a_rid) === String(a.rid);
    const aWins = aIsLeft ? r.a_wins : r.b_wins;
    const bWins = aIsLeft ? r.b_wins : r.a_wins;
    const leader = aWins > bWins ? a.team : bWins > aWins ? b.team : "Even";
    // Record is always shown leader-first so the sentence reads naturally.
    const rec =
      leader === "Even"
        ? `${aWins}-${bWins}`
        : leader === a.team
        ? `${aWins}-${bWins}`
        : `${bWins}-${aWins}`;
    h2hOut = { leader, rec, gp: r.gp, big: r.big ? { ...r.big } : null, aWins, bWins };
  }

  // Projected favorite / edge (preview only).
  let edge = null, close = false, fav = null;
  if (resolved === "preview") {
    if (Number.isFinite(a.proj_total) && Number.isFinite(b.proj_total)) {
      edge = round(Math.abs(a.proj_total - b.proj_total));
      close = edge <= 5;
      fav =
        a.proj_total >= b.proj_total
          ? { team: a.team, rid: a.rid, proj: a.proj_total }
          : { team: b.team, rid: b.rid, proj: b.proj_total };
    }
  }

  const story = resolved === "recap" ? gameStory(game, d) : null;
  const margin =
    resolved === "recap" ? Number(game.margin ?? Math.abs(Number(a.pts) - Number(b.pts))) : null;

  // ---- Narrative (data-only sentences) ----
  const narrative = [];
  if (resolved === "preview") {
    if (edge != null && fav) {
      const dog = fav.team === a.team ? b : a;
      narrative.push(
        `${fav.team} is the projected favorite, ${fmt(fav.proj)} to ${fmt(dog.proj_total)} — a ${fmt(edge)} point edge.`,
      );
    } else {
      narrative.push("Projections aren't in yet, so this one is wide open.");
    }
    const formTxt = (t) => {
      let s = `${t.team} is ${t.rec}`;
      if (t.result_last === "W") s += " off a win last week";
      else if (t.result_last === "L") s += " off a loss last week";
      return s;
    };
    narrative.push(`${formTxt(ai)}; ${formTxt(bi)}.`);
    if (h2hOut) {
      narrative.push(
        h2hOut.leader === "Even"
          ? `All-time they're even, ${h2hOut.rec} over ${h2hOut.gp} meetings.`
          : `All-time ${h2hOut.leader} leads the series ${h2hOut.rec} over ${h2hOut.gp} meetings.`,
      );
    }
    const watch = [
      ...ai.injuries.map((i) => `${i.name} (${i.chip})`),
      ...bi.injuries.map((i) => `${i.name} (${i.chip})`),
    ];
    if (watch.length) narrative.push(`Injury watch: ${watch.join(", ")}.`);
    if (ai.rank && bi.rank)
      narrative.push(
        `The standings set it up: ${ai.team} (#${ai.rank}) against ${bi.team} (#${bi.rank}).`,
      );
  } else {
    if (a.pts === b.pts) {
      narrative.push(`${a.team} and ${b.team} tie at ${fmt(Number(a.pts || 0))}.`);
    } else {
      narrative.push(
        `${favFor(a, b).team} wins ${fmt(Number(a.pts || 0))} to ${fmt(Number(b.pts || 0))} by ${fmt(margin)}.`,
      );
    }
    if (story?.top)
      narrative.push(`${story.top.name} led the way with ${fmt(story.top.pts)} points.`);
    if (story?.battle)
      narrative.push(
        `The closest positional battle came at ${story.battle.slot} (${fmt(story.battle.a.pts)} to ${fmt(story.battle.b.pts)}).`,
      );
    if (story?.decidedBy?.text)
      narrative.push(story.decidedBy.text);
    narrative.push(
      `Now ${ai.team} sits at ${ai.rec} and ${bi.team} at ${bi.rec}.`,
    );
  }

  return {
    mid: game.mid,
    week,
    mode: resolved,
    live,
    a: ai,
    b: bi,
    edge,
    close,
    fav: resolved === "preview" ? fav : null,
    h2h: h2hOut,
    scoreA: resolved === "recap" ? Number(a.pts || 0) : null,
    scoreB: resolved === "recap" ? Number(b.pts || 0) : null,
    margin,
    winner:
      resolved === "recap" && a.pts !== b.pts
        ? a.pts > b.pts
          ? { team: a.team, rid: a.rid }
          : { team: b.team, rid: b.rid }
        : null,
    top: story?.top
      ? { name: story.top.name, pos: story.top.pos, pts: story.top.pts }
      : null,
    battle: story?.battle
      ? {
          slot: story.battle.slot,
          a: story.battle.a.pts,
          b: story.battle.b.pts,
        }
      : null,
    decidedBy: story?.decidedBy || null,
    leaves: {
      a: { rec: ai.rec, rank: ai.rank, streak: ai.streak },
      b: { rec: bi.rec, rank: bi.rank, streak: bi.streak },
    },
    narrative,
  };
}
const favFor = (a, b) => (Number(a.pts) >= Number(b.pts) ? a : b);

/** Two-sided weekend page: preview cards for the upcoming slate, recap cards
 *  for the one that just finished. */
export function weekendNarrative(d) {
  const nw = d.next_week || { week: null, status: "upcoming", games: [] };
  const lw = d.last_week || { week: null, games: [] };
  const pre = (nw.games || []).map((g) => matchupCard(g, d, nw.week, "preview"));
  const recap = (lw.games || []).map((g) => matchupCard(g, d, lw.week, "recap"));
  return {
    week: nw.week,
    status: nw.status,
    lwWeek: lw.week,
    pre,
    recap,
  };
}

/**
 * Deterministic "matchup of the week" selection for the deep-dive lead on the
 * hype page. Uses the same data-only narrative cards as the rest of the page:
 *
 * - Preview/live weeks: the closest projected finish among matchups with both
 *   projections available. Ties break on how evenly matched the teams are by
 *   rank, then on whether an all-time series exists, then matchup id (stable).
 * - Recap weeks: the closest actual finish (smallest positive margin), then
 *   the bigger total, then matchup id.
 *
 * Returns the chosen card plus a one-line `why`, or null when there is
 * nothing to feature (no games, or no usable numbers).
 */
export function featuredMatchup(d, narrative) {
  const n = narrative || weekendNarrative(d);
  const mode = weekMode(d).mode;
  const rankOf = new Map((d.standings || []).map((s) => [String(s.rid), s.rank ?? 99]));
  const rankDiff = (c) => Math.abs((rankOf.get(String(c.a?.rid)) ?? 99) - (rankOf.get(String(c.b?.rid)) ?? 99));
  // Always prefer the upcoming week's closest projected finish. Only fall
  // back to the recap pool when there is no upcoming slate at all.
  const upcomingPre = (n.pre || []).filter((c) => c.edge != null);
  if (upcomingPre.length) {
    const best = upcomingPre
      .slice()
      .sort(
        (a, b) =>
          a.edge - b.edge ||
          rankDiff(a) - rankDiff(b) ||
          (b.h2h ? 1 : 0) - (a.h2h ? 1 : 0) ||
          a.mid - b.mid,
      )[0];
    return { ...best, why: best.close ? "projected to be a coin flip" : `projected ${fmt(best.edge)} apart` };
  }
  if (mode === "recap") {
    const pool = (n.recap || []).filter((c) => c.margin != null && c.margin > 0 && c.winner);
    if (!pool.length) return null;
    const total = (c) => (c.scoreA ?? 0) + (c.scoreB ?? 0);
    const best = pool
      .slice()
      .sort((a, b) => a.margin - b.margin || total(b) - total(a) || a.mid - b.mid)[0];
    return { ...best, why: `won by just ${fmt(best.margin)}` };
  }
  return null;
}

/**
 * The Slate desk — the Sunday article queue.
 *
 * A deterministic, fully factual article pack for the slate of games being
 * covered right now. Every number comes from the payload (Sleeper league
 * data); no motives, quotes, or updates are invented. The queue runs on a
 * fixed Sunday schedule: articles appear at the 4pm cutoff and are rebuilt
 * from the same data pipeline once the remaining games (late/MNF) finalize.
 *
 * Articles emitted (each has its own #story/ route):
 *  - `w{N}-slate`   The slate: every matchup, with projected edges and one
 *                   standout line from each game.
 *  - `w{N}-edge`    Edge watch: the closest projected finish, with the two
 *                   largest individual projections that make the gap hang in
 *                   the balance.
 *  - `w{N}-bench`   Bench chess: the biggest legal one-player bench swing by
 *                   projection on the slate.
 *  - `w{N}-decider` The decider (live, and final after rollover): the closest
 *                   live or final finish, plus the hindsight bench swing that
 *                   would have flipped or covered it.
 *
 * The same builder powers `slateFinalArticles` (the completed week), so the
 * queue's deep links keep resolving after the slate rolls over.
 *
 * Returns [] when there is no slate to cover.
 */
export function slateArticles(d) {
  return slateDesk(
    d.next_week || { week: null, status: "upcoming", games: [] },
    d,
  );
}

/**
 * The final slate article pack for the completed week, so the queue's deep
 * links (e.g. #story/w2-slate) keep resolving after the week rolls over.
 * Same deterministic pipeline, phase "final".
 */
export function slateFinalArticles(d) {
  const lw = d.last_week || { week: null, games: [] };
  if (!lw.week || !(lw.games || []).length) return [];
  return slateDesk({ week: lw.week, status: "complete", games: lw.games }, d, "final");
}

function slateDesk(nw, d, phaseOverride) {
  const week = nw.week;
  if (!week) return [];
  const games = nw.games || [];
  const status = nw.status || "upcoming";
  const phase =
    phaseOverride ||
    (status === "in_progress" ? "live" : status === "complete" ? "final" : "preview");
  const live = phase === "live";
  const base = {
    byline: "XClub • League desk",
    source_url: d.league.url,
    source_label: "Sleeper league data",
    week,
  };
  const articles = [];

  // ---- The slate ----------------------------------------------------------
  if (games.length) {
    const withProj = games.filter((g) => g.a.proj_total != null && g.b.proj_total != null);
    const rows = [...games]
      .sort((a, b) => a.mid - b.mid)
      .map((g) => {
        if (phase === "final") {
          const tied = Number(g.a.pts) === Number(g.b.pts);
          const winner = tied ? null : g.a.pts > g.b.pts ? g.a : g.b;
          const top = [...(g.a.starters || []), ...(g.b.starters || [])]
            .filter((p) => p.pts != null)
            .sort((x, y) => y.pts - x.pts)[0];
          const topTxt = top ? `${top.name} with ${fmt(top.pts)} for ${top.team}` : "no individual lines recorded";
          return tied
            ? `${g.a.team} and ${g.b.team} tied ${fmt(g.a.pts)}–${fmt(g.b.pts)}; top line ${topTxt}.`
            : `${g.a.team} vs. ${g.b.team}: final ${fmt(g.a.pts)}–${fmt(g.b.pts)} (${winner.team} won by ${fmt(Math.abs(g.a.pts - g.b.pts))}); top line ${topTxt}.`;
        }
        const pa = g.a.proj_total,
          pb = g.b.proj_total;
        const projTxt =
          pa != null && pb != null
            ? `${fmt(pa)}–${fmt(pb)} (${pa >= pb ? g.a.team : g.b.team} the projected favorite, by ${fmt(Math.abs(pa - pb))})`
            : "projections pending";
        const top = [...(g.a.starters || []), ...(g.b.starters || [])]
          .filter((p) => p.proj != null)
          .sort((x, y) => y.proj - x.proj)[0];
        const topTxt = top ? `${top.name} at ${fmt(top.proj)}` : "no individual estimates yet";
        const scoreTxt =
          live
            ? ` currently ${fmt(g.a.pts)}–${fmt(g.b.pts)}`
            : "";
        return `${g.a.team} vs. ${g.b.team}: ${projTxt}; standout ${topTxt}${scoreTxt}.`;
      });
    articles.push({
      id: `w${week}-slate`,
      tag: "Slate desk",
      headline:
        phase === "final"
          ? `Week ${week} slate: how all ${games.length} matchups finished`
          : `Week ${week} slate: ${games.length} matchups, one at a time`,
      dek:
        phase === "final"
          ? `Every game on the Week ${week} slate with its final score and the top line of the box.`
          : `Every game on the Week ${week} slate with its projected edge and a standout line${live ? ", plus the running score" : ""}. ${withProj.length} of ${games.length} have complete projections.`,
      body: [
        phase === "final"
          ? `The Week ${week} slate is in the books. ${games.length} matchups; the numbers below are final league scores.`
          : `${live ? "The slate is live right now." : "Here is the full slate for Week " + week + "."} ${games.length} matchups, ${withProj.length} with complete projection coverage. Edges are points gaps from Sleeper's standard scoring, not win probabilities.`,
        ...rows,
        phase === "final"
          ? "The matchup view always shows the full box behind every score."
          : "Lineups are snapshots and can move before lock; the matchup view always shows the current box.",
      ].join("\n\n"),
      ...base,
      rid: null,
    });
  }

  // ---- Edge watch: preserve the published ID with final-score facts --------
  if (phase === "final" && games.length) {
    const closest = [...games].sort(
      (a, b) => Math.abs(Number(a.a.pts) - Number(a.b.pts)) - Math.abs(Number(b.a.pts) - Number(b.b.pts)) || a.mid - b.mid,
    )[0];
    const margin = round(Math.abs(Number(closest.a.pts) - Number(closest.b.pts)));
    const tied = Number(closest.a.pts) === Number(closest.b.pts);
    articles.push({
      id: `w${week}-edge`,
      tag: "Slate desk · Final",
      headline: tied
        ? `${closest.a.team} and ${closest.b.team}: the slate's closest finish ended level`
        : `${closest.a.team} vs. ${closest.b.team}: the slate's closest final finish`,
      dek: tied
        ? `The two teams finished level at ${fmt(closest.a.pts)}–${fmt(closest.b.pts)}.`
        : `${fmt(margin)} points separated ${fmt(closest.a.pts)} for ${closest.a.team} and ${fmt(closest.b.pts)} for ${closest.b.team}.`,
      body: tied
        ? `${closest.a.team} and ${closest.b.team} tied ${fmt(closest.a.pts)}–${fmt(closest.b.pts)}, the smallest final margin on the Week ${week} slate.`
        : `${closest.a.team} finished at ${fmt(closest.a.pts)} and ${closest.b.team} at ${fmt(closest.b.pts)}. The ${fmt(margin)}-point final margin was the closest non-tied finish on the Week ${week} slate. These are final box-score facts, not the pregame projection story.`,
      ...base,
      rid: tied ? null : closest.a.pts > closest.b.pts ? closest.a.rid : closest.b.rid,
    });
  }

  // ---- Edge watch (pregame only) ------------------------------------------
  const projGames =
    phase === "final"
      ? []
      : games
          .filter((g) => g.a.proj_total != null && g.b.proj_total != null)
          .map((g) => ({ g, edge: round(Math.abs(g.a.proj_total - g.b.proj_total)) }))
          .sort((x, y) => x.edge - y.edge || x.g.mid - y.g.mid);
  if (projGames.length) {
    const { g, edge } = projGames[0];
    const hi = g.a.proj_total >= g.b.proj_total ? g.a : g.b;
    const lo = hi === g.a ? g.b : g.a;
    const leaders = [...(hi.starters || []), ...(lo.starters || [])]
      .filter((p) => p.proj != null)
      .sort((x, y) => y.proj - x.proj)
      .slice(0, 2);
    articles.push({
      id: `w${week}-edge`,
      tag: "Slate desk",
      headline: `${hi.team} vs. ${lo.team}: the slate's tightest projected finish`,
      dek: `${fmt(edge)} points separate ${fmt(hi.proj_total)} for ${hi.team} and ${fmt(lo.proj_total)} for ${lo.team} — the smallest projected gap on the Week ${week} slate.`,
      body: [
        `${hi.team} projects for ${fmt(hi.proj_total)} points and ${lo.team} for ${fmt(lo.proj_total)}, a ${fmt(edge)}-point edge — the closest projected finish of the ${games.length} games on the Week ${week} slate.`,
        leaders.length
          ? `${leaders.map((p) => `${p.name} (${fmt(p.proj)})`).join(" and ")} carry the largest individual projections across the two lineups. A single unexpected scoreline — a fourth-down stop, a long return, a late lineup change — can erase a gap this size. A one-point projected edge and a ten-point one are not the same game.`
          : "Individual projections are not complete for both lineups, so the team-level gap is the only number to weigh.",
        live
          ? `The score so far: ${fmt(g.a.pts)}–${fmt(g.b.pts)}. Projections are a morning snapshot; the running score is the live number from the league data.`
          : phase === "final"
            ? `The final: ${fmt(g.a.pts)}–${fmt(g.b.pts)}. The morning estimate had the gap at ${fmt(edge)} points; the final margin came in at ${fmt(round(Math.abs(g.a.pts - g.b.pts)))}.`
            : "Projections use Sleeper standard-scoring estimates, not betting odds or win probabilities. League-specific scoring — particularly kicker rules — can differ, and lineups may change before kickoff.",
      ].join("\n\n"),
      ...base,
      rid: hi.rid,
    });
  }

  // ---- Bench chess: final replacement keeps the Sunday link resolvable -----
  if (phase === "final" && games.length) {
    const finalSwaps = games
      .flatMap((g) => [g.a, g.b].map((side) => ({ side, game: g, swap: bestBenchSwap(side) })))
      .filter((x) => x.swap)
      .sort((a, b) => b.swap.gain - a.swap.gain || a.game.mid - b.game.mid);
    const selected = finalSwaps[0];
    let body;
    let headline;
    let dek;
    let rid = null;
    if (selected) {
      const { side, game, swap } = selected;
      const opponent = side.rid === game.a.rid ? game.b : game.a;
      const before = Number(side.pts);
      const after = round(before + swap.gain);
      const opposing = Number(opponent.pts);
      const effect = before === opposing
        ? after > opposing ? "turned the tie into a lead" : "left the teams level"
        : before < opposing
          ? after > opposing ? "flipped the result" : after === opposing ? "tied the final score" : "narrowed the final margin"
          : "increased the winning margin";
      headline = `${swap.bench.name}: the slate's largest final bench swing`;
      dek = `${side.team} left ${fmt(swap.gain)} actual points in a legal one-player bench replacement.`;
      body = `${swap.bench.name} scored ${fmt(swap.bench.pts)} while ${swap.starter.name} scored ${fmt(swap.starter.pts)} in the ${swap.starter.slot} slot for ${side.team}. Replacing that starter would have moved ${side.team} from ${fmt(before)} to ${fmt(after)} points and ${effect} against ${opponent.team} (${fmt(opposing)}). This is a hindsight comparison from the final box score, not a future lineup recommendation.`;
      rid = side.rid;
    } else {
      headline = `Week ${week}: no positive legal bench swing in the final box`;
      dek = "No eligible one-player bench replacement outscored its starter in the recorded box scores.";
      body = `The completed Week ${week} lineups contain no positive legal one-player bench replacement in the available final box-score data. This closes the published bench-watch link without inventing a missed opportunity.`;
    }
    articles.push({ id: `w${week}-bench`, tag: "Slate desk · Final", headline, dek, body, ...base, rid });
  }

  // ---- Bench chess (pregame information only) ----------------------------
  const swaps =
    phase === "final"
      ? []
      : games
          .flatMap((g) => [g.a, g.b])
          .map((s) => ({ side: s, swap: bestProjBenchSwap(s) }))
          .filter((x) => x.swap && x.side.proj_total != null)
          .sort((a, b) => b.swap.gain - a.swap.gain);
  if (swaps.length) {
    const { side, swap } = swaps[0];
    const game = gOf(games, side);
    const opp = game ? (game.a.rid === side.rid ? game.b : game.a) : null;
    const oppEdge = edgeOf(games, game);
    const newEdge =
      oppEdge != null && opp && side.proj_total != null
        ? round(Math.abs(side.proj_total + swap.gain - (side === game.a ? game.b : game.a).proj_total))
        : null;
    articles.push({
      id: `w${week}-bench`,
      tag: "Slate desk",
      headline: `${swap.bench.name}'s ${fmt(swap.bench.proj)}-point projection sits on ${side.team}'s bench`,
      dek: `The slate's biggest legal bench swing: ${fmt(swap.gain)} points over ${swap.starter.name} in the ${swap.starter.slot} slot for ${side.team}${opp ? `, playing ${opp.team}` : ""}.`,
      body: [
        `${swap.bench.name} projects for ${fmt(swap.bench.proj)} points while ${swap.starter.name}, the ${swap.starter.slot} starter, projects for ${fmt(swap.starter.proj)}. Of every legal one-player, position-eligible bench replacement on the Week ${week} slate, that is the biggest swing.`,
        `Taking it would move ${side.team} from ${fmt(side.proj_total)} projected points to ${fmt(round(side.proj_total + swap.gain))}${newEdge != null && oppEdge != null ? ` and move ${side.team}'s projected gap against ${opp.team} from ${fmt(oppEdge)} to ${fmt(newEdge)}` : ""}. It is a one-change comparison, not an optimal-lineup calculation.`,
        "Bench chess is about information: the projection gap is what was knowable before kickoff. The matchup box always shows the final, post-factum version of this same calculation.",
      ].join("\n\n"),
      ...base,
      rid: side.rid,
    });
  }

  // ---- The decider (live and final) ---------------------------------------
  if (live || phase === "final") {
    const scored = phase === "final"
      ? games
      : games.filter((g) => Number(g.a.pts) > 0 || Number(g.b.pts) > 0);
    const decider = [...scored]
      .sort((a, b) => Math.abs(a.a.pts - a.b.pts) - Math.abs(b.a.pts - b.b.pts) || a.mid - b.mid)[0];
    if (decider) {
      const tied = Number(decider.a.pts) === Number(decider.b.pts);
      const winner = tied ? null : decider.a.pts > decider.b.pts ? decider.a : decider.b;
      const loser = winner ? (winner === decider.a ? decider.b : decider.a) : null;
      const margin = tied ? 0 : round(Math.abs(winner.pts - loser.pts));
      const topAll = [...(decider.a.starters || []), ...(decider.b.starters || [])]
        .filter((p) => p.pts != null)
        .sort((x, y) => y.pts - x.pts)[0];
      const swap = loser ? bestBenchSwap(loser) : null;
      const score = `${fmt(decider.a.pts)}–${fmt(decider.b.pts)}`;
      articles.push({
        id: `w${week}-decider`,
        tag: phase === "final" ? "Slate desk · Final" : "Slate desk",
        headline: tied
          ? `${decider.a.team} and ${decider.b.team} are level — the slate's closest ${live ? "live" : "final"} finish`
          : live
            ? `${winner.team} leads ${loser.team} by ${fmt(margin)} — the slate's closest live finish`
            : `${winner.team} beats ${loser.team} by ${fmt(margin)} — the slate's closest finish`,
        dek: tied
          ? `${score}${live ? " right now" : " final"}${topAll ? `; ${topAll.name} led the game with ${fmt(topAll.pts)}` : ""}.`
          : live
            ? `${fmt(winner.pts)}–${fmt(loser.pts)} right now${topAll ? `, with ${topAll.name} the biggest line of the game at ${fmt(topAll.pts)}` : ""}. The smallest live margin of the Week ${week} slate.`
            : `${fmt(winner.pts)}–${fmt(loser.pts)} final${topAll ? `, with ${topAll.name} the biggest line of the game at ${fmt(topAll.pts)}` : ""}. The smallest margin of the Week ${week} slate.`,
        body: [
          tied
            ? `${decider.a.team} and ${decider.b.team} are tied ${score} — level at ${live ? "the current checkpoint" : "the final whistle"}, the smallest ${live ? "live" : "final"} margin among the ${scored.length} games on the Week ${week} slate.`
            : live
              ? `${winner.team} leads ${loser.team} ${fmt(winner.pts)} to ${fmt(loser.pts)} — a ${fmt(margin)}-point margin, the closest live finish among the ${scored.length} games with scores so far this Sunday.`
              : `${winner.team} beat ${loser.team} ${fmt(winner.pts)} to ${fmt(loser.pts)} — a ${fmt(margin)}-point margin, the closest finish of the ${scored.length} games in the Week ${week} slate.`,
          topAll
            ? `${topAll.name} had the biggest individual line of the matchup at ${fmt(topAll.pts)} points for ${topAll.team}.`
            : "",
          swap
            ? live
              ? `The hindsight swing: ${swap.bench.name} has ${fmt(swap.bench.pts)} points on ${loser.team}'s bench against ${swap.starter.name}'s ${fmt(swap.starter.pts)} — ${fmt(swap.gain)} points that would have ${swap.gain > margin ? "flipped" : swap.gain === margin ? "tied" : "narrowed"} the game. This is the running score, not a final result.`
              : `The hindsight swing: ${swap.bench.name} had ${fmt(swap.bench.pts)} points on ${loser.team}'s bench against ${swap.starter.name}'s ${fmt(swap.starter.pts)} — ${fmt(swap.gain)} points that would have ${swap.gain > margin ? "flipped" : swap.gain === margin ? "tied" : "narrowed"} the final result.`
            : "No single legal bench replacement leads the box; the margin belongs to the lineups as locked.",
          live
            ? "Scores update as the league data refreshes; this article re-builds from the same pipeline at the end of the Sunday slate, when the final numbers are in."
            : "This is the final number, from the league's completed box score.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        ...base,
        rid: winner?.rid ?? null,
      });
    }
  }

  return articles;
}
function gOf(games, side) {
  return (games || []).find((g) => g.a.rid === side.rid || g.b.rid === side.rid) || null;
}
function edgeOf(games, game) {
  const g = gOf(games, game);
  if (!g || g.a.proj_total == null || g.b.proj_total == null) return null;
  return round(Math.abs(g.a.proj_total - g.b.proj_total));
}

/** Per-URL og:title/og:description for link cards (WhatsApp, X, etc.). */
export function ogMeta(pathname, d) {
  const nw = d?.next_week || {};
  const n = (nw.games || []).length;
  const hype = weekendHype(d || {});
  if (pathname === "/weekend") {
    const lw = d?.last_week;
    const recaps = (lw?.games || []).length;
    return {
      title: `Week ${nw.week || "—"} Hype — XClub Fantasy`,
      description: `Pre-game stories for the Week ${nw.week || "—"} slate: ${n} matchups with projected edges${hype.closeCount ? ` (${hype.closeCount} within 5 projected points)` : ""}${recaps ? `, plus recaps from Week ${lw.week}` : ""}. Tom Byrne Memorial League.`,
      url: "https://xclubfantasy.robsplex.com/weekend",
      type: "website",
    };
  }
  if (pathname === "/" || pathname === "") {
    const lw = d?.last_week;
    const lead = (d?.articles || []).find((a) => a.id === (d?.week_mode?.leadStory || "weekly-lead"));
    if (lead?.satire) {
      return {
        title: lead.headline,
        description: lead.dek,
        url: "https://xclubfantasy.robsplex.com/#story/baker-decree",
        type: "website",
      };
    }
    const leadText =
      lw?.week != null ? `Week ${lw.week} is in the books. ` : "";
    return {
      title: `XClub Fantasy — The league, covered.`,
      description: `${leadText}Week ${nw.week || "—"} slate: ${n} matchups${hype.closeCount ? `, ${hype.closeCount} within 5 projected points` : ""}. Reviews, matchups and the Tom Byrne Memorial League.`,
      url: "https://xclubfantasy.robsplex.com/",
      type: "website",
    };
  }
  return {
    title: "XClub Fantasy — The league, covered.",
    description:
      "Weekly reviews, matchups, players and league history. The home of the Tom Byrne Memorial Fantasy Football League.",
    url: "https://xclubfantasy.robsplex.com/",
    type: "website",
  };
}

/** Everything the team page needs, derived from data that already exists. */
export function teamPage(d, rid) {
  const ridS = String(rid);
  const t = d.standings.find((x) => String(x.rid) === ridS);
  if (!t) return null;
  const nameOf = (r) => d.standings.find((x) => String(x.rid) === String(r)) || null;
  const gamesPlayed = [];
  // Results come from last_week (authoritative completed slate) — earlier weeks
  // are not in the payload, so only the freshest completed week is shown.
  const lw = d.last_week?.games || [];
  for (const g of lw) {
    if (String(g.a.rid) === ridS) gamesPlayed.push({ week: d.last_week.week, self: g.a, opponent: nameOf(g.b.rid) || g.b, result: g.a.pts > g.b.pts ? "W" : g.a.pts < g.b.pts ? "L" : "T", margin: round(g.a.pts - g.b.pts), mid: g.mid });
    else if (String(g.b.rid) === ridS) gamesPlayed.push({ week: d.last_week.week, self: g.b, selfPts: g.b.pts, oppPts: g.a.pts, opponent: nameOf(g.a.rid) || g.a, result: g.b.pts > g.a.pts ? "W" : g.b.pts < g.a.pts ? "L" : "T", margin: round(g.b.pts - g.a.pts), mid: g.mid });
  }
  const lastGame = gamesPlayed[0] || null;
  const ng = (d.next_week?.games || []).find((g) => String(g.a.rid) === ridS || String(g.b.rid) === ridS);
  const nextSide = ng ? (String(ng.a.rid) === ridS ? ng.a : ng.b) : null;
  const nextGame = ng
    ? {
        week: d.next_week.week,
        status: d.next_week.status,
        side: nextSide,
        opponent: String(ng.a.rid) === ridS ? nameOf(ng.b.rid) || ng.b : nameOf(ng.a.rid) || ng.a,
        selfProj: String(ng.a.rid) === ridS ? ng.a.proj_total : ng.b.proj_total,
        oppProj: String(ng.a.rid) === ridS ? ng.b.proj_total : ng.a.proj_total,
        mid: ng.mid,
      }
    : null;
  const playerOf = (pid) => (d.players || []).find((p) => String(p.pid) === String(pid));
  const form = (d.team_form || {})[ridS] || [];
  const seasonTop = (d.season_top || {})[ridS] || [];
  const seasonTopFull = seasonTop
    .map((x) => ({ ...playerOf(x.pid), ...x }))
    .filter((x) => x.pos || x.name);
  const tx = (d.transactions || []).filter((t) =>
    [...(t.adds || []), ...(t.drops || [])].some((p) => String(p.rid) === ridS),
  );
  const draftPicks = (d.draft?.picks || []).filter((p) => String(p.rid) === ridS);
  const rivalry = (d.rivalries || []).filter((r) => String(r.a_rid) === ridS || String(r.b_rid) === ridS);
  const injuries = (d.players || []).filter((p) => String(p.rid) === ridS && p.injury);
  const roster = (d.players || []).filter((p) => String(p.rid) === ridS);
  const pr = (d.power_rankings || []).find((x) => String(x.rid) === ridS);
  return {
    rid: t.rid,
    uid: t.uid,
    name: t.name,
    manager: t.manager,
    avatar: t.avatar,
    record: recStr(t),
    rank: t.rank,
    fpts: t.fpts,
    pa: t.pa,
    moves: t.moves,
    faab_used: t.faab_used,
    streak: t.streak || "",
    ppg: pr?.ppg ?? null,
    allPlay: pr?.all_play || "",
    lastGame,
    nextGame,
    recent: gamesPlayed.slice(0, 5),
    form,
    seasonTop: seasonTopFull,
    draftPicks,
    tx,
    rivalries: rivalry.map((r) => {
      const isA = String(r.a_rid) === ridS;
      return { opponent: isA ? r.b : r.a, oppRid: isA ? r.b_rid : r.a_rid, wins: isA ? r.a_wins : r.b_wins, losses: isA ? r.b_wins : r.a_wins, ties: r.ties, gp: r.gp, thisWeek: r.this_week };
    }),
    injuries,
    roster,
    awards: (d.awards || []).filter((a) => String(a.rid) === ridS),
  };
}

/** Box-score story facts for one matchup. Hindsight is labelled, never asserted as decision-making. */
export function gameStory(g, d) {
  const sides = [g.a, g.b].map((s) => ({
    ...s,
    top: [...(s.starters || [])].filter((p) => Number.isFinite(p.pts)).sort((a, b) => b.pts - a.pts)[0] || null,
    flop: [...(s.starters || [])].filter((p) => Number.isFinite(p.pts)).sort((a, b) => a.pts - b.pts)[0] || null,
    swap: bestBenchSwap(s),
    injured: [...(s.starters || [])].filter((p) => p.injury),
  }));
  const [a, b] = sides;
  const winner = a.pts > b.pts ? a : b.pts > a.pts ? b : null;
  // Position battle: closest starter-vs-starter gap at the same slot.
  let battle = null;
  for (const sa of a.starters || [])
    for (const sb of b.starters || [])
      if (sa.slot === sb.slot && Number.isFinite(sa.pts) && Number.isFinite(sb.pts)) {
        const gap = round(Math.abs(sa.pts - sb.pts));
        if (!battle || gap < battle.gap) battle = { slot: sa.slot, a: sa, b: sb, gap };
      }
  return {
    winner: winner ? { rid: winner.rid, name: winner.team, pts: winner.pts } : null,
    loser: winner ? (winner === a ? b : a) : null,
    top: [...a.starters, ...b.starters].filter((p) => Number.isFinite(p.pts)).sort((x, y) => y.pts - x.pts)[0] || null,
    flop: [...a.starters, ...b.starters].filter((p) => Number.isFinite(p.pts)).sort((x, y) => x.pts - y.pts)[0] || null,
    battle,
    benchSwing: [a, b].map((s) => (s.swap ? { side: s.team, rid: s.rid, ...s.swap } : null)).filter(Boolean).sort((x, y) => y.gain - x.gain)[0] || null,
    decidedBy:
      winner && g.margin < 5
        ? (() => {
            // Which single starter decision most plausibly decided it? Hindsight only.
            const loser = winner === a ? b : a;
            const swing = loser.swap;
            const margin = round(Math.abs(Number(winner.pts) - Number(loser.pts)));
            if (!swing) return null;
            const outcome = swing.gain > margin
              ? "flipped the result"
              : swing.gain === margin
                ? "tied the final score"
                : "narrowed the final margin";
            return {
              kind: "bench",
              text: `Hindsight: ${swing.bench.name} (${num2(swing.bench.pts)} on the bench) would have ${outcome}`,
            };
          })()
        : null,
  };
}

/**
 * The "Baker decree" — a league-banter (satire) lead story.
 *
 * Returns the article (added via `add`) and true when it was created, or
 * null when the gate isn't met. Gating: the upcoming week must feature
 * Emery's Hash Browns vs. Tuten Hurts AND we must be able to find Baker
 * Mayfield on Emery's projected Week-2 starting lineup. Every number is
 * pulled live from the payload, so the satire stays grounded in real data;
 * the "spite Brock Stars" motive is the invented premise (labelled banter).
 */
function bakerDecree(d, add) {
  const games = d.next_week?.games || [];
  const g = games.find(
    (g) =>
      ((g.a?.team || "").startsWith("Emery") && (g.b?.team || "").startsWith("Tuten")) ||
      ((g.a?.team || "").startsWith("Tuten") && (g.b?.team || "").startsWith("Emery")),
  );
  if (!g) return null;

  const emery = (g.a?.team || "").startsWith("Emery") ? g.a : g.b;
  const tuten = emery === g.a ? g.b : g.a;
  const baker = (emery?.starters || []).find((p) => p.name === "Baker Mayfield");
  if (!baker) return null; // not actually starting this week — no decree to issue
  const bakerMeta = (d.players || []).find((p) => p.name === "Baker Mayfield") || {};
  const bakerLast = bakerMeta.last_pts != null ? bakerMeta.last_pts : 0;

  const stEm = (d.standings || []).find((s) => s.name === emery.team);
  const stTu = (d.standings || []).find((s) => s.name === tuten.team);
  const stBr = (d.standings || []).find((s) => (s.name || "").startsWith("Brock"));
  const brockGame = games.find((g) =>
    ((g.a?.team || "").startsWith("Brock") && (g.b?.team || "").startsWith("Ladd")) ||
    ((g.a?.team || "").startsWith("Ladd") && (g.b?.team || "").startsWith("Brock")),
  );
  const brockOpp = brockGame
    ? (brockGame.a.team.startsWith("Brock") ? brockGame.b : brockGame.a).team
    : null;
  const rival = (d.rivalries || []).find(
    (r) =>
      ((r.a === emery.team && r.b === tuten.team) || (r.b === emery.team && r.a === tuten.team)),
  );

  const emRec = stEm ? `${stEm.wins}-${stEm.losses}` : "?-?";
  const tuRec = stTu ? `${stTu.wins}-${stTu.losses}` : "?-?";
  const emRank = stEm ? stEm.rank : null;
  const tuRank = stTu ? stTu.rank : null;
  const h2h =
    rival && rival.a === emery.team
      ? `The series stands ${rival.a_wins}–${rival.b_wins} in Emery's favour across ${rival.gp} all-time meetings`
      : rival
        ? `The series stands ${rival.b_wins}–${rival.a_wins} in Emery's favour across ${rival.gp} all-time meetings`
        : "The all-time head-to-head is even";
  const edge =
    tuten.proj_total != null && emery.proj_total != null
      ? tuten.proj_total - emery.proj_total
      : null;
  const trending = (d.trending || []).some((t) => t.name === "Baker Mayfield");

  const headline = "Emery's Hash Browns Start Baker Mayfield, a Move With One Clear Victim";
  const dek = `${emery.team}, ${emRec} and ranked No. ${emRank ?? "?"}, will start Baker Mayfield against ${tuten.team} this week. The official reason is fantasy football. The real reason is one man, his love of Tampa Bay, and a grudge that does not fit in a lineup.`;

  const paras = [
    `Nobody asked the group chat how ${emery.team} felt about starting Baker Mayfield. Nobody needed to ask. The team — ${emRec}, ranked No. ${emRank ?? "?"}${stEm?.fpts != null ? `, ${fmt(stEm.fpts)} points last week` : ""} — made the decision in a single, quiet, terrible moment, and it has the look of a manager who has been thinking about ${stBr?.name || "a certain opponent"} for six days straight.`,

    `Here is what is true, and it is all verified: ${baker.name} is a Tampa Bay Buccaneer. ${stBr?.name || "A manager in this league"} is, as the group chat will confirm, a massive Bucs fan. Those two facts are unrelated in any way a fantasy football manager should care about. That is precisely the problem. The matchup has been arranged so that one man's favorite team is played, on a shared slate, by the other man's starting quarterback. This is not a lineup. This is a personal statement with a points column.`,

    `The numbers, for the record, do not support this. ${baker.name} was benched last week for ${fmt(bakerLast)} points. He is now starting with a ${fmt(baker.proj)}-point projection${trending ? "" : " and no appearance on the league's trending players list"}. That is not, in the words of at least one manager, a "commodity." That is a grudge wearing a jersey.`,

    `${tuten.team}, for their part, are projected to win by about ${edge != null ? fmt(edge) : "a handful"} points, which means the manager who made this call just handed his own side the favorite's game on purpose. ${h2h}, so the optics are fine. The logic is not available.`,

    `The cruel part, and the part the league desk is required to report neutrally, is that ${stBr?.name || "he"} is ${stBr ? `${stBr.wins}-${stBr.losses}` : "0-1"} and ranked No. ${stBr?.rank ?? "?"} this week${brockOpp ? `, playing ${brockOpp}, not ${emery.team}` : ""}. He will watch the Buccaneers' quarterback get started to spite him and be unable to do anything about it for a full seven days. He will also, presumably, remain a Bucs fan the entire time, which will make it worse.`,

    `${baker.name} may be benched, traded, or outplayed by Sunday. None of that would change the motive, and the group chat has already moved on to arguing about a different team. The decree stands. Nobody was consulted. Nobody needed to be.`,
  ];

  add(
    "baker-decree",
    "League banter",
    headline,
    dek,
    paras,
    {
      image: { ...baker, pts: baker.proj },
      metric: baker.proj,
      metric_label: "Projected pts",
      rid: emery.rid,
      satire: true,
      source_label: "Statistics from the public league data; motives and quotes invented for effect.",
      hero: {
        src: "/memes/baker-decree.gif",
        alt: "League-minted meme: a Bucswear-wearing Baker Mayfield with his arms spread wide",
      },
    },
  );
  return true;
}

export function buildEditorial(d) {
  const articles = [];
  const url = d.league.url;
  const add = (id, tag, headline, dek, paragraphs, extra = {}) =>
    articles.push({
      id,
      tag,
      headline,
      dek,
      body: paragraphs.filter(Boolean).join("\n\n"),
      byline: "XClub • League desk",
      source_url: url,
      source_label: "Sleeper league data",
      ...extra,
    });

  // ---- League banter / satire lead: the "Baker decree" ---------------------
  // Emitted only while Emery's Hash Browns face Tuten Hurts in the upcoming
  // week. It becomes the home lead that week (via weekMode.leadStory) while the
  // normal data articles below still render as the secondary cards. Every
  // number is pulled live from the payload (real); the motive is the
  // satirical premise, labelled as league banter with a satire disclosure.
  bakerDecree(d, add);

  const lw = d.last_week;
  const games = lw?.games || [];
  const sides = games.flatMap((g) => [g.a, g.b]);
  const avg = sides.length
    ? sides.reduce((s, t) => s + t.pts, 0) / sides.length
    : 0;
  const top = sides.slice().sort((a, b) => b.pts - a.pts)[0];
  const upcoming = d.next_week?.status === "upcoming" && d.next_week.week > (lw?.week || 0);
  const nextOf = (rid) =>
    (upcoming ? d.next_week.games : []).find((g) => g.a.rid === rid || g.b.rid === rid);
  const nextOpp = (rid) => {
    const g = nextOf(rid);
    return g ? (g.a.rid === rid ? g.b : g.a) : null;
  };
  const runnerUp = sides.slice().sort((a, b) => b.pts - a.pts)[1];
  if (top) {
    const game = games.find((g) => g.a.rid === top.rid || g.b.rid === top.rid);
    const opp = game.a.rid === top.rid ? game.b : game.a;
    const leaders = [...top.starters]
      .filter((p) => Number.isFinite(p.pts))
      .sort((a, b) => b.pts - a.pts);
    const next = nextOpp(top.rid);
    const diff = round(top.pts - avg);
    add(
      "weekly-lead",
      "The weekly review",
      `${top.team} sets the pace`,
      `${fmt(top.pts)} points. ${fmt(diff)} above the league average. Week ${lw.week}'s highest score belongs to ${top.team}.`,
      [
        `${top.team} finished Week ${lw.week} with ${fmt(top.pts)} points${top.pts > opp.pts ? `, beating ${opp.team} by ${fmt(game.margin)}` : ` in a tie with ${opp.team}`}. Against the rest of the league, that score would have beaten ${sides.filter((t) => t.rid !== top.rid && t.pts < top.pts).length} of ${Math.max(0, sides.length - 1)} opponents. This wasn't just a favourable matchup.`,
        leaders.length >= 2
          ? `${leaders[0].name} led the lineup with ${fmt(leaders[0].pts)}, followed by ${leaders[1].name} at ${fmt(leaders[1].pts)}. Together they supplied ${Math.round(((leaders[0].pts + leaders[1].pts) / Math.max(top.pts, 0.01)) * 100)}% of the total. The rest of the starters added ${fmt(top.pts - leaders[0].pts - leaders[1].pts)}; that split is worth watching when judging how repeatable the score is.`
          : "",
        `${runnerUp ? `${runnerUp.team} was the nearest challenger at ${fmt(runnerUp.pts)}, just ${fmt(top.pts - runnerUp.pts)} behind. ` : ""}The league averaged ${fmt(avg)} points. ${leaders.some((p) => p.pos === "K" && p.pts >= 15) ? `${leaders.find((p) => p.pos === "K" && p.pts >= 15).name}'s ${fmt(leaders.find((p) => p.pos === "K" && p.pts >= 15).pts)} from the kicker slot is a particular bonus: that contribution makes this score harder to treat as a normal weekly baseline.` : "The weekly scoring lead is earned, even if the size of the gap will take more Sundays to establish."}`,
        next
          ? `Next up: ${next.team} in Week ${d.next_week.week}. The question is whether ${top.team} can stay ahead of the pack when the scoring resets, not whether the opening result deserves credit. It does.`
          : "The score is in the books. Lineup decisions still start fresh next week.",
      ],
      {
        image: leaders[0] || null,
        metric: top.pts,
        metric_label: `Week ${lw.week} points`,
        rid: top.rid,
      },
    );
  }
  const close = [...games]
    .filter((g) => g.margin > 0)
    .sort((a, b) => a.margin - b.margin)[0];
  if (close) {
    const winner = close.a.pts > close.b.pts ? close.a : close.b;
    const loser = winner === close.a ? close.b : close.a;
    const swap = bestBenchSwap(loser);
    add(
      "fine-margins",
      "Fine margins",
      `${winner.team} gets through by ${fmt(close.margin)}`,
      `${fmt(winner.pts)}–${fmt(loser.pts)}. The closest finish of Week ${lw.week}, and a result worth a second look.`,
      [
        `${winner.team} took the week's narrowest win against ${loser.team}. The ${fmt(close.margin)}-point margin counts exactly the same in the standings as a blowout, but it tells a different story about the gap between these lineups.`,
        `${loser.team}'s ${fmt(loser.pts)} points would have beaten ${sides.filter((t) => t.rid !== loser.rid && t.pts < loser.pts).length} of the other ${Math.max(0, sides.length - 1)} teams. Comparing that all-play result with the actual loss is a useful way to separate scoring strength from schedule luck.`,
        swap
          ? `${swap.bench.name} scored ${fmt(swap.bench.pts)} on the bench. A legal one-player swap for ${swap.starter.name} in the ${swap.starter.slot} slot would have added ${fmt(swap.gain)} points${swap.gain > close.margin ? " and changed the winner" : swap.gain === close.margin ? " and tied the game" : ", but would not have erased the deficit"}. This is hindsight, not proof the pregame decision was wrong: the box score alone doesn't show the information available at lineup lock.`
          : "No higher-scoring, position-eligible one-player bench replacement appears in the recorded lineup. That is a narrower conclusion than saying every possible lineup was optimal.",
      ],
      { rid: winner.rid },
    );
  }
  const topPlayer = lw?.top_performers?.[0];
  if (topPlayer) {
    const side = sides.find((t) => t.rid === topPlayer.rid);
    add(
      "player-of-week",
      "Player of the week",
      `${topPlayer.name} does the heavy lifting`,
      `${fmt(topPlayer.pts)} points for ${topPlayer.teamName}. The highest individual score in a starting lineup this week.`,
      [
        `${topPlayer.name} led the league's starting players with ${fmt(topPlayer.pts)} points. ${side ? `That accounted for ${Math.round((topPlayer.pts / Math.max(side.pts, 0.01)) * 100)}% of ${topPlayer.teamName}'s ${fmt(side.pts)}-point total.` : ""} These are the league's actual scored points, not PPR totals from another format.`,
        `The distinction matters in a standard-scoring league. Receptions alone add nothing; yards and touchdowns drive the skill-position returns. Quarterbacks also benefit from having the ball on every offensive possession, so the highest raw score is not automatically the week's most valuable draft pick.`,
        `A repeat performance would be welcome, but this result is not a projection. Use the Week ${d.next_week?.week || ""} matchup view to compare the next starting lineups, and check Sleeper for the latest availability before making changes.`,
      ],
      { image: topPlayer, rid: topPlayer.rid },
    );
  }
  const bench = sides
    .map((s) => ({ side: s, swap: bestBenchSwap(s) }))
    .filter((x) => x.swap)
    .sort((a, b) => b.swap.gain - a.swap.gain)[0];
  if (bench) {
    const { side, swap } = bench;
    add(
      "bench-notebook",
      "The bench notebook",
      `${swap.bench.name}'s ${fmt(swap.bench.pts)} points stayed on the bench`,
      `${side.team} had a ${fmt(swap.gain)}-point upgrade available in a legal ${swap.starter.slot} slot.`,
      [
        `${swap.bench.name} outscored ${swap.starter.name}, ${fmt(swap.bench.pts)} to ${fmt(swap.starter.pts)}. Of the position-eligible, single-player replacements recorded this week, this was the largest improvement. A receiver is only compared with slots that can actually start a receiver—not a kicker or a quarterback.`,
        `That would have taken ${side.team} from ${fmt(side.pts)} to ${fmt(side.pts + swap.gain)} points. It is not an optimal-lineup calculation: multiple changes could interact, and this comparison considers one direct replacement at a time.`,
        `The useful question now is whether the player has earned a larger role, not why the manager failed to predict the final score. The box score cannot answer the workload question on its own. Treat the bench result as a reason to investigate before the next lock, rather than an automatic start.`,
      ],
      { image: swap.bench, rid: side.rid },
    );
  }
  const featured = [...(upcoming ? d.next_week.games : [])]
    .filter((g) => g.a.proj_total != null && g.b.proj_total != null)
    .sort(
      (a, b) =>
        Math.abs(a.a.proj_total - a.b.proj_total) -
        Math.abs(b.a.proj_total - b.b.proj_total),
    )[0];
  if (featured) {
    const { a, b } = featured,
      gap = Math.abs(a.proj_total - b.proj_total);
    const leaders = [...a.starters, ...b.starters]
      .filter((p) => p.proj != null)
      .sort((x, y) => y.proj - x.proj)
      .slice(0, 2);
    add(
      "next-week",
      "Looking ahead",
      `${a.team} vs. ${b.team}: little to separate them`,
      `${fmt(gap)} points between the current projected lineups. Our closest matchup on the Week ${d.next_week.week} slate.`,
      [
        `${a.team} projects for ${fmt(a.proj_total)} points, with ${b.team} at ${fmt(b.proj_total)}. That is the smallest projected gap among the matchups with complete lineup coverage. It is a reason to follow this game, not a meaningful promise about who wins.`,
        leaders.length
          ? `${leaders.map((p) => `${p.name} (${fmt(p.proj)})`).join(" and ")} carry the largest individual projections across the two lineups. An unexpected touchdown, an absence, or a late lineup change can easily erase a small team-level edge.`
          : "",
        "Projections use Sleeper standard-scoring estimates, not betting odds or win probabilities. League-specific scoring—particularly kicker rules—can differ. The listed lineups are snapshots and may change before kickoff; manage them in Sleeper.",
      ],
    );
  }
  const waiver = [...(d.transactions || [])]
    .filter((t) => t.type === "waiver" && t.bid != null && t.adds?.length)
    .sort((a, b) => b.bid - a.bid)[0];
  if (waiver) {
    const p = waiver.adds[0];
    const pct = d.league.faab
      ? Math.round((waiver.bid / d.league.faab) * 100)
      : null;
    add(
      "waiver-notebook",
      "On the wire",
      `${p.teamName} spends $${waiver.bid} on ${p.name}`,
      `${pct != null ? `${pct}% of the $${d.league.faab} starting budget. ` : ""}The largest completed bid in the displayed transaction window.`,
      [
        `${p.teamName} added ${p.name} for $${waiver.bid}${waiver.drops?.length ? ` and released ${waiver.drops.map((p) => p.name).join(", ")}` : ""}. This is a completed move, not a waiver recommendation or a pending claim.`,
        `${pct != null ? `The bid used ${pct}% of the league's starting FAAB budget. ` : ""}That is different from the percentage of the manager's remaining budget at the time. The public transaction record does not establish the full set of losing bids, so it cannot tell us how much was necessary to win.`,
        `The value of the move depends on whether ${p.name} earns useful starts. The players page separates rostered players from those available in this league; platform-wide popularity alone is not evidence that a player is still on this waiver wire.`,
      ],
    );
  }
  const late = d.draft?.steals?.[0];
  if (late) {
    const comps = (d.draft.picks || []).filter(
      (p) =>
        p.pos === late.pos &&
        p.pick_no < late.pick_no &&
        p.pts != null &&
        p.pts < late.pts,
    );
    add(
      "draft-notebook",
      "Draft notebook",
      `${late.name} makes pick ${late.pick_no} look good—for a week`,
      `${fmt(late.pts)} points from a Round ${late.round} pick. A useful early return, not a season-long verdict.`,
      [
        `${late.owner} drafted ${late.name} at No. ${late.pick_no}. The ${late.pos} scored ${fmt(late.pts)} in Week ${lw?.week}, putting him at the top of the Round 8-or-later picks with recorded points that week. This measures player output whether he started or sat.`,
        comps.length
          ? `He outscored ${comps.length} earlier-drafted ${late.pos}${comps.length === 1 ? "" : "s"} with recorded scores, including ${comps
              .slice(0, 2)
              .map((p) => `${p.name} (${fmt(p.pts)}; pick ${p.pick_no})`)
              .join(
                " and ",
              )}. Keeping the comparison within the position avoids treating a quarterback's raw points as directly interchangeable with a running back's.`
          : "Raw points across positions are not a reliable measure of draft value. Quarterback output, for example, should be compared with other quarterbacks and the alternatives available on waivers.",
        "The draft paid for a full season. A strong opening return deserves attention, but it does not prove a permanent role; a quiet week for an early pick does not prove a bust. Revisit the comparison as more games are played.",
      ],
      { image: late },
    );
  }
  return articles;
}
