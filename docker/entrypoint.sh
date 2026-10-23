#!/usr/bin/env bash
# Sobe, no mesmo container, o servidor da demo (4747) e o bundle web do app (8085).
# Se um dos dois cair, o container encerra para o orquestrador decidir o restart.
set -euo pipefail

API_PORT="${DEV_SERVER_PORT:-4747}"
WEB_PORT="${DEMO_WEB_PORT:-8085}"

mkdir -p /app/.runtime

python /app/docker/web_server.py --port "$WEB_PORT" --root /app/web &
WEB_PID=$!

python /app/server/server.py --port "$API_PORT" &
API_PID=$!

encerrar() {
    kill "$API_PID" "$WEB_PID" 2>/dev/null || true
    wait "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap 'encerrar; exit 0' INT TERM

set +e
wait -n "$API_PID" "$WEB_PID"
STATUS=$?
set -e

encerrar
exit "$STATUS"
