"""Compare the deployed player bundle's NFL metadata with live Sleeper data."""
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = "https://api.sleeper.app/v1/players/nfl"


def main():
    bundle_path = ROOT / "public/data/players.json"
    try:
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        request = urllib.request.Request(
            API,
            headers={"User-Agent": "XClubFantasy/metadata-verifier"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            live = json.load(response)
    except Exception as exc:
        print(f"Unable to fetch or read player metadata: {exc}", file=sys.stderr)
        return 1

    checked = 0
    errors = []
    for pid, row in (bundle.get("players") or {}).items():
        if not str(pid).isdigit():
            continue
        checked += 1
        source = live.get(str(pid))
        if source is None:
            errors.append(f"{pid}: missing from live Sleeper response")
            continue
        expected = (
            source.get("team") or "",
            source.get("injury_status"),
            source.get("position") or "",
        )
        actual = (
            row.get("t") or "",
            row.get("i"),
            row.get("p") or "",
        )
        if actual != expected:
            errors.append(f"{pid}: bundle={actual!r}, Sleeper={expected!r}")

    if errors:
        print(
            f"Sleeper verification failed: {len(errors)} mismatches among {checked} records.",
            file=sys.stderr,
        )
        for error in errors[:12]:
            print(f"  {error}", file=sys.stderr)
        return 1

    print(f"Verified Sleeper NFL team/injury/position fields for {checked} numeric players; mismatches: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
