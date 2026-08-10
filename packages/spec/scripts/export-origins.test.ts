// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The export-origins baseline's own pin (#4796).
 *
 * Seventeen export-surface pins now compare against `export-origins/` instead
 * of each building a `ts.createProgram`. That trade is only sound while the
 * artifact is a faithful description of the source, so the two claims it rests
 * on are asserted here rather than assumed:
 *
 *   1. the reader and the writer agree on the shard layout — the reader cannot
 *      import the writer's naming function (`rootDir: ./src`), so the agreement
 *      is measured over the real artifact instead of shared;
 *   2. the compiler-free freshness cross-check actually discriminates. A guard
 *      that would pass over a doctored artifact is worse than no guard, because
 *      it reads as coverage.
 *
 * What is deliberately NOT here: a re-derivation of the origins from source.
 * That is `check:export-origins`, it costs a full `tsc` program, and running it
 * inside vitest would reintroduce the exact ~3.4s-per-case compilation this
 * change removed.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
  maybeOriginOf,
  originFile,
  originOf,
  originsOf,
  runtimeParityOf,
} from './lib/export-origins-testkit';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINS_DIR = resolve(PKG_DIR, 'export-origins');

/**
 * The entry points, with the module each one really is. Written out rather than
 * derived from `EXPORT_ENTRY_POINTS` so the runtime cross-check below reads the
 * REAL namespaces: a derived dynamic import built from the artifact's own keys
 * would let a doctored artifact choose what it is compared against.
 */
const ENTRY_NAMESPACES: ReadonlyArray<[string, () => Promise<object>]> = [
  ['.', () => import('../src/index')],
  ['./ai', () => import('../src/ai/index')],
  ['./api', () => import('../src/api/index')],
  ['./automation', () => import('../src/automation/index')],
  ['./cloud', () => import('../src/cloud/index')],
  ['./contracts', () => import('../src/contracts/index')],
  ['./data', () => import('../src/data/index')],
  ['./identity', () => import('../src/identity/index')],
  ['./integration', () => import('../src/integration/index')],
  ['./kernel', () => import('../src/kernel/index')],
  ['./qa', () => import('../src/qa/index')],
  ['./security', () => import('../src/security/index')],
  ['./shared', () => import('../src/shared/index')],
  ['./studio', () => import('../src/studio/index')],
  ['./system', () => import('../src/system/index')],
  ['./ui', () => import('../src/ui/index')],
];

