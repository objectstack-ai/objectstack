// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * export-origins-testkit.ts — the READER side of `packages/spec/export-origins/`.
 *
 * Every "resolves the export surface" pin used to answer its question by
 * building a `ts.createProgram` over all sixteen entry points and running
 * `getTypeChecker()` inside its own `it()`. Seventeen pins, ~3.4s of compilation
 * each, ~55s per CI lap, growing by one compilation per retirement PR — and at
 * ~3.4s against vitest's 5s default they rode the timeout line, ejecting
 * unrelated PRs from the merge queue six times in one night (#4796).
 *
 * The resolution moved to build time (`scripts/build-export-origins.ts`). This
 * module reads the resulting artifact and offers the same three primitives the
 * pins used, so a pin's assertions carry over one for one:
 *
 *     exportsOf(sub).map(e => e.getName())   →   exportNamesOf(entry)
 *     originOf(sym, label)                   →   originOf(entry, name)
 *     Object.keys(entries)                   →   EXPORT_ENTRY_POINTS
 *
 * ## Why this is not weaker than compiling
 *
 * A comparison is only as good as the thing compared, so the artifact's
 * freshness is load-bearing, and it is guarded twice — independently:
 *
 *   1. `check:export-origins` recomputes from source and compares bytes. It
 *      runs inside `check:generated`, hence inside lint.yml's required
 *      `TypeScript Type Check` job. A stale or hand-edited artifact is CI-red.
 *   2. The compiler-free cross-check below. Every origin whose kind is a
 *      RUNTIME kind must appear in the entry's real runtime namespace, and
 *      every runtime export must appear in the artifact. That needs no `tsc`,
 *      so `pnpm test` on its own is not blind to a doctored artifact either —
 *      it catches exactly the hand-edit that (1) catches, one lane earlier.
 *
 * Type-only exports are erased at runtime, so guard (2) cannot see them; guard
 * (1) is what covers those, and it covers everything. The split is deliberate:
 * two gates that fail for different reasons beat one gate that has to be
 * believed.
 *
 * ⚠️ It lives in `scripts/lib/` rather than beside the tests it serves, and that
 * is not filing preference. `tsconfig.json` is the BUILD config: it compiles
 * everything under `src/` that is not a `*.test.ts` as CommonJS, where
 * `import.meta` is a hard error (TS1470) — so a reader in `src/` could not
 * resolve its own location, and the alternatives (excluding it from the build
 * program, or reaching outside `rootDir: ./src` for the artifact) each weaken a
 * gate to place a file. Here it sits next to the writer it mirrors, shares its
 * shard naming rather than restating it, and is type-checked by
 * `tsconfig.scripts.json`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryForShardName, listShardNames } from './sharded-artifacts';
import { EXPORT_ORIGINS_DIR_NAME } from './export-origins-layout';

/** `<package>/export-origins` — resolved from this file, so vitest's cwd is irrelevant. */
const ORIGINS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..', EXPORT_ORIGINS_DIR_NAME);

interface ShardDoc {
  description: string;
  entry: string;
  exports: Record<string, string>;
}

function loadShards(): Map<string, Record<string, string>> {
  let names: string[];
  try {
    names = listShardNames(ORIGINS_DIR);
  } catch (error) {
    throw new Error(
      `cannot read ${ORIGINS_DIR}: ${error}. This artifact is generated — run ` +
        `\`pnpm --filter @objectstack/spec gen:export-origins\`. Every export-surface pin reads it, ` +
        `so its absence must be loud rather than an empty surface every assertion passes over (#4796).`,
    );
  }

  // A floor, not a formality. The pins each asserted `> 10` entry points for
  // themselves because an enumeration that silently finds nothing makes every
  // `not.toContain` below it vacuously true — the exact way a gate goes dormant
  // while reporting success (#4642). The floor now lives here, once.
  if (names.length <= 10) {
    throw new Error(
      `export-origins/ holds only ${names.length} shard(s); @objectstack/spec publishes 16 ` +
        `TypeScript entry points. Regenerate with \`pnpm --filter @objectstack/spec gen:export-origins\`.`,
    );
  }

  const byEntry = new Map<string, Record<string, string>>();
  for (const name of names) {
    const file = `${name}.json`;
    const doc = JSON.parse(readFileSync(join(ORIGINS_DIR, file), 'utf-8')) as ShardDoc;
    const expected = entryForShardName(name);
    if (doc.entry !== expected) {
      throw new Error(
        `export-origins/${file} declares entry ${JSON.stringify(doc.entry)} but its filename says ` +
          `"${expected}". A shard answers for exactly the entry point it is named for — regenerate ` +
          `rather than reconcile by hand (#5837).`,
      );
    }
    if (!doc.exports || typeof doc.exports !== 'object') {
      throw new Error(`export-origins/${file} has no "exports" object.`);
    }
    if (Object.keys(doc.exports).length === 0) {
      throw new Error(
        `export-origins/${file} records zero exports for ${doc.entry}. Every published entry point ` +
          `of this package exports something, so an empty shard is a resolution failure, not a fact.`,
      );
    }
    byEntry.set(doc.entry, doc.exports);
  }
  return byEntry;
}

