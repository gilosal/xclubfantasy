#!/usr/bin/env python3
"""Native-Windows Sleeper metadata refresh and XClub production verifier.

This is the Hermes cron entrypoint's implementation. It deliberately avoids a
shell so Hermes' Windows cron runner does not route the job through WSL bash.
Success is silent; every failure raises a non-zero exit code.
"""
from __future__ import annotations

import json
import io
import os
import shutil
import subprocess
import sys
import tarfile
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


def run_command(
    command: list[str], label: str, log_path: Path, timeout: int, *, cwd: Path | None = None
) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=str(cwd or PROJECT_ROOT),
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


def snapshot_release(project_root: Path, destination: Path) -> str:
    """Materialize exactly the committed source tree without worktree edits."""
    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", str(project_root), *args],
            capture_output=True,
            check=False,
        )

    head = git("rev-parse", "--verify", "HEAD^{commit}")
    if head.returncode:
        raise RuntimeError(f"cannot identify approved release revision: {last_line(head.stderr.decode(errors='replace'))}")
    revision = head.stdout.decode("ascii", errors="strict").strip()
    archive = git("archive", "--format=tar", revision)
    if archive.returncode:
        raise RuntimeError(f"cannot archive approved release revision: {last_line(archive.stderr.decode(errors='replace'))}")

    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise RuntimeError("release snapshot destination must be empty")
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode="r:") as bundle:
        for member in bundle:
            name = member.name
            if "\\" in name or ":" in name.split("/", 1)[0]:
                raise RuntimeError(f"unsafe path in approved release archive: {name!r}")
            parts = Path(*name.split("/"))
            if parts.is_absolute() or any(part in ("", ".", "..") for part in name.split("/")):
                raise RuntimeError(f"unsafe path in approved release archive: {name!r}")
            target = destination / parts
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                source = bundle.extractfile(member)
                if source is None:
                    raise RuntimeError(f"cannot read approved release file: {name!r}")
                target.parent.mkdir(parents=True, exist_ok=True)
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
            else:
                raise RuntimeError(f"unsupported file type in approved release archive: {name!r}")
    return revision


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def run_release_gates(release_root: Path, node: str, temp_dir: Path) -> None:
    """Run committed tests and syntax checks before a whole-site deployment."""
    js_tests = sorted((release_root / "tests").glob("*.test.js"))
    py_tests = sorted((release_root / "tests").glob("test_*.py"))
    if not js_tests or not py_tests:
        raise RuntimeError("approved release snapshot is missing its JavaScript or Python test suite")
    run_command(
        [node, "--test", *[str(path) for path in js_tests]],
        "JavaScript release tests",
        temp_dir / "xcf_release_js_tests.log",
        600,
        cwd=release_root,
    )
    run_command(
        [sys.executable, "-m", "unittest", "discover", "-s", str(release_root / "tests"), "-p", "test_*.py"],
        "Python release tests",
        temp_dir / "xcf_release_py_tests.log",
        600,
        cwd=release_root,
    )
    for path in (
        release_root / "src" / "index.js",
        release_root / "src" / "domain.js",
        release_root / "src" / "http-headers.js",
        release_root / "src" / "refresh-policy.js",
        release_root / "public" / "app.js",
        release_root / "public" / "view-models.js",
        release_root / "public" / "theme-bootstrap.js",
    ):
        run_command(
            [node, "--check", str(path)],
            f"JavaScript syntax check ({path.name})",
            temp_dir / f"xcf_syntax_{path.name}.log",
            60,
            cwd=release_root,
        )



def main() -> int:
    temp_dir = Path(tempfile.gettempdir())
    build_log = temp_dir / "xcf_player_build.log"
    verify_log = temp_dir / "xcf_player_verify.log"
    deploy_log = temp_dir / "xcf_player_deploy.log"

    previous_bytes = BUNDLE_PATH.read_bytes() if BUNDLE_PATH.exists() else None
    previous_bundle = json.loads(previous_bytes) if previous_bytes else None
    release_root = Path(tempfile.mkdtemp(prefix="xcf-approved-release-", dir=str(temp_dir)))
    try:
        revision = snapshot_release(PROJECT_ROOT, release_root)
        bundle_path = release_root / "public" / "data" / "players.json"
        builder = release_root / "scripts" / "build_players.py"
        if not bundle_path.is_file() or not builder.is_file():
            raise RuntimeError("approved source snapshot is missing the metadata bundle or builder")

        # Build and deploy only from the pinned HEAD snapshot. Mutable files in
        # the developer checkout (including uncommitted application edits) are
        # never copied into the production release.
        run_command(
            [sys.executable, str(builder)],
            "player bundle build",
            build_log,
            300,
            cwd=release_root,
        )
        current_bundle = json.loads(bundle_path.read_text(encoding="utf-8"))

        if previous_bundle is not None and comparable_bundle(previous_bundle) == comparable_bundle(current_bundle):
            # Preserve the last known bundle timestamp, then verify production.
            # A local no-change result is not proof that the preceding deploy
            # succeeded; if read-back disagrees, the approved bundle is deployed
            # again below rather than silently acknowledging stale production.
            stable_timestamp = previous_bundle.get("generated_at")
            if stable_timestamp:
                current_bundle["generated_at"] = stable_timestamp
                write_json_atomic(bundle_path, current_bundle)
                try:
                    if payload_is_fresh(current_bundle, fetch_live_payload()):
                        return 0
                except Exception as exc:
                    verify_log.write_text(str(exc), encoding="utf-8")

        # Build players validates against the exact Sleeper snapshot used here.
        # Pin Wrangler to this checkout's locked package while running it against
        # the isolated, committed release directory.
        node = find_command("node")
        run_release_gates(release_root, node, temp_dir)
        wrangler = PROJECT_ROOT / "node_modules" / "wrangler" / "bin" / "wrangler.js"
        if not wrangler.is_file():
            raise RuntimeError(f"locked Wrangler entrypoint is missing: {wrangler}")
        run_command(
            [node, str(wrangler), "deploy", "--dry-run", "--strict", "--config", str(release_root / "wrangler.jsonc")],
            "Wrangler dry run",
            temp_dir / "xcf_wrangler_dry_run.log",
            300,
            cwd=release_root,
        )
        deploy_output = run_command(
            [node, str(wrangler), "deploy", "--strict", "--config", str(release_root / "wrangler.jsonc")],
            "Wrangler deploy",
            deploy_log,
            600,
            cwd=release_root,
        )
        if not any(marker in deploy_output.lower() for marker in ("success", "current version", "uploaded xclubfantasy")):
            raise RuntimeError("Wrangler deploy did not report a successful version")

        for _attempt in range(6):
            try:
                live = fetch_live_payload()
                if payload_is_fresh(current_bundle, live):
                    # Only persist a changed generated artifact after production
                    # read-back confirms this exact metadata snapshot is live.
                    if previous_bytes is None or (BUNDLE_PATH.exists() and BUNDLE_PATH.read_bytes() == previous_bytes):
                        write_json_atomic(BUNDLE_PATH, current_bundle)
                    return 0
            except Exception as exc:
                verify_log.write_text(str(exc), encoding="utf-8")
            time.sleep(5)

        raise RuntimeError(
            f"production payload did not expose metadata from approved revision {revision[:12]} after propagation retries"
        )
    finally:
        shutil.rmtree(release_root, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"XClub player metadata refresh failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
