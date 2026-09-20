/* XClub client: small, dependency-free, mobile-first. All source strings are escaped. */
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const f = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const short = (n) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);
const rec = (t) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
const date = (ms) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
let DATA,
  currentView = "home",
  matchMode = "recap",
  playerLimit = 40,
  loading = false,
  returnHash = "#home",
  previousFocus;
let followed = "";
try {
  followed = localStorage.getItem("xclub-team") || "";
} catch {}
const head = (text, sub = "") =>
  `<div class="section-heading"><h2>${esc(text)}</h2>${sub ? `<span class="small">${esc(sub)}</span>` : ""}</div>`;
const avatar = (url, name) =>
  `<span class="avatar" data-fallback="${esc((name || "?").trim().charAt(0))}">${url ? `<img src="${esc(url)}" loading="lazy" width="32" height="32" alt="">` : esc((name || "?").trim().charAt(0))}</span>`;
const photo = (p) =>
  `<span class="headshot" data-fallback="${esc(p.pos === "DEF" ? p.team : (p.name || "?").charAt(0))}">${p.img ? `<img src="${esc(p.img)}" loading="lazy" alt="" width="46" height="46">` : esc(p.team || p.pos || "—")}</span>`;
const injury = (p) =>
  p.injury
    ? `<span class="injury" title="Metadata snapshot: ${esc(DATA.player_metadata_asof || "unknown")}">${esc(p.injury)}</span>`
    : "";
const storyLink = (a, label = "Read the story") =>
  `<a class="text-link" href="#story/${esc(a.id)}" data-story="${esc(a.id)}">${esc(label)}</a>`;
const intro = (eyebrow, title, description) =>
  `<div class="page-intro"><span class="eyebrow">${esc(eyebrow)}</span><h1 style="margin-top:10px">${esc(title)}</h1><p>${esc(description)}</p></div>`;

document.addEventListener(
  "error",
  (e) => {
    if (e.target.tagName === "IMG") {
      const wrap = e.target.parentElement;
      if (wrap.hasAttribute("data-fallback"))
        wrap.textContent = wrap.dataset.fallback;
      else {
        e.target.remove();
        wrap.classList.add("no-photo");
      }
    }
  },
  true,
);

