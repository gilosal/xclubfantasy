"""Refresh and validate the compact player metadata bundle from Sleeper."""
import concurrent.futures
import datetime
import json
import os
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
LID = "1371971946459201536"
API = "https://api.sleeper.app/v1"
POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}


def get(path):
    req = urllib.request.Request(
        API + path,
        headers={"User-Agent": "XClubFantasy/metadata-refresh"},
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def build_bundle(players, rosters, drafts, trending, transactions):
    needed = {
        pid
        for roster in rosters
        for pid in (roster.get("players") or [])
    }
    needed |= {
        pid
        for pid, player in players.items()
        if player.get("position") in POSITIONS
        and player.get("team")
        and player.get("active")
    }
    needed |= {item["player_id"] for item in trending if item.get("player_id")}
    for transaction in transactions:
        needed |= set(transaction.get("adds") or {})
        needed |= set(transaction.get("drops") or {})
    if drafts:
        picks = get(f"/draft/{drafts[0]['draft_id']}/picks")
        needed |= {pick["player_id"] for pick in picks if pick.get("player_id")}

    bundle = {}
    for pid in sorted(needed):
        source = players.get(pid, {})
        name = (
            source.get("full_name")
            or f"{source.get('first_name', '')} {source.get('last_name', '')}".strip()
            or f"Player {pid}"
        )
        position = source.get("position") or ("DEF" if pid.isalpha() else "")
        if position == "DEF" and not name.endswith("D/ST"):
            name += " D/ST"
        bundle[pid] = {
            "n": name,
            "p": position,
            "t": source.get("team") or "",
            "i": source.get("injury_status"),
            "fp": source.get("fantasy_positions") or [position],
        }
    return bundle


def validate_bundle(bundle, players):
    """Prove the NFL team/injury/position fields came from this live response."""
    checked = 0
    errors = []
    for pid, row in bundle.items():
        if not pid.isdigit():
            continue  # Sleeper D/ST pseudo-IDs are not player records.
        checked += 1
        source = players.get(pid)
        if source is None:
            errors.append(f"{pid}: missing from live Sleeper response")
            continue
        expected = (
            source.get("team") or "",
            source.get("injury_status"),
            source.get("position") or "",
        )
        actual = (row.get("t") or "", row.get("i"), row.get("p") or "")
        if actual != expected:
            errors.append(f"{pid}: bundle={actual!r}, Sleeper={expected!r}")

    if errors:
        sample = "; ".join(errors[:8])
        raise RuntimeError(
            f"Sleeper metadata validation failed for {len(errors)} of {checked} records: {sample}"
        )
    return checked


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(text, encoding="utf-8")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        players, rosters, state, league = list(
            executor.map(
                get,
                [
                    "/players/nfl",
                    f"/league/{LID}/rosters",
                    "/state/nfl",
                    f"/league/{LID}",
                ],
            )
        )
    week = state.get("week") or 1
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        drafts, trending, transactions = list(
            executor.map(
                get,
                [
                    f"/league/{LID}/drafts",
                    "/players/nfl/trending/add?lookback_hours=168&limit=25",
                    f"/league/{LID}/transactions/{week}",
                ],
            )
        )

    bundle = build_bundle(players, rosters, drafts, trending, transactions)
    checked = validate_bundle(bundle, players)
    generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    output = {
        "season": league["season"],
        "week": state.get("week"),
        "generated_at": generated_at,
        "players": bundle,
    }
    path = ROOT / "public/data/players.json"
    write_atomic(path, json.dumps(output, separators=(",", ":")))
    print(
        f"{len(bundle)} players; {path.stat().st_size} bytes; "
        f"verified Sleeper team/injury/position fields for {checked}; "
        f"metadata timestamp {generated_at}"
    )


if __name__ == "__main__":
    main()
