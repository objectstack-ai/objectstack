#!/usr/bin/env node
/**
 * Pack every publishable workspace package into <dest-dir> and write
 * <dest-dir>/overrides.json mapping package name → `file:` tarball spec.
 *
 * Usage:  node scripts/publish-smoke-pack.mjs <dest-dir>
 *
 * Part of the publish-artifact smoke (scripts/publish-smoke.sh): `pnpm pack`
 * applies the SAME manifest rewrites as `pnpm publish` (workspace:* →
 * concrete versions, publishConfig overlay), so the tarballs are what a
 * downstream `npm install` would actually receive — including whatever the
 * published manifests declare WITHOUT this workspace's pnpm overrides.
 *
 * The whole public surface is packed (not a hand-curated closure): the CLI
 * alone depends on ~45 workspace packages, so any curated list would rot.
 * Packing everything keeps the overrides map total — a package missing from
 * it would make the smoke project resolve that name from the npm registry,
 * silently testing a published version instead of the candidate one.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// Not consumed as npm dependencies by a scaffolded project:
//   create-objectstack — the scaffolder itself; the smoke runs it straight
//     from the repo's built bin, and no @objectstack/* manifest depends on it.
//   objectstack-vscode — a VS Code extension (vsce-packaged), not an npm lib.
const EXCLUDE = new Set(['create-objectstack', 'objectstack-vscode']);

const CONCURRENCY = 8;

async function listPublicPackages(repoRoot) {
  const { stdout } = await execFileP('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const all = JSON.parse(stdout);
  return all.filter((p) => p.name && p.private !== true && !EXCLUDE.has(p.name));
}

async function packOne(pkg, destDir) {
  const { stdout } = await execFileP(
    'pnpm',
    ['pack', '--json', '--pack-destination', destDir],
    { cwd: pkg.path, maxBuffer: 64 * 1024 * 1024 },
  );
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`pnpm pack --json returned non-JSON for ${pkg.name}:\n${stdout}`);
  }
  if (!parsed.filename) {
    throw new Error(`pnpm pack reported no tarball filename for ${pkg.name}`);
  }
  return { name: pkg.name, filename: parsed.filename };
}

async function main() {
  const destArg = process.argv[2];
  if (!destArg) {
    console.error('Usage: node scripts/publish-smoke-pack.mjs <dest-dir>');
    process.exit(1);
  }
  const repoRoot = resolve(import.meta.dirname, '..');
  const destDir = resolve(destArg);
  mkdirSync(destDir, { recursive: true });

  const packages = await listPublicPackages(repoRoot);
  console.log(`Packing ${packages.length} publishable package(s) → ${destDir}`);

  const overrides = {};
  const queue = [...packages];
  let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const pkg = queue.shift();
      if (!pkg) return;
      const { name, filename } = await packOne(pkg, destDir);
      overrides[name] = `file:${filename}`;
      done += 1;
      if (done % 10 === 0 || done === packages.length) {
        console.log(`  packed ${done}/${packages.length}`);
      }
    }
  });
  await Promise.all(workers);

  const sorted = Object.fromEntries(
    Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
  );
  const outPath = resolve(destDir, 'overrides.json');
  writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(sorted).length} override(s) → ${outPath}`);
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
