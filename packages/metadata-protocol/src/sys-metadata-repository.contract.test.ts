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
  hashSpec, assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { runRepositoryContractTests } from '@objectstack/metadata-core/testing';
import type { MetadataEvent, WatchFilter } from '@objectstack/metadata-core';
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
      assertEngineFindOnePredicate(table, opts);
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
  // #10842 — the `declaredDivergences: { resumableWatch: '#10842' }` line that
  // stood here is GONE, deleted by the PR that made invariant 6 true for this
  // implementation: `watch(filter, since)` now replays from
  // `sys_metadata_history` before going live. The pin clause the declaration
  // swapped in went red the moment replay landed, which is the mechanism
  // working — it is what told this call site to delete the line rather than
  // let a fixed divergence keep being declared.
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

/**
 * #10842 — invariant 6's TWO halves, pinned where they are implementation
 * facts rather than table entries.
 *
 * The shared suite asserts the floor every `MetadataRepository` owes and
 * deliberately carries no per-implementation column — that is the property
 * that keeps it one table. The half below is precisely per-implementation:
 * `repository.ts` says a `watch()` with no `since` MAY additionally replay,
 * and `SysMetadataRepository` is the implementation that does NOT. That is a
 * load-bearing choice, not an omission, so it is pinned here.
 *
 * ⛔ Why it is load-bearing: both production subscribers attach with no
 * `since` — `MetadataManager.startRepositoryWatch()` issues `repo.watch({})`
 * from `setRepository()`, and `MetadataCache.start()` issues
 * `repo.watch(this.watchFilter)`. Every event they receive invalidates a
 * registry entry, drops the `list()` cache and re-emits to every watcher
 * (ObjectQLPlugin, Studio HMR). A replay here means the org's whole
 * `sys_metadata_history` arrives as "this just changed" at every attach —
 * thousands of rows on a mature environment. That flood is the option the
 * maintainer explicitly declined, so its absence gets a test, not a comment.
 */
