#!/usr/bin/env python3
"""XClub Weekly League Digest — deterministic, fully factual.

Builds a Discord-ready recap+preview from the public payload at
https://xclubfantasy.robsplex.com/api/data . No Sleeper credentials are
used or needed; every number comes straight from the league data.

Usage:
  python weekly_digest.py             # auto mode: wait for final scores, dedupe, print once
  python weekly_digest.py --dry-run   # build + print immediately from current data (no state)
  XCLUB_SITE=http://host python weekly_digest.py

Auto mode prints the digest only when it is newly deliverable; otherwise it
is silent (empty stdout, exit 0). Dry-run never waits or writes state.
Errors exit 1 with a one-line diagnostic on stdout.
"""
import json
import os
import sys
import time
import urllib.request

SITE = os.environ.get("XCLUB_SITE", "https://xclubfantasy.robsplex.com")
API = SITE + "/api/data"
STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "digest_state.json")
MAX_LEN = 2000  # Discord message limit
WAIT_MINUTES = 50  # finalization grace: re-check every 5 min, capped under the 60-min cron script timeout

AWARD_EMOJI = {
    "team-of-the-week": "🏆",
    "player-of-the-week": "⭐",
    "biggest-blowout": "💥",
    "closest-finish": "🎯",
    "bench-crime": "🪑",
    "unluckiest-loss": "🍀",
    "biggest-upset": "🚀",
}


def num2(x):
    try:
        return f"{float(x):.2f}"
    except (TypeError, ValueError):
        return "?"


