#!/usr/bin/env bash
set -euo pipefail

echo "🔒 npm ci"
if npm ci; then
  echo "✅ npm ci OK"; exit 0
fi

echo "⚠️ npm ci 실패 → lock 동기화"
rm -rf node_modules
npm install --package-lock-only
npm ci
echo "✅ lock sync + npm ci OK"

