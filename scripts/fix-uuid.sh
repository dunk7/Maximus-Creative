#!/usr/bin/env bash
# rpc-websockets (via @solana/web3.js) requires uuid CJS; npm may nest uuid@14 (ESM-only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/node_modules/rpc-websockets/node_modules/uuid" 2>/dev/null || true