def fetch_payload(timeout=60, attempts=3):
    last_err = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(API, headers={"User-Agent": "Mozilla/5.0 (XClub weekly digest)"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            time.sleep(15 * (i + 1))
    raise last_err


def is_finalized(data):
    """True when the recap week is fully scored and the league has rolled on
    (or the regular season is over)."""
    lw = data.get("last_week") or {}
    nw = data.get("next_week") or {}
    week = lw.get("week") or 0
    if week < 1 or not lw.get("games"):
        return False
    if data.get("completed_week") != week:
        return False
    # Season over: no next week to check.
    if week >= 18:
        return True
    # The league has rolled past the recap week. We do NOT gate on
    # next_week.status — a live next-week slate must not block delivering
    # the recap of the already-completed week.
    if (nw.get("week") or 0) <= week:
        return False
    return True


def digest_week_key(data):
    lw = data.get("last_week") or {}
    week = lw.get("week")
    if week is None:
        return None
    return f"{data.get('season', '?')}-w{week}"


def _winner(game):
    a, b = game.get("a") or {}, game.get("b") or {}
    if (a.get("pts") or 0) >= (b.get("pts") or 0):
        return a, b
    return b, a


def _team_name(side):
    return (side or {}).get("team") or (side or {}).get("name") or "???"


def section_scoreboard(data):
    lw = data.get("last_week") or {}
    lines = [f"📊 **Scoreboard — Week {lw.get('week')}**"]
    for g in lw.get("games") or []:
        w, l = _winner(g)
        lines.append(f"• **{_team_name(w)}** {num2(w.get('pts'))} @ {_team_name(l)} {num2(l.get('pts'))}")
    return lines


def section_standings(data, count=5):
    lines = ["**Standings**"]
    for s in (data.get("standings") or [])[:count]:
        rec = f"{s.get('wins', 0)}-{s.get('losses', 0)}{('-' + str(s.get('ties', 0))) if s.get('ties') else ''}"
        lines.append(f"{s.get('rank')}. {s.get('name')} {rec} · {num2(s.get('fpts'))} pts")
    lines.append(f"Full board: {SITE}/")
    return lines


def section_awards(data, max_count=6):
    awards = data.get("awards") or []
    if not awards:
        return []
    lines = ["**Awards**"]
    for a in awards[:max_count]:
        emoji = AWARD_EMOJI.get(a.get("id"), "▪️")
        detail = a.get("detail") or ""
        label = (a.get("label") or "").strip()
        lines.append(f"{emoji} {label}: {detail}" if detail else f"{emoji} {label}")
    return lines


def section_top_performers(data, count=3):
    tops = (data.get("last_week") or {}).get("top_performers") or []
    if not tops:
        return []
    lines = [f"🔥 **Top performers — Week {data['last_week'].get('week')}**"]
    for p in tops[:count]:
        team = p.get("teamName") or ""
        lines.append(f"• {p.get('name')} ({p.get('pos')} {p.get('team') or ''}) {num2(p.get('pts'))} pts — {team}")
    return lines


def section_preview(data, short=False):
    """Next-week preview computed purely from next_week.games projections."""
    nw = data.get("next_week") or {}
    week = nw.get("week")
    games = nw.get("games") or []
    if not week or week <= (data.get("last_week") or {}).get("week", 0) or not games:
        if week and week <= (data.get("last_week") or {}).get("week", 0):
            return [f"🏁 **Season over** — regular season complete. Check the hub for the playoff picture."]
        return []
    lines = [f"🔭 **Looking ahead — Week {week}**"]
    proj_games = []
    stars = []
    for g in games:
        pa, pb = (g.get("a") or {}).get("proj_total"), (g.get("b") or {}).get("proj_total")
        if pa is not None and pb is not None:
            proj_games.append((abs(pa - pb), g, pa, pb))
        for side in (g.get("a"), g.get("b")):
            for p in (side or {}).get("starters") or []:
                if p.get("proj") is not None:
                    stars.append((p["proj"], p))
    if proj_games:
        proj_games.sort(key=lambda t: (t[0], t[1].get("mid", 0)))
        edge, g, pa, pb = proj_games[0]
        a, b = g.get("a"), g.get("b")
        hi, lo = (a, b) if pa >= pb else (b, a)
        lines.append(f"• Closest on paper: {_team_name(hi)} vs {_team_name(lo)} (projected edge {num2(edge)})")
    if not short and stars:
        stars.sort(key=lambda t: -t[0])
        top3 = ", ".join(f"{p['name']} ({p['pos']} {p.get('team') or ''}) {num2(proj)}" for proj, p in stars[:3])
        lines.append(f"• Projected stars: {top3}")
    return lines


def section_injuries(data, count=4):
    inj = data.get("injuries") or []
    if not inj:
        return []
    sev_rank = {"Out": 0, "IR": 1, "Questionable": 2, "DNP": 3, "PUP": 4}

    def key(i):
        return (sev_rank.get((i.get("injury") or "").strip(), 5), -(i.get("last_pts") or 0))

    lines = ["🚑 **Injury watch (rostered)**"]
    for i in sorted(inj, key=key)[:count]:
        team = i.get("teamName") or ""
        lines.append(f"• {i.get('name')} — {i.get('injury')} ({team})")
    lines.append(f"Full list: {SITE}/#injuries")
    return lines


def section_moves(data, count=4):
    week = (data.get("last_week") or {}).get("week")
    txs = [t for t in (data.get("transactions") or []) if t.get("week") == week and t.get("type") == "free_agent"]
    if not txs:
        return []
    lines = ["📨 **Waiver wire moves**"]
    for t in txs[:count]:
        team = (t.get("adds") or [{}])[0].get("teamName") or (t.get("drops") or [{}])[0].get("teamName") or "???"
        added = (t.get("adds") or [{}])[0]
        dropped = (t.get("drops") or [{}])[0]
        line = f"• {team} added {added.get('name')} ({added.get('pos')} {added.get('team') or ''})"
        if dropped.get("name"):
            line += f", dropped {dropped.get('name')}"
        lines.append(line)
    return lines


def _build(data, standings, awards, top, injuries, moves, preview):
    """Assemble the digest at a given detail level. preview: full|short|none."""
    lw = data.get("last_week") or {}
    season = data.get("season", "")
    header = f"🏈 **XClub Weekly Digest — Week {lw.get('week')} Recap**"
    if season:
        header += f" · Season {season}"
    parts = [header, ""]
    parts += section_scoreboard(data) + [""]
    parts += section_standings(data, standings) + [""]
    parts += section_awards(data, awards) + [""]
    parts += section_top_performers(data, top) + [""]
    if preview != "none":
        prev = section_preview(data, short=(preview == "short"))
        if prev:
            parts += prev + [""]
    if injuries:
        parts += section_injuries(data, injuries) + [""]
    if moves:
        parts += section_moves(data, moves) + [""]
    parts.append(f"Full hub: {SITE}/")
    parts.append("All stats from public Sleeper league data.")
    return "\n".join(parts)


def build_digest(data):
    """Build the full digest, degrading gracefully to fit the Discord limit.
    The preview is always preserved in some form; injuries/moves trim first."""
    for opts in (
        (5, 6, 3, 4, 4, "full"),
        (4, 5, 2, 3, 3, "short"),
        (4, 4, 2, 2, 2, "short"),
        (4, 4, 2, 0, 0, "short"),
        (4, 3, 1, 0, 0, "none"),
    ):
        text = _build(data, *opts)
        if len(text) <= MAX_LEN:
            return text
    text = _build(data, 4, 3, 1, 0, 0, "none")
    return text[: MAX_LEN - 2] + "…"


def load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except OSError as e:
        print(f"warning: could not persist digest state: {e}", file=sys.stderr)


def main():
    """Auto mode (cron): polls until the latest week is fully scored (up to
    WAIT_MINUTES), then prints the digest once per week. Silent (empty
    stdout, exit 0) when not finalized yet or already delivered.
    Dry-run mode (--dry-run): builds and prints immediately from current
    data without waiting, state changes, or dedupe — for manual preview."""
    dry = "--dry-run" in sys.argv
    try:
        data = fetch_payload()
        if not dry:
            deadline = time.time() + WAIT_MINUTES * 60
            while not is_finalized(data):
                if time.time() >= deadline:
                    return 0  # scores still pending; next scheduled run can catch it
                time.sleep(300)
                data = fetch_payload()
        week = int((data.get("last_week") or {}).get("week") or 0)
        if not dry:
            state = load_state()
            if week in state.get("delivered", {}).get(data.get("season", "?"), []):
                return 0  # already delivered this week
            text = build_digest(data)
            state.setdefault("delivered", {}).setdefault(data.get("season", "?"), []).append(week)
            save_state(state)
        else:
            text = build_digest(data)
        print(text)
        return 0
    except Exception as e:
        print(f"XClub weekly digest failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
