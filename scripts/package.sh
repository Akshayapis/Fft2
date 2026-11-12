#!/usr/bin/env bash
# Builds the single downloadable ZIP required for delivery:
#
#   project/
#     user-app/
#     admin-app/
#     backend/
#     firebase/
#     .github/workflows/
#     documentation/
#     README.md
#     .env.example
#
# Runtime artifacts (node_modules, dist, data, .env) are excluded so the archive
# contains source code and configuration templates only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS="$ROOT/artifacts"
STAGE="$(mktemp -d)"
PROJECT="$STAGE/project"
ZIP_NAME="fire-arena-tournament-platform.zip"

mkdir -p "$ARTIFACTS" "$PROJECT"

echo "→ staging source files"
tar -C "$ROOT" -cf - \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='data' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='artifacts' \
  --exclude='*.zip' \
  --exclude='*.log' \
  user-app admin-app backend firebase documentation .github \
  README.md .env.example package.json scripts \
  | tar -C "$PROJECT" -xf -

echo "→ sanity check"
missing=0
for required in user-app admin-app backend firebase .github/workflows documentation README.md .env.example; do
  if [ ! -e "$PROJECT/$required" ]; then
    echo "  ✗ missing $required"
    missing=1
  fi
done
if [ -d "$PROJECT/user-app/node_modules" ] || [ -d "$PROJECT/admin-app/dist" ]; then
  echo "  ✗ build artifacts leaked into the archive"
  missing=1
fi
[ "$missing" -eq 0 ] || { echo "packaging failed"; exit 1; }
echo "  ✓ structure complete"

echo "→ writing ZIP"
rm -f "$ARTIFACTS/$ZIP_NAME"
(cd "$STAGE" && zip -qr "$ARTIFACTS/$ZIP_NAME" project -x '*/node_modules/*' -x '*/dist/*' -x '*/data/*')

rm -rf "$STAGE"

SIZE="$(du -h "$ARTIFACTS/$ZIP_NAME" | cut -f1)"
FILES="$(unzip -l "$ARTIFACTS/$ZIP_NAME" | tail -1 | awk '{print $2}')"
echo "✓ $ARTIFACTS/$ZIP_NAME ($SIZE, $FILES files)"
