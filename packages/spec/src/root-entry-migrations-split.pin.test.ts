// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: the ADR-0087 migration chain lives on `@objectstack/spec/migrations`,
 * never on the package root (#20646).
 *
 * The migration registry is mostly the guidance text `objectstack migrate meta`
 * prints, and it does work when its module loads (the list of majors and each
 * step's rationale are computed then). A consumer's bundler therefore cannot
 * prove it unused, so whichever entry's module graph reaches it carries ALL of
 * it into every bundle of that entry. While the root re-exported it, that was
 * 1,761,987 of the root ESM bundle's 3,766,221 bytes, downloaded by every
 * browser first screen that imports any root name. It moved to its own subpath;
 * the conversion layer (ADR-0087 D2) stays on the root, because `defineStack` /
 * `normalizeStackInput` read it at run time.
 *
 * Nothing else holds that boundary. `browser-reachable-entries.json` leaves
 * both entries unjudged and no gate weighs a bundle, so one `export *` in
 * `./index.ts` — or one value import of a registry name from any module the
 * root reaches — would put the text back into every root bundle with every
 * gate green. So this holds four things:
 *
 *  1. the root module exports none of the moved names, and `./migrations`
 *     exports every one of them (the runtime namespaces, read from source);
 *  2. the root api-surface shard lists none of them, types included, and the
 *     `./migrations` shard lists all of them (the published declarations);
 *  3. the root's STATIC value-import graph does not reach
 *     `migrations/registry.ts` at all — the edge a bundler follows, which a
 *     re-export check alone would miss;
 *  4. the exports map publishes `./migrations` to the built files.
 *
 * Each negative half has a positive control on the same instrument, so a walk
 * or a read that silently stopped seeing anything fails instead of passing.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from './index';
import * as migrations from './migrations/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = HERE;
const PKG = resolve(HERE, '..');

/** The runtime values that left the root for `./migrations`. */
const MOVED_VALUES = [
  'MIGRATIONS_BY_MAJOR',
  'MIGRATION_MAJORS',
  'MIGRATION_SUPPORT_FLOOR',
  'RETIRED_DEFS_BY_MAJOR',
  'RETIRED_KEYS_BY_MAJOR',
  'applyMetaMigrations',
  'composeMigrationChain',
  'MigrationFloorError',
  'composeReleaseChanges',
  'composeSpecChanges',
  'SpecChangesSchema',
  'SpecConvertedSchema',
  'SpecMigratedSchema',
  'SpecSurfaceAddSchema',
  'SpecReleaseChangesSchema',
  'SpecReleaseSurfaceSchema',
  'SpecSurfaceRemoveSchema',
] as const;

/** The types that left with them — visible only in the published declarations. */
const MOVED_TYPES = [
  'MigrationApplication',
  'MigrationChainResult',
  'MigrationHopResult',
  'MigrationStep',
  'MigrationTodo',
  'SemanticMigration',
  'PreviousReleaseRegistries',
  'ReleaseSurfaceDiff',
  'SpecChanges',
  'SpecConverted',
  'SpecMigrated',
  'SpecReleaseChanges',
  'SpecReleaseSurface',
  'SpecSurfaceAdd',
  'SpecSurfaceRemove',
  'SurfaceDiff',
] as const;

/** The conversion layer: it stays on the root, read by the authoring funnel. */
const STAYING_CONVERSION_VALUES = [
  'ALL_CONVERSIONS',
  'CONVERSIONS_BY_MAJOR',
  'applyConversions',
  'applyConversionsToStoredItem',
] as const;

/** The names an api-surface shard lists, `name (kind)` → `name`. */
function shardNames(entry: string): Set<string> {
  const shard = JSON.parse(readFileSync(resolve(PKG, 'api-surface', `${entry}.json`), 'utf8')) as {
    exports: string[];
  };
  return new Set(shard.exports.map((row) => row.replace(/ \([a-z-]+\)$/, '')));
}

// A relative specifier in a value-bearing `import … from` / `export … from`
// statement, or a bare side-effect `import '…'`. Statements that open with
// `import type` / `export type` are dropped before this runs: they are erased
// at build time and cost a bundle nothing. (The walker of
// `api/api-entry-graph.pin.test.ts`, same rules.)
const EDGE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
const TYPE_ONLY = /(?:^|\n)\s*(?:import|export)\s+type\s[^;]*?from\s*['"][^'"]+['"]\s*;?/g;

function resolveSpecifier(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  // An unresolved edge would make the walk incomplete, and an incomplete walk
  // reporting "not reached" is the false green this pin exists to prevent.
  throw new Error(`unresolved relative import ${spec} in ${relative(SRC, fromFile)}`);
}

function valueGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    // Comment lines are dropped line by line, never with a `/* … */` regex:
    // glob strings such as `src/**/*.ts` would open a false comment.
    const source = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n')
      .replace(TYPE_ONLY, '\n');
    for (const m of source.matchAll(EDGE)) {
      queue.push(resolveSpecifier(file, (m[1] ?? m[2])!));
    }
  }
  return new Set([...seen].map((f) => relative(SRC, f).split('\\').join('/')));
}

