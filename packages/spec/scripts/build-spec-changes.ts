// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-spec-changes.ts — generate the machine-readable change manifest
 * `spec-changes.json` (ADR-0087 D4).
 *
 * The manifest is a pure projection of the two ADR-0087 registries — the D2
 * conversion table and the D3 migration chain — folded per major from the
 * support floor to the current protocol major, plus one aggregate record for
 * the whole range. Because it is generated, it can never drift from what the
 * loader and `migrate meta` actually do; a CI `--check` enforces that the
 * committed copy is regenerated with any registry change (the ADR-0049
 * enforce-or-remove discipline applied to release artifacts).
 *
 *   pnpm --filter @objectstack/spec gen:spec-changes     # regenerate + write
 *   pnpm --filter @objectstack/spec check:spec-changes   # CI: fail on drift
 *
 * Release-time surface join: `--previous-surface <path>` diffs the current
 * committed export surface against a previously *published* one (both ship in
 * the npm artifact from protocol 15 on) and fills the `added[]`/`removed[]`
 * arrays of the aggregate record, attributed to the current major. The Release
 * workflow runs this against the last published spec tarball and attaches the
 * result to the GitHub Release; the committed copy keeps `added`/`removed`
 * empty (registry-derived content only) so it stays deterministic.
 *
 * `<path>` is whichever shape that published tarball carried: the `api-surface/`
 * directory from #5837 on, or the single `api-surface.json` before it. Reading
 * both is not consumer leniency — a published tarball is immutable, so there is
 * no producer to fix. This repo's OWN surface is always the directory.
 *
 * Per-release section: `--previous-package <dir>` points at the UNPACKED
 * previous tarball (its `package/` root) and is the publish-time superset of
 * `--previous-surface`. From that one directory it reads the previous version
 * (its `package.json`), the previous export surface and the previous
 * `spec-changes.json`, and writes a `release` section — `from → to` at
 * PACKAGE-VERSION resolution — into the manifest that is about to be packed.
 * The committed copy never carries it (generating it needs a published tarball,
 * so it could not be deterministic), which is exactly how the ruling answers
 * the determinism concern: publish time only.
 *
 * ⛔ The section is OMITTED, loudly, rather than emitted empty when the previous
 * tarball lacks either input — an empty `release` is indistinguishable from
 * "this release changed nothing", which is the misreading this whole section
 * exists to end. `scripts/check-release-spec-changes.mjs` derives the same
 * condition from the same artifacts and accepts the absence for the same reason.
 *
 * `spec-changes.json` itself stays a single file, deliberately (#5837), and #8344
 * re-measured that call rather than inheriting it. The original reason — "two PRs
 * append under different majors" — is not what actually holds: in-flight
 * registrations land in the SAME (current) major, so what separates them is their
 * distance in the registry's id sort order, not the major. What holds is the
 * conclusion. This file is a sorted union of an insertion-only registration, so a
 * driver-less server-side merge either takes both sides (byte-identical to the
 * regeneration) or conflicts; it is never stale-but-clean, it conflicts only on
 * ADJACENT ids, and in that case `src/migrations/registry.ts` — unsharded and
 * outside the merge driver — conflicts too, so splitting this file would not save
 * the PR. Measurement table: `../src/migrations/entries/README.md`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '../src/kernel/protocol-version';
import { MIGRATION_SUPPORT_FLOOR } from '../src/migrations/registry';
import {
  composeReleaseChanges,
  composeSpecChanges,
  SpecChangesSchema,
  SpecReleaseChangesSchema,
  type SpecReleaseChanges,
  type SpecSurfaceAdd,
  type SpecSurfaceRemove,
} from '../src/migrations/spec-changes';
import { API_SURFACE_DIR_NAME, readApiSurfaceFrom } from './lib/sharded-artifacts';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SNAPSHOT = resolve(PKG_DIR, 'spec-changes.json');
const SURFACE = resolve(PKG_DIR, API_SURFACE_DIR_NAME);
const CHECK = process.argv.includes('--check');
const prevSurfaceIdx = process.argv.indexOf('--previous-surface');
const prevPackageIdx = process.argv.indexOf('--previous-package');
const PREV_PACKAGE = prevPackageIdx >= 0 ? process.argv[prevPackageIdx + 1] : undefined;
/** The version this tree is about to publish — read, never transcribed. */
const THIS_VERSION = (JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')) as { version: string })
  .version;

/**
 * The export snapshot inside an unpacked published tarball, in whichever of the
 * two shapes that release shipped (`api-surface/` from #5837, `api-surface.json`
 * before it), or `null` when it shipped neither (pre-protocol-15).
 */
function previousSurfacePath(pkgDir: string): string | null {
  const dir = resolve(pkgDir, API_SURFACE_DIR_NAME);
  if (existsSync(dir)) return dir;
  const monolith = resolve(pkgDir, `${API_SURFACE_DIR_NAME}.json`);
  if (existsSync(monolith)) return monolith;
  return null;
}

const PREV_SURFACE = PREV_PACKAGE
  ? (previousSurfacePath(PREV_PACKAGE) ?? undefined)
  : prevSurfaceIdx >= 0
    ? process.argv[prevSurfaceIdx + 1]
    : undefined;

/** Flatten an export surface ({ entry: ["name (kind)", …] }) into one set. */
function flattenSurface(path: string): Set<string> {
  const doc = readApiSurfaceFrom(path);
  const out = new Set<string>();
  for (const [entry, names] of Object.entries(doc)) {
    for (const name of names) out.add(`${entry}: ${name}`);
  }
  return out;
}

/** The raw `entry: name` rows a release added and removed, before attribution. */
function diffSurfaceNames(prevPath: string): { added: string[]; removed: string[] } {
  const prev = flattenSurface(prevPath);
  const curr = flattenSurface(SURFACE);
  return {
    added: [...curr].filter((s) => !prev.has(s)).sort(),
    removed: [...prev].filter((s) => !curr.has(s)).sort(),
  };
}

/** Diff two flattened surfaces into the manifest's added/removed arrays. */
function diffSurfaces(prevPath: string): { added: SpecSurfaceAdd[]; removed: SpecSurfaceRemove[] } {
  const names = diffSurfaceNames(prevPath);
  return {
    added: names.added.map((surface) => ({ surface, since: PROTOCOL_MAJOR })),
    removed: names.removed.map((surface) => ({ surface, removedIn: PROTOCOL_MAJOR })),
  };
}

/**
 * The previous release's registry ids and version, read out of its own unpacked
 * tarball. `null` when that tarball carries no `spec-changes.json` (before
 * #2897's release side) — the caller then omits the section rather than
 * claiming an empty delta.
 */
function previousRelease(
  pkgDir: string,
): { version: string; conversionIds: string[]; migrationIds: string[] } | null {
  const manifestPath = resolve(pkgDir, 'spec-changes.json');
  if (!existsSync(manifestPath)) return null;
  const pkgPath = resolve(pkgDir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }).version;
  if (!version) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    aggregate?: { converted?: { conversionId: string }[]; migrated?: { migrationId: string }[] };
  };
  if (!manifest.aggregate) return null;
  return {
    version,
    conversionIds: (manifest.aggregate.converted ?? []).map((c) => c.conversionId),
    migrationIds: (manifest.aggregate.migrated ?? []).map((m) => m.migrationId),
  };
}

