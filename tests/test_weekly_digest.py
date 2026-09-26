#!/usr/bin/env python3
"""Unit tests for the XClub weekly digest builder.

Fixture-driven — no network. Mirrors the real /api/data shape so the
builder is exercised against the exact fields it reads.
"""
import json
import os
import sys
import unittest
from unittest.mock import patch

# Make scripts/ importable.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import weekly_digest as wd


def make_side(team, rid, pts, proj_total=90.0, starters=None):
    return {
        "rid": rid,
        "team": team,
        "pts": pts,
        "proj_total": proj_total,
        "starters": starters or [],
        "bench": [],
    }


def make_game(mid, a, b):
    return {
        "mid": mid,
        "a": a,
        "b": b,
        "margin": abs((a.get("pts") or 0) - (b.get("pts") or 0)),
        "total": (a.get("pts") or 0) + (b.get("pts") or 0),
    }


def fixture_finalized():
    """A payload where Week 3 is fully scored and the league rolled into Week 4."""
    games = [
        make_game(1,
                  make_side("Team A", 1, 120.5, 95.0,
                            [{"name": "Caleb Williams", "pos": "QB", "team": "CHI", "pts": 37.26, "proj": 16.68}]),
                  make_side("Team B", 2, 98.1)),
        make_game(2,
                  make_side("Team C", 3, 100.0),
                  make_side("Team D", 4, 99.0)),
    ]
    next_games = [
        make_game(1,
                  make_side("Team A", 1, 0.0, 97.0,
                            [{"name": "Jahmyr Gibbs", "pos": "RB", "team": "DET", "pts": 0, "proj": 22.27}]),
                  make_side("Team B", 2, 0.0, 86.0)),
        make_game(2,
                  make_side("Team C", 3, 0.0, 90.0),
                  make_side("Team D", 4, 0.0, 80.0)),
    ]
    return {
        "season": "2026",
        "current_week": 4,
        "completed_week": 3,
        "league": {"name": "Tom Byrne Memorial FF League"},
        "last_week": {
            "week": 3,
            "games": games,
            "top_performers": [
                {"name": "Caleb Williams", "pos": "QB", "team": "CHI", "pts": 37.26, "teamName": "Team A"},
                {"name": "Josh Allen", "pos": "QB", "team": "BUF", "pts": 35.66, "teamName": "Team B"},
                {"name": "Derrick Henry", "pos": "RB", "team": "BAL", "pts": 34.3, "teamName": "Team C"},
            ],
            "team_of_the_week": {"rid": 1, "name": "Team A", "pts": 120.5},
            "blowout": games[0],
            "nail_biter": games[1],
            "average": 104.4,
        },
        "next_week": {"week": 4, "status": "upcoming", "games": next_games},
        "standings": [
            {"rank": 1, "name": "Team A", "manager": "m1", "wins": 3, "losses": 0, "ties": 0, "fpts": 340.0, "streak": "3W"},
            {"rank": 2, "name": "Team B", "manager": "m2", "wins": 2, "losses": 1, "ties": 0, "fpts": 300.0, "streak": "1L"},
            {"rank": 3, "name": "Team C", "manager": "m3", "wins": 1, "losses": 2, "ties": 0, "fpts": 280.0, "streak": "1L"},
            {"rank": 4, "name": "Team D", "manager": "m4", "wins": 0, "losses": 3, "ties": 0, "fpts": 270.0, "streak": "3L"},
        ],
        "awards": [
            {"id": "team-of-the-week", "label": "Team of the week", "detail": "Highest score of Week 3", "value": 120.5, "week": 3},
            {"id": "player-of-the-week", "label": "Player of the week", "detail": "Caleb Williams · CHI 37.26 pts", "value": 37.26, "week": 3},
            {"id": "biggest-blowout", "label": "Biggest blowout", "detail": "120.50–98.10 · 22.40-point margin", "value": 22.4, "week": 3},
            {"id": "closest-finish", "label": "Closest finish", "detail": "Won by 1.00", "value": 1.0, "week": 3},
        ],
        "injuries": [
            {"name": "DJ Moore", "pos": "WR", "team": "BUF", "injury": "Out", "teamName": "Team B", "last_pts": 16, "proj": 8.72},
            {"name": "A.J. Brown", "pos": "WR", "team": "NE", "injury": "IR", "teamName": "Team B", "last_pts": 2.6, "proj": None},
            {"name": "Zach Charbonnet", "pos": "RB", "team": "SEA", "injury": "PUP", "teamName": "Team D", "last_pts": 0, "proj": None},
        ],
        "transactions": [
            {"id": "t1", "week": 3, "type": "free_agent", "when": 1,
             "adds": [{"name": "Chris Brooks", "pos": "RB", "team": "GB", "teamName": "Team A"}],
             "drops": [{"name": "Khalil Shakir", "pos": "WR", "team": "BUF", "teamName": "Team A"}]},
            {"id": "t2", "week": 3, "type": "trade", "when": 2, "adds": [], "drops": [], "lines": ["2026 Round 10 pick → Team A"]},
        ],
    }