describe('the migration chain is `@objectstack/spec/migrations`, not the root (#20646)', () => {
  it('the root module exports none of the moved values', () => {
    expect(MOVED_VALUES.filter((name) => name in root)).toEqual([]);
  });

  it('`./migrations` exports every moved value, and nothing it exports is on the root', () => {
    expect(MOVED_VALUES.filter((name) => !(name in migrations))).toEqual([]);
    // Every runtime name of the subpath, not only the declared list: a name
    // added to `./migrations` later must not also appear on the root.
    const namespace = Object.keys(migrations);
    expect(namespace.length).toBeGreaterThanOrEqual(MOVED_VALUES.length);
    expect(namespace.filter((name) => name in root)).toEqual([]);
  });

  it('positive control: the conversion layer is still on the root', () => {
    expect(STAYING_CONVERSION_VALUES.filter((name) => !(name in root))).toEqual([]);
  });

  it('the root api-surface shard lists none of the moved names, types included', () => {
    const rootShard = shardNames('root');
    expect([...MOVED_VALUES, ...MOVED_TYPES].filter((name) => rootShard.has(name))).toEqual([]);
    // Positive control on the same read: the shard is the real root surface.
    expect(STAYING_CONVERSION_VALUES.filter((name) => !rootShard.has(name))).toEqual([]);
  });

  it('the `./migrations` api-surface shard lists every moved name', () => {
    const migrationsShard = shardNames('migrations');
    expect([...MOVED_VALUES, ...MOVED_TYPES].filter((name) => !migrationsShard.has(name))).toEqual([]);
  });

  it('the root value-import graph does not reach the migration registry', () => {
    const rootGraph = valueGraph('index.ts');
    expect([...rootGraph].filter((f) => f.startsWith('migrations/'))).toEqual([]);
    // Anti-vacuity: the walk covers the root's real graph, conversions included
    // (134 value-graph modules when the split landed; far below that means the
    // edge pattern stopped matching, not that the entry shrank).
    expect(rootGraph.size).toBeGreaterThan(100);
    expect(rootGraph.has('conversions/registry.ts')).toBe(true);
  });

  it('positive control: the same walk DOES reach the registry from `./migrations`', () => {
    expect(valueGraph('migrations/index.ts').has('migrations/registry.ts')).toBe(true);
  });

  it('the exports map publishes `./migrations` to the built entry', () => {
    const manifest = JSON.parse(readFileSync(resolve(PKG, 'package.json'), 'utf8')) as {
      exports: Record<string, { import?: { types?: string; default?: string }; require?: { types?: string; default?: string } }>;
    };
    expect(manifest.exports['./migrations']).toEqual({
      import: { types: './dist/migrations/index.d.mts', default: './dist/migrations/index.mjs' },
      require: { types: './dist/migrations/index.d.ts', default: './dist/migrations/index.js' },
    });
  });
});
