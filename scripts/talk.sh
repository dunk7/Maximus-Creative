#!/usr/bin/env bash
# Talk to Maximus on your Oracle VM (or local core).
# Usage:
#   ./scripts/talk.sh "Hello Maximus"
#   ./scripts/talk.sh --history
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${MAXIMUS_URL:-http://167.234.214.140:4747}"

if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/.env"
fi

SECRET="${MAXIMUS_WAKE_SECRET:-${WAKE_SECRET:-}}"

# If local secret is still the dev default, try fetching from the server.
if [ "$SECRET" = "create" ] || [ -z "$SECRET" ]; then
  HOST="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.urlparse(sys.argv[1]).hostname or "")' "$URL")"
  if [ -n "$HOST" ]; then
    FETCHED="$(ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no -i "$HOME/.ssh/id_ed25519" "opc@${HOST}" \
      'grep ^WAKE_SECRET= /opt/maximus/.env | cut -d= -f2-' 2>/dev/null || true)"
    if [ -n "$FETCHED" ]; then
      SECRET="$FETCHED"
    fi
  fi
fi

if [ -z "$SECRET" ]; then
  echo "Set WAKE_SECRET in .env, MAXIMUS_WAKE_SECRET, or ensure SSH can read /opt/maximus/.env on the server." >&2
  exit 1
fi

if [ "${1:-}" = "--history" ]; then
  curl -s "$URL/messages" -H "Authorization: Bearer $SECRET" | python3 -m json.tool
  exit 0
fi

MESSAGE="${*:-}"
if [ -z "$MESSAGE" ]; then
  echo "Usage: ./scripts/talk.sh \"your message\"" >&2
  echo "       ./scripts/talk.sh --history" >&2
  exit 1
fi

curl -s -X POST "$URL/chat" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"message": sys.argv[1]}))' "$MESSAGE")" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("response") or d.get("error") or d)'