describe('SysMetadataRepository — invariant 6, both halves (#10842)', () => {
  const ref = { org: 'system', type: 'view' as const, name: 'sample_view' };

  /** Drain up to `n` events, or until `timeoutMs` elapses. Never throws. */
  async function drain(
    iter: AsyncIterator<MetadataEvent>,
    n: number,
    timeoutMs: number,
  ): Promise<MetadataEvent[]> {
    const out: MetadataEvent[] = [];
    const deadline = Date.now() + timeoutMs;
    while (out.length < n) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const r = await Promise.race([
        iter.next(),
        new Promise<IteratorResult<MetadataEvent>>((resolve) =>
          setTimeout(() => resolve({ value: undefined as any, done: true }), remaining),
        ),
      ]);
      if (r.done) break;
      out.push(r.value);
    }
    return out;
  }

  // ── THE ACCIDENTAL-OPTION-A GUARD ──────────────────────────────────────
  //
  // ⛔ This case FAILS if `watch()` ever starts replaying without `since`.
  // That is its entire job: it is the falsifiable form of the sentence
  // `repository.ts` now carries, and the tripwire on the attach-time flood.
  it.each([
    ['MetadataManager.startRepositoryWatch()', {}],
    ['MetadataCache.start() with the default filter', {}],
    ['MetadataCache.start() with a type filter', { type: 'view' as const }],
  ])('replays NOTHING at attach time for %s', async (_label, filter) => {
    const repo = makeRepo();
    const a = await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });
    await repo.put(ref, { label: '2' }, { parentVersion: a.version, actor: 't' });

    // Two events are committed and durably logged. A no-`since` subscriber is
    // owed none of them.
    const iter = repo.watch(filter)[Symbol.asyncIterator]();
    expect(await drain(iter, 5, 250)).toEqual([]);
    await iter.return?.(undefined);
  });

  it('…and the same no-`since` subscriber still receives what commits AFTER it attached', async () => {
    const repo = makeRepo();
    const a = await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });

    const iter = repo.watch({})[Symbol.asyncIterator]();
    const pending = drain(iter, 1, 2000);
    const b = await repo.put(ref, { label: '2' }, { parentVersion: a.version, actor: 't' });

    expect((await pending).map((e) => e.seq)).toEqual([b.seq]);
    await iter.return?.(undefined);
  });

  // ── FACE 1 — the durable replay ────────────────────────────────────────

  it('a numeric `since` replays `seq > since` from `sys_metadata_history`, in seq order, then goes live', async () => {
    const repo = makeRepo();
    const a = await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });
    const b = await repo.put(ref, { label: '2' }, { parentVersion: a.version, actor: 't' });
    const c = await repo.put(ref, { label: '3' }, { parentVersion: b.version, actor: 't' });

    const iter = repo.watch({ org: 'system' }, a.seq)[Symbol.asyncIterator]();
    // b and c committed BEFORE the subscription and are replayed out of the
    // durable log — the read this repository used to never issue.
    expect((await drain(iter, 2, 2000)).map((e) => e.seq)).toEqual([b.seq, c.seq]);

    const pending = drain(iter, 1, 2000);
    const d = await repo.put(ref, { label: '4' }, { parentVersion: c.version, actor: 't' });
    expect((await pending).map((e) => e.seq)).toEqual([d.seq]);
    await iter.return?.(undefined);
  });

  it('the replayed event carries the ROW’s own (type, name), not the filter’s', async () => {
    const repo = makeRepo();
    const view = await repo.put(ref, { label: 'v' }, { parentVersion: null, actor: 't' });
    await repo.put(
      { org: 'system', type: 'dashboard', name: 'board' },
      { label: 'd' },
      { parentVersion: null, actor: 't' },
    );

    // Org-wide watch: the replay is org-scoped, so the two rows must come back
    // wearing their own refs. A mapping that stamped one ref on every row (the
    // shape `history()` legitimately uses, because it resolved a single ref
    // first) would pass a same-type fixture and silently mislabel this one.
    const iter = repo.watch({ org: 'system' }, view.seq - 1)[Symbol.asyncIterator]();
    const got = await drain(iter, 2, 2000);
    expect(got.map((e) => `${e.ref.type}/${e.ref.name}`)).toEqual([
      'view/sample_view',
      'dashboard/board',
    ]);
    await iter.return?.(undefined);
  });

  it('an event committing DURING the durable read is delivered exactly once', async () => {
    const base = makeFakeEngine();
    let onHistoryRead: (() => void) | null = null;
    const gated = {
      ...base,
      async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
        if (table === 'sys_metadata_history' && onHistoryRead) {
          const fire = onHistoryRead;
          onHistoryRead = null;
          fire();
          // Hold the read open long enough for the interleaved write to commit
          // and broadcast, so the same event is in BOTH the replay batch and
          // the live queue — which is the seam `delivered` exists to close.
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return base.find(table, opts);
      },
    };
    const repo = new SysMetadataRepository({
      engine: gated,
      organizationId: null,
      orgLabel: 'system',
    });
    created.push(repo);

    const a = await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });
    const b = await repo.put(ref, { label: '2' }, { parentVersion: a.version, actor: 't' });

    let cSeq = -1;
    onHistoryRead = () => {
      void repo
        .put(ref, { label: '3' }, { parentVersion: b.version, actor: 't' })
        .then((r) => {
          cSeq = r.seq;
        });
    };
    const iter = repo.watch({ org: 'system' }, a.seq)[Symbol.asyncIterator]();

    // Ask for THREE; only two exist. The third slot is what would catch a
    // duplicate, so the assertion is on the whole drained list, not a prefix.
    const got = await drain(iter, 3, 2000);
    expect(cSeq).toBeGreaterThan(0);
    expect(got.map((e) => e.seq)).toEqual([b.seq, cSeq]);
    await iter.return?.(undefined);
  });

  it('a durable-read failure reaches the consumer instead of silently degrading to live-only', async () => {
    const base = makeFakeEngine();
    let failHistoryReads = false;
    const flaky = {
      ...base,
      async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
        if (table === 'sys_metadata_history' && failHistoryReads) {
          throw new Error('connection reset');
        }
        return base.find(table, opts);
      },
    };
    const repo = new SysMetadataRepository({
      engine: flaky,
      organizationId: null,
      orgLabel: 'system',
    });
    created.push(repo);

    const a = await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });
    await repo.put(ref, { label: '2' }, { parentVersion: a.version, actor: 't' });

    failHistoryReads = true;
    const iter = repo.watch({ org: 'system' }, a.seq)[Symbol.asyncIterator]();
    // A consumer that asked to resume from `a.seq` and got a quiet live tail
    // would believe it holds events it does not hold. #4867's rule, one seam
    // over: a cursor we could not read is not a cursor we may invent.
    await expect(iter.next()).rejects.toThrow('connection reset');
    await iter.return?.(undefined);
  });
});