describe('[#4796] export-origins/ — the baseline the export-surface pins compare against', () => {
  it('covers exactly the TypeScript entry points package.json publishes', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    // The same filter the generator and the retired pins used: `.` plus
    // `./<name>`, minus the two JSON subpaths, which are not modules.
    const published = Object.keys(pkg.exports)
      .filter((sub) => sub === '.' || /^\.\/[a-z-]+$/.test(sub))
      .sort();

    expect(published.length).toBeGreaterThan(10);
    expect([...EXPORT_ENTRY_POINTS]).toEqual(published);
    // …and the hand-written table below covers all of them, so no entry point
    // can escape the runtime cross-check by simply not being listed.
    expect(ENTRY_NAMESPACES.map(([entry]) => entry).sort()).toEqual(published);
  });

  it('every shard filename round-trips to the entry it declares', () => {
    // The reader's `entryForShardName` duplicates the writer's
    // `shardNameForEntry` because it cannot import it. This is where the two
    // are measured against each other, over the bytes on disk.
    const shardFiles = readdirSync(ORIGINS_DIR).filter((f) => f.endsWith('.json'));
    expect(shardFiles.length).toBe(EXPORT_ENTRY_POINTS.length);

    for (const file of shardFiles) {
      const doc = JSON.parse(readFileSync(resolve(ORIGINS_DIR, file), 'utf8')) as {
        entry: string;
        description: string;
        exports: Record<string, string>;
      };
      const base = file.slice(0, -'.json'.length);
      expect(doc.entry, `${file} must declare the entry its filename names`).toBe(
        base === 'root' ? '.' : `./${base}`,
      );
      expect(doc.description, `${file} must carry the shard description`).toContain('#4796');
      expect(Object.keys(doc.exports).length).toBeGreaterThan(0);
    }
  });

  it('every origin is a declaring file, a declared name and a kind', () => {
    let checked = 0;
    let external = 0;
    for (const entry of EXPORT_ENTRY_POINTS) {
      for (const name of exportNamesOf(entry)) {
        const origin = originOf(entry, name);
        // `src/…` for this package's own declarations; `node_modules/<pkg>/…`
        // for the handful `./contracts` re-exports from `ai` — recorded with
        // the pnpm store's version/peer segments normalised away, so a
        // dependency bump does not rewrite the artifact.
        expect(origin, `${entry} → ${name}`).toMatch(
          /^(src|node_modules)\/[\w@./-]+\.ts#[\w$]+ \([a-z]+\)$/,
        );
        if (origin.startsWith('node_modules/')) {
          expect(origin, `${entry} → ${name} must not carry a pnpm store path`).not.toContain('.pnpm');
          external++;
        }
        checked++;
      }
    }
    // The external re-exports really are covered by the normalisation above —
    // without this the `.pnpm` assertion could hold by never running.
    expect(external).toBeGreaterThan(0);
    // Anti-vacuity: the loop above ran over the real surface. A resolution
    // failure that emptied the artifact would otherwise pass this silently.
    expect(checked).toBeGreaterThan(3000);
  });

  it.each(ENTRY_NAMESPACES)(
    '%s: the artifact agrees with the real runtime namespace (compiler-free freshness guard)',
    async (entry, load) => {
      const namespace = await load();
      const { missingAtRuntime, missingFromArtifact } = runtimeParityOf(entry, namespace);

      expect(
        missingAtRuntime,
        `${entry}: export-origins records these as runtime values, but the module does not export ` +
          `them — the artifact is stale or hand-edited. Run \`pnpm --filter @objectstack/spec ` +
          `gen:export-origins\`.`,
      ).toEqual([]);
      expect(
        missingFromArtifact,
        `${entry}: the module exports these at runtime and export-origins does not record them — ` +
          `the artifact is stale. Run \`pnpm --filter @objectstack/spec gen:export-origins\`.`,
      ).toEqual([]);

      // Anti-vacuity for the guard itself: two empty lists satisfy both
      // assertions above, so the comparison must be shown to have had
      // something to compare. `./qa` publishes 8 runtime values — the floor is
      // "this entry resolved at all", not a size claim about any entry.
      expect(Object.keys(namespace).length, `${entry} resolved an empty namespace`).toBeGreaterThan(0);
      expect(
        exportNamesOf(entry).filter((name) => name in namespace).length,
        `${entry}: no artifact name matched the runtime namespace — nothing was compared`,
      ).toBeGreaterThan(0);
    },
  );

  it('the freshness guard is DISCRIMINATING — it rejects a doctored namespace', async () => {
    const real = await import('../src/automation/index');

    // Same shape as the real check, against a namespace missing one runtime
    // export. If this passed, the guard above would be decoration.
    const withoutOne = { ...real } as Record<string, unknown>;
    expect('StateMachineSchema' in withoutOne).toBe(true);
    delete withoutOne.StateMachineSchema;
    expect(runtimeParityOf('./automation', withoutOne).missingAtRuntime).toEqual([
      'StateMachineSchema',
    ]);

    // …and against one carrying an export the artifact does not know.
    const withExtra = { ...real, __smuggled__: 1 };
    expect(runtimeParityOf('./automation', withExtra).missingFromArtifact).toEqual(['__smuggled__']);
  });

  it('the query primitives answer the three questions the pins ask', () => {
    // 1. does an entry export the name? — the retirement pins' question.
    expect(maybeOriginOf('./automation', 'StateMachineSchema')).toBeDefined();
    expect(maybeOriginOf('./automation', 'NoSuchExportAnywhere')).toBeUndefined();
    expect(holdersOf('NoSuchExportAnywhere')).toEqual([]);

    // 2. which file declares it? — the single-source pins' question.
    expect(originFile(originOf('./kernel', 'EventSchema'))).toBe('src/kernel/events/core.zod.ts');

    // 3. one declaration or several? — the dual-source pins' question.
    expect(originsOf('EventSchema')).toHaveLength(1);
    expect(originsOf('NoSuchExportAnywhere')).toEqual([]);
    // A name genuinely re-exported from several entries still resolves to one
    // declaration — the property that makes `originsOf(...).length === 1` a
    // meaningful single-source assertion rather than a count of entries.
    // `defineAgent` stands on `./ai` and on the root entry.
    expect(holdersOf('defineAgent')).toEqual(['.', './ai']);
    expect(originsOf('defineAgent')).toHaveLength(1);
  });
});
