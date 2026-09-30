"""Native-Windows Hermes cron entrypoint for the XClub Wednesday edition.

The JS publisher verifies the public feed, writes the bound KV manifest only
once, and prints an announcement only after production API read-back. Empty
stdout means a quiet no-op; failures surface via the cron error channel.
"""
import subprocess
import sys
from pathlib import Path

PUBLISHER = Path(__file__).with_name("publish_waiver_article.mjs")


def main():
    result = subprocess.run(
        ["node", str(PUBLISHER), *sys.argv[1:]],
        cwd=str(PUBLISHER.parent.parent),
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode:
        print(result.stderr.strip() or "Waiver publisher failed without diagnostics", file=sys.stderr)
        return result.returncode
    if result.stdout.strip():
        print(result.stdout.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