class IsFinalizedTests(unittest.TestCase):
    def test_finalized_true(self):
        self.assertTrue(wd.is_finalized(fixture_finalized()))

    def test_finalized_even_when_next_in_progress(self):
        # A completed week is deliverable even while the next slate is live.
        # (A live next-week slate must not block the recap of the completed week.)
        d = fixture_finalized()
        d["next_week"]["status"] = "in_progress"
        self.assertTrue(wd.is_finalized(d))

    def test_not_finalized_when_completed_week_mismatch(self):
        d = fixture_finalized()
        d["completed_week"] = 2
        self.assertFalse(wd.is_finalized(d))

    def test_not_finalized_when_no_last_games(self):
        d = fixture_finalized()
        d["last_week"]["games"] = []
        self.assertFalse(wd.is_finalized(d))

    def test_finalized_at_season_end(self):
        d = fixture_finalized()
        d["last_week"]["week"] = 18
        d["completed_week"] = 18
        d["next_week"] = {"week": 18, "status": "complete", "games": []}
        self.assertTrue(wd.is_finalized(d))


class DigestBuildTests(unittest.TestCase):
    def setUp(self):
        self.d = fixture_finalized()

    def test_under_discord_limit(self):
        text = wd.build_digest(self.d)
        self.assertLessEqual(len(text), wd.MAX_LEN)

    def test_contains_scoreboard_and_standings(self):
        text = wd.build_digest(self.d)
        self.assertIn("Scoreboard — Week 3", text)
        self.assertIn("Team A", text)
        self.assertIn("120.50", text)
        self.assertIn("Standings", text)

    def test_contains_awards(self):
        text = wd.build_digest(self.d)
        self.assertIn("Player of the week", text)
        self.assertIn("Caleb Williams", text)

    def test_contains_top_performers(self):
        text = wd.build_digest(self.d)
        self.assertIn("Top performers", text)
        self.assertIn("37.26", text)

    def test_contains_preview(self):
        text = wd.build_digest(self.d)
        self.assertIn("Looking ahead — Week 4", text)
        # Closest projected: Team C 90.0 vs Team D 80.0 = edge 10.0 (tighter than A/B 11.0).
        self.assertIn("Team C", text)
        self.assertIn("10.00", text)

    def test_contains_injury_watch(self):
        text = wd.build_digest(self.d)
        self.assertIn("Injury watch", text)
        di = text.find("DJ Moore")
        ajb = text.find("A.J. Brown")
        self.assertNotEqual(di, -1)
        self.assertNotEqual(ajb, -1)
        self.assertLess(di, ajb)  # Out sorts before IR

    def test_contains_waiver_moves(self):
        text = wd.build_digest(self.d)
        self.assertIn("Waiver wire moves", text)
        self.assertIn("Chris Brooks", text)
        self.assertIn("Khalil Shakir", text)

    def test_factual_disclaimer_present(self):
        self.assertIn("All stats from public Sleeper league data.", wd.build_digest(self.d))


class DegradationLadderTests(unittest.TestCase):
    def _bloat(self, count=30):
        """Pad the fixture until the full digest exceeds the Discord limit."""
        d = fixture_finalized()
        base = {
            "id": "bench-crime", "label": "Bench crime",
            "detail": "Jalen Coker left 25.60 pts on the bench", "value": 25.6, "week": 3,
        }
        d["awards"] = [dict(base, id=f"bench-crime-{i}", label=f"Bench crime {i}",
                            detail=f"Player {i} left 25.60 pts on the bench") for i in range(count)]
        d["injuries"] = [
            {"name": f"Player {i}", "pos": "WR", "team": "BUF", "injury": "Out",
             "teamName": f"Team {i % 4 + 1}", "last_pts": 10 - i % 5, "proj": 8.0}
            for i in range(count)
        ]
        d["transactions"] = [
            {"id": f"t{i}", "week": 3, "type": "free_agent", "when": i,
             "adds": [{"name": f"Added {i}", "pos": "RB", "team": "GB", "teamName": f"Team {i % 4 + 1}"}],
             "drops": [{"name": f"Dropped {i}", "pos": "WR", "team": "BUF", "teamName": f"Team {i % 4 + 1}"}]}
            for i in range(count)
        ]
        return d

    def test_full_fits_when_small(self):
        text = wd.build_digest(fixture_finalized())
        self.assertIn("Projected stars", text)  # full preview intact

    def test_bloated_still_under_limit(self):
        text = wd.build_digest(self._bloat())
        self.assertLessEqual(len(text), wd.MAX_LEN)

    def test_bloated_preview_survives(self):
        text = wd.build_digest(self._bloat())
        self.assertIn("Looking ahead — Week 4", text)

    def test_bloated_keeps_core_sections(self):
        text = wd.build_digest(self._bloat())
        for needle in ("Scoreboard — Week 3", "Standings", "Awards",
                       "Full hub:", "All stats from public Sleeper league data."):
            self.assertIn(needle, text)


