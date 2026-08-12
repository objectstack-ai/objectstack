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
 *   6. Resumability (watch with `since` replays)
 *   7. Tombstones (delete event emitted, get returns null)
 */

import { describe, it, expect } from 'vitest';
import type { MetadataRepository } from './repository.js';
import type { MetaRef, MetadataEvent } from './types.js';
import { hashSpec } from './canonicalize.js';
import { ConflictError } from './errors.js';

export interface ContractSuiteOptions {
  /** If the implementation supports `version`-pinned reads, set true. */
  supportsVersionedReads?: boolean;
}

const refOf = (overrides: Partial<MetaRef> = {}): MetaRef => ({
  org: 'system',
  type: 'view',
  name: 'sample_view',
  ...overrides,
});

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
async function take<T>(iter: AsyncIterable<T>, n: number, timeoutMs = 1000): Promise<T[]> {
  const out: T[] = [];
  const it = iter[Symbol.asyncIterator]();
  const deadline = Date.now() + timeoutMs;
  while (out.length < n) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const result = await Promise.race([
      it.next(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), remaining),
      ),
    ]);
    if (result.done) break;
    out.push(result.value as T);
  }
  // Close the iterator so the repo subscriber is freed.
  await it.return?.(undefined);
  return out;
}

export function runRepositoryContractTests(
  label: string,
  factory: () => MetadataRepository | Promise<MetadataRepository>,
  opts: ContractSuiteOptions = {},
): void {
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

      it('watch filters by type and name', async () => {
        const repo = await factory();
        await repo.put(refOf({ name: 'a' }), spec('a'), { parentVersion: null, actor: 't' });
        await repo.put(refOf({ name: 'b' }), spec('b'), { parentVersion: null, actor: 't' });
        const events = await take(
          repo.watch({ org: 'system', type: 'view', name: 'a' }),
          5,
          200,
        );
        expect(events.length).toBe(1);
        expect(events[0]!.ref.name).toBe('a');
      });
    });

    // ── list ────────────────────────────────────────────────────────
    describe('list', () => {
      it('returns headers (no body) for matching items', async () => {
        const repo = await factory();
        await repo.put(refOf({ name: 'alpha' }), spec('a'), { parentVersion: null, actor: 't' });
        await repo.put(refOf({ name: 'beta' }), spec('b'), { parentVersion: null, actor: 't' });
        await repo.put(refOf({ type: 'object', name: 'thing' }), spec('o'), {
          parentVersion: null,
          actor: 't',
        });
        const headers: unknown[] = [];
        for await (const h of repo.list({ type: 'view' })) headers.push(h);
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
        for await (const h of repo.list({ type: 'view', limit: 3 })) headers.push(h);
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
