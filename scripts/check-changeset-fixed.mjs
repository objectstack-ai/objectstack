#!/usr/bin/env node
/**
 * Validates that every publishable workspace package is enumerated in the
 * Changesets `fixed` group, so a new public package can never silently be
 * released out of lockstep with the rest of the monorepo.
 *
 * Run:  node scripts/check-changeset-fixed.mjs
 *
 * Exits with code 1 (and a clear diff) if:
 *   - A public (non-private) workspace package is missing from the
 *     `fixed` group in .changeset/config.json
 *   - A name listed in the `fixed` group no longer exists in the workspace
 *
 * The script intentionally has zero third-party dependencies so it can run
 * in minimal CI environments before `pnpm install`. The workspace walk comes
 * from scripts/workspace-enumerator.mjs, which has none either, for the same
 * reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePackages } from './workspace-enumerator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * Names of all non-private workspace packages.
 *
 * Membership comes from `scripts/workspace-enumerator.mjs` (#11510) — this
 * repo's one parse of `pnpm-workspace.yaml`, and one of nine private copies
 * before it. Two behaviours of the copy that used to live here changed, both
 * toward refusing rather than under-reporting, and neither observable on this
 * repo's workspace file:
 *
 *   - a missing or empty `packages:` block used to yield `[]`, which made this
 *     gate report the `fixed` group in sync with a workspace of zero packages —
 *     green, and vacuous. It now throws.
 *   - a `#` was stripped unconditionally, so a member path legitimately
 *     containing one was silently truncated to a directory that does not exist.
 *     Only a whitespace-led `#` is a comment now.
 *
 * @returns {string[]}
 */
function listPublicPackageNames() {
  const names = new Set();
  for (const { manifest } of workspacePackages(repoRoot)) {
    if (!manifest.name || manifest.private === true) continue;
    names.add(manifest.name);
  }
  return [...names].sort();
}

function readFixedGroups() {
  const configPath = resolve(repoRoot, '.changeset/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!Array.isArray(config.fixed)) return [];
  return config.fixed;
}

function main() {
  const publicPackages = listPublicPackageNames();
  const fixedGroups = readFixedGroups();
  const fixed = new Set(fixedGroups.flat());

  const missing = publicPackages.filter((name) => !fixed.has(name));
  const stale = [...fixed]
    .filter((name) => !publicPackages.includes(name))
    .sort();

  if (missing.length === 0 && stale.length === 0) {
    console.log(
      `✓ .changeset/config.json "fixed" group is in sync with ${publicPackages.length} public workspace packages.`,
    );
    return;
  }

  console.error('✗ .changeset/config.json "fixed" group is out of sync.');
  if (missing.length > 0) {
    console.error(
      '\nPublic packages missing from "fixed" (add them to keep versions in lockstep):',
    );
    for (const name of missing) console.error(`  - ${name}`);
  }
  if (stale.length > 0) {
    console.error(
      '\nNames in "fixed" that no longer exist in the workspace (remove them):',
    );
    for (const name of stale) console.error(`  - ${name}`);
  }
  console.error(
    '\nEdit .changeset/config.json so the "fixed" group matches the public workspace, then re-run this script.',
  );
  process.exit(1);
}

main();

