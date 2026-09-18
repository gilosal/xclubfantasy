#!/usr/bin/env bash
# Manual Git-Bash convenience wrapper. Hermes cron uses the native .py entrypoint
# directly because this Windows host has no WSL distribution for bash dispatch.
set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$(cygpath -w "$PROJECT_ROOT/scripts/refresh_players_deploy.py")"
exec python "$SCRIPT_PATH"