class PreviewEdgeCases(unittest.TestCase):
    def test_season_over_note(self):
        d = fixture_finalized()
        d["next_week"] = {"week": 3, "status": "complete", "games": []}
        lines = wd.section_preview(d)
        self.assertTrue(any("Season over" in l for l in lines))

    def test_no_preview_when_no_slate(self):
        d = fixture_finalized()
        d["next_week"] = {"week": 5, "status": "upcoming", "games": []}
        self.assertEqual(wd.section_preview(d), [])

    def test_short_preview_omits_stars(self):
        lines = wd.section_preview(fixture_finalized(), short=True)
        self.assertTrue(any("Looking ahead" in l for l in lines))
        self.assertFalse(any("Projected stars" in l for l in lines))


class DedupeTests(unittest.TestCase):
    def test_week_key_format(self):
        self.assertEqual(wd.digest_week_key(fixture_finalized()), "2026-w3")

    def test_week_key_none_when_no_last_week(self):
        self.assertIsNone(wd.digest_week_key({"season": "2026"}))


class MainFlowTests(unittest.TestCase):
    """Exercise main() with mocked network + state."""

    def setUp(self):
        self._state_file = os.path.join(ROOT, "digest_state_test.json")
        self._orig_state = wd.STATE_FILE
        self._orig_fetch = wd.fetch_payload
        self._orig_wait = wd.WAIT_MINUTES
        wd.STATE_FILE = self._state_file
        wd.WAIT_MINUTES = 0  # no real waiting in tests

    def tearDown(self):
        wd.STATE_FILE = self._orig_state
        wd.fetch_payload = self._orig_fetch
        wd.WAIT_MINUTES = self._orig_wait
        try:
            os.remove(self._state_file)
        except OSError:
            pass

    def _patch_fetch(self, data):
        wd.fetch_payload = lambda *a, **k: data

    def _run_main(self, args):
        sys.argv = ["weekly_digest.py"] + args
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = wd.main()
        return code, buf.getvalue()

    def test_auto_prints_once_and_records(self):
        self._patch_fetch(fixture_finalized())
        code, out = self._run_main([])
        self.assertEqual(code, 0)
        self.assertIn("Week 3 Recap", out)
        with open(self._state_file) as f:
            state = json.load(f)
        self.assertIn(3, state["delivered"]["2026"])
        # Second run is silent (dedupe).
        code2, out2 = self._run_main([])
        self.assertEqual(code2, 0)
        self.assertEqual(out2.strip(), "")

    def test_failed_digest_output_is_not_marked_delivered(self):
        self._patch_fetch(fixture_finalized())
        sys.argv = ["weekly_digest.py"]
        with patch("builtins.print", side_effect=[OSError("output not delivered"), None]):
            code = wd.main()
        self.assertEqual(code, 1)
        if os.path.exists(self._state_file):
            with open(self._state_file, encoding="utf-8") as f:
                state = json.load(f)
            self.assertNotIn(3, state.get("delivered", {}).get("2026", []))

    def test_auto_silent_when_not_finalized(self):
        # Truly-not-finalized: the completed_week counter hasn't caught up to
        # the recap week, so the slate isn't fully scored yet.
        d = fixture_finalized()
        d["completed_week"] = 2
        self._patch_fetch(d)
        code, out = self._run_main([])
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "")
        self.assertFalse(os.path.exists(self._state_file))

    def test_auto_prints_when_completed_and_next_live(self):
        # The real-world case that used to wedge: completed week with a live
        # next-week slate. Must deliver, not wait silently.
        d = fixture_finalized()
        d["next_week"]["status"] = "in_progress"
        self._patch_fetch(d)
        code, out = self._run_main([])
        self.assertEqual(code, 0)
        self.assertIn("Week 3 Recap", out)

    def test_dry_run_prints_immediately_without_state(self):
        d = fixture_finalized()
        d["next_week"]["status"] = "in_progress"  # would fail the auto gate
        self._patch_fetch(d)
        code, out = self._run_main(["--dry-run"])
        self.assertEqual(code, 0)
        self.assertIn("Week 3 Recap", out)
        self.assertFalse(os.path.exists(self._state_file))

    def test_error_is_loud(self):
        def boom(*a, **k):
            raise RuntimeError("api down")
        wd.fetch_payload = boom
        code, out = self._run_main([])
        self.assertEqual(code, 1)
        self.assertIn("XClub weekly digest failed", out)


class SectionHelpersTests(unittest.TestCase):
    def test_winner_order(self):
        g = make_game(1, make_side("Low", 1, 90), make_side("High", 2, 100))
        w, l = wd._winner(g)
        self.assertEqual(w["team"], "High")
        self.assertEqual(l["team"], "Low")

    def test_team_name_fallback(self):
        self.assertEqual(wd._team_name(None), "???")
        self.assertEqual(wd._team_name({"team": "X"}), "X")
        self.assertEqual(wd._team_name({"name": "Y"}), "Y")


if __name__ == "__main__":
    unittest.main()