/**
 * #11021 — what `close()` owes a pending iterator.
 *
 * `close()` used to model shutdown as a metadata EVENT: it broadcast a
 * synthetic `{ seq: -1, ref: { org: '', type: 'view', name: '_close' } }`
 * through the same `dispatch` closure every real event passes, and then
 * cleared the watcher set. Both of that closure's guards reject it:
 *
 *   - `matchesFilter` — the synthetic ref's org is the EMPTY STRING and its
 *     type is always `view`, so any subscription naming an `org`, a `type`
 *     other than `view`, or a `name` drops it;
 *   - the `since` drop — `-1 <= since` holds against every real seq, so every
 *     numeric-`since` subscription drops it too.
 *
 * Dropped, and then unsubscribed by `watchers.clear()`: nothing could ever
 * settle the promise, and the consumer's `for await` never returned. The
 * matrix below is the one the card was filed on, plus the row that is easy to
 * misread — an EMPTY filter with no `since` passed both guards, so the pending
 * pull settled, but it settled with `done: false` carrying the synthetic event
 * as though a view named `_close` had been deleted at seq -1. The iterator
 * then hung on the NEXT pull just like the other two.
 *
 * The repair is that shutdown is not an event. `close()` runs the same
 * termination routine `iterator.return()` runs, on every live watcher — which
 * is what these cases assert, and it is why the assertion is on `done: true`
 * with NO value rather than on "something arrived".
 */
describe('SysMetadataRepository — close() terminates every live watcher (#11021)', () => {
  const ref = { org: 'system', type: 'view' as const, name: 'sample_view' };

  const PENDING = Symbol('still-pending');

  /**
   * Settle-or-report-pending. Every case here has to tell "settled with
   * `done: true`" apart from "still unsettled", and a bare `await` on the
   * unsettled shape hangs the RUN rather than failing the case.
   */
  function within<T>(p: Promise<T>, ms: number): Promise<T | typeof PENDING> {
    return Promise.race([
      p,
      new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), ms)),
    ]);
  }

  /**
   * Let the durable-replay promise settle, so the pull under test is genuinely
   * PARKED on the live listener rather than still inside `await replayReady`.
   * Without this the numeric-`since` row would prove less than it claims.
   */
  const parked = () => new Promise((resolve) => setTimeout(resolve, 50));

  it.each([
    ['filtered + numeric `since`', { org: 'system' } as WatchFilter, true],
    // ⭐ The row that proves the org-filter half bites ON ITS OWN. A fix
    // tested only against the `since` half looks complete and leaves this —
    // `MetadataCache.start()` with any non-empty `watchFilter` — hanging.
    ['filtered, no `since` at all', { org: 'system' } as WatchFilter, false],
    // The row that looked drained and was not: it received the synthetic
    // event, then hung on the next pull.
    ['empty filter, no `since`', {} as WatchFilter, false],
  ])('close() settles the pending next() with done:true — %s', async (_label, filter, withSince) => {
    const repo = makeRepo();
    const a = await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });

    const iter = (withSince ? repo.watch(filter, a.seq) : repo.watch(filter))[
      Symbol.asyncIterator
    ]();
    const pending = iter.next();
    await parked();

    repo.close();

    // Termination — not a synthetic event wearing `done: false`.
    expect(await within(pending, 500)).toEqual({ value: undefined, done: true });
    // …and the iterator is FINISHED, not merely unblocked once. This is the
    // half the old empty-filter row hid: one pull settled, the next hung.
    expect(await within(iter.next(), 500)).toEqual({ value: undefined, done: true });
  });

  it('finishes a watcher that has no pull outstanding at close() time', async () => {
    const repo = makeRepo();
    const iter = repo.watch({ org: 'system' })[Symbol.asyncIterator]();
    await parked();

    repo.close();

    expect(await within(iter.next(), 500)).toEqual({ value: undefined, done: true });
  });

  it('terminates EVERY live watcher, and is idempotent', async () => {
    const repo = makeRepo();
    const iters = [
      repo.watch({ org: 'system' })[Symbol.asyncIterator](),
      repo.watch({ type: 'view' })[Symbol.asyncIterator](),
      repo.watch({ org: 'system', type: 'view', name: 'sample_view' })[Symbol.asyncIterator](),
      repo.watch({})[Symbol.asyncIterator](),
    ];
    const pendings = iters.map((it) => it.next());
    await parked();

    repo.close();
    repo.close();

    for (const p of pendings) {
      expect(await within(p, 500)).toEqual({ value: undefined, done: true });
    }
  });

  it('ends the stream exactly the way the consumer’s own `return()` does', async () => {
    // The contract sentence, as a comparison rather than a claim: a consumer
    // that breaks its loop and a consumer whose repository shut down under it
    // observe the SAME thing, so neither has to special-case the other.
    const byReturn = makeRepo();
    const a = byReturn.watch({ org: 'system' })[Symbol.asyncIterator]();
    const aPending = a.next();
    await parked();
    void a.return?.(undefined);

    const byClose = makeRepo();
    const b = byClose.watch({ org: 'system' })[Symbol.asyncIterator]();
    const bPending = b.next();
    await parked();
    byClose.close();

    const viaReturn = await within(aPending, 500);
    const viaClose = await within(bPending, 500);
    expect(viaClose).toEqual(viaReturn);
    expect(viaClose).toEqual({ value: undefined, done: true });
  });
});
