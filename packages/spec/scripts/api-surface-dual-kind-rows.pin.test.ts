// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dual-kind row pin (#15919) — the committed `api-surface/` shards must record
 * BOTH halves of a name that is declared as a const and as a type.
 *
 * ## What went wrong, and why the gate could not see it
 *
 * TypeScript merges `export const X` and `export type X` into ONE symbol whose
 * flags carry both. `build-api-surface.ts` used to map that symbol through a
 * first-match-wins `kindOf` that tested `TypeAlias` before `Variable`, so the
 * shard recorded `X (type)` and nothing else — the value half was never
 * enumerated. Ablated on `origin/main`: deleting `export const
 * RestApiRouteRegistration` while keeping `export type RestApiRouteRegistration`
 * left all 17 shards byte-identical, the export total unmoved and
 * `check:api-surface` printing "public API surface + factory signatures
 * unchanged" at exit 0 — on a removed public value export, which is the exact
 * removal ADR-0059's breadth gate exists to make loud.
 *
 * ## Why this pin exists ON TOP of `check:api-surface`
 *
 * `check:api-surface` compares the generator against its own committed output,
 * so it cannot notice the generator becoming less complete: revert
 * `kindsOf` and regenerate, and the gate is green again on a surface that has
 * silently dropped 130-odd value exports. This pin reads the COMMITTED shards
 * and asserts the property directly, so that regression is loud even when the
 * baseline is regenerated in the same commit.
 *
 * ## The controls
 *
 * A pin that only asserted "some name carries two kinds" would also pass on a
 * generator that stamped every kind onto every name. So the negative controls
 * are asserted in the same run and out of the same parse: const-only names and
 * type-only names must both still exist. Together with the non-empty aggregate,
 * a silently emptied or uniformly-stamped surface fails here rather than
 * reading as agreement.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { aggregateApiSurfaceShards, API_SURFACE_DIR_NAME } from './lib/sharded-artifacts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SURFACE_DIR = path.resolve(HERE, '..', API_SURFACE_DIR_NAME);

const ROW = /^(\S+) \((\w+)\)$/;

const read = aggregateApiSurfaceShards(SURFACE_DIR);
if (!read) throw new Error(`no api-surface shards at ${SURFACE_DIR}`);
const SURFACE: Record<string, string[]> = read.surface;

/** `entry -> name -> kinds`, parsed out of the committed shards. */
function readKinds(): { byEntry: Map<string, Map<string, Set<string>>>; rows: number } {
  const byEntry = new Map<string, Map<string, Set<string>>>();
  let rows = 0;
  for (const [entry, names] of Object.entries(SURFACE)) {
    const kinds = new Map<string, Set<string>>();
    for (const row of names) {
      const m = ROW.exec(row);
      if (!m) throw new Error(`cannot parse row "${row}" under "${entry}"`);
      rows++;
      let set = kinds.get(m[1]);
      if (!set) kinds.set(m[1], (set = new Set()));
      set.add(m[2]);
    }
    byEntry.set(entry, kinds);
  }
  return { byEntry, rows };
}

const { byEntry, rows } = readKinds();

/** Every name in the artifact, collapsed across entry points. */
const allNames = [...byEntry.values()].flatMap((kinds) => [...kinds.entries()]);

describe('api-surface records one row per declared kind (#15919)', () => {
  it('parsed a non-empty artifact — the control that makes every assertion below a reading', () => {
    // Without this, an empty or unreadable `api-surface/` would satisfy every
    // "no name is wrong" assertion vacuously.
    expect(byEntry.size).toBeGreaterThan(10);
    expect(rows).toBeGreaterThan(1000);
  });

  it('records both halves of `EpochMs`, the worked example from the card', () => {
    // `packages/spec/src/shared/epoch.zod.ts` declares the name twice:
    //   export const EpochMs = z.number().int()…
    //   export type  EpochMs = z.input<typeof EpochMs>
    // Before #15919 `./shared` carried `EpochMs (type)` alone.
    const shared = byEntry.get('./shared');
    expect(shared, 'the ./shared entry point must exist').toBeDefined();
    expect(shared!.get('EpochMs')).toEqual(new Set(['const', 'type']));
  });

  it('carries a real population of dual-declared names, not one special case', () => {
    const dual = allNames.filter(([, kinds]) => kinds.has('const') && kinds.has('type'));
    // Measured at 134 (name, entry) pairs over 10 entry points when the repair
    // landed. Asserted as a floor, not an equality: this family grows with
    // every new `z.enum` idiom in the spec, and a pin that reddened on ordinary
    // growth would be edited away rather than believed.
    expect(dual.length).toBeGreaterThanOrEqual(100);
  });

  it('NEGATIVE CONTROL: does not stamp every kind onto every name', () => {
    // If the emitter had gone from "first match wins" to "everything always",
    // these two buckets would be empty and the assertion above would pass on a
    // meaningless artifact.
    const constOnly = allNames.filter(([, k]) => k.size === 1 && k.has('const'));
    const typeOnly = allNames.filter(([, k]) => k.size === 1 && k.has('type'));
    expect(constOnly.length).toBeGreaterThan(0);
    expect(typeOnly.length).toBeGreaterThan(0);
  });

  it('never records the same name twice under one kind in one entry point', () => {
    // The row grammar is unchanged by #15919: rows are still `Name (kind)` and
    // a (name, kind) pair is still unique per entry. Two rows for one name are
    // two DIFFERENT kinds, never a duplicate.
    for (const [entry, names] of Object.entries(SURFACE)) {
      expect(new Set(names).size, `${entry} has duplicate rows`).toBe(names.length);
    }
  });
});