function renderScoreboard(d) {
  const games = d.last_week?.games || [];
  if (!games.length) return "";
  return `<div class="scoreboard"><div class="score-heading"><span>Week ${d.last_week.week} · Final scores</span><a href="#matchups">Box scores →</a></div><div class="score-scroll" role="region" aria-label="Week ${d.last_week.week} scores, swipe for more" tabindex="0">${games.map((g) => `<a href="#matchups" class="score-tile" aria-label="${esc(g.a.team)} ${f(g.a.pts)}, ${esc(g.b.team)} ${f(g.b.pts)}. View box scores.">${[g.a, g.b].map((s) => `<div class="score-mini-row ${s.pts > (s === g.a ? g.b : g.a).pts ? "winner" : s.pts < (s === g.a ? g.b : g.a).pts ? "loser" : ""}"><span>${esc(s.team)}</span><strong class="num">${f(s.pts)}</strong></div>`).join("")}</a>`).join("")}</div></div>`;
}
function awardStrip(d) {
  const awards = d.awards || [];
  if (!awards.length) return "";
  return `<section class="awards-strip" aria-label="Week ${d.last_week?.week} awards">${head(`Week ${d.last_week?.week} awards`, "Computed from box scores")}<div class="award-grid">${awards.map((a) => { const t = d.standings.find((t) => String(t.rid) === String(a.rid)); return `<a class="award" href="#team/${a.rid}"><span class="award-label">${esc(a.label)}</span><strong>${esc(t?.name || "—")}</strong><span class="award-detail">${esc(a.detail)}</span></a>`; }).join("")}</div></section>`;
}
function injuryRoom(d) {
  const list = (d.injuries || []).slice(0, 8);
  if (!list.length)
    return `<section class="feature-row">${head("The trainer's room", "No designations")}<p class="context-note">No rostered player is carrying an injury designation in the current metadata snapshot. Verify in Sleeper before kickoff.</p></section>`;
  const chipClass = (p) => `sev-${esc(String(p.injury_chip || p.injury).toLowerCase().replace(/[^a-z]/g, ""))}`;
  const chipText = (p) => esc(p.injury_chip || String(p.injury).slice(0, 3).toUpperCase());
  return `<section class="feature-row">${head("The trainer's room", "Metadata snapshot")}<div class="injury-grid">${list.map((p) => `<a class="injury-row" href="#players"><span class="injury-sev ${chipClass(p)}">${chipText(p)}</span><div><strong>${esc(p.name)}</strong><div class="small">${esc(p.pos === "DEF" ? "D/ST" : p.pos)} · ${esc(p.team || "FA")} · ${esc(p.teamName || "Available")}</div></div></a>`).join("")}</div><p class="context-note">Designations come from the player metadata snapshot (${esc(date(Date.parse(d.player_metadata_asof) || d.asof))} ET) and change frequently. Always verify in Sleeper before lineup lock.</p></section>`;
}
function featureArt(a) {
  const p = a.image;
  const full =
    p?.pid && /^\d+$/.test(p.pid)
      ? `https://sleepercdn.com/content/nfl/players/${p.pid}.jpg`
      : null;
  return `<div class="feature-art${full ? "" : " no-photo"}"><div class="big-score num" aria-hidden="true">${f(a.metric)}</div><div class="art-label">${esc(a.metric_label)}</div>${full ? `<img src="${esc(full)}" alt="${esc(p.name)}" width="350" height="254" fetchpriority="high">` : ""}<div class="art-credit">${esc(p?.name || "")}<small>${esc(p?.pos || "")} · ${f(p?.pts)} PTS</small></div></div>`;
}
function storyCard(a) {
  return `<article class="story-card"><span class="eyebrow">${esc(a.tag)}</span><h3><a href="#story/${esc(a.id)}" data-story="${esc(a.id)}">${esc(a.headline)}</a></h3><p>${esc(a.dek)}</p>${storyLink(a)}</article>`;
}
function slateDeskSection(d) {
  const slate = d.slate || [];
  if (!slate.length) return "";
  const wm = d.week_mode || {};
  const label =
    wm.mode === "live"
      ? `Week ${wm.week} · live from the Sunday slate`
      : wm.mode === "preview"
        ? `Week ${wm.nextWeek ?? "—"} · queued for Sunday`
        : "This slate";
  const cards = slate.slice(0, 4).map((a) => storyCard(a)).join("");
  return `<section class="slate-desk" aria-label="The Slate desk">${head("The Slate desk", label)}<div class="story-grid">${cards}</div></section>`;
}
function homeHypeSection(d) {
  const n = d.weekend_narrative || {};
  const pre = Array.isArray(n.pre) ? n.pre : [];
  const recap = Array.isArray(n.recap) ? n.recap : [];
  const useRecap = d.featured?.mode === "recap" && recap.length > 0;
  const source = useRecap ? recap : pre.length ? pre : recap;
  const featured = d.featured && source.some((c) => c.mid === d.featured.mid) ? d.featured : null;
  const stories = source
    .filter((c) => !featured || c.mid !== featured.mid)
    .slice(0, 3);
  if (!source.length && !featured) return "";
  const week = useRecap ? n.lwWeek : n.week;
  const label = useRecap
    ? `Week ${week ?? "—"} recap · ${source.length} matchup stories`
    : `Week ${week ?? "—"} preview · ${source.length} matchup stories`;
  const remaining = Math.max(0, source.length - stories.length - (featured ? 1 : 0));
  return `<section class="home-hype" aria-label="The Hype desk">${head("The Hype desk", label)}${featured ? featuredCard(featured, d, "homeFeatTitle") : ""}${stories.length ? `<div class="home-hype-cards">${stories.map((c) => narrativeCard(c, d)).join("")}</div>` : ""}<div class="home-hype-foot">${remaining ? `<span class="small">${remaining} more matchup stor${remaining === 1 ? "y" : "ies"} on Hype.</span>` : ""}<a class="text-link" href="#weekend">Read the full Hype page →</a></div></section>`;
}
function renderHome(d) {
  const wm = d.week_mode || { mode: "recap", week: d.last_week?.week, nextWeek: d.next_week?.week, leadStory: "weekly-lead" };
  const weekLabel = { recap: "Weekly review", preview: "Week preview", live: "Live Sunday", offseason: "Offseason" }[wm.mode] || "Weekly review";
  const lead = d.articles.find((a) => a.id === wm.leadStory) || d.articles[0];
  const selectStories = (ids) =>
    ids.map((id) => d.articles.find((a) => a.id === id)).filter(Boolean);
  const followTeam = d.standings.find((t) => String(t.rid) === followed);
  const next = d.next_week.games.find(
    (g) => String(g.a.rid) === followed || String(g.b.rid) === followed,
  );
  const opp = next ? (String(next.a.rid) === followed ? next.b : next.a) : null;
  const top = d.last_week?.team_of_the_week;
  const banterLead = !!(lead && lead.satire);
  const leadEyebrow = banterLead
    ? `${lead.tag} · Week ${wm.nextWeek ?? "—"} preview`
    : `${lead.tag} · ${weekLabel}${wm.mode === "live" ? " · In progress" : ""}`;
  const leadCta = banterLead
    ? "Read the column"
    : wm.mode === "preview"
      ? "Read the preview"
      : "Read the weekly review";
  $("view-home").innerHTML =
    `${renderScoreboard(d)}<div class="home-layout"><div class="home-main">
    ${lead ? `<article class="lead${banterLead ? " lead-banter" : ""}"><div class="lead-copy"><span class="eyebrow">${esc(leadEyebrow)}</span><h1><a href="#story/${esc(lead.id)}" data-story="${esc(lead.id)}">${esc(lead.headline)}</a></h1><p class="lead-dek">${esc(lead.dek)}</p><div class="lead-meta">XClub / League desk</div>${storyLink(lead, leadCta)}</div>${featureArt(lead)}</article>` : intro("The new season", "Every week starts here.", "The first completed scores will bring the weekly review. Until then, take a look at the matchups and starting lineups.")}
    ${awardStrip(d)}
    ${homeHypeSection(d)}
    ${slateDeskSection(d)}
    <div class="story-grid">${selectStories(["fine-margins", "bench-notebook", "next-week"]).map(storyCard).join("")}</div>
    <section class="feature-row">${head(`Week ${d.last_week?.week || "—"} standouts`, "Starting lineups only")}<div class="players-preview">${
      (d.last_week?.top_performers || [])
        .slice(0, 6)
        .map(
          (p) =>
            `<div class="performer">${photo(p)}<div class="performer-info"><h3>${esc(p.name)}</h3><div class="small">${esc(p.pos)} · ${esc(p.team)}</div><div class="pts num">${f(p.pts)}</div></div></div>`,
        )
        .join("") ||
      '<p class="context-note">No completed player scores yet.</p>'
    }</div><a class="text-link" href="#players">Explore the players</a></section>
    ${selectStories(["waiver-notebook", "draft-notebook", "player-of-week"]).length ? `<section class="feature-row">${head("The notebook", "Beyond the score")}<div class="story-grid">${selectStories(["waiver-notebook", "draft-notebook", "player-of-week"]).map(storyCard).join("")}</div></section>` : ""}
    ${injuryRoom(d)}
    <section class="feature-row cheap-seats"><span class="eyebrow">The cheap seats · League banter</span><h3>${top ? `${esc(top.name)}, the screenshot is probably saved by now.` : "The group chat is undefeated."}</h3><p>${top ? `${f(top.pts)} points is a perfectly reasonable excuse to check the standings again. Enjoy it. The next lineup still needs setting.` : "Every season begins with twelve convincing explanations for why this is the year."}</p></section>
  </div><aside class="home-aside" aria-label="League at a glance">
    <section class="follow-box"><span class="eyebrow">Your corner of the league</span><label for="followTeam">Follow your team</label><select id="followTeam"><option value="">Choose a team</option>${d.standings.map((t) => `<option value="${t.rid}" ${followed === String(t.rid) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>${followTeam ? `<div class="follow-summary"><p><strong>${esc(followTeam.name)}</strong></p><p>${rec(followTeam)} · ${f(followTeam.fpts)} points for</p>${opp ? `<p>Week ${d.next_week.week}: vs. ${esc(opp.team)}</p>` : ""}<a class="text-link" href="#matchups">See the matchup</a></div>` : '<p class="follow-note">Keep your team in view. Saved only on this device; no account needed.</p>'}</section>
    <section>${head("The table", `Week ${d.completed_week}`)}<ol class="rail-list">${d.standings
      .slice(0, 6)
      .map(
        (t) =>
          `<li><span class="rank">${t.rank}</span>${avatar(t.avatar, t.name)}<span class="rail-name">${esc(t.name)}</span><span class="record">${rec(t)}</span></li>`,
      )
      .join(
        "",
      )}</ol><a class="text-link" href="#standings">Full standings</a></section>
    <section>${head("Latest moves")}<div>${
      d.transactions
        .slice(0, 4)
        .map(
          (t) =>
            `<div class="rail-transaction"><span class="eyebrow">${t.type === "trade" ? "Trade" : t.type === "free_agent" ? "Free agent" : "Waiver"}${t.bid != null ? ` · $${t.bid}` : ""} · ${esc(date(t.when))} ET</span>${t.lines
              .slice(0, 2)
              .map((l) => `<p>${esc(l)}</p>`)
              .join("")}</div>`,
        )
        .join("") ||
      '<p class="context-note">No completed moves in the current transaction window.</p>'
    }</div><a class="text-link" href="#players">Players &amp; transactions</a></section>
    ${d.reigning_champ ? `<section>${head("Defending champion")}<h3>${esc(d.reigning_champ.name)}</h3><p class="context-note">${d.reigning_champ.season} playoff champion.<br>Now: ${esc(d.reigning_champ.current_team)}</p><a class="text-link" href="#history">The trophy cabinet</a></section>` : ""}
  </aside></div>`;
}
function lineup(s, preview) {
  return `<div><div class="lineup-title">${esc(s.team)}</div>${s.starters.map((p) => `<div class="lineup-row"><span class="slot">${esc(p.slot || p.pos)}</span><div><strong>${esc(p.name)}</strong>${injury(p)}<div class="small">${esc(p.team)}${p.pos ? ` · ${esc(p.pos)}` : ""}</div></div><span class="num">${f(preview ? p.proj : p.pts)}</span></div>`).join("")}${!preview && s.bench.length ? `<div class="lineup-title">Bench</div>${s.bench.map((p) => `<div class="lineup-row"><span class="slot">${esc(p.pos)}</span><strong>${esc(p.name)}</strong><span class="num">${f(p.pts)}</span></div>`).join("")}` : ""}</div>`;
}
function gameCard(g, week, preview) {
  const tie = g.a.pts === g.b.pts;
  const status = preview ? DATA.next_week.status : "complete";
  const label = preview
    ? status === "upcoming"
      ? "Upcoming · Projected"
      : status === "complete"
        ? "Final · Actual / projected"
        : "In progress · Actual / projected"
    : "Final";
  return `<article class="game" data-mid="${g.mid}"><div class="game-top"><span>Week ${week} · ${label}</span>${!preview ? `<button class="share-game" data-share-game="${week}/${g.mid}" aria-label="Copy a link to this matchup">Share</button><span class="close-label">${tie ? "Tie" : g.margin < 5 ? "Close finish" : ""}</span>` : ""}</div><div class="game-sides">${[g.a, g.b].map((s) => `<a class="game-side ${!preview && s.pts > (s === g.a ? g.b : g.a).pts ? "winner" : ""}" href="#team/${s.rid}">${avatar(s.avatar, s.team)}<div><div class="team-name">${esc(s.team)}</div><div class="small">${preview ? (s.proj_total == null ? `${s.proj_covered}/${s.proj_slots} estimates available` : "Sleeper standard estimate") : `Top: ${esc([...s.starters].filter((p) => p.pts != null).sort((a, b) => b.pts - a.pts)[0]?.name || "—")}`}</div></div><div class="score">${f(preview && status === "upcoming" ? s.proj_total : s.pts)}${preview && status !== "upcoming" ? `<div class="small">Proj. ${f(s.proj_total)}</div>` : ""}</div></a>`).join("")}</div>${!preview ? matchupStory(g, DATA, false) : ""}<p class="game-foot">${preview ? "Estimates, not a win probability." : tie ? "An even result." : `${f(g.margin)}-point margin · ${f(g.total)} combined`}</p><details class="lineup-details"><summary>${preview ? "Starting lineups & projections" : "Full box score & bench"}</summary><div class="lineup-columns">${lineup(g.a, preview)}${lineup(g.b, preview)}</div></details></article>`;
}
function narrativeCard(c, d) {
  const shareUrl = `${location.origin}${location.pathname}#game/${c.week}/${c.mid}`;
  const sideLine = (s) => {
    const rank = s.rank ? `#${s.rank}` : "";
    const last =
      s.result_last === "W"
        ? `won last week (${f(s.pts_last)})`
        : s.result_last === "L"
        ? `lost last week (${f(s.pts_last)})`
        : "no result on record";
    const inj = s.injuries.length ? ` · ${s.injuries.map((i) => `${i.name} (${i.chip})`).join(", ")}` : "";
    return `<div class="nc-side"><a class="nc-team" href="#team/${s.rid}">${esc(s.team)}</a><div class="nc-meta">${s.rec}${rank ? ` · ${rank}` : ""} · ${last}${inj}</div></div>`;
  };
  const badge =
    c.mode === "preview"
      ? c.close ? '<span class="close-badge">Close call</span>' : '<span class="hype-edge">Projected</span>'
      : c.live ? '<span class="live-badge">Final*</span>' : '<span class="final-badge">Final</span>';
  const h2h = c.h2h
    ? `<div class="nc-h2h">All-time: ${c.h2h.leader === "Even" ? "level" : esc(c.h2h.leader) + " leads"} ${c.h2h.rec} over ${c.h2h.gp} meetings</div>`
    : "";
  return `<article class="nc-card${c.close ? " close" : ""}">
    <div class="nc-top"><span>Week ${c.week} · ${c.mode === "preview" ? "Pre-game" : c.live ? "In progress" : "Recap"}</span>${badge}</div>
    <div class="nc-sides">
      ${sideLine(c.a)}
      <div class="nc-vs">
        ${c.mode === "preview" ? (c.fav ? `<span class="nc-fav">${esc(c.fav.team)} +${f(c.edge)}</span>` : `<span class="nc-fav muted">open</span>`) : `<span class="nc-score">${f(c.scoreA)} – ${f(c.scoreB)}</span>`}
      </div>
      ${sideLine(c.b)}
    </div>
    ${h2h}
    <p class="nc-copy">${c.narrative.map((s) => esc(s)).join(" ")}</p>
    <div class="nc-foot"><button class="share-game" data-share-game="${c.week}/${c.mid}">Copy link</button><a class="text-link" href="#game/${c.week}/${c.mid}">Full matchup →</a></div>
  </article>`;
}
function renderWeekend(d) {
  const n = d.weekend_narrative || { week: d.next_week?.week, lwWeek: d.last_week?.week, pre: [], recap: [] };
  const feat = d.featured || null;
  const pre = n.pre.map((c) => narrativeCard(c, d)).join("");
  const recap = n.recap.map((c) => narrativeCard(c, d)).join("");
  const preHead = n.week
    ? `<section>${head(`This weekend — Week ${n.week}`, "The pre-game story for every matchup")}${pre || '<div class="empty">No matchups scheduled.</div>'}</section>`
    : "";
  const recapHead = n.lwWeek != null && n.recap.length
    ? `<section>${head(`Last weekend — Week ${n.lwWeek}`, "How each game actually played out")}${recap}</section>`
    : "";
  $("view-weekend").innerHTML =
    `${intro("The weekend, told match-up by match-up", n.week ? `Week ${n.week} hype, plus the story from Week ${n.lwWeek}.` : "Week-by-week stories.")}
    <button id="shareWeekend" class="solid-button">Share this hype page</button>
    ${feat ? featuredCard(feat, d) : ""}
    ${preHead}
    ${recapHead}
    <p class="context-note">Pre-game lines use Sleeper's standard projections — an edge is a points gap, not a win probability. Recaps are built from the final box score, including hindsight bench swings. Injury chips are status flags — verify before kickoff.</p>`;
}
function featuredCard(c, d, titleId = "featTitle") {
  const wm = d.week_mode || {};
  const isRecap = wm.mode === "recap";
  const sideLine = (s) => {
    const st = d.standings.find((x) => String(x.rid) === String(s.rid)) || {};
    const rec = `${st.wins ?? "?"}-${st.losses ?? "?"}${st.ties ? `-${st.ties}` : ""}`;
    const isA = String(c.a.rid) === String(s.rid);
    const val = isRecap ? (isA ? c.scoreA : c.scoreB) : s.proj;
    return `<div class="feat-side ${c.winner && String(c.winner.rid) === String(s.rid) ? "winner" : ""}">
      <div class="feat-score num">${f(val)}</div>
      <a class="feat-team" href="#team/${s.rid}">${esc(s.team)}</a>
      <div class="small">${rec} · #${s.rank ?? "—"}${s.streak ? ` · ${esc(s.streak)}` : ""}</div>
      ${(s.injuries || []).length ? `<div class="feat-inj small">${s.injuries.map((i) => `${esc(i.name)} (${esc(i.chip)})`).join(" · ")}</div>` : ""}
    </div>`;
  };
  const headline = c.h2h
    ? c.h2h.leader === "Even"
      ? `An even rivalry, decided by ${esc(c.winner ? c.winner.team : "whoever shows up")}`
      : `${esc(c.h2h.leader)} own this series`
    : isRecap
      ? `${esc(c.winner?.team || "One side")} had the last word`
      : `${esc(c.fav?.team || "No projected favorite")}, for now`;
  const dek = isRecap
    ? c.narrative ? c.narrative.join(" ") : ""
    : `${c.why.charAt(0).toUpperCase() + c.why.slice(1)}: ${f(c.a.proj)} for ${c.a.team} against ${f(c.b.proj)} for ${c.b.team}. ${c.narrative ? c.narrative.join(" ") : ""}`;
  const battle = c.battle
    ? `<div class="feat-fact"><span>Closest positional battle</span><strong>${esc(c.battle.slot)} · ${f(c.battle.a)} to ${f(c.battle.b)}</strong></div>`
    : "";
  const topLine = c.top ? `<div class="feat-fact"><span>Top scorer</span><strong>${esc(c.top.name)} · ${f(c.top.pts)} pts</strong></div>` : "";
  const decidedBy = c.decidedBy?.text ? `<div class="feat-fact decided"><span>The deciding move</span><strong>${esc(c.decidedBy.text)}</strong></div>` : "";
  const leaves = c.leaves
    ? `<div class="feat-leaves small">Where it leaves them: ${esc(c.leaves.a.rec)} at #${c.leaves.a.rank ?? "—"} · ${esc(c.leaves.b.rec)} at #${c.leaves.b.rank ?? "—"}</div>`
    : "";
  return `<section class="feat" aria-labelledby="${esc(titleId)}">${head("Matchup of the week", c.week ? `Week ${c.week}` : "")}
    <article class="feat-card">
      <div class="feat-scores">${sideLine(c.a)}<div class="feat-vs" aria-hidden="true">${isRecap ? "final" : "vs"}</div>${sideLine(c.b)}</div>
      <h3 id="${esc(titleId)}">${esc(headline)}</h3>
      <p class="feat-dek">${esc(dek)}</p>
      ${topLine}${battle}${decidedBy}${leaves}
      <a class="text-link feat-open" href="#game/${c.week}/${c.mid}">Open the full matchup box →</a>
    </article></section>`;
}
function renderMatchups(d) {
  if (!d.last_week) matchMode = "preview";
  const preview = matchMode === "preview",
    week = preview ? d.next_week.week : d.last_week?.week,
    games = preview ? d.next_week.games : d.last_week?.games || [];
  const sorted = [...games].sort(
    (a, b) =>
      Number([b.a.rid, b.b.rid].map(String).includes(followed)) -
      Number([a.a.rid, a.b.rid].map(String).includes(followed)),
  );
  $("view-matchups").innerHTML =
    `${intro("The scoreboard", "Scores & matchups.", "Results and starting lineups. Choose your team to bring its matchup to the top.")}<div class="match-follow"><label for="matchFollow">Your team</label><select id="matchFollow"><option value="">All matchups</option>${d.standings.map((t) => `<option value="${t.rid}" ${followed === String(t.rid) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div><div class="tab-switch" aria-label="Select matchup week">${d.last_week ? `<button data-match-mode="recap" aria-pressed="${!preview}">Week ${d.last_week.week} · Results</button>` : ""}<button data-match-mode="preview" aria-pressed="${preview}">Week ${d.next_week.week} · ${d.next_week.status === "upcoming" ? "Preview" : d.next_week.status === "complete" ? "Results" : "In progress"}</button></div>${preview ? `<p class="context-note">${esc(d.methodology.projections)} Lineups fetched ${esc(date(d.asof))} ET; they may change before kickoff.</p>` : ""}<div class="games-grid">${sorted.map((g) => gameCard(g, week, preview)).join("") || '<div class="empty">No head-to-head matchups are scheduled for this week.</div>'}</div>`;
}
function renderStandings(d) {
  $("view-standings").innerHTML =
    `${intro("The season so far", "The standings. No spin.", "Wins and losses first. Points for breaks an equal record. Scoring form below shows who is producing, independent of the schedule.")}<div class="table-wrap"><table class="standings-table"><caption class="small" style="text-align:left;padding:12px 8px">${d.season} standings · ${d.league.size} teams</caption><thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col" class="num">W–L–T</th><th scope="col" class="num">PF</th><th scope="col" class="num optional-col">PA</th><th scope="col" class="num optional-col">FAAB left</th></tr></thead><tbody>${d.standings.map((t) => `<tr class="${t.rank === d.league.playoff_teams ? "cutoff " : ""}${String(t.rid) === followed ? "followed" : ""}"><td class="rank-col">${t.rank}</td><td class="team-cell"><div class="team-title">${esc(t.name)}</div><div class="small">${esc(t.manager)}</div></td><td class="num">${rec(t)}</td><td class="num">${f(t.fpts)}</td><td class="num optional-col">${f(t.pa)}</td><td class="num optional-col">$${Math.max(0, d.league.faab - t.faab_used)}</td></tr>`).join("")}</tbody></table></div><p class="context-note">PF = points for. PA = points against. Red line marks the current top ${d.league.playoff_teams}; it does not indicate a clinched playoff place.</p><section class="form-table">${head("Scoring form", "Not a prediction")}<p class="context-note">${esc(d.methodology.rankings)} No made-up hot takes or unsupported rank changes.</p><div class="form-rows">${d.power_rankings.map((t) => `<div class="form-row"><span class="position">${t.rank}</span><div><strong>${esc(t.name)}</strong>${t.delta ? `<span class="change">${t.delta > 0 ? "↑" : "↓"} ${Math.abs(t.delta)}</span>` : ""}<div class="small">All-play: ${esc(t.all_play)}</div></div><div class="right"><div class="ppg num">${f(t.ppg)}</div><div class="small">points / game</div></div></div>`).join("")}</div></section>`;
}
function renderInjuries(d) {
  const list = d.injuries || [];
  const snap = d.player_metadata_asof ? date(Date.parse(d.player_metadata_asof) || d.asof) : "an unknown time";
  const byChips = (codes) => list.filter((p) => codes.includes(String(p.injury_chip || "").toUpperCase())).length;
  const chips = [
    ["o", "Out", ["O", "PUP"]],
    ["ir", "Injured reserve", ["IR", "IR-R"]],
    ["sus", "Suspended", ["SUS"]],
    ["d", "Doubtful", ["D", "SSPD"]],
    ["q", "Questionable", ["Q"]],
    ["q", "Did not play / other", ["DNP", "NA", "?"]],
  ].filter((c) => byChips(c[2]) > 0);
  $( "view-injuries").innerHTML =
    `${intro("The trainer's report", "Injury designations.", "Every rostered player carrying an injury flag in the current metadata snapshot, most severe first. Designations change before kickoff — treat this as a starting point, not a guarantee.")}` +
    `<div class="sev-summary" role="list" aria-label="Severity summary">${chips.map((c) => `<span class="sev-pill" role="listitem"><span class="injury-sev sev-${c[0]}">${c[1].split(" ")[0].toUpperCase()}</span>${byChips(c[2])} <span class="small">${c[1]}</span></span>`).join("")}</div>` +
    `<div class="filters injury-filters"><div><label for="injuryPosFilter">Position</label><select id="injuryPosFilter"><option value="">All positions</option>${["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `<option value="${p}">${p === "DEF" ? "D/ST" : p}</option>`).join("")}</select></div><div class="owner-filter"><label for="injuryTeamFilter">Fantasy team</label><select id="injuryTeamFilter"><option value="">Every team</option>${d.standings.map((t) => `<option value="${t.rid}">${esc(t.name)}</option>`).join("")}</select></div></div>` +
    `<div class="table-wrap"><table class="injury-table"><caption class="small" style="text-align:left;padding:12px 8px">${list.length} rostered player${list.length === 1 ? "" : "s"} with a designation · snapshot ${snap} ET</caption><thead><tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">NFL team</th><th scope="col">Status</th><th scope="col" class="owner-col">Fantasy team</th><th scope="col" class="num optional-col">W${d.last_week?.week || "—"} pts</th></tr></thead><tbody id="injuryRows">${injuryRowsHtml(list, d)}</tbody></table><div id="injuryEmpty" class="empty" hidden>No rostered players match these filters.</div></div>` +
    `<p class="context-note">Statuses are Sleeper designations from the player metadata snapshot (${snap} ET) and are a point-in-time view. "PUP" is shown at out level because those players are not practicing. Full words in the source are abbreviated here. Always verify in <a href="https://sleeper.com/leagues/${esc(d.league.id)}" target="_blank" rel="noopener noreferrer">Sleeper</a> before lineup lock.</p>`;
  const pf = $("injuryPosFilter"), tf = $("injuryTeamFilter");
  const apply = () => {
    const pos = pf.value, team = tf.value;
    const filtered = list.filter((p) => (!pos || p.pos === pos) && (!team || String(p.rid) === team));
    $("injuryRows").innerHTML = injuryRowsHtml(filtered, d);
    $("injuryEmpty").hidden = filtered.length > 0;
  };
  pf.addEventListener("change", apply);
  tf.addEventListener("change", apply);
}
function injuryRowsHtml(list, d) {
  return list
    .map((p) => {
      const chip = p.injury_chip || String(p.injury).slice(0, 3).toUpperCase();
      const sev = String(chip).toLowerCase().replace(/[^a-z]/g, "");
      return `<tr><td class="name-cell"><strong>${esc(p.name)}</strong></td><td>${esc(p.pos === "DEF" ? "D/ST" : p.pos)}</td><td>${esc(p.team || "FA")}</td><td><span class="injury-sev sev-${sev}" title="${esc(p.injury || p.injury_chip)}">${esc(chip)}</span></td><td class="owner-col">${p.rid != null ? `<a class="text-link" href="#team/${p.rid}">${esc(p.teamName || "—")}</a>` : "—"}</td><td class="num optional-col">${p.last_pts != null ? f(p.last_pts) : "—"}</td></tr>`;
    })
    .join("");
}
function renderWaivers(d) {
  const wk = d.waivers || {};
  const txs = d.transactions || [];
  const deadlineCard = wk.trade_open
    ? `<div class="deadline-card open"><span class="deadline-tag">Trade deadline</span><strong>Week ${wk.trade_week}</strong><p>${wk.trade_weeks_left === 0 ? "Trades close after this week — the final window is open now." : `${wk.trade_weeks_left} week${wk.trade_weeks_left === 1 ? "" : "s"} of trade windows left.`}</p></div>`
    : `<div class="deadline-card closed"><span class="deadline-tag">Trade deadline</span><strong>Closed</strong><p>The league's trade window closed after Week ${wk.trade_week || "—"}. Only waiver adds and drops remain.</p></div>`;
  const faabCard = wk.faab
    ? `<div class="faab-card"><span class="faab-tag">FAAB pool</span><strong>$${wk.faab}</strong><div class="faab-bars" role="list" aria-label="FAAB spent by each team">${wk.faab_teams.map((t) => `<span role="listitem" title="${esc(t.name)}: $${t.used} spent, $${t.left} left"><span class="faab-name">${esc(t.name)}</span><span class="faab-bar"><span class="faab-fill" style="width:${Math.round((t.used / wk.faab) * 100)}%"></span></span><span class="faab-num num">${t.used}/${wk.faab}</span></span>`).join("")}</div><p class="context-note">Waiver claims draw from the league's shared $${wk.faab} pool; each team's remaining share is shown. A bid is the claim itself, not a separate fee.</p></div>`
    : "";
  $( "view-waivers").innerHTML =
    `${intro("The wire", "Waivers & transactions.", "Every completed waiver claim, add, drop and trade in the current window, plus the trade deadline and the league's FAAB pool. This page only reports what happened — make changes in Sleeper.")}` +
    `<div class="wire-cards">${deadlineCard}${faabCard}</div>` +
    `<div class="filters wire-filters"><div><label for="wireType">Move type</label><select id="wireType"><option value="all">All moves</option><option value="waiver">Waivers</option><option value="free_agent">Adds &amp; drops</option><option value="trade">Trades</option></select></div><div><label for="wirePos">Position</label><select id="wirePos"><option value="">All positions</option>${["QB","RB","WR","TE","K","DEF"].map((p) => `<option value="${p}">${p === "DEF" ? "D/ST" : p}</option>`).join("")}</select></div><div><label for="wireWeek">Week</label><select id="wireWeek"><option value="">Any week</option>${[d.current_week, d.current_week - 1].filter((w) => w >= 1).map((w) => `<option value="${w}">Week ${w}</option>`).join("")}</select></div><div class="owner-filter"><label for="wireTeam">Team</label><select id="wireTeam"><option value="">Every team</option>${d.standings.map((t) => `<option value="${t.rid}">${esc(t.name)}</option>`).join("")}</select></div></div>` +
    `<div class="wire-list" id="wireList">${wireItemsHtml(txs, { type: "all", pos: "", week: "", team: "" })}</div>` +
    `<p class="context-note">Only completed moves are listed; failed or cancelled claims are excluded. Bids are the FAAB amount a team spent to win the claim.</p>`;
  const wireApply = () => {
    $("wireList").innerHTML = wireItemsHtml(txs, {
      type: $("wireType").value,
      pos: $("wirePos").value,
      week: $("wireWeek").value,
      team: $("wireTeam").value,
    });
  };
  for (const id of ["wireType", "wirePos", "wireWeek", "wireTeam"])
    $(id).addEventListener("change", wireApply);
}
function wireItemsHtml(txs, f) {
  const rows = txs.filter((t) =>
    (f.type === "all" || t.type === f.type) &&
    (!f.pos || (t.adds || []).some((p) => p.pos === f.pos)) &&
    (!f.week || t.week === Number(f.week)) &&
    (!f.team || [...(t.adds || []), ...(t.drops || [])].some((p) => String(p.rid) === f.team)),
  );
  if (!rows.length) return '<div class="empty">No completed moves match these filters in the current window.</div>';
  return rows
    .map((t) => {
      const win = t.type === "waiver" && (t.adds || []).length > 0;
      return `<div class="wire-item ${win ? "won" : ""}"><span class="wire-week">W${t.week}</span><span class="wire-type ${t.type === "waiver" ? "waiver" : t.type === "trade" ? "trade" : "fa"}">${t.type === "waiver" ? "Waiver" : t.type === "trade" ? "Trade" : "Add/drop"}</span><div class="wire-copy">${t.lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>${t.bid != null ? `<span class="wire-bid num" title="${win ? "Won bid" : "Bid"}">$${t.bid}</span>` : ""}</div>`;
    })
    .join("");
}
function renderPlayers(d) {
  $("view-players").innerHTML =
    `${intro("The player room", "Players.", "Search rostered players and the available player pool. Availability is specific to this league; projections are Sleeper standard estimates.")}<div class="filters"><div class="search-field"><label for="playerSearch">Search players or NFL teams</label><input id="playerSearch" type="search" placeholder="Name or team…" autocomplete="off"></div><div><label for="positionFilter">Position</label><select id="positionFilter"><option value="">All positions</option>${["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `<option value="${p}">${p === "DEF" ? "D/ST" : p}</option>`).join("")}</select></div><div><label for="availabilityFilter">Availability</label><select id="availabilityFilter"><option value="">All players</option><option value="free">Available</option><option value="owned">Rostered</option></select></div><div class="owner-filter"><label for="ownerFilter">Fantasy team</label><select id="ownerFilter"><option value="">Every team</option>${d.standings.map((t) => `<option value="${t.rid}">${esc(t.name)}</option>`).join("")}</select></div><div><label for="playerSort">Sort by</label><select id="playerSort"><option value="proj">Week ${d.next_week.week} projection</option><option value="last_pts">Last-week points</option><option value="name">Player name</option></select></div></div><div class="results-meta"><span id="playerCount" aria-live="polite"></span><button id="resetFilters">Reset filters</button></div><div class="table-wrap"><table class="player-table"><thead><tr><th scope="col">Player</th><th scope="col" class="owner-col">Fantasy team</th><th scope="col" class="num">W${d.last_week?.week || "—"} pts</th><th scope="col" class="num">W${d.next_week.week} proj.</th></tr></thead><tbody id="playerRows"></tbody></table><div id="playerEmpty" class="empty" hidden>No matching players. Try a different name or reset the filters.</div></div><button id="morePlayers" class="show-more">Show more players</button><p class="context-note">Choose a sort above; missing scores stay at the bottom. A dash means no recorded value, not zero. Last-week points are available for players on last week's league rosters. Player metadata and injury designations are a snapshot from ${d.player_metadata_asof ? esc(date(d.player_metadata_asof)) + " ET" : "an unknown time"}; verify current status in Sleeper before setting a lineup.</p><section class="feature-row">${head("Trending on Sleeper", "Last 7 days")}<p class="context-note">Platform-wide add activity, not unique leagues or a recommendation. Availability below is checked against this league's rosters.</p><div class="players-preview">${d.trending
      .slice(0, 6)
      .map(
        (p) =>
          `<div class="performer">${photo(p)}<div class="performer-info"><h3>${esc(p.name)}</h3><div class="small">${short(p.count)} adds · ${p.rid != null ? "Rostered" : "Available here"}</div><div class="small">${esc(p.teamName || p.team)}</div></div></div>`,
      )
      .join(
        "",
      )}</div></section><section class="feature-row">${head("Transaction log", `Weeks ${Math.max(1, d.current_week - 1)}–${d.current_week}`)}${d.transactions.map((t) => `<div class="rail-transaction"><span class="eyebrow">${t.type === "trade" ? "Trade" : t.type === "free_agent" ? "Free agent" : "Waiver"}${t.bid != null ? ` · $${t.bid}` : ""} · ${esc(date(t.when))} ET</span>${t.lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`).join("") || '<p class="empty">No completed transactions in this window.</p>'}</section>`;
  filterPlayers();
}
function filterPlayers() {
  if (!$("playerSearch")) return;
  const q = $("playerSearch").value.trim().toLowerCase(),
    pos = $("positionFilter").value,
    avail = $("availabilityFilter").value,
    owner = $("ownerFilter").value;
  const list = DATA.players.filter(
    (p) =>
      (!q || `${p.name} ${p.team}`.toLowerCase().includes(q)) &&
      (!pos || p.pos === pos) &&
      (!avail || (avail === "free" ? p.rid == null : p.rid != null)) &&
      (!owner || String(p.rid) === owner),
  );
  const sort = $("playerSort").value;
  list.sort((a, b) => {
    if (sort !== "name") {
      const av = Number.isFinite(a[sort]) ? a[sort] : -Infinity;
      const bv = Number.isFinite(b[sort]) ? b[sort] : -Infinity;
      if (av !== bv) return av > bv ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  const shown = list.slice(0, playerLimit);
  $("playerCount").textContent =
    `${list.length} players${list.length > shown.length ? ` · showing ${shown.length}` : ""}`;
  $("playerRows").innerHTML = shown
    .map(
      (p) =>
        `<tr><td><div class="player-cell">${photo(p)}<div><div class="name">${esc(p.name)}${injury(p)}</div><div class="small">${esc(p.pos === "DEF" ? "D/ST" : p.pos)} · ${esc(p.team || "FA")}</div><div class="small mobile-owner ${p.rid == null ? "free" : ""}">${esc(p.teamName || "Available")}</div></div></div></td><td class="owner-col"><span class="small">${esc(p.teamName || "Available")}</span></td><td class="num">${f(p.last_pts)}</td><td class="num">${f(p.proj)}</td></tr>`,
    )
    .join("");
  $("playerEmpty").hidden = list.length > 0;
  $("morePlayers").hidden = list.length <= playerLimit;
}
function teamCard(t, d) {
  const pr = (d.power_rankings || []).find((x) => String(x.rid) === String(t.rid));
  const inj = (d.injuries || []).filter((p) => String(p.rid) === String(t.rid));
  return `<a class="team-card${String(t.rid) === followed ? " followed" : ""}" href="#team/${t.rid}"><div class="team-card-head">${avatar(t.avatar, t.name)}<div><strong>${esc(t.name)}</strong><div class="small">${esc(t.manager)}</div></div><span class="rank">${t.rank}</span></div><div class="team-card-stats"><span>${rec(t)}</span><span class="num">${f(t.fpts)} PF</span><span class="num">${pr ? `${f(pr.ppg)}/g` : ""}</span>${inj.length ? `<span class="injury-count">${inj.length} inj</span>` : ""}</div></a>`;
}
function renderTeams(d) {
  $("view-teams").innerHTML =
    `${intro("The twelve franchises", "Team pages.", "Records, form, injuries and history for every team in the league. Choose a team to open its page.")}<div class="team-grid">${d.standings.map((t) => teamCard(t, d)).join("")}</div>`;
}
function formStrip(form) {
  if (!form.length) return "";
  const max = Math.max(...form.map((w) => w.pts), 1);
  return `<section>${head("Season form", "Points per week, tap a week to open its box score")}<div class="form-strip" role="list" aria-label="Season form, one column per week">${form.map((w) => `<a role="listitem" class="form-cell ${w.result}" href="#game/${w.week}/${w.mid}" aria-label="Week ${w.week}: ${w.pts} points, ${w.result === "W" ? "win" : w.result === "L" ? "loss" : "tie"}"><span class="form-wl">${w.result}</span><div class="form-bar" style="height:${Math.max(12, Math.round((w.pts / max) * 100))}%"></div><span class="form-pts">${Math.round(w.pts)}</span></a>`).join("")}</div></section>`;
}
function seasonScorers(top, players) {
  const rows = (top || [])
    .map((x) => {
      const p = (players || []).find((q) => String(q.pid) === String(x.pid));
      return p ? { name: p.name, pos: p.pos === "DEF" ? "D/ST" : p.pos, team: p.team, img: p.img, pts: x.pts } : null;
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return `<section>${head("Season scorers", "Top 5 by recorded points")}${rows.map((p, i) => `<div class="score-row"><span class="pick">${i + 1}</span>${photo(p)}<div class="name">${esc(p.name)}<div class="small">${esc(p.pos)} · ${esc(p.team)}</div></div><span class="num">${f(p.pts)}</span></div>`).join("")}</section>`;
}
function draftSection(picks, completedWeek) {
  if (!picks.length) return "";
  return `<section>${head("Draft picks", "Where the team was built")}${picks.slice().sort((a, b) => a.pick_no - b.pick_no).map((p) => `<div class="draft-row"><span class="pick">#${p.pick_no}</span><div class="name">${esc(p.name)}<div class="small">${esc(p.pos)} · Round ${p.round}</div></div><span class="num">${p.pts != null ? f(p.pts) : "—"}</span></div>`).join("")}<p class="context-note">Points are from the most recently completed week on record, starter or not; missing scores stay blank.</p></section>`;
}
function wireSection(tx) {
  if (!tx.length) return "";
  return `<section>${head("On the wire", "Completed moves, latest first")}${tx.slice(0, 6).map((t) => `<div class="tx-item"><span class="tx-week">W${t.week}</span><span class="tx-type">${esc(t.type)}</span><div class="small">${esc((t.lines || []).join(" · "))}</div>${t.bid != null ? `<span class="num">$${t.bid}</span>` : ""}</div>`).join("")}</section>`;
}
function renderTeamPage(d, rid) {
  const ridS = String(rid);
  const t = d.standings.find((x) => String(x.rid) === ridS);
  if (!t) return false;
  const pr = (d.power_rankings || []).find((x) => String(x.rid) === ridS);
  const lw = (d.last_week?.games || []).find((g) => String(g.a.rid) === ridS || String(g.b.rid) === ridS);
  const lastOpp = lw ? (String(lw.a.rid) === ridS ? lw.b : lw.a) : null;
  const lastRes = lw ? (String(lw.a.rid) === ridS ? lw.a.pts - lw.b.pts : lw.b.pts - lw.a.pts) : null;
  const ng = (d.next_week?.games || []).find((g) => String(g.a.rid) === ridS || String(g.b.rid) === ridS);
  const nextOpp = ng ? (String(ng.a.rid) === ridS ? ng.b : ng.a) : null;
  const nextSide = ng ? (String(ng.a.rid) === ridS ? ng.a : ng.b) : null;
  const projStars = nextSide
    ? [...(nextSide.starters || [])].filter((p) => p.proj != null).sort((a, b) => b.proj - a.proj).slice(0, 3)
    : [];
  const roster = (d.players || []).filter((p) => String(p.rid) === ridS && p.injury);
  const rivalries = (d.rivalries || []).filter((r) => String(r.a_rid) === ridS || String(r.b_rid) === ridS).slice(0, 6);
  const awards = (d.awards || []).filter((a) => String(a.rid) === ridS);
  const form = d.team_form?.[ridS] || [];
  const seasonTop = d.season_top?.[ridS] || [];
  const draftPicks = (d.draft?.picks || []).filter((p) => String(p.rid) === ridS);
  const tx = (d.transactions || []).filter((x) => [...(x.adds || []), ...(x.drops || [])].some((p) => String(p.rid) === ridS));
  $("view-teams").innerHTML =
    `${intro("Team page", t.name, `${esc(t.manager)} · Rank ${t.rank} · ${rec(t)}${t.streak ? ` · ${esc(t.streak)}` : ""} · ${f(t.fpts)} points for`)}<div class="team-hero"><div class="team-stat"><span>Record</span><strong>${rec(t)}</strong></div><div class="team-stat"><span>Points for</span><strong class="num">${f(t.fpts)}</strong></div><div class="team-stat"><span>Points against</span><strong class="num">${f(t.pa)}</strong></div><div class="team-stat"><span>PPG</span><strong class="num">${pr && pr.ppg != null ? f(pr.ppg) : "—"}</strong></div><div class="team-stat"><span>All-play</span><strong>${esc(pr?.all_play || "—")}</strong></div></div>
    ${formStrip(form)}
    ${awards.length ? `<section>${head("Recent hardware")}<div class="award-grid">${awards.map((a) => `<div class="award static"><span class="award-label">${esc(a.label)}</span><strong>Week ${a.week}</strong><span class="award-detail">${esc(a.detail)}</span></div>`).join("")}</div></section>` : ""}
    ${lw && lastOpp ? `<section>${head(`Last result · Week ${d.last_week.week}`)}<div class="result-card"><div><strong>${esc(t.name)}</strong> vs. <a class="text-link" href="#team/${lastOpp.rid}">${esc(lastOpp.team)}</a></div><div class="result-score num">${f(String(lw.a.rid) === ridS ? lw.a.pts : lw.b.pts)} – ${f(String(lw.a.rid) === ridS ? lw.b.pts : lw.a.pts)}</div><span class="${lastRes > 0 ? "win" : lastRes < 0 ? "loss" : "tie"}">${lastRes > 0 ? "Win" : lastRes < 0 ? "Loss" : "Tie"} by ${f(Math.abs(lastRes))}</span></div><a class="text-link" href="#game/${d.last_week.week}/${lw.mid}">Open the full box score →</a></section>` : '<section>' + head("Last result") + '<p class="context-note">No completed game on record yet this season.</p></section>'}
    ${ng && nextOpp ? `<section>${head(`Next up · Week ${d.next_week.week}`)}<div class="result-card preview"><div><strong>${esc(t.name)}</strong> vs. <a class="text-link" href="#team/${nextOpp.rid}">${esc(nextOpp.team)}</a></div><div class="small">${d.next_week.status === "upcoming" ? "Projected lineups" : d.next_week.status === "complete" ? "Final" : "In progress"}${ng.a.proj_total != null && ng.b.proj_total != null ? ` · ${f(String(ng.a.rid) === ridS ? ng.a.proj_total : ng.b.proj_total)} vs ${f(String(ng.a.rid) === ridS ? ng.b.proj_total : ng.a.proj_total)} proj.` : ""}</div></div>${projStars.length ? `<div class="score-rows">${projStars.map((p) => `<div class="score-row">${photo(p)}<div class="name">${esc(p.name)}<div class="small">${esc(p.pos === "DEF" ? "D/ST" : p.pos)}${p.slot && p.slot !== p.pos ? ` · ${esc(p.slot)} slot` : ""}</div></div><span class="num">${f(p.proj)}</span></div>`).join("")}</div>` : ""}<a class="text-link" href="#game/${d.next_week.week}/${ng.mid}">Open the matchup →</a></section>` : ""}
    ${seasonScorers(seasonTop, d.players)}
    ${roster.length ? `<section>${head("Injury watch")}<div class="injury-grid">${roster.map((p) => `<span class="injury-row"><span class="injury-sev sev-${esc(String(p.injury_chip || p.injury).toLowerCase().replace(/[^a-z]/g, ""))}">${esc(p.injury_chip || String(p.injury).slice(0, 3).toUpperCase())}</span><div><strong>${esc(p.name)}</strong><div class="small">${esc(p.pos === "DEF" ? "D/ST" : p.pos)} · ${esc(p.team || "")}</div></div></span>`).join("")}</div><p class="context-note">From the metadata snapshot; verify in Sleeper before kickoff.</p></section>` : ""}
    ${rivalries.length ? `<section>${head("Rivalry ledger", "All-time, regular season")}<div class="rivalry-grid">${rivalries.map((r) => { const isA = String(r.a_rid) === ridS; return `<div class="rivalry ${r.this_week ? "active" : ""}"><span class="eyebrow">${r.this_week ? "Renewed this week" : `${r.gp} meetings`}</span><div class="rivalry-row"><span>${esc(r.a)}</span><strong class="num">${r.a_wins}</strong></div><div class="rivalry-row"><span>${esc(r.b)}</span><strong class="num">${r.b_wins}</strong></div><p class="small">${r.gp} completed meetings${r.ties ? ` · ${r.ties} tied` : ""}</p></div>`; }).join("")}</div></section>` : ""}
    ${draftSection(draftPicks, d.completed_week)}
    ${wireSection(tx)}`;
  return true;
}
function matchupStory(g, d, preview) {
  const story = preview ? null : gameStoryClient(g);
  if (!story) return "";
  const bits = [];
  if (story.winner) bits.push(`<strong>${esc(story.winner.name)}</strong> won by ${f(g.margin)}`);
  if (story.top) bits.push(`${esc(story.top.name)} was the game's top scorer with ${f(story.top.pts)}`);
  if (story.battle) bits.push(`Closest position battle: ${esc(story.battle.slot)} — ${esc(story.battle.a.name)} ${f(story.battle.a.pts)} vs ${esc(story.battle.b.name)} ${f(story.battle.b.pts)} (${f(story.battle.gap)} apart)`);
  if (story.benchSwing) bits.push(`${esc(story.benchSwing.side)} left ${f(story.benchSwing.gain)} points on the bench (${esc(story.benchSwing.bench.name)} sat for ${esc(story.benchSwing.starter.name)})`);
  return `<div class="game-story"><span class="eyebrow">The story of the game</span><ul>${bits.map((b) => `<li>${b}</li>`).join("")}</ul><p class="small">Bench comparisons count only position-legal swaps. This is hindsight from the box score, not a judgment of the pregame decision.</p></div>`;
}
function gameStoryClient(g) {
  // Client-side re-derivation (mirrors domain.gameStory) to keep payload small.
  const sides = [g.a, g.b];
  const winner = sides[0].pts > sides[1].pts ? sides[0] : sides[1].pts > sides[0].pts ? sides[1] : null;
  const all = sides.flatMap((s) => s.starters || []).filter((p) => Number.isFinite(p.pts));
  let battle = null;
  for (const sa of sides[0].starters || [])
    for (const sb of sides[1].starters || [])
      if (sa.slot === sb.slot && Number.isFinite(sa.pts) && Number.isFinite(sb.pts)) {
        const gap = Math.abs(sa.pts - sb.pts);
        if (!battle || gap < battle.gap) battle = { slot: sa.slot, a: sa, b: sb, gap };
      }
  const swapOf = (s) => {
    const ELIG = { FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"], REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["WR", "RB"] };
    let best = null;
    for (const b of s.bench || [])
      for (const st of s.starters || []) {
        const allowed = ELIG[st.slot] || [st.slot || st.pos];
        if (!((b.positions || [b.pos]) || [b.pos]).some((p) => allowed.includes(p))) continue;
        if (!Number.isFinite(b.pts) || !Number.isFinite(st.pts)) continue;
        const gain = Math.round((b.pts - st.pts) * 100) / 100;
        if (gain > 0 && (!best || gain > best.gain)) best = { bench: b, starter: st, gain };
      }
    return best;
  };
  const swings = sides.map((s) => (swapOf(s) ? { side: s.team, ...swapOf(s) } : null)).filter(Boolean).sort((x, y) => y.gain - x.gain)[0] || null;
  return {
    winner: winner ? { name: winner.team } : null,
    top: [...all].sort((x, y) => y.pts - x.pts)[0] || null,
    battle,
    benchSwing: swings,
  };
}
function renderHistory(d) {
  const draftGroup = (title, description, rows) =>
    `<section class="draft-group"><h3>${esc(title)}</h3><p class="small">${esc(description)}</p>${rows.map((p) => `<div class="draft-row"><span class="pick">#${p.pick_no}</span><div class="name">${esc(p.name)}<div class="small">${esc(p.pos)} · ${esc(p.owner)}</div></div><span class="num">${f(p.pts)}</span></div>`).join("")}</section>`;
  $("view-history").innerHTML =
    `${intro("The league archive", "There is history here.", "The playoff winners, the familiar opponents, and the draft decisions that built this year’s teams.")}<section>${head("The trophy cabinet", "Verified playoff winners")}<div class="champions">${d.champions.map((c) => `<article class="champion"><div class="year">${esc(c.season)}</div><h3>${esc(c.name)}</h3><p class="small">${esc(c.current_team)}</p><a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">Playoff bracket ↗</a></article>`).join("")}</div></section><section>${head("Head to head", "Regular season")}<p class="context-note">${esc(d.methodology.history)} Records follow managers when team names change. Win counts below belong to the named team on each row; ties are listed separately.</p><div class="rivalry-grid">${d.rivalries
      .slice(0, 12)
      .map(
        (r) =>
          `<article class="rivalry ${r.this_week ? "active" : ""}"><span class="eyebrow">${r.this_week ? `On the Week ${d.next_week.week} slate` : `${r.gp} meetings`}</span><div class="rivalry-row"><span>${esc(r.a)}</span><strong class="num">${r.a_wins}</strong></div><div class="rivalry-row"><span>${esc(r.b)}</span><strong class="num">${r.b_wins}</strong></div><p class="small">${r.gp} completed meetings${r.ties ? ` · ${r.ties} tied` : ""}${r.big ? ` · Largest margin: ${f(r.big.margin)} (${esc(r.big.season)})` : ""}</p></article>`,
      )
      .join(
        "",
      )}</div></section>${d.draft ? `<section class="feature-row">${head("The draft ledger", `${d.season} draft · Week ${d.last_week?.week || "—"} points`)}<p class="context-note">One week's return is not a final draft grade. These are actual league player points, whether started or benched; missing scores stay blank.</p><div class="draft-grid">${draftGroup("Late-round returns", "Round 8 and later, ordered by weekly output.", d.draft.steals)}${draftGroup("A quiet week", "Lowest recorded scores from Rounds 1–3. Not a bust verdict.", d.draft.busts)}${draftGroup("The first round", "In draft order, not ranked against other positions.", d.draft.first_round)}</div></section>` : ""}`;
}
function showArticle(id) {
  // Slate desk articles (the Sunday queue) live in DATA.slate, and last
  // week's final queue in DATA.slate_final (deep links survive rollover).
  const a = [
    ...(DATA.articles || []),
    ...(DATA.slate || []),
    ...(DATA.slate_final || []),
  ].find((x) => x.id === id);
  if (!a) {
    location.hash = "home";
    return;
  }
  const satireNote = a.satire
    ? `<p class="satire-note">This is league banter. The statistics are real and come from the league's public Sleeper data; the motives, personality, and quotes are invented for effect and are not attributed to anyone.</p>`
    : "";
  const hero = a.hero
    ? `<img class="article-hero" src="${esc(a.hero.src)}" alt="${esc(a.hero.alt || a.headline)}" width="280" height="280">`
    : "";
  $("articleContent").innerHTML =
    `${hero}<span class="eyebrow">${esc(a.tag)} · ${DATA.season}</span>${satireNote}<h1 id="articleTitle">${esc(a.headline)}</h1><p class="article-dek">${esc(a.dek)}</p><div class="article-byline">${esc(a.byline)} · Updated ${esc(date(DATA.asof))} ET</div><div class="article-body">${a.body
      .split("\n\n")
      .map((p) => `<p>${esc(p)}</p>`)
      .join("")}</div><div class="article-source">${a.satire
      ? `League banter. ${esc(a.source_label || "Stats from public league data; motives paraphrased, not sourced.")}`
      : "Based on public league box scores, lineups and transaction records. Automatically assembled analysis; no interviews or attributed quotes."}<br><a href="${esc(a.source_url)}" target="_blank" rel="noopener noreferrer">Check the league on Sleeper ↗</a></div><div class="article-actions"><button id="shareArticle">Share this story</button><a href="#matchups">Explore the matchups →</a><span id="shareStatus" class="share-status" role="status"></span></div>`;
  document.title = `${a.headline} | XClub Fantasy`;
  if (!$("articleDialog").open) {
    $("articleDialog").showModal();
    document.body.classList.add("modal-open");
  }
  $("articleDialog").scrollTop = 0;
}
function route(scroll = true) {
  if (!DATA) return;
  const hash = location.hash.slice(1) || "home";
  if (hash.startsWith("story/")) {
    showArticle(hash.slice(6));
    return;
  }
  if (hash.startsWith("team/")) {
    const rid = hash.slice(5);
    if (renderTeamPage(DATA, rid)) {
      currentView = "teams";
      for (const v of ["home", "weekend", "matchups", "standings", "teams", "players", "injuries", "waivers", "history"]) $(`view-${v}`).hidden = v !== "teams";
      document.querySelectorAll("[data-nav]").forEach((a) => {
        if (a.dataset.nav === "teams") a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
      document.title = `${DATA.standings.find((x) => String(x.rid) === String(rid))?.name || "Team"} | XClub Fantasy`;
      if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    location.hash = "teams";
    return;
  }
  if (hash.startsWith("game/")) {
    // Week-qualified form (#game/WEEK/MID) is authoritative — Sleeper reuses
    // matchup IDs across weeks, so a bare mid is ambiguous. Bare #game/MID
    // falls back to the completed game (recap) when it exists, else preview.
    const parts = hash.slice(5).split("/").filter(Boolean);
    const mid = Number(parts[parts.length - 1]);
    const week = parts.length > 1 ? Number(parts[0]) : null;
    const lastGames = DATA.last_week?.games || [];
    const nextGames = DATA.next_week?.games || [];
    const inLast = lastGames.find((g) => g.mid === mid);
    const inNext = nextGames.find((g) => g.mid === mid);
    // Which week's instance did the caller ask for? Explicit week wins; bare
    // mid prefers the completed game, then the upcoming one.
    const wantPreview =
      week != null ? week === (DATA.next_week?.week ?? -1) : !inLast && !!inNext && DATA.next_week?.status === "upcoming";
    const game = wantPreview ? inNext || inLast : inLast || inNext;
    if (!game) {
      location.hash = "matchups";
      return;
    }
    currentView = "matchups";
    matchMode = wantPreview ? "preview" : "recap";
    renderMatchups(DATA);
    for (const v of ["home", "weekend", "matchups", "standings", "teams", "players", "injuries", "waivers", "history"]) $(`view-${v}`).hidden = v !== "matchups";
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === "matchups") a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = "Matchup | XClub Fantasy";
    // A #game/WEEK/MID hash is always a request to see that specific
    // matchup — whether it arrived as a click or as a deep/shared link on
    // first load. Scroll to the card and open its details in both cases.
    window.scrollTo({ top: 0, behavior: "instant" });
    const card = document.querySelector(`.game[data-mid="${mid}"]`);
    if (card) {
      card.scrollIntoView({ block: "start" });
      const det = card.querySelector(".lineup-details");
      if (det && !det.open) det.open = true;
    }
    return;
  }
  if ($("articleDialog").open) {
    $("articleDialog").close();
    document.body.classList.remove("modal-open");
  }
  const valid = ["home", "weekend", "matchups", "standings", "teams", "players", "injuries", "waivers", "history"];
  currentView = valid.includes(hash) ? hash : "home";
  for (const view of valid) $(`view-${view}`).hidden = view !== currentView;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === currentView) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.title = `${{ home: "The league, covered", weekend: "Weekend hype", matchups: "Scores & matchups", standings: "Standings", teams: "Team pages", players: "Players", injuries: "Injury report", waivers: "Waivers & transactions", history: "League history" }[currentView]} | XClub Fantasy`;
  if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
}
function closeArticle() {
  history.replaceState(null, "", returnHash);
  route(false);
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
}
function render(d) {
  renderHome(d);
  renderWeekend(d);
  renderMatchups(d);
  renderStandings(d);
  renderTeams(d);
  renderPlayers(d);
  renderInjuries(d);
  renderWaivers(d);
  renderHistory(d);
  $("edition").textContent = `${d.season} / Week ${d.current_week}`;
  $("navSeason").textContent =
    `${d.league.size} TEAMS · ${d.league.scoring.toUpperCase()} · ${d.league.qb}`;
  $("freshness").textContent = `Updated ${date(d.asof)} ET`;
  $("buildInfo").textContent =
    `Build ${d.build} · League data refreshes automatically (about every 5 minutes during game days, hourly otherwise). Player metadata ${d.player_metadata_asof ? date(d.player_metadata_asof) + " ET" : "timestamp unavailable"}.`;
  $("methodology").innerHTML =
    Object.entries(d.methodology)
      .map(
        ([k, v]) =>
          `<p><strong>${esc(k.charAt(0).toUpperCase() + k.slice(1))}.</strong> ${esc(v)}</p>`,
      )
      .join("") +
    "<p>Only completed transactions are shown. Trending counts are add activity across Sleeper, not unique leagues. This site never changes your roster.</p>";
  const notices = [...(d.notices || [])];
  if (d.stale || Date.now() - d.asof > 90 * 60000)
    notices.push(
      "League data is older than expected. Check the timestamp before making decisions.",
    );
  if (
    !d.player_metadata_asof ||
    Date.now() - Date.parse(d.player_metadata_asof) > 24 * 3600000
  )
    notices.push(
      "Player metadata is over a day old. Verify NFL teams and injury status in Sleeper.",
    );
  $("notice").textContent = [...new Set(notices)].join(" ");
  $("notice").hidden = !notices.length;
  $("app").hidden = false;
  route(false);
}
function usableData(d) {
  const arrays = ["players", "standings", "power_rankings", "articles", "transactions", "champions", "rivalries", "trending"];
  const games = (w) => w && Number.isInteger(w.week) && Array.isArray(w.games) && w.games.every(
    (g) => g && [g.a, g.b].every((s) => s && Array.isArray(s.starters) && Array.isArray(s.bench)),
  );
  return !!(d && d.league && typeof d.league.scoring === "string" && d.methodology &&
    Number.isFinite(d.asof) && arrays.every((k) => Array.isArray(d[k])) &&
    games(d.next_week) && (d.last_week == null || (games(d.last_week) && Array.isArray(d.last_week.top_performers))) &&
    d.players.every((p) => p && typeof p.name === "string") &&
    d.articles.every((a) => a && typeof a.id === "string" && typeof a.body === "string") &&
    d.transactions.every((t) => t && Array.isArray(t.lines) && Number.isFinite(t.when)) &&
    (!d.draft || ["steals", "busts", "first_round"].every((k) => Array.isArray(d.draft[k]))) &&
    (!d.player_metadata_asof || Number.isFinite(Date.parse(d.player_metadata_asof))));
}
async function loadData(force = false) {
  if (loading) return;
  loading = true;
  $("refreshBtn").disabled = true;
  $("refreshBtn").setAttribute("aria-busy", "true");
  $("error").hidden = true;
  if (!DATA) $("loading").hidden = false;
  try {
    const r = await fetch(`/api/data${force ? "?refresh=1" : ""}`, {
      signal: AbortSignal.timeout(35000),
    });
    if (!r.ok)
      throw new Error(
        "The league feed is temporarily unavailable. Please try again shortly.",
      );
    const d = await r.json();
    if (!usableData(d))
      throw new Error(
        "The league feed is updating. Please try refreshing in a moment.",
      );
    const previousData = DATA;
    DATA = d;
    try {
      render(d);
    } catch (error) {
      DATA = previousData;
      if (previousData) render(previousData);
      throw error;
    }
    scheduleAutoRefresh();
  } catch (e) {
    if (DATA) {
      $("notice").textContent =
        "Refresh failed. Your previously loaded scores are still shown; check their timestamp.";
      $("notice").hidden = false;
    } else {
      $("error").hidden = false;
      $("errorMsg").textContent =
        e.name === "TimeoutError"
          ? "The request took too long. Please try again."
          : e.message;
    }
  } finally {
    $("loading").hidden = true;
    $("refreshBtn").disabled = false;
    $("refreshBtn").removeAttribute("aria-busy");
    loading = false;
  }
}
$("refreshBtn").addEventListener("click", () => loadData(true));
$("retryBtn").addEventListener("click", () => loadData(true));
// ---- Silent auto-refresh ----
// The payload carries refresh_window: ~2 min while a game window is live,
// 15 min otherwise. We re-fetch only when the page is visible, nothing is
// open/being typed, and the user is on a plain view (deep #game/#team/#story
// routes re-render with a scroll jump, so we wait for a navigation instead).
let autoTimer = null;
function scheduleAutoRefresh() {
  if (autoTimer) clearTimeout(autoTimer);
  const ms = Number.isFinite(DATA?.refresh_window?.poll_ms)
    ? DATA.refresh_window.poll_ms
    : 900000;
  autoTimer = setTimeout(tickAuto, ms);
}
function idleForAutoRefresh() {
  if (loading || !DATA) return false;
  if (document.hidden) return false;
  if ($("articleDialog").open) return false;
  const ae = document.activeElement;
  if (ae && ["INPUT", "SELECT", "TEXTAREA"].includes(ae.tagName)) return false;
  const h = location.hash.slice(1);
  return !(h.startsWith("game/") || h.startsWith("team/") || h.startsWith("story/"));
}
async function tickAuto() {
  if (!idleForAutoRefresh()) return scheduleAutoRefresh();
  const before = DATA.asof;
  let d;
  try {
    const r = await fetch(`/api/data?refresh=1`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("http " + r.status);
    d = await r.json();
  } catch {
    return scheduleAutoRefresh();
  }
  if (!usableData(d) || d.asof === before) return scheduleAutoRefresh();
  // Preserve the player directory's in-progress filters across the refresh so
  // a background update doesn't wipe the user's search/sort.
  let saved = null;
  if (currentView === "players") {
    saved = {
      q: $("playerSearch")?.value || "",
      pos: $("positionFilter")?.value || "",
      avail: $("availabilityFilter")?.value || "",
      owner: $("ownerFilter")?.value || "",
      sort: $("playerSort")?.value || "proj",
      limit: playerLimit,
    };
  }
  try {
    DATA = d;
    render(d);
  } catch {
    return scheduleAutoRefresh();
  }
  if (saved) {
    const set = (id, v) => {
      const el = $(id);
      if (el) el.value = v;
    };
    set("playerSearch", saved.q);
    set("positionFilter", saved.pos);
    set("availabilityFilter", saved.avail);
    set("ownerFilter", saved.owner);
    set("playerSort", saved.sort);
    playerLimit = saved.limit;
    filterPlayers();
  }
  scheduleAutoRefresh();
}
// Coming back to a backgrounded tab: re-check right away if the data is
// already stale enough to be worth a fetch.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && idleForAutoRefresh() && DATA && Date.now() - DATA.asof > 60000) tickAuto();
});
// ---- Theme toggle (Day / Night Edition) ----
(function initTheme() {
  const btn = $("themeBtn");
  const moon = btn.querySelector(".icon-moon");
  const sun = btn.querySelector(".icon-sun");
  const label = btn.querySelector(".theme-label");
  const meta = document.querySelector('meta[name="theme-color"]');
  function apply(t) {
    const dark = t === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // SVG <g> ignores the `hidden` attribute; use style.display directly.
    moon.style.display = dark ? "none" : "";
    sun.style.display = dark ? "" : "none";
    label.textContent = dark ? "Day" : "Dark";
    btn.setAttribute(
      "aria-label",
      dark ? "Switch to day theme" : "Switch to dark theme"
    );
    btn.setAttribute("aria-pressed", String(dark));
    if (meta) meta.setAttribute("content", dark ? "#12151a" : "#f5f3ee");
  }
  // Initial state was already set by the inline head script; sync UI to it.
  apply(document.documentElement.dataset.theme || "light");
  btn.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("xcf-theme", next);
    } catch (e) {}
    apply(next);
  });
})();
$("closeArticle").addEventListener("click", closeArticle);
$("articleDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeArticle();
});
window.addEventListener("hashchange", () => route());
document.addEventListener("click", async (e) => {
  const story = e.target.closest("[data-story]");
  if (story) {
    returnHash = location.hash.startsWith("#story/")
      ? "#home"
      : location.hash || "#home";
    previousFocus = story;
  }
  const mode = e.target.closest("[data-match-mode]");
  if (mode) {
    matchMode = mode.dataset.matchMode;
    renderMatchups(DATA);
    document
      .querySelector(`[data-match-mode="${matchMode}"]`)
      .focus({ preventScroll: true });
  }
  if (e.target.closest("#morePlayers")) {
    playerLimit += 40;
    filterPlayers();
  }
  if (e.target.closest("#resetFilters")) {
    for (const id of [
      "playerSearch",
      "positionFilter",
      "availabilityFilter",
      "ownerFilter",
    ])
      $(id).value = "";
    $("playerSort").value = "proj";
    playerLimit = 40;
    filterPlayers();
    $("playerSearch").focus();
  }
  if (e.target.closest("#shareArticle")) {
    const a = DATA.articles.find((a) => `#story/${a.id}` === location.hash);
    try {
      if (navigator.share)
        await navigator.share({ title: a?.headline, url: location.href });
      else {
        await navigator.clipboard.writeText(location.href);
        $("shareStatus").textContent = "Story link copied.";
      }
    } catch (e) {
      if (e.name !== "AbortError")
        $("shareStatus").textContent =
          "Copy the address from your browser to share this story.";
    }
  }
  if (e.target.closest("#shareWeekend")) {
    const url = `${location.origin}/weekend`;
    const w = DATA?.weekend || {};
    const title = `Week ${w.week || ""} Hype — XClub Fantasy`;
    try {
      if (navigator.share)
        await navigator.share({
          title,
          text: w.closeCount ? `${w.closeCount} matchups projected within 5 points.` : "Projected edges and stars to watch.",
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        const btn = e.target.closest("#shareWeekend");
        btn.textContent = "Link copied!";
        setTimeout(() => (btn.textContent = "Share this hype page"), 1600);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(url);
          e.target.closest("#shareWeekend").textContent = "Link copied!";
        } catch {}
      }
    }
  }
  const shareGame = e.target.closest("[data-share-game]");
  if (shareGame) {
    e.preventDefault();
    const url = `${location.origin}${location.pathname}#game/${shareGame.dataset.shareGame}`;
    try {
      if (navigator.share) await navigator.share({ title: "XClub matchup", url });
      else {
        await navigator.clipboard.writeText(url);
        shareGame.textContent = "Copied!";
        setTimeout(() => (shareGame.textContent = "Share"), 1600);
      }
    } catch (err) {
      if (err.name !== "AbortError") shareGame.textContent = "Share";
    }
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "playerSearch") {
    playerLimit = 40;
    filterPlayers();
  }
});
document.addEventListener("change", (e) => {
  if (
    ["positionFilter", "availabilityFilter", "ownerFilter", "playerSort"].includes(
      e.target.id,
    )
  ) {
    playerLimit = 40;
    filterPlayers();
  }
  if (["followTeam", "matchFollow"].includes(e.target.id)) {
    const control = e.target.id;
    followed = e.target.value;
    try {
      localStorage.setItem("xclub-team", followed);
    } catch {}
    renderHome(DATA);
    renderStandings(DATA);
    renderMatchups(DATA);
    $(control).focus({ preventScroll: true });
  }
});
loadData();
