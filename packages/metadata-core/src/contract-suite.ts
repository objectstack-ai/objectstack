// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Parameterised Repository contract test suite. Every `MetadataRepository`
 * implementation MUST pass this suite. Reuse:
 *
 *     import { runRepositoryContractTests } from '@objectstack/metadata-core/test';
 *     runRepositoryContractTests('InMemory', () => new InMemoryRepository());
 *
 * The suite verifies the seven invariants from `repository.ts`:
 *
 *   1. Atomic put
 *   2. Monotonic seq per branch
 *   3. Optimistic locking (ConflictError)
 *   4. Canonical hashing (hash === hashSpec(body))
 *   5. Event ordering (monotonic seq, no gaps)
 *   6. Resumability (a numeric `since` replays; a bare `watch(filter)` is
 *      owed live events only)
 *   7. Tombstones (delete event emitted, get returns null)
 *
 * Two knobs, both narrow on purpose. `primaryType` / `secondaryType` move the
 * FIXTURE metadata types (an implementation may sit behind a write door keyed
 * on the type — see the option's own notes); `declaredDivergences` records an
 * issue-tracked exception to the table WITHOUT skipping the clause it names.
 * Neither adds, removes or weakens an invariant, which is the property that
 * keeps this one table rather than one table per implementation.
 */

import { describe, it, expect } from 'vitest';
import type { MetadataRepository } from './repository.js';
import type { MetaRef, MetadataEvent, MetadataType } from './types.js';
import { hashSpec } from './canonicalize.js';
import { ConflictError } from './errors.js';

export interface ContractSuiteOptions {
  /** If the implementation supports `version`-pinned reads, set true. */
  supportsVersionedReads?: boolean;
  /**
   * The metadata type nearly every clause writes under. Defaults to `'view'`.
   *
   * A FIXTURE knob, deliberately not an invariant knob: no clause below is
   * added, removed or weakened by moving it, because none of the seven
   * invariants is a statement about a particular type. It exists because an
   * implementation may sit behind a **write-authorization door** keyed on the
   * type — `SysMetadataRepository.assertAllowed()` refuses any type whose
   * registry entry lacks `allowOrgOverride` — so a hard-coded fixture type
   * decides which implementations can be held to the table at all. Naming the
   * two types here is what keeps that ONE table, instead of carving a second
   * one for the engine-backed implementation to be measured against.
   */
  primaryType?: MetadataType;
  /**
   * A second, DISTINCT type, used only where a clause must prove a type filter
   * discriminates (`list`'s `type` filter, `watch`'s). Defaults to `'object'`.
   * Same fixture-knob argument as {@link primaryType}; it must differ from it
   * or those two clauses assert nothing.
   */
  secondaryType?: MetadataType;
  /**
   * Issue-tracked exceptions to the invariant table above.
   *
   * ⚠️ Read the shape before reaching for it. A declaration does NOT skip the
   * clause it names — a skipped clause is indistinguishable from coverage in a
   * green run, which is the one failure a shared contract suite must not have.
   * It swaps the clause for one that **pins the divergent behaviour**, so the
   * suite reds the day the implementation starts conforming and whoever fixes
   * it is told, by name, to delete the declaration in the same PR. Same
   * shrink-only, audited-in-both-directions shape as the repo's other ledgers.
   *
   * There is deliberately no free-form escape here: every member is one named
   * invariant, and its value is the issue that will retire it.
   */
  declaredDivergences?: DeclaredDivergences;
}

/** @see ContractSuiteOptions.declaredDivergences */
export interface DeclaredDivergences {
  /**
   * **Invariant 6, first half (a numeric `since` replays).** The
   * implementation's `watch(filter, since)` never replays from its durable
   * log, so an event that committed before the subscription cannot be
   * surfaced however high `since` is set.
   *
   * ⚠️ Scoped to the NUMERIC-`since` half on purpose. A `watch(filter)` with
   * no `since` that surfaces nothing already committed is not a divergence at
   * all — invariant 6 owes such a subscriber live events only, and replaying
   * for it is a MAY. That sentence used to be unwritten, and this member's
   * own doc used to name the no-`since` case as part of the divergence.
   *
   * Value is the tracking issue, e.g. `'#10842'`. **No declaration today:**
   * `SysMetadataRepository`, the only one there has ever been, was fixed and
   * deleted its line — the pin below is what told it to. An empty ledger is
   * the mechanism at rest, not dead code; the shrink-only direction is the
   * only one it travels without a new tracking issue.
   */
  resumableWatch?: string;
}

const spec = (label: string) => ({ label, columns: ['a', 'b'] });

/** A value whose `toJSON` collapses it to something other than its own keys. */
class Money {
  constructor(
    private readonly cents: number,
    private readonly currency: string,
  ) {}

  toJSON(): string {
    return `${(this.cents / 100).toFixed(2)} ${this.currency}`;
  }
}

/**
 * Spec shapes for the #7856 identity pin, spanning the ways a value's
 * serialised form can differ from its in-memory object graph.
 *
 * Deliberately a TABLE and not one hand-picked `Date`. The defect was never
 * about `Date` — it was about `canonicalize` walking own enumerable keys
 * while the disk received whatever `JSON.stringify` produced — and a
 * single-case pin is exactly what lets the next value in this class through.
 * `Date` is merely its most reachable instance; a `toJSON` returning a
 * string, an object, or sitting under an array index are the same defect
 * wearing different clothes, and each row below failed differently before
 * the fix (see the PR's per-arm table).
 *
 * The control row matters as much as the rest: it is what proves a fix here
 * did not simply change every hash.
 */
const SERIALISATION_SHAPES: ReadonlyArray<{
  label: string;
  spec: () => Record<string, unknown>;
}> = [
  {
    label: 'control — plain JSON, no toJSON anywhere in the graph',
    spec: () => ({ label: 'Home', columns: ['a', 'b'], nested: { n: 1, ok: true, nil: null } }),
  },
  {
    label: 'Date at a top-level key',
    spec: () => ({ label: 'Home', createdAt: new Date('2024-01-01T00:00:00.000Z') }),
  },
  {
    label: 'Date under an array index',
    spec: () => ({ label: 'Audit', stamps: [new Date('2020-06-01T12:00:00.000Z')] }),
  },
  {
    label: 'class instance whose toJSON collapses it to a string',
    spec: () => ({ label: 'Price', amount: new Money(1250, 'USD') }),
  },
  {
    label: 'object literal carrying its own toJSON',
    spec: () => ({ label: 'Range', span: { toJSON: () => ({ from: 1, to: 9 }) } }),
  },
  {
    label: 'toJSON nested inside an array element',
    spec: () => ({ rows: [{ at: new Date('2022-02-02T02:02:02.000Z') }] }),
  },
];

/** Drain at most `n` events from an async iterable with a timeout. */
/**
 * Poll `cond` until it holds or `timeoutMs` elapses. Returns either way — the
 * caller's `expect` is what fails, so a timeout produces the real assertion
 * message instead of "timed out".
 */
async function until(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function runRepositoryContractTests(
  label: string,
  factory: () => MetadataRepository | Promise<MetadataRepository>,
  opts: ContractSuiteOptions = {},
): void {
  const primaryType: MetadataType = opts.primaryType ?? 'view';
  const secondaryType: MetadataType = opts.secondaryType ?? 'object';
  if (primaryType === secondaryType) {
    throw new Error(
      `runRepositoryContractTests(${label}): primaryType and secondaryType must differ — ` +
        `both are '${primaryType}', which makes the list/watch type-filter clauses vacuous.`,
    );
  }
  const resumableWatchDivergence = opts.declaredDivergences?.resumableWatch;
  if (resumableWatchDivergence !== undefined && resumableWatchDivergence.trim() === '') {
    throw new Error(
      `runRepositoryContractTests(${label}): declaredDivergences.resumableWatch must name the ` +
        `tracking issue — an anonymous exception is the skip this mechanism exists to refuse.`,
    );
  }
  const refOf = (overrides: Partial<MetaRef> = {}): MetaRef => ({
    org: 'system',
    type: primaryType,
    name: 'sample_view',
    ...overrides,
  });

  describe(`MetadataRepository contract — ${label}`, () => {
    // ── 1. Atomic put + canonical hash ──────────────────────────────
    describe('put / get', () => {
      it('creates an item from null parent', async () => {
        const repo = await factory();
        const ref = refOf();
        const res = await repo.put(ref, spec('hello'), { parentVersion: null, actor: 'tester' });
        expect(res.version).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(res.version).toBe(hashSpec(spec('hello')));
        expect(res.seq).toBeGreaterThan(0);
        expect(res.item.parentHash).toBeNull();
        expect(res.item.authoredBy).toBe('tester');

        const got = await repo.get(ref);
        expect(got).not.toBeNull();
        expect(got!.hash).toBe(res.version);
        expect(got!.body).toEqual(spec('hello'));
      });

      it('round-trips successive updates with parent chaining', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('one'), { parentVersion: null, actor: 't' });
        const b = await repo.put(ref, spec('two'), { parentVersion: a.version, actor: 't' });
        const c = await repo.put(ref, spec('three'), { parentVersion: b.version, actor: 't' });
        expect(b.item.parentHash).toBe(a.version);
        expect(c.item.parentHash).toBe(b.version);
        expect(c.seq).toBeGreaterThan(b.seq);
        expect(b.seq).toBeGreaterThan(a.seq);
      });

      it('canonical hash invariant: item.hash === hashSpec(item.body)', async () => {
        const repo = await factory();
        const ref = refOf();
        await repo.put(ref, { z: 1, a: 2, m: [3, 1, 2] }, { parentVersion: null, actor: 't' });
        const got = await repo.get(ref);
        expect(got!.hash).toBe(hashSpec(got!.body));
      });

      // ── #7856 — the version identifies the STORED BYTES ───────────
      //
      // Table-driven on purpose; see SERIALISATION_SHAPES. Every row
      // asserts BOTH faces of the same invariant, because the two
      // implementations in this repo broke DIFFERENT ones:
      //
      //   put().version === get().hash
      //       the face FileSystemRepository broke — it hashed the spec it
      //       was handed, wrote `JSON.stringify` of it, and re-hashed the
      //       parse on the way back out.
      //   get().hash === hashSpec(get().body)
      //       invariant 4's face, the one InMemoryRepository broke — it
      //       stores `body` already serialised (`clonePlain`) while
      //       hashing the in-memory spec, so the item it hands back
      //       disagrees with its own hash.
      //
      // Asserting only one face would have left the other implementation's
      // divergence unpinned, which is the whole reason this lives in the
      // shared contract suite rather than beside either bug.
      describe('serialized-form identity (#7856)', () => {
        for (const shape of SERIALISATION_SHAPES) {
          it(`version identifies the stored bytes — ${shape.label}`, async () => {
            const repo = await factory();
            const ref = refOf();
            const put = await repo.put(ref, shape.spec(), {
              parentVersion: null,
              actor: 't',
            });

            const got = await repo.get(ref);
            expect(got).not.toBeNull();
            expect(got!.hash).toBe(put.version);
            expect(got!.hash).toBe(hashSpec(got!.body));
          });

          it(`re-putting the same spec is a no-op — ${shape.label}`, async () => {
            const repo = await factory();
            const ref = refOf();
            const first = await repo.put(ref, shape.spec(), {
              parentVersion: null,
              actor: 't',
            });

            // Chains on the version the caller was HANDED. When that
            // version does not identify the stored bytes, the head index
            // it is compared against holds the other hash and this second
            // write is not recognised as the no-op it is — it either
            // conflicts or republishes the item as a fresh revision.
            const second = await repo.put(ref, shape.spec(), {
              parentVersion: first.version,
              actor: 't',
            });
            expect(second.version).toBe(first.version);
            expect(second.seq).toBe(first.seq);
          });
        }
      });

      it('returns null for missing item', async () => {
        const repo = await factory();
        expect(await repo.get(refOf({ name: 'never_existed' }))).toBeNull();
      });

      it('no-op write with identical content returns current version', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('same'), { parentVersion: null, actor: 't' });
        const b = await repo.put(ref, spec('same'), { parentVersion: a.version, actor: 't' });
        expect(b.version).toBe(a.version);
        expect(b.seq).toBe(a.seq);
      });

      // ADR-0009: every MetadataRepository must implement getByHash().
      // For repos that retain only HEAD bodies (InMemory, FS), the
      // contract is "HEAD-hash resolves to HEAD body; other hashes
      // return null". For history-backed repos this widens to all
      // recorded hashes — those repos may add their own stronger tests.
      it('getByHash() resolves the current HEAD hash to the HEAD body', async () => {
        const repo = await factory();
        const ref = refOf();
        await repo.put(ref, spec('pinned'), { parentVersion: null, actor: 't' });
        const head = await repo.get(ref);
        expect(head).not.toBeNull();
        const byHash = await repo.getByHash(ref, head!.hash);
        expect(byHash).not.toBeNull();
        expect(byHash!.body).toEqual(spec('pinned'));
        expect(byHash!.hash).toBe(head!.hash);
      });

      it('getByHash() returns null for an unknown hash', async () => {
        const repo = await factory();
        const ref = refOf();
        await repo.put(ref, spec('whatever'), { parentVersion: null, actor: 't' });
        const fake = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
        expect(await repo.getByHash(ref, fake)).toBeNull();
      });
    });

    // ── 2 & 3. Optimistic locking + Monotonic seq ───────────────────
    describe('optimistic locking', () => {
      it('throws ConflictError when parentVersion mismatches', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('v1'), { parentVersion: null, actor: 't' });
        await expect(
          repo.put(ref, spec('v2'), { parentVersion: null, actor: 't' }),
        ).rejects.toBeInstanceOf(ConflictError);
        await expect(
          repo.put(ref, spec('v2'), { parentVersion: 'sha256:deadbeef'.padEnd(71, '0'), actor: 't' }),
        ).rejects.toBeInstanceOf(ConflictError);
        // Sanity: correct parent succeeds.
        await expect(
          repo.put(ref, spec('v2'), { parentVersion: a.version, actor: 't' }),
        ).resolves.toMatchObject({ seq: expect.any(Number) });
      });

      it('throws ConflictError when creating over an existing item with null parent', async () => {
        const repo = await factory();
        const ref = refOf();
        await repo.put(ref, spec('a'), { parentVersion: null, actor: 't' });
        await expect(
          repo.put(ref, spec('b'), { parentVersion: null, actor: 't' }),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it('delete requires correct parentVersion', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('a'), { parentVersion: null, actor: 't' });
        await expect(
          repo.delete(ref, { parentVersion: 'sha256:wrong'.padEnd(71, '0'), actor: 't' }),
        ).rejects.toBeInstanceOf(ConflictError);
        await repo.delete(ref, { parentVersion: a.version, actor: 't' });
      });
    });

    describe('monotonic seq per org', () => {
      it('seq strictly increases within an org', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('1'), { parentVersion: null, actor: 't' });
        const b = await repo.put(ref, spec('2'), { parentVersion: a.version, actor: 't' });
        const c = await repo.put(refOf({ name: 'other' }), spec('o'), { parentVersion: null, actor: 't' });
        expect(b.seq).toBeGreaterThan(a.seq);
        expect(c.seq).toBeGreaterThan(b.seq);
      });

      it('different orgs have independent sequences', async () => {
        const repo = await factory();
        const orgA = refOf({ org: 'org_a' });
        const orgB = refOf({ org: 'org_b' });
        // Some backends (FileSystemRepository) are scoped to a single
        // org; for those any foreign-org put throws — skip the test.
        let a: { seq: number; version: string };
        let b: { seq: number; version: string };
        try {
          a = await repo.put(orgA, spec('a1'), { parentVersion: null, actor: 't' });
          b = await repo.put(orgB, spec('b1'), { parentVersion: null, actor: 't' });
        } catch {
          return;
        }
        const c = await repo.put(orgA, spec('a2'), { parentVersion: a.version, actor: 't' });
        const d = await repo.put(orgB, spec('b2'), { parentVersion: b.version, actor: 't' });
        expect(c.seq).toBeGreaterThan(a.seq);
        expect(d.seq).toBeGreaterThan(b.seq);
      });
    });

    // ── 4. Tombstones ───────────────────────────────────────────────
    describe('delete / tombstones', () => {
      it('get returns null after delete; history retains lineage', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('a'), { parentVersion: null, actor: 't' });
        await repo.delete(ref, { parentVersion: a.version, actor: 't' });
        expect(await repo.get(ref)).toBeNull();
        const hist: MetadataEvent[] = [];
        for await (const evt of repo.history(ref)) hist.push(evt);
        expect(hist.map((e) => e.op)).toEqual(['create', 'delete']);
        expect(hist[1]?.parentHash).toBe(a.version);
        expect(hist[1]?.hash).toBeNull();
      });

      it('can recreate after delete with null parent', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('a'), { parentVersion: null, actor: 't' });
        await repo.delete(ref, { parentVersion: a.version, actor: 't' });
        const b = await repo.put(ref, spec('a-redux'), { parentVersion: null, actor: 't' });
        expect(b.item.parentHash).toBeNull();
      });
    });

    // ── 5. Event ordering & watch replay ────────────────────────────
    describe('watch / history', () => {
      it('history yields events in monotonic seq order', async () => {
        const repo = await factory();
        const ref = refOf();
        const a = await repo.put(ref, spec('1'), { parentVersion: null, actor: 't' });
        const b = await repo.put(ref, spec('2'), { parentVersion: a.version, actor: 't' });
        const c = await repo.put(ref, spec('3'), { parentVersion: b.version, actor: 't' });
        const evts: MetadataEvent[] = [];
        for await (const e of repo.history(ref)) evts.push(e);
        expect(evts.map((e) => e.seq)).toEqual([a.seq, b.seq, c.seq]);
        expect(evts.every((e, i) => i === 0 || e.seq > evts[i - 1]!.seq)).toBe(true);
      });

      // ── Invariant 6, second half — the FILTER clause, live-stream shaped ──
      //
      // Unconditional, and deliberately NOT written as "put twice, then open a
      // watch and expect the match back". That older shape asserted a replay
      // the contract does not owe: invariant 6 states that a `watch()` with no
      // `since` is owed LIVE events only, and that events which had already
      // committed MAY be delivered but MUST NOT be relied on. The clause passed
      // for two implementations because they happen to replay the whole
      // matching log, and failed for the third for conforming — a suite defect,
      // not a repository defect, and the reason the sentence it leaned on is now
      // written down in `repository.ts` instead of inherited from whichever
      // implementation was read first.
      //
      // So the subscription is established FIRST and the writes follow it. What
      // is asserted is the floor every implementation owes: the post-subscribe
      // event that matches the filter arrives, and the one that does not is
      // never delivered. An implementation that additionally replays is not
      // failed here — that is the MAY, and pinning its absence is an
      // implementation-local question, kept out of this table on purpose (the
      // table's whole value is having no per-implementation columns).
      it('watch filters by type and name — over the live stream', async () => {
        const repo = await factory();
        const iter = repo
          .watch({ org: 'system', type: primaryType, name: 'a' })
          [Symbol.asyncIterator]();
        const collected: MetadataEvent[] = [];
        const pump = (async () => {
          for (;;) {
            const r = await iter.next();
            if (r.done) return;
            collected.push(r.value as MetadataEvent);
          }
        })();

        await repo.put(refOf({ name: 'a' }), spec('a'), { parentVersion: null, actor: 't' });
        await repo.put(refOf({ name: 'b' }), spec('b'), { parentVersion: null, actor: 't' });
        // Wait for the match to actually land rather than for a fixed sleep to
        // elapse — a filesystem-backed implementation routes it through a real
        // watcher and a bare `setTimeout` turns that into a flake.
        await until(() => collected.length >= 1, 2000);
        // …then let a wrongly-delivered non-match have its chance to show up.
        await new Promise((resolve) => setTimeout(resolve, 100));
        await iter.return?.(undefined);
        await pump;

        expect(collected.map((e) => e.ref.name)).toEqual(['a']);
        expect(collected.every((e, i) => i === 0 || e.seq > collected[i - 1]!.seq)).toBe(true);
      });

      if (resumableWatchDivergence === undefined) {
        it('watch(sinceSeq) replays subsequent events then goes live', async () => {
          const repo = await factory();
          const ref = refOf();
          const a = await repo.put(ref, spec('1'), { parentVersion: null, actor: 't' });
          const b = await repo.put(ref, spec('2'), { parentVersion: a.version, actor: 't' });

          // Start watching with `since = a.seq` — must replay b, then deliver a live event.
          const iter = repo.watch({ org: ref.org }, a.seq);
          const collected: MetadataEvent[] = [];
          const it = iter[Symbol.asyncIterator]();

          // First yield should be the replay of `b`.
          const first = await it.next();
          expect(first.done).toBe(false);
          collected.push(first.value as MetadataEvent);
          expect(collected[0]!.seq).toBe(b.seq);

          // Now trigger a live event and collect it.
          const livePromise = it.next();
          const c = await repo.put(ref, spec('3'), { parentVersion: b.version, actor: 't' });
          const live = await livePromise;
          expect(live.done).toBe(false);
          collected.push(live.value as MetadataEvent);
          expect(collected[1]!.seq).toBe(c.seq);

          await it.return?.(undefined);
        });
      } else {
        // ── DECLARED DIVERGENCE — invariant 6's first half is unmet here ──
        //
        // Only the numeric-`since` clause above is swapped out; the filter
        // clause is shared, because it now asserts the live-stream floor every
        // implementation owes rather than a replay only some perform. The
        // replacement below is NOT a relaxation: it PINS the absence of replay,
        // so it reds the day replay lands and this whole branch has to go.

        it(`watch(sinceSeq) does NOT replay, then goes live — DECLARED DIVERGENCE ${resumableWatchDivergence}`, async () => {
          const repo = await factory();
          const ref = refOf();
          const a = await repo.put(ref, spec('1'), { parentVersion: null, actor: 't' });
          const b = await repo.put(ref, spec('2'), { parentVersion: a.version, actor: 't' });

          const it = repo.watch({ org: ref.org }, a.seq)[Symbol.asyncIterator]();

          // ONE pending `next()`, deliberately. Invariant 6 says `b` (seq >
          // a.seq, already committed) must satisfy it. Here nothing does, and
          // the SAME promise is later settled by a live event — which is what
          // separates "does not replay" from "the stream is dead".
          const pending = it.next();
          let settled = false;
          const mark = () => {
            settled = true;
          };
          pending.then(mark, mark);
          await new Promise((resolve) => setTimeout(resolve, 200));
          expect(settled).toBe(false);

          const c = await repo.put(ref, spec('3'), { parentVersion: b.version, actor: 't' });
          const live = await pending;
          expect(live.done).toBe(false);
          expect((live.value as MetadataEvent).seq).toBe(c.seq);

          await it.return?.(undefined);
        });

      }
    });

    // ── list ────────────────────────────────────────────────────────
    describe('list', () => {
      it('returns headers (no body) for matching items', async () => {
        const repo = await factory();
        await repo.put(refOf({ name: 'alpha' }), spec('a'), { parentVersion: null, actor: 't' });
        await repo.put(refOf({ name: 'beta' }), spec('b'), { parentVersion: null, actor: 't' });
        await repo.put(refOf({ type: secondaryType, name: 'thing' }), spec('o'), {
          parentVersion: null,
          actor: 't',
        });
        const headers: unknown[] = [];
        for await (const h of repo.list({ type: primaryType })) headers.push(h);
        expect(headers.length).toBe(2);
        for (const h of headers) {
          expect((h as { body?: unknown }).body).toBeUndefined();
        }
      });

      it('limit clamps result size', async () => {
        const repo = await factory();
        for (let i = 0; i < 5; i++) {
          await repo.put(refOf({ name: `v_${i}` }), spec(`v${i}`), { parentVersion: null, actor: 't' });
        }
        const headers: unknown[] = [];
        for await (const h of repo.list({ type: primaryType, limit: 3 })) headers.push(h);
        expect(headers.length).toBe(3);
      });
    });

    // ── Optional behaviour ──────────────────────────────────────────
    if (opts.supportsVersionedReads) {
      describe('versioned reads', () => {
        it('get with version pin returns that historical version', async () => {
          const repo = await factory();
          const ref = refOf();
          const a = await repo.put(ref, spec('v1'), { parentVersion: null, actor: 't' });
          await repo.put(ref, spec('v2'), { parentVersion: a.version, actor: 't' });
          const pinned = await repo.get({ ...ref, version: a.version });
          expect(pinned?.hash).toBe(a.version);
          expect(pinned?.body).toEqual(spec('v1'));
        });
      });
    }
  });
}
