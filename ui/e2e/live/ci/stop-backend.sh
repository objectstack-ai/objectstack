#!/usr/bin/env bash
# Stop the live-e2e backend started by start-backend.sh. Kills ONLY the PID
# that script recorded — never by port or process name (parallel agents run
# their own stacks; see AGENTS.md service discipline).
set -euo pipefail

BACKEND_DIR="${LIVE_BACKEND_DIR:-${TMPDIR:-/tmp}/objectui-live-backend}"
PID_FILE="$BACKEND_DIR/backend.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "[live-backend] no pid file at $PID_FILE — nothing to stop"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  # SIGTERM lets `--fresh` clean up its throwaway sqlite db.
  kill "$PID"
  for _ in $(seq 1 20); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
  done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null
  echo "[live-backend] stopped pid $PID"
else
  echo "[live-backend] pid $PID not running"
fi
rm -f "$PID_FILE"
