// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10420 — `SysMetadataRepository` under the SHARED repository contract suite.
 *
 * ## Why this file exists
 *
 * `runRepositoryContractTests` exists so that ONE table of invariants holds for
 * EVERY `MetadataRepository` implementation — its own header says so, and the
 * #7856 / #7992 serialized-form pins were deliberately put there rather than
 * beside either bug for that reason. Until this file, the suite had exactly two
 * call sites: `InMemoryRepository` and `FileSystemRepository` — the two
 * implementations that carry the TEST traffic. `SysMetadataRepository`, which
 * carries the PRODUCTION traffic (561 of 1,729 `put()` invocations in the #8006
 * census, including all four production call sites), was never handed to it.
 *
 * ⚠️ Green here is the EXPECTED outcome and is worth nothing on its own — the
 * card that ordered this file said so explicitly. What makes the coverage real
 * is that every clause is REACHED: a factory that quietly fails to wire up, or
 * an adaptation that skips the clauses an engine-backed repository cannot run,
 * produces exactly the same green and reads as coverage. So:
 *
 *   - the adaptation below adds NO wrapper between the suite and the
 *     repository — `factory()` returns the real `SysMetadataRepository`, and
 *     every `put`/`get`/`delete`/`list`/`history`/`watch` the suite issues goes
 *     straight into it, through its own authorization door;
 *   - the three dimensions the suite's `factory()` shape does not model —
 *     `state: 'draft' | 'active'`, `packageId`, org scoping — are pinned as
 *     facts at the bottom of this file rather than described in prose, so a
 *     later change that moves the suite off the paths it exercises today
 *     fails here instead of going quiet.
 *
 * ## The one thing that had to move in the shared suite
 *
 * Nothing about the invariants. The suite hard-coded its two FIXTURE metadata
 * types (`'view'` for almost everything, `'object'` for the one clause that
 * must prove a type filter discriminates), and `SysMetadataRepository` — unlike
 * the other two implementations — has a write-authorization door keyed on the
 * type: `assertAllowed()` refuses `'object'` under the default
 * `override-artifact` intent because its registry entry is
 * `allowOrgOverride: false`. So `ContractSuiteOptions` grew `primaryType` /
 * `secondaryType`, defaulting to today's values, and this call site names two
 * types the door admits. That keeps ONE invariant table; the alternative —
 * wrapping the repository in an adapter that injects `intent: 'runtime-only'` —
 * would have put a test-only shim between the suite and the subject, which is
 * precisely the "reads as coverage" failure above.
 */

