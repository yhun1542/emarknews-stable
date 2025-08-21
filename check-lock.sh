#!/usr/bin/env bash
set -euo pipefail

echo "[check] npm ci --dry-run"
if npm ci --dry-run >/dev/null 2>&1; then
  echo "[ok] lockfile in sync."
  exit 0
fi

echo "[warn] lockfile out of sync with package.json."

if [[ "${AUTO_FIX_LOCK:-0}" == "1" ]]; then
  echo "[fix] regenerating package-lock.json"
  rm -f package-lock.json
  npm install
  npm dedupe
  echo "[done] lockfile regenerated."
else
  echo "[hint] run:"
  echo "  rm -rf node_modules package-lock.json && npm cache verify && npm install && npm dedupe"
  exit 1
fi

