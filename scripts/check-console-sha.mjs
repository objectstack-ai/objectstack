#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:console-sha — guard against @objectstack/console version drift.
 *
 * The Console SPA in packages/console/dist is a gitignored, locally-built
 * artifact. It is (re)built ONLY by scripts/build-console.sh — via
 * `pnpm objectui:build` / `objectui:refresh` / `release` / CI — and NOT by
 * `turbo run build`. So pulling a branch that bumps the committed
 * `.objectui-sha` pin updates the pin while leaving a stale dist in place,
 * silently serving a console built from a different objectui commit.
 *
 * build-console.sh stamps the SHA it built from into
 * packages/console/dist/.objectui-sha. This script compares that stamp
 * against the pin and fails loudly on drift so the fix is obvious.
 *
 * Remediation is `pnpm objectui:build` (rebuild at the *pinned* SHA), NOT
 * `objectui:refresh` — after a pull the pin is already correct; refresh
 * would re-bump it to your local ../objectui HEAD.
 *
 * Exit codes:
 *   0  in sync; or no dist built yet (nothing to serve — CLI degrades on its
 *      own); or dist present but unstamped (unverifiable → warns, non-fatal)
 *   1  drift: dist was built from a different objectui SHA than the pin
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN_FILE = path.join(ROOT, '.objectui-sha');
const DIST = path.join(ROOT, 'packages', 'console', 'dist');
const STAMP_FILE = path.join(DIST, '.objectui-sha');
const INDEX = path.join(DIST, 'index.html');

const read = (p) => fs.readFileSync(p, 'utf-8').trim();
const short = (s) => (s ? s.slice(0, 12) : '<none>');
const rel = (p) => path.relative(ROOT, p);

if (!fs.existsSync(PIN_FILE)) {
  console.error(`✗ ${rel(PIN_FILE)} is missing — cannot determine the pinned objectui commit.`);
  process.exit(1);
}
const pin = read(PIN_FILE);

// No console built yet: not a drift condition. The CLI already degrades
// gracefully (serves the API, warns the dist is absent), and package-only /
// CI builds legitimately have no dist. Nothing to verify.
if (!fs.existsSync(INDEX)) {
  console.log(`ℹ No console dist at ${rel(DIST)} — skipping SHA check. Build it with: pnpm objectui:build`);
  process.exit(0);
}

// Dist present but unstamped: built by an older build-console.sh (pre-guard)
// or assembled by hand. Can't prove drift, but can't prove freshness either.
if (!fs.existsSync(STAMP_FILE)) {
  console.warn(
    `⚠ Console dist has no objectui-SHA stamp — cannot verify it matches the pin (objectui@${short(pin)}).\n` +
    `  Rebuild once to enable the drift guard:  pnpm objectui:build`,
  );
  process.exit(0);
}

const stamp = read(STAMP_FILE);
if (stamp === pin) {
  console.log(`✓ Console dist matches the objectui pin (objectui@${short(pin)}).`);
  process.exit(0);
}

console.error(
  `\n✗ Console version drift detected.\n\n` +
  `    pinned  (.objectui-sha):              objectui@${short(pin)}\n` +
  `    built   (console/dist/.objectui-sha): objectui@${short(stamp)}\n\n` +
  `  packages/console/dist is a gitignored local artifact that 'turbo run build' does NOT rebuild.\n` +
  `  The objectui pin moved ahead of your locally-built console, so a stale Console SPA would be served.\n\n` +
  `  Rebuild the console at the pinned SHA:\n\n` +
  `      pnpm objectui:build\n\n` +
  `  (Use 'pnpm objectui:refresh' only when you intend to move the pin to your local ../objectui HEAD.)\n`,
);
process.exit(1);