/**
 * The publish-time `release` section, or `null` with the reason printed.
 *
 * ⛔ Never returns an empty-but-present section on missing inputs: `release`
 * present means "this is the delta", and a consumer cannot tell a true empty
 * delta from an uncomputable one.
 */
function buildReleaseSection(current: ReturnType<typeof composeSpecChanges>): SpecReleaseChanges | null {
  if (!PREV_PACKAGE) return null;
  const prevSurface = previousSurfacePath(PREV_PACKAGE);
  const prev = previousRelease(PREV_PACKAGE);
  if (!prevSurface || !prev) {
    console.error(
      `No per-release section: the previous tarball at ${PREV_PACKAGE} ships ` +
        `${!prevSurface ? 'no api-surface snapshot' : 'no readable spec-changes.json'}, ` +
        'so the delta cannot be computed. Omitting the section — an empty one would read as ' +
        '"this release changed nothing".',
    );
    return null;
  }
  const names = diffSurfaceNames(prevSurface);
  return SpecReleaseChangesSchema.parse(
    composeReleaseChanges(prev.version, THIS_VERSION, current, prev, names),
  );
}

function build(): string {
  const surfaceDiff = PREV_SURFACE ? diffSurfaces(PREV_SURFACE) : {};

  // Per-major records compose (ADR-0087 D4): any tool can fold them into a
  // single from→to view. The aggregate is that fold, precomputed.
  const perMajor = [];
  for (let major = MIGRATION_SUPPORT_FLOOR + 1; major <= PROTOCOL_MAJOR; major++) {
    perMajor.push(SpecChangesSchema.parse(composeSpecChanges(major - 1, major)));
  }
  const aggregate = SpecChangesSchema.parse(
    composeSpecChanges(MIGRATION_SUPPORT_FLOOR, PROTOCOL_MAJOR, surfaceDiff),
  );
  const release = buildReleaseSection(aggregate);

  const doc = {
    $comment:
      'GENERATED (ADR-0087 D4) — do not edit. Regenerate with: pnpm --filter @objectstack/spec gen:spec-changes. ' +
      'A projection of the D2 conversion table + D3 migration chain; the upgrade guide and the MCP spec_changes ' +
      'tool derive from this same data.',
    protocolVersion: PROTOCOL_VERSION,
    supportFloor: MIGRATION_SUPPORT_FLOOR,
    migrateCommand: `objectstack migrate meta --from <N>  (N >= ${MIGRATION_SUPPORT_FLOOR})`,
    // Publish-time only, and placed BEFORE the major-keyed records on purpose:
    // it is the section a consumer crossing one release needs first, and the
    // one whose absence sent the filer of #17080 to a hand diff of two
    // `node_modules` trees.
    ...(release ? { release } : {}),
    aggregate,
    perMajor,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const next = build();

if (CHECK) {
  if (PREV_SURFACE || PREV_PACKAGE) {
    console.error(
      'check mode compares the committed (registry-only) manifest; drop ' +
        (PREV_PACKAGE ? '--previous-package' : '--previous-surface'),
    );
    process.exit(2);
  }
  const current = existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT, 'utf8') : '';
  if (current !== next) {
    console.error(
      'spec-changes.json is stale — the ADR-0087 registries changed without regenerating the manifest.\n' +
        'Run: pnpm --filter @objectstack/spec gen:spec-changes  (and commit the result)',
    );
    process.exit(1);
  }
  console.log('spec-changes.json is up to date.');
} else {
  writeFileSync(SNAPSHOT, next);
  console.log(`Wrote ${SNAPSHOT}`);
}
