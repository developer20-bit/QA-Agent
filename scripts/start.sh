#!/usr/bin/env bash
# QA-Agent: install deps, build, install Chromium (optional), start health dashboard.
# Usage:
#   bash scripts/start.sh
#   bash scripts/start.sh -- --urls config/urls.txt
#   SKIP_PLAYWRIGHT=1 bash scripts/start.sh   # skip "playwright install chromium"
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> QA-Agent startup (project: $ROOT)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed or not on PATH." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js 20 or newer is required. Found: $(node -v)" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not on PATH." >&2
  exit 1
fi

echo "==> npm install (root)"
npm install

if [ -f "$ROOT/web/package.json" ]; then
  echo "==> npm install (web/)"
  (cd "$ROOT/web" && npm install)
fi

echo "==> npm run build:all"
npm run build:all

if [ ! -f "$ROOT/dist/index.js" ]; then
  echo "Error: Build did not produce dist/index.js" >&2
  exit 1
fi

if [ "${SKIP_PLAYWRIGHT:-}" = "1" ]; then
  echo "==> Skipping Playwright Chromium (SKIP_PLAYWRIGHT=1)"
else
  echo "==> playwright install chromium (PDF, screenshots, viewport checks)"
  if ! npm run setup-browsers; then
    echo "Warning: Playwright Chromium install failed. PDF export and browser-based features may not work. Run: npm run setup-browsers" >&2
  fi
fi

DASHBOARD_PORT="${QA_AGENT_PORT:-3847}"
echo "==> Starting dashboard at http://127.0.0.1:${DASHBOARD_PORT}/ (Ctrl+C to stop)"
echo "    Port: QA_AGENT_PORT in .env, or --port (default 3847). If EADDRINUSE: npm run dashboard:kill"
echo "    Extra args are passed to: health --serve ..."
exec npm run health -- --serve "$@"
