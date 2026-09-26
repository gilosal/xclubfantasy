import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "refresh_players_deploy.py"


class RefreshPlayersDeployTests(unittest.TestCase):
    def load_script(self):
        self.assertTrue(SCRIPT.is_file(), "Native Python refresh entrypoint is required")
        spec = importlib.util.spec_from_file_location("refresh_players_deploy", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_windows_wrappers_are_preferred_for_node_commands(self):
        module = self.load_script()
        self.assertEqual(module.command_candidates("npx"), ["npx.cmd", "npx"])
        self.assertEqual(module.command_candidates("npm"), ["npm.cmd", "npm"])

    def test_production_payload_validator_requires_fresh_metadata_timestamp(self):
        module = self.load_script()
        self.assertTrue(
            module.payload_is_fresh(
                {"generated_at": "2026-09-17T20:00:00+00:00"},
                {"player_metadata_asof": "2026-09-17T20:00:00+00:00", "players": [1]},
            )
        )
        self.assertFalse(
            module.payload_is_fresh(
                {"generated_at": "2026-09-17T20:00:00+00:00"},
                {"player_metadata_asof": "2026-09-17T19:00:00+00:00", "players": [1]},
            )
        )


    def test_release_snapshot_excludes_uncommitted_application_changes(self):
        module = self.load_script()
        with tempfile.TemporaryDirectory() as tmp:
            repo = pathlib.Path(tmp) / "repo"
            release = pathlib.Path(tmp) / "release"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(repo), "config", "user.name", "XClub test"], check=True)
            (repo / "src").mkdir()
            (repo / "src" / "index.js").write_text("approved", encoding="utf-8")
            subprocess.run(["git", "-C", str(repo), "add", "src/index.js"], check=True)
            subprocess.run(["git", "-C", str(repo), "commit", "-qm", "approved"], check=True)
            (repo / "src" / "index.js").write_text("unreviewed", encoding="utf-8")

            with patch.object(module, "PROJECT_ROOT", repo):
                revision = module.snapshot_release(repo, release)

            self.assertTrue(revision)
            self.assertEqual((release / "src" / "index.js").read_text(encoding="utf-8"), "approved")
            self.assertEqual((repo / "src" / "index.js").read_text(encoding="utf-8"), "unreviewed")

    def test_failed_deploy_is_retried_even_when_the_new_bundle_is_unchanged(self):
        module = self.load_script()
        old = {"season": "2026", "week": 3, "players": [{"pid": "1", "injury": None}], "generated_at": "old"}
        candidate = {"season": "2026", "week": 3, "players": [{"pid": "1", "injury": "Q"}], "generated_at": "fresh"}
        deploys = []
        deploy_commands = []
        syntax_checks = []
        source = pathlib.Path(tempfile.mkdtemp(prefix="xcf-refresh-test-"))
        try:
            (source / "node_modules" / "wrangler" / "bin").mkdir(parents=True)
            (source / "node_modules" / "wrangler" / "bin" / "wrangler.js").write_text("// test", encoding="utf-8")
            bundle_path = source / "public" / "data" / "players.json"
            bundle_path.parent.mkdir(parents=True)
            bundle_path.write_text(json.dumps(old), encoding="utf-8")

            def fake_snapshot(_root, target):
                target.mkdir(parents=True, exist_ok=True)
                (target / "scripts").mkdir()
                (target / "scripts" / "build_players.py").write_text("# pinned builder", encoding="utf-8")
                (target / "wrangler.jsonc").write_text("{}", encoding="utf-8")
                (target / "tests").mkdir()
                (target / "tests" / "snapshot.test.js").write_text("// test", encoding="utf-8")
                (target / "tests" / "test_snapshot.py").write_text("# test", encoding="utf-8")
                (target / "src").mkdir()
                (target / "src" / "index.js").write_text("// source", encoding="utf-8")
                (target / "src" / "domain.js").write_text("// source", encoding="utf-8")
                (target / "public").mkdir(exist_ok=True)
                (target / "public" / "app.js").write_text("// source", encoding="utf-8")
                (target / "public" / "view-models.js").write_text("// source", encoding="utf-8")
                for name in ("http-headers.js", "refresh-policy.js"):
                    (target / "src" / name).write_text("// source", encoding="utf-8")
                for name in ("theme-bootstrap.js",):
                    (target / "public" / name).write_text("// source", encoding="utf-8")
                (target / "public" / "data").mkdir(parents=True, exist_ok=True)
                (target / "public" / "data" / "players.json").write_text(json.dumps(old), encoding="utf-8")

            def fake_run(command, label, log_path, timeout, cwd=None):
                if label.startswith("JavaScript syntax check"):
                    syntax_checks.append(pathlib.Path(command[-1]).name)
                if label == "Wrangler dry run":
                    deploy_commands.append((label, command))
                if label in {"JavaScript release tests", "Python release tests", "Wrangler dry run"} or label.startswith("JavaScript syntax check"):
                    return "passed"
                if label == "player bundle build":
                    release = pathlib.Path(command[1]).resolve().parents[1]
                    (release / "public" / "data" / "players.json").write_text(json.dumps(candidate), encoding="utf-8")
                    return "built"
                if label == "Wrangler deploy":
                    deploy_commands.append((label, command))
                    deploys.append(pathlib.Path(cwd))
                    if len(deploys) == 1:
                        raise RuntimeError("simulated deploy failure")
                    return "Uploaded XClubFantasy"
                raise AssertionError(f"unexpected command label: {label}")

            with patch.object(module, "PROJECT_ROOT", source), \
                 patch.object(module, "BUNDLE_PATH", bundle_path), \
                 patch.object(module, "snapshot_release", side_effect=fake_snapshot), \
                 patch.object(module, "run_command", side_effect=fake_run), \
                 patch.object(module, "find_command", return_value="node"), \
                 patch.object(module, "fetch_live_payload", return_value={"players": [1], "player_metadata_asof": "fresh"}), \
                 patch.object(module.time, "sleep", return_value=None), \
                 patch("tempfile.gettempdir", return_value=str(source)):
                with self.assertRaisesRegex(RuntimeError, "simulated deploy failure"):
                    module.main()
                self.assertEqual(json.loads(bundle_path.read_text(encoding="utf-8")), old)
                self.assertEqual(module.main(), 0)

            self.assertEqual(len(deploys), 2, "the unchanged candidate must be deployed again after failure")
            self.assertTrue(all("--strict" in command for _, command in deploy_commands), "dry-run and publish must enable Wrangler strict mode")
            self.assertEqual({label for label, _ in deploy_commands}, {"Wrangler dry run", "Wrangler deploy"})
            self.assertEqual(set(syntax_checks), {"index.js", "domain.js", "http-headers.js", "refresh-policy.js", "app.js", "view-models.js", "theme-bootstrap.js"})
            self.assertTrue(all(path != source for path in deploys), "deployment must run from the isolated snapshot")
            self.assertEqual(json.loads(bundle_path.read_text(encoding="utf-8")), candidate)
        finally:
            import shutil
            shutil.rmtree(source, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
