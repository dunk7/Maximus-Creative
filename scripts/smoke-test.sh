#!/usr/bin/env bash
# Local smoke tests for wake server + recent audit fixes.
set -euo pipefail

BASE="${MAXIMUS_URL:-http://127.0.0.1:4747}"
TOKEN="${MAXIMUS_TOKEN:-create}"
FAIL=0

pass() { echo "  OK: $1"; }
fail() { echo "  FAIL: $1"; FAIL=1; }

echo "==> Smoke test against $BASE"

code=$(curl -s -o /tmp/max-health.json -w "%{http_code}" "$BASE/health")
if [ "$code" = "200" ] && grep -q '"ok":true' /tmp/max-health.json; then
  pass "GET /health"
else
  fail "GET /health ($code)"
fi

status=$(curl -s "$BASE/status")
if echo "$status" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  if (d.ok !== true) process.exit(1);
  if (typeof d.agent_busy !== 'boolean') process.exit(2);
  if (d.busy_reason !== null && d.busy_reason !== 'tick' && d.busy_reason !== 'chat') process.exit(3);
"; then
  pass "GET /status includes agent_busy + busy_reason"
else
  fail "GET /status fields"
fi

html=""
for _ in 1 2 3; do
  html=$(curl -s --max-time 10 "$BASE/")
  if [ "${#html}" -gt 30000 ] && echo "$html" | grep -q 'id="tickBanner"'; then
    break
  fi
  sleep 1
done
if [ "${#html}" -lt 30000 ]; then
  fail "GET / returned short response (${#html} bytes)"
else
  pass "GET / returns full chat page (${#html} bytes)"
fi
for needle in 'id="tickBanner"' 'background thinking tick' 'startActivityPoll' 'div.textContent = raw'; do
  if echo "$html" | grep -Fq "$needle"; then
    pass "chat HTML contains: $needle"
  else
    fail "chat HTML missing: $needle"
  fi
done

code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/session")
[ "$code" = "200" ] && pass "GET /session auth" || fail "GET /session auth ($code)"

code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer friend" "$BASE/session")
[ "$code" = "200" ] && pass "GET /session friend" || fail "GET /session friend ($code)"

# Oversized body should return JSON error, not reset connection
big=$(python3 -c "print('x'*70000)")
code=$(curl -s -o /tmp/max-big.json -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"message\":\"$big\"}" "$BASE/chat")
if [ "$code" = "413" ] || [ "$code" = "500" ]; then
  if grep -q 'too large' /tmp/max-big.json; then
    pass "POST /chat rejects oversized body ($code)"
  else
    fail "POST /chat oversized body wrong error ($code)"
  fi
else
  fail "POST /chat oversized body ($code) $(head -c 120 /tmp/max-big.json)"
fi

# SSE stream returns events
curl -s -N -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"reply with exactly: pong"}' "$BASE/threads/1/chat/stream" > /tmp/max-sse.txt &
SSE_PID=$!
sleep 25
kill "$SSE_PID" 2>/dev/null || true
wait "$SSE_PID" 2>/dev/null || true

if grep -q 'event: token' /tmp/max-sse.txt && grep -q 'event: done' /tmp/max-sse.txt; then
  pass "POST /threads/1/chat/stream emits token + done"
else
  fail "SSE stream missing events ($(wc -c < /tmp/max-sse.txt) bytes)"
  head -20 /tmp/max-sse.txt >&2 || true
fi

if grep -q 'event: model' /tmp/max-sse.txt || grep -q 'event: status' /tmp/max-sse.txt; then
  pass "SSE stream emits status/model"
else
  fail "SSE stream missing status/model"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "All smoke tests passed."
  exit 0
fi
echo "Some smoke tests failed."
exit 1
