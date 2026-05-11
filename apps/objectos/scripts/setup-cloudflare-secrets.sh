#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-cloudflare-secrets.sh — bulk-push secrets to a Cloudflare Worker.
#
# Reads values from `.env.cloudflare.secrets` (gitignored) and pipes each
# one to `wrangler secret put`. Safe to re-run — wrangler upserts secrets.
#
#   pnpm --filter @objectstack/objectos cf:secrets
#   pnpm --filter @objectstack/cloud    cf:secrets
#
# .env.cloudflare.secrets format (one key=value per line, # for comments):
#
#   OS_DATABASE_URL=libsql://my-control.turso.io
#   OS_DATABASE_AUTH_TOKEN=eyJhbGciOi...
#   AUTH_SECRET=<openssl rand -hex 32>
#   # Cloud-only:
#   TURSO_API_TOKEN=...
#   TURSO_ORG_NAME=...
#   # ObjectOS multi-project mode:
#   OS_CLOUD_URL=https://objectstack-cloud.<sub>.workers.dev
#   OS_CLOUD_API_KEY=...
#
# Any unset variable is *skipped* (not cleared) so you can keep one shared
# file across both apps.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER_TOML="$APP_DIR/wrangler.toml"
SECRETS_FILE="${SECRETS_FILE:-$APP_DIR/.env.cloudflare.secrets}"

# Per-app key allow-list. Secrets not in the list are ignored so we can
# share one .env.cloudflare.secrets file across apps without leaking
# unrelated keys to a Worker that has no use for them.
APP_BASENAME="$(basename "$APP_DIR")"
case "$APP_BASENAME" in
  objectos)
    KEYS=( OS_DATABASE_URL OS_DATABASE_AUTH_TOKEN AUTH_SECRET
           OS_CLOUD_URL OS_CLOUD_API_KEY OS_COOKIE_DOMAIN ) ;;
  cloud)
    KEYS=( OS_DATABASE_URL OS_CONTROL_DATABASE_URL OS_DATABASE_AUTH_TOKEN AUTH_SECRET
           OS_CONTROL_PG_POOL_MIN OS_CONTROL_PG_POOL_MAX
           TURSO_API_TOKEN TURSO_ORG_NAME OS_COOKIE_DOMAIN ) ;;
  *)
    echo "✗ unknown app dir: $APP_BASENAME" >&2; exit 1 ;;
esac

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "✗ no $SECRETS_FILE — copy .env.cloudflare.secrets.example and fill it in" >&2
  exit 1
fi

set -a; source "$SECRETS_FILE"; set +a

echo "→ pushing secrets to Worker defined in $WRANGLER_TOML"
PUSHED=0; SKIPPED=0
for key in "${KEYS[@]}"; do
  value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "  · $key (skipped — not set)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi
  echo "  ✓ $key"
  printf '%s' "$value" | npx --yes wrangler secret put "$key" \
    --config "$WRANGLER_TOML" >/dev/null
  PUSHED=$((PUSHED+1))
done

echo ""
echo "✓ pushed=$PUSHED skipped=$SKIPPED"
