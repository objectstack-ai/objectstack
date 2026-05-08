#!/usr/bin/env bash
set -euo pipefail

# Build script for Vercel deployment of @objectstack/objectos.
#
# Follows the Vercel deployment pattern:
#   - api/[[...route]].js is committed to the repo (Vercel detects it pre-build)
#   - esbuild bundles server/index.ts → api/_handler.js (self-contained bundle)
#   - The committed .js wrapper re-exports from _handler.js at runtime
#   - Studio SPA is built and copied to public/ for serving the UI
#   - External dependencies installed in api/node_modules/ (no symlinks)
#
# Steps:
#   1. Build the project with turbo (includes studio)
#   2. Bundle the API serverless function (→ api/_handler.js)
#   3. Copy studio dist files to public/ for UI serving
#   4. Install external deps in api/node_modules/ (resolve pnpm symlinks)

echo "[build-vercel] Starting server build..."

# 1. Build the project with turbo (from monorepo root)
# This builds server, studio, account, and the runtime console portal.
cd ../..
pnpm turbo run build --filter=@objectstack/objectos --filter=@objectstack/studio --filter=@objectstack/account --filter=@objectstack/console
cd apps/objectos

# 1b. Compile objectstack.config.ts → dist/objectstack.json (the metadata artifact).
# MetadataPlugin reads this file at startup in local mode. Without it the kernel
# cannot boot ("Cannot read artifact file … ENOENT").
echo "[build-vercel] Compiling objectstack artifact..."
pnpm objectstack build
echo "[build-vercel]   ✓ dist/objectstack.json generated"

# 2. Bundle API serverless function
node scripts/bundle-api.mjs

# 2b. Copy the artifact into api/dist/ so Vercel includes it in the function
# deployment package. The function runs with CWD=/var/task and resolves the
# artifact relative to its own directory (api/), so api/dist/objectstack.json
# maps to /var/task/apps/objectos/api/dist/objectstack.json at runtime.
echo "[build-vercel] Copying artifact into api/dist/..."
mkdir -p api/dist
cp dist/objectstack.json api/dist/objectstack.json
echo "[build-vercel]   ✓ api/dist/objectstack.json ready"

# 3. Copy studio dist files to public/_studio/ for UI serving.
# Studio is always mounted under /_studio/ (same convention as the CLI
# static plugin). Vite builds with base: '/_studio/' so its asset URLs
# and router basepath are already correct for this mount point.
echo "[build-vercel] Copying studio dist to public/_studio/..."
rm -rf public
mkdir -p public/_studio
if [ -d "../studio/dist" ]; then
  cp -r ../studio/dist/. public/_studio/
  echo "[build-vercel]   ✓ Copied studio dist to public/_studio/"
else
  echo "[build-vercel]   ⚠ Studio dist not found (skipped)"
fi

# 3b. Copy the account portal dist to public/_account/ — same pattern as
# studio. The account SPA is always built with base: '/_account/'.
echo "[build-vercel] Copying account dist to public/_account/..."
mkdir -p public/_account
if [ -d "../account/dist" ]; then
  cp -r ../account/dist/. public/_account/
  echo "[build-vercel]   ✓ Copied account dist to public/_account/"
else
  echo "[build-vercel]   ⚠ Account dist not found (skipped)"
fi

# 3c. Copy the runtime Console SPA to public/_console/ — same pattern as
# studio. The Console is built with base: '/_console/'.
echo "[build-vercel] Copying console dist to public/_console/..."
mkdir -p public/_console
if [ -d "../console/dist" ]; then
  cp -r ../console/dist/. public/_console/
  echo "[build-vercel]   ✓ Copied console dist to public/_console/"
else
  echo "[build-vercel]   ⚠ Console dist not found (skipped)"
fi

# 4. Install external dependencies in api/node_modules/ (no symlinks)
# pnpm uses symlinks in node_modules/, which Vercel's serverless function
# packaging cannot handle ("invalid deployment package" error).
# We use npm to install external packages as real files next to the handler.
echo "[build-vercel] Installing external dependencies for serverless function..."
cat > api/_package.json << 'DEPS'
{
  "private": true,
  "dependencies": {
    "@libsql/client": "0.14.0",
    "pino": "10.3.1",
    "pino-pretty": "13.1.3"
  }
}
DEPS
cd api
mv _package.json package.json
npm install --production --no-package-lock --ignore-scripts --loglevel error
rm package.json
cd ..
echo "[build-vercel]   ✓ External dependencies installed in api/node_modules/"

echo "[build-vercel] Done. Static files in public/, serverless function in api/[[...route]].js → api/_handler.js"