import { describe, it, expect, afterEach } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` rather than
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  hashSpec,
} from '@objectstack/metadata-core';
import { runRepositoryContractTests } from '@objectstack/metadata-core/testing';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row {
  [k: string]: unknown;
}

/**
 * In-memory engine double honouring just enough of `SysMetadataEngine` to run
 * the shared contract suite: two tables (`sys_metadata` + `sys_metadata_history`)
 * and a `transaction()` with REAL rollback, so contract invariant 1 ("atomic
 * put — no half-states") is an observation here rather than an assumption.
 *
 * Its write verbs open with the producer's own dispatch predicates, so it
 * cannot accept a `delete`/`update` shape the real engine throws on — the
 * `check:engine-double-contract` rule, and the reason a green suite over a
 * loose double is not a suite at all.
 */
function makeFakeEngine() {
  let rows: Row[] = [];
  let historyRows: Row[] = [];
  let nextRowId = 1;

  /**
   * Predicate matching, deliberately EXACT-equality only. Anything the double
   * cannot answer faithfully throws instead of silently matching nothing —
   * a `$or` quietly treated as "no rows" is how a double stops standing in for
   * the engine while staying green.
   */
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
      if (v === undefined) return true;
      return row[k] === v;
    });

  const tableOf = (table: string): Row[] => (table === 'sys_metadata_history' ? historyRows : rows);

  return {
    /** Inspection seams for the implementation-specific pins below. */
    rows: () => rows.map((r) => ({ ...r })),
    historyRows: () => historyRows.map((r) => ({ ...r })),

    async find(
      table: string,
      opts: { where: Record<string, unknown>; limit?: number },
    ): Promise<Row[]> {
      const hits = tableOf(table).filter((r) => matches(r, opts.where));
      return typeof opts.limit === 'number' ? hits.slice(0, opts.limit) : hits;
    },
    async findOne(table: string, opts: { where: Record<string, unknown> }): Promise<Row | null> {
      return tableOf(table).find((r) => matches(r, opts.where)) ?? null;
    },
    async insert(table: string, data: Record<string, unknown>): Promise<{ id: string }> {
      const id = (data.id as string | undefined) ?? `r_${nextRowId++}`;
      tableOf(table).push({ ...data, id });
      return { id };
    },
    async update(
      table: string,
      data: Record<string, unknown>,
      opts: { where: Record<string, unknown> },
    ): Promise<{ id: string }> {
      assertEngineUpdateDispatch(data, opts);
      const row = tableOf(table).find((r) => matches(r, opts.where));
      if (!row) throw new Error('fake engine: update matched no row');
      Object.assign(row, data);
      return { id: row.id as string };
    },
    async delete(table: string, opts: { where: Record<string, unknown> }): Promise<{ deleted: number }> {
      assertEngineDeleteDispatch(opts);
      const target = tableOf(table);
      const idx = target.findIndex((r) => matches(r, opts.where));
      if (idx < 0) return { deleted: 0 };
      target.splice(idx, 1);
      return { deleted: 1 };
    },
    async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
      const rowsSnapshot = rows.map((r) => ({ ...r }));
      const historySnapshot = historyRows.map((r) => ({ ...r }));
      try {
        return await cb({ txn: true }, { owned: true });
      } catch (err) {
        rows = rowsSnapshot;
        historyRows = historySnapshot;
        throw err;
      }
    },
  };
}

/** Repos handed to the suite, so each case's instance is closed after it. */
const created: SysMetadataRepository[] = [];

afterEach(() => {
  while (created.length) {
    try {
      created.pop()!.close();
    } catch {
      /* ignore */
    }
  }
});

function makeRepo(): SysMetadataRepository {
  const repo = new SysMetadataRepository({
    engine: makeFakeEngine(),
    // The env-wide overlay scope. `orgLabel: 'system'` is what makes
    // `fullRef().org` agree with the suite's `refOf()` — the repository ignores
    // `ref.org` and stamps its own, which is exactly the single-org shape the
    // "different orgs have independent sequences" clause is written to skip.
    organizationId: null,
    orgLabel: 'system',
  });
  created.push(repo);
  return repo;
}

runRepositoryContractTests('SysMetadataRepository', makeRepo, {
  // Both types must clear `assertAllowed()` under the suite's default
  // `override-artifact` intent, i.e. both are `allowOrgOverride: true` in
  // `DEFAULT_METADATA_TYPE_REGISTRY`. `'object'` — the suite's default second
  // type — is not, on purpose (packaged objects are locked); `'dashboard'` is.
  primaryType: 'view',
  secondaryType: 'dashboard',
  // #10842 — the one invariant this implementation does NOT satisfy, found by
  // this very file: `watch()` registers an in-memory listener and reads `since`
  // only as a drop-filter on live events, so it never replays from
  // `sys_metadata_history`. Declaring it does not skip the clauses: the suite
  // swaps in two that pin the divergence and re-ask the filter question over
  // the live stream, so this line has to be deleted the day replay lands.
  // Not fixed here — both production `watch()` consumers subscribe with no
  // `since`, so a full-log replay would flood HMR and cache invalidation at
  // every `setRepository()`, and what `watch()` with no `since` owes is not
  // written in `repository.ts` at all. #10842 carries the fork.
  declaredDivergences: { resumableWatch: '#10842' },
});

/**
 * The three dimensions `runRepositoryContractTests`' `factory()` shape does not
 * model. The suite drives each of them at its DEFAULT, and that is a fact about
 * which paths the coverage above actually reaches — so it is asserted here
 * rather than asserted in a comment.
 */
describe('SysMetadataRepository — what the contract suite does and does not reach', () => {
  it('every suite write lands on the ACTIVE row; no draft row is ever created', async () => {
    const engine = makeFakeEngine();
    const repo = new SysMetadataRepository({ engine, organizationId: null, orgLabel: 'system' });
    created.push(repo);
    const ref = { org: 'system', type: 'view' as const, name: 'sample_view' };

    const a = await repo.put(ref, { label: 'x' }, { parentVersion: null, actor: 't' });
    await repo.put(ref, { label: 'y' }, { parentVersion: a.version, actor: 't' });

    const states = engine.rows().map((r) => r.state);
    expect(states).toEqual(['active']);
    expect(await repo.listDrafts()).toEqual([]);
  });

  it('every suite write lands on the UNBOUND row — `package_id` is null throughout', async () => {
    const engine = makeFakeEngine();
    const repo = new SysMetadataRepository({ engine, organizationId: null, orgLabel: 'system' });
    created.push(repo);
    const ref = { org: 'system', type: 'view' as const, name: 'sample_view' };

    await repo.put(ref, { label: 'x' }, { parentVersion: null, actor: 't' });

    expect(engine.rows().map((r) => r.package_id)).toEqual([null]);
  });

  it('is single-org: `ref.org` is ignored, which is WHY the multi-org clause self-skips', async () => {
    const engine = makeFakeEngine();
    const repo = new SysMetadataRepository({ engine, organizationId: null, orgLabel: 'system' });
    created.push(repo);
    const orgA = { org: 'org_a', type: 'view' as const, name: 'sample_view' };
    const orgB = { org: 'org_b', type: 'view' as const, name: 'sample_view' };

    const a = await repo.put(orgA, { label: 'a1' }, { parentVersion: null, actor: 't' });
    // The row `orgA` created is the row `orgB` collides with: one scope, one
    // row, so the second create is a ConflictError. The shared suite's
    // "different orgs have independent sequences" clause catches exactly this
    // and returns — it is SKIPPED for this implementation, not passed.
    await expect(
      repo.put(orgB, { label: 'b1' }, { parentVersion: null, actor: 't' }),
    ).rejects.toThrow();
    expect(engine.rows()).toHaveLength(1);
    expect(engine.rows()[0]!.organization_id).toBeNull();
    // …and the ref it stamps back is this repository's own label, not the
    // caller's.
    const got = await repo.get(orgA);
    expect(got!.ref.org).toBe('system');
    expect(got!.hash).toBe(a.version);
    expect(got!.hash).toBe(hashSpec(got!.body));
  });
});
