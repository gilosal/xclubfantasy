#!/usr/bin/env python3
"""Native-Windows Sleeper metadata refresh and XClub production verifier.

This is the Hermes cron entrypoint's implementation. It deliberately avoids a
shell so Hermes' Windows cron runner does not route the job through WSL bash.
Success is silent; every failure raises a non-zero exit code.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUNDLE_PATH = PROJECT_ROOT / "public" / "data" / "players.json"
LIVE_URL = "https://xclubfantasy.robsplex.com/api/data?refresh=1"


def command_candidates(name: str) -> list[str]:
    """Return native command names in preference order for this host."""
    return [f"{name}.cmd", name] if os.name == "nt" else [name]


def find_command(name: str) -> str:
    for candidate in command_candidates(name):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError(f"required command is not on PATH: {name}")


def last_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1][-300:] if lines else "no diagnostic output"


def run_command(command: list[str], label: str, log_path: Path, timeout: int) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"{label} could not complete: {exc}") from exc

    combined = ((result.stdout or "") + (result.stderr or "")).strip()
    log_path.write_text(combined + ("\n" if combined else ""), encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed (exit {result.returncode}): {last_line(combined)}")
    return combined


def comparable_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    """Exclude the generation clock when deciding whether metadata changed."""
    return {
        "season": bundle.get("season"),
        "week": bundle.get("week"),
        "players": bundle.get("players"),
    }


def payload_is_fresh(bundle: dict[str, Any], live: dict[str, Any]) -> bool:
    return (
        bool(live.get("players"))
        and live.get("player_metadata_asof") == bundle.get("generated_at")
    )


def fetch_live_payload() -> dict[str, Any]:
    query = urllib.parse.urlencode({"refresh": "1", "xcf_verify": str(time.time_ns())})
    request = urllib.request.Request(
        f"https://xclubfantasy.robsplex.com/api/data?{query}",
        headers={"User-Agent": "XClubFantasy/metadata-refresh"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise RuntimeError(f"production /api/data returned HTTP {response.status}")
        return json.load(response)


def restore_file(previous: bytes | None) -> None:
    if previous is None:
        return
    temporary = BUNDLE_PATH.with_suffix(".json.restore.tmp")
    temporary.write_bytes(previous)
    os.replace(temporary, BUNDLE_PATH)


def main() -> int:
    temp_dir = Path(tempfile.gettempdir())
    build_log = temp_dir / "xcf_player_build.log"
    verify_log = temp_dir / "xcf_player_verify.log"
    deploy_log = temp_dir / "xcf_player_deploy.log"

    previous_bytes = BUNDLE_PATH.read_bytes() if BUNDLE_PATH.exists() else None
    previous_bundle = json.loads(previous_bytes) if previous_bytes else None

    python_exe = sys.executable
    run_command(
        [python_exe, str(PROJECT_ROOT / "scripts" / "build_players.py")],
        "player bundle build",
        build_log,
        300,
    )
    current_bundle = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))

    if previous_bundle is not None and comparable_bundle(previous_bundle) == comparable_bundle(current_bundle):
        # build_players.py may have refreshed only generated_at; preserve the known
        # good bytes so a no-change tick does not trigger a needless deployment.
        restore_file(previous_bytes)
        return 0

    run_command(
        [python_exe, str(PROJECT_ROOT / "scripts" / "verify_players.py")],
        "Sleeper team/injury verification",
        verify_log,
        300,
    )

    npx = find_command("npx")
    deploy_output = run_command(
        [npx, "wrangler", "deploy", "--config", "wrangler.jsonc"],
        "Wrangler deploy",
        deploy_log,
        600,
    )
    if not any(marker in deploy_output.lower() for marker in ("success", "current version", "uploaded xclubfantasy")):
        raise RuntimeError("Wrangler deploy did not report a successful version")

    for _attempt in range(6):
        try:
            live = fetch_live_payload()
            if payload_is_fresh(current_bundle, live):
                return 0
        except Exception as exc:
            verify_log.write_text(str(exc), encoding="utf-8")
        time.sleep(5)

    raise RuntimeError("production payload did not expose the fresh metadata timestamp after propagation retries")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"XClub player metadata refresh failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