/**
 * Read once, at import time. Nothing in the GENERATOR's import graph reaches
 * this module — it is the reader, imported only by the pin tests — so a tree
 * with no artifact yet cannot deadlock on it: the bootstrap answer is to run
 * `gen:export-origins`, and the throw above says exactly that.
 */
const SHARDS = loadShards();

/** Every public TypeScript entry point, sorted — the pins' `Object.keys(entries)`. */
export const EXPORT_ENTRY_POINTS: readonly string[] = Object.freeze([...SHARDS.keys()].sort());

function exportsOf(entry: string): Record<string, string> {
  const found = SHARDS.get(entry);
  if (!found) {
    throw new Error(
      `no export-origins shard for entry point "${entry}". Known entries: ` +
        `${EXPORT_ENTRY_POINTS.join(', ')}. A typo here would silently assert nothing.`,
    );
  }
  return found;
}

/** Every name `entry` exports, sorted — the pins' `exportsOf(sub).map(e => e.getName())`. */
export function exportNamesOf(entry: string): string[] {
  return Object.keys(exportsOf(entry)).sort();
}

/**
 * The origin `entry` exports `name` from, or `undefined` when it does not
 * export that name — `<src path>#<declared name> (<kind>)`.
 *
 * Two exports share this string iff they are the same declaration, which is the
 * whole point: equal across two entries is a re-export, different under one
 * name is the #4411 dual-source trap.
 */
export function maybeOriginOf(entry: string, name: string): string | undefined {
  return exportsOf(entry)[name];
}

/** As `maybeOriginOf`, but a missing name is an error — the pins' `expect(sym).toBeTruthy()`. */
export function originOf(entry: string, name: string): string {
  const origin = maybeOriginOf(entry, name);
  if (origin === undefined) {
    throw new Error(`${entry} does not export \`${name}\` (export-origins/).`);
  }
  return origin;
}

/**
 * The whole `name → origin` map for one entry — the shape the cross-entry
 * conflict pins built by hand from `getExportsOfModule`, so their set algebra
 * carries over unchanged.
 */
export function originMapOf(entry: string): ReadonlyMap<string, string> {
  return new Map(Object.entries(exportsOf(entry)));
}

/** Just the declaring source path of an origin — `src/kernel/events/core.zod.ts`. */
export function originFile(origin: string): string {
  return origin.slice(0, origin.indexOf('#'));
}

/** The declaring source path `entry` exports `name` from. */
export function originFileOf(entry: string, name: string): string {
  return originFile(originOf(entry, name));
}

/** Every entry point that exports `name`, sorted — the pins' `holders` loop. */
export function holdersOf(name: string): string[] {
  return EXPORT_ENTRY_POINTS.filter((entry) => maybeOriginOf(entry, name) !== undefined);
}

/**
 * As `holdersOf`, paired with each holder's origin — the record shape the
 * retirement pins' own local `holdersOf` helper returned, so their assertion
 * bodies carry over unchanged.
 */
export function holderOriginsOf(name: string): Array<{ sub: string; origin: string }> {
  return holdersOf(name).map((sub) => ({ sub, origin: originOf(sub, name) }));
}

/**
 * Every distinct origin `name` resolves to across all entry points, sorted.
 *
 * One element = single-source (a re-export, however many entries carry it).
 * Two or more = dual-source. Zero = the name is gone from the public surface,
 * which is what a retirement pin asserts.
 */
export function originsOf(name: string): string[] {
  const seen = new Set<string>();
  for (const entry of EXPORT_ENTRY_POINTS) {
    const origin = maybeOriginOf(entry, name);
    if (origin !== undefined) seen.add(origin);
  }
  return [...seen].sort();
}

/**
 * Kinds that survive to runtime. `type` and `interface` are erased, and a
 * symbol that merges a value with a type reports the type kind — so this set
 * deliberately UNDER-claims. It never false-reds; what it misses is covered by
 * `check:export-origins`.
 */
const RUNTIME_KINDS = new Set(['const', 'function', 'class', 'enum']);

function kindOf(origin: string): string {
  const open = origin.lastIndexOf('(');
  return open < 0 ? 'other' : origin.slice(open + 1, origin.length - 1);
}

/**
 * The compiler-free freshness cross-check: the artifact's runtime-kind exports
 * for `entry` must be exactly the keys of its real namespace object.
 *
 * Call it with the entry's live namespace — `await import('../automation/index')`
 * — from a pin that reads this entry. It is what stops a doctored or stale
 * artifact from reading as a fact during a plain `pnpm test`, one lane before
 * `check:export-origins` would catch the same edit in CI.
 *
 * Returns the discrepancies rather than throwing, so the caller asserts them
 * with vitest and gets the diff in the failure output.
 */
export function runtimeParityOf(
  entry: string,
  namespace: object,
): { missingAtRuntime: string[]; missingFromArtifact: string[] } {
  const origins = exportsOf(entry);
  const runtimeNames = new Set(Object.keys(namespace));

  const missingAtRuntime = Object.keys(origins)
    .filter((name) => RUNTIME_KINDS.has(kindOf(origins[name])) && !runtimeNames.has(name))
    .sort();
  const missingFromArtifact = [...runtimeNames].filter((name) => !(name in origins)).sort();

  return { missingAtRuntime, missingFromArtifact };
}
