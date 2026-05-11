#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-cloudflare.sh — build → push → deploy ObjectOS to Cloudflare Containers
#
# Idempotent end-to-end pipeline. Run from anywhere; resolves the repo root
# automatically. Reads config from `apps/objectos/.env.cloudflare` (gitignored)
# or from environment variables (for CI).
#
#   pnpm --filter @objectstack/objectos cf:deploy           # full pipeline
#   pnpm --filter @objectstack/objectos cf:deploy -- --skip-build
#   pnpm --filter @objectstack/objectos cf:deploy -- --tag v2
#
# Required config (env or .env.cloudflare):
#   CF_ACCOUNT_ID         Cloudflare account id (npx wrangler whoami)
#   CF_IMAGE_REGISTRY     Default: registry.cloudflare.com/$CF_ACCOUNT_ID
#   CF_IMAGE_NAME         Default: objectos
#   CF_IMAGE_TAG          Default: $(git rev-parse --short HEAD)
#   CF_PLATFORM           Default: linux/amd64 (Cloudflare Containers requirement)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_NAME="objectos"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
WRANGLER_TOML="$APP_DIR/wrangler.toml"
DOCKERFILE="$APP_DIR/Dockerfile"
ENV_FILE="$APP_DIR/.env.cloudflare"

# ── Load .env.cloudflare if present ─────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  echo "→ loading $ENV_FILE"
  set -a; source "$ENV_FILE"; set +a
fi

# ── Defaults ────────────────────────────────────────────────────────────────
: "${CF_IMAGE_NAME:=$APP_NAME}"
: "${CF_IMAGE_TAG:=$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo latest)}"
: "${CF_PLATFORM:=linux/amd64}"

# ── Parse flags ─────────────────────────────────────────────────────────────
SKIP_BUILD=0
SKIP_PUSH=0
SKIP_DEPLOY=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)  SKIP_BUILD=1; shift ;;
    --skip-push)   SKIP_PUSH=1; shift ;;
    --skip-deploy) SKIP_DEPLOY=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --tag)         CF_IMAGE_TAG="$2"; shift 2 ;;
    --tag=*)       CF_IMAGE_TAG="${1#--tag=}"; shift ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── Validate ────────────────────────────────────────────────────────────────
if [[ -z "${CF_ACCOUNT_ID:-}" ]]; then
  echo "✗ CF_ACCOUNT_ID is required (set in $ENV_FILE or env)" >&2
  echo "  Run: npx wrangler whoami" >&2
  exit 1
fi
: "${CF_IMAGE_REGISTRY:=registry.cloudflare.com/$CF_ACCOUNT_ID}"
IMAGE="$CF_IMAGE_REGISTRY/$CF_IMAGE_NAME:$CF_IMAGE_TAG"

echo "════════════════════════════════════════════════════════════════"
echo " App     : $APP_NAME"
echo " Repo    : $REPO_ROOT"
echo " Image   : $IMAGE"
echo " Platform: $CF_PLATFORM"
echo " Wrangler: $WRANGLER_TOML"
echo "════════════════════════════════════════════════════════════════"

run() {
  if [[ $DRY_RUN -eq 1 ]]; then echo "[dry-run] $*"; else "$@"; fi
}

# ── 1. Build ────────────────────────────────────────────────────────────────
if [[ $SKIP_BUILD -eq 0 ]]; then
  echo ""
  echo "▶ [1/3] docker buildx build"
  command -v docker >/dev/null || { echo "✗ docker not installed" >&2; exit 1; }
  run docker buildx build \
    --platform "$CF_PLATFORM" \
    -f "$DOCKERFILE" \
    -t "$IMAGE" \
    --load \
    "$REPO_ROOT"
else
  echo "▶ [1/3] skipped (--skip-build)"
fi

# ── 2. Push ─────────────────────────────────────────────────────────────────
if [[ $SKIP_PUSH -eq 0 ]]; then
  echo ""
  echo "▶ [2/3] wrangler containers push"
  run npx --yes wrangler containers push "$IMAGE"
else
  echo "▶ [2/3] skipped (--skip-push)"
fi

# ── 3. Sync wrangler.toml + deploy ──────────────────────────────────────────
if [[ $SKIP_DEPLOY -eq 0 ]]; then
  echo ""
  echo "▶ [3/3] update wrangler.toml image → $IMAGE"
  if [[ $DRY_RUN -eq 0 ]]; then
    # Replace the entire `image = "..."` line under [[containers]].
    # Cross-platform sed (BSD on macOS needs '' after -i).
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' -E "s|^image = \".*\"|image = \"$IMAGE\"|" "$WRANGLER_TOML"
    else
      sed -i -E "s|^image = \".*\"|image = \"$IMAGE\"|" "$WRANGLER_TOML"
    fi
  fi

  echo ""
  echo "▶ wrangler deploy"
  run npx --yes wrangler deploy --config "$WRANGLER_TOML"
else
  echo "▶ [3/3] skipped (--skip-deploy)"
fi

echo ""
echo "✓ done — $IMAGE"
echo "  Tail logs : (cd $APP_DIR && npx wrangler tail)"
echo "  Health    : curl https://$APP_NAME.<your-subdomain>.workers.dev/api/v1/health"
