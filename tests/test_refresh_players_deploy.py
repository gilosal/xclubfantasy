import importlib.util
import pathlib
import unittest

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


if __name__ == "__main__":
    unittest.main()
