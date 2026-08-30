// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11971] Pins for the #11633 leg-B grants cache — the design's §7 test plan,
 * pins 1–5, 7 and 9 (pin 6, the explain bypass, lives with `buildContextForUser`
 * in `plugin-security/src/explain-engine.test.ts`; pin 8 is leg C's and already
 * stands in `analytics-timezone.dogfood.test.ts`).
 *
 * Two disciplines carried from `session-of-record.test.ts` via the design:
 *
 *  - **Assert the END of the chain, not the middle.** The revocation pins
 *    assert the capability is ABSENT from the resolved envelope — never that
 *    "the cache was cleared" — because a clear-then-repopulate-from-a-stale-read
 *    implementation passes the middle and fails the end.
 *  - **Equality alone passes on a cache that never caches**, so every identity
 *    pin also asserts the hit issued ZERO reads.
 *
 * The doubles here mirror the REAL engine's seam order
 * (`objectql/src/engine.ts` `executeWithMiddleware`): the write epoch advances
 * FIRST, ahead of every middleware, and the middleware chain wraps the
 * executor — so what these pins exercise is the order the cache actually sees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
import type { ResolveUserAuthzGrantsOptions } from './resolve-authz-context.js';
import {
  makeRecordingQl,
  FIXTURES,
} from './resolve-authz-context.batch-equivalence.testkit.js';

// ── An engine double that carries the #11968 seams ──────────────────────────

interface SeamCall { object: string; where: unknown; limit: unknown }
type SeamMiddleware = (
  ctx: { object: string; operation: string },
  next: () => Promise<void>,
) => Promise<void>;

/**
 * A `where`-honouring in-memory engine WITH the write-epoch and middleware
 * seams: reads are recorded (so "zero reads" is measurable), writes go through
 * `epoch.bump('write')` first and then the middleware onion — the real
 * engine's order. `middlewares.length` / `epochListenerCount` are exposed so
 * pin 7 can assert the OFF path wired NOTHING.
 */
function makeSeamQl(tables: Record<string, any[]>) {
  const calls: SeamCall[] = [];
  const middlewares: SeamMiddleware[] = [];
  const listeners = new Set<(epoch: number, reason: string) => void>();
  const epoch = {
    current: 0,
    bump(reason: string): number {
      epoch.current += 1;
      const at = epoch.current;
      for (const l of [...listeners]) l(at, reason);
      return at;
    },
    subscribe(l: (epoch: number, reason: string) => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  async function writeOp(object: string, operation: 'insert' | 'update' | 'delete', executor: () => void): Promise<void> {
    // Real order: the epoch advances ahead of the whole chain.
    epoch.bump('write');
    const ctx = { object, operation };
    const run = async (i: number): Promise<void> => {
      if (i < middlewares.length) return middlewares[i](ctx, () => run(i + 1));
      executor();
    };
    await run(0);
  }
  return {
    calls,
    tables,
    writeEpoch: epoch,
    epoch,
    get middlewareCount() { return middlewares.length; },
    get epochListenerCount() { return listeners.size; },
    registerMiddleware(fn: SeamMiddleware) { middlewares.push(fn); },
    async find(object: string, opts: any) {
      calls.push({ object, where: opts?.where, limit: opts?.limit });
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async insert(object: string, row: any) {
      await writeOp(object, 'insert', () => { (tables[object] ??= []).push(row); });
    },
    async update(object: string, patch: any, where: any) {
      await writeOp(object, 'update', () => {
        for (const r of (tables[object] ?? []).filter((r) => matches(r, where))) Object.assign(r, patch);
      });
    },
    async delete(object: string, where: any) {
      await writeOp(object, 'delete', () => {
        tables[object] = (tables[object] ?? []).filter((r) => !matches(r, where));
      });
    },
  };
}

type SeamQl = ReturnType<typeof makeSeamQl>;

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed clock. Injected everywhere, so no pin sleeps and no pin races. */
const T = Date.UTC(2026, 5, 1);

/** A principal whose PLATFORM_ADMIN standing hangs on one revocable row. */
function adminTables(): Record<string, any[]> {
  return {
    sys_user: [{ id: 'u1', email: 'u1@x.com' }],
    sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'member' }],
    sys_user_position: [],
    sys_user_permission_set: [
      { user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null },
    ],
    sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
    sys_position: [],
    sys_position_permission_set: [],
  };
}

const OPTS: ResolveUserAuthzGrantsOptions = { tenantId: 'org_a', nowMs: T };

const TTL_ENV = 'OS_AUTHZ_GRANTS_CACHE_TTL_MS';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
let savedTtl: string | undefined;
let savedOwner: string | undefined;

beforeEach(() => {
  savedTtl = process.env[TTL_ENV];
  savedOwner = process.env[OWNER_ENV];
  delete process.env[TTL_ENV];
  // The fixtures (like the batch-equivalence goldens) assume a deployment that
  // declared no platform administrators; an ambient CI value would add a
  // conditional `sys_user` read and break the suppressed-read pin.
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  if (savedTtl === undefined) delete process.env[TTL_ENV]; else process.env[TTL_ENV] = savedTtl;
  if (savedOwner === undefined) delete process.env[OWNER_ENV]; else process.env[OWNER_ENV] = savedOwner;
  resetPlatformAdminEmailMemo();
});

const cacheOn = (ms = 60_000) => { process.env[TTL_ENV] = String(ms); };

/** Resolve and assert the resolution issued no reads at all (a true hit). */
async function resolveExpectingZeroReads(ql: SeamQl, userId: string, opts: ResolveUserAuthzGrantsOptions) {
  const before = ql.calls.length;
  const grants = await resolveUserAuthzGrants(ql, userId, opts);
  expect(ql.calls.length).toBe(before);
  return grants;
}

// ── Pin 7 — zero means OFF, and off is a REAL path ──────────────────────────

describe('pin 7 — TTL 0 (the shipped default) is a real off path', () => {
  it('default config: resolves twice with the SAME query multiset, and wires NOTHING onto the engine', async () => {
    const ql = makeSeamQl(adminTables());
    const first = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    const afterFirst = ql.calls.length;
    const second = await resolveUserAuthzGrants(ql, 'u1', OPTS);

    expect(second).toEqual(first);
    // The second resolution re-issued every read — nothing was cached.
    expect(ql.calls.length).toBe(afterFirst * 2);
    const key = (c: SeamCall) => JSON.stringify(c);
    expect(ql.calls.slice(afterFirst).map(key).sort()).toEqual(ql.calls.slice(0, afterFirst).map(key).sort());
    // ⭐ The bit-identical half: with the cache off this module must leave NO
    // footprint — no engine middleware, no epoch subscription. This is what
    // separates "off" from "a cache with a degenerate TTL".
    expect(ql.middlewareCount).toBe(0);
    expect(ql.epochListenerCount).toBe(0);
  });

  it('explicit OS_AUTHZ_GRANTS_CACHE_TTL_MS=0 takes the same off path', async () => {
    process.env[TTL_ENV] = '0';
    const ql = makeSeamQl(adminTables());
    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    const afterFirst = ql.calls.length;
    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    expect(ql.calls.length).toBe(afterFirst * 2);
    expect(ql.middlewareCount).toBe(0);
    expect(ql.epochListenerCount).toBe(0);
  });
});

// ── Pin 1 — identity: cached ≡ uncached, and the hit reads nothing ──────────

describe('pin 1 — identity over the 11-fixture batch-equivalence matrix', () => {
  describe.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    it('cached ≡ uncached (deep-equal INCLUDING array order), and the second resolution issues ZERO reads', async () => {
      cacheOn();
      // The uncached truth, from an identical table set via the ruled bypass.
      const uncached = await resolveUserAuthzGrants(
        makeSeamQl(structuredClone(f.tables)),
        f.userId,
        { ...f.opts, bypassGrantsCache: true },
      );

      const ql = makeSeamQl(structuredClone(f.tables));
      const first = await resolveUserAuthzGrants(ql, f.userId, f.opts);
      expect(first).toEqual(uncached);

      // Both halves are needed — equality alone passes on a cache that never
      // caches (#11633 §7 pin 1).
      const second = await resolveExpectingZeroReads(ql, f.userId, f.opts);
      expect(second).toEqual(uncached);
    });
  });

  it('a served envelope is a CLONE — a caller mutating its answer cannot poison the next caller', async () => {
    cacheOn();
    const ql = makeSeamQl(adminTables());
    const first = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    const snapshot = structuredClone(first);
    first.permissions.push('injected_by_caller');
    first.org_user_ids.length = 0;
    (first as any).posture = 'PLATFORM_ADMIN';

    const second = await resolveExpectingZeroReads(ql, 'u1', OPTS);
    expect(second).toEqual(snapshot);
  });
});

// ── Pin 2 — revocation observed by the NEXT request, with NO clock advance ──

describe('pin 2 — read-after-write on the writing node (invalidation, not TTL)', () => {
  it('a revoke THROUGH THE ENGINE is absent from the very next resolution', async () => {
    // TTL one hour: if this pin passes, it cannot have passed by expiry.
    cacheOn(3_600_000);
    const ql = makeSeamQl(adminTables());

    const before = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    expect(before.permissions).toContain('admin_full_access');
    expect(before.posture).toBe('PLATFORM_ADMIN');
    // Control: the entry IS being served (otherwise this pin tests nothing).
    await resolveExpectingZeroReads(ql, 'u1', OPTS);

    // Revoke through the engine — the same seam a real revoke uses.
    await ql.delete('sys_user_permission_set', { user_id: 'u1' });

    // ⭐ Assert the END of the chain: the capability is GONE, not "the cache
    // was cleared". Same injected clock — nothing here is allowed to lean on
    // time passing.
    const after = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    expect(after.permissions).not.toContain('admin_full_access');
    expect(after.positions).not.toContain('platform_admin');
    expect(after.posture).toBe('MEMBER');
  });

  it('a GRANT through the engine is present on the very next resolution (both directions of staleness)', async () => {
    cacheOn(3_600_000);
    const tables = adminTables();
    tables.sys_user_permission_set = [];
    const ql = makeSeamQl(tables);

    const before = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    expect(before.permissions).not.toContain('admin_full_access');

    await ql.insert('sys_user_permission_set', {
      user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null,
    });

    const after = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    expect(after.permissions).toContain('admin_full_access');
    expect(after.posture).toBe('PLATFORM_ADMIN');
  });

  it('⛔ the ruled keying trap: a `sys_session` write does NOT retire the cache (sys_session is not watched)', async () => {
    cacheOn(3_600_000);
    const tables = adminTables();
    tables.sys_session = [{ id: 's1', user_id: 'u1', last_activity_at: T }];
    const ql = makeSeamQl(tables);

    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    const epochBefore = ql.epoch.current;

    // The once-a-minute `last_activity_at` cadence, through the engine.
    await ql.update('sys_session', { last_activity_at: T + 60_000 }, { id: 's1' });

    // Control: the write DID advance the engine's epoch — the cache survived
    // by its watched-set filter, not because the write was invisible.
    expect(ql.epoch.current).toBeGreaterThan(epochBefore);
    await resolveExpectingZeroReads(ql, 'u1', OPTS);
  });

  it('an unwatched business-object write does not retire the cache either', async () => {
    cacheOn(3_600_000);
    const ql = makeSeamQl(adminTables());
    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    await ql.insert('crm_lead', { id: 'l1', name: 'lead' });
    await resolveExpectingZeroReads(ql, 'u1', OPTS);
  });

  it("epoch reasons the middleware cannot see — 'metadata' and 'manual' — retire wholesale", async () => {
    cacheOn(3_600_000);
    for (const reason of ['metadata', 'manual'] as const) {
      const tables = adminTables();
      const ql = makeSeamQl(tables);
      const before = await resolveUserAuthzGrants(ql, 'u1', OPTS);
      expect(before.permissions).toContain('admin_full_access');

      // Mutate the rows DIRECTLY — no engine write, so ONLY the epoch bump
      // below can make the next resolution look again. (A declared permission
      // set changing in metadata is exactly a permission change with no row
      // written; plugin-security bumps the engine epoch with 'metadata'.)
      tables.sys_user_permission_set.length = 0;
      await resolveExpectingZeroReads(ql, 'u1', OPTS); // control: entry still standing

      ql.epoch.bump(reason);
      const after = await resolveUserAuthzGrants(ql, 'u1', OPTS);
      expect(after.permissions).not.toContain('admin_full_access');
    }
  });
});

// ── Pin 3 — the expiry-boundary rule: min(ttl, nextBoundary) ────────────────

describe('pin 3 — ADR-0091 validity boundaries expire entries WITHOUT any write', () => {
  it('a grant whose valid_until falls inside the TTL stops resolving AT the boundary, not at TTL expiry', async () => {
    cacheOn(3_600_000); // TTL one hour; the boundary is 2 seconds away
    const tables = adminTables();
    tables.sys_user_permission_set[0].valid_until = new Date(T + 2_000).toISOString();
    const ql = makeSeamQl(tables);

    const at = (nowMs: number) => ({ ...OPTS, nowMs });

    const before = await resolveUserAuthzGrants(ql, 'u1', at(T));
    expect(before.permissions).toContain('admin_full_access');

    // Just inside the boundary: still the SAME cached entry (zero reads) —
    // the boundary cap must not turn into "always expired".
    const inside = await resolveExpectingZeroReads(ql, 'u1', at(T + 1_999));
    expect(inside.permissions).toContain('admin_full_access');

    // Past the boundary, with NO write anywhere: the entry is dead and the
    // fresh resolution drops the lapsed grant. Write-invalidation is
    // structurally blind here — the timer is the only mechanism (#11633 B.1).
    const after = await resolveUserAuthzGrants(ql, 'u1', at(T + 2_001));
    expect(after.permissions).not.toContain('admin_full_access');
    expect(after.posture).toBe('MEMBER');
  });

  it('the OTHER direction flips too: a future valid_from becomes active at its boundary', async () => {
    cacheOn(3_600_000);
    const tables = adminTables();
    tables.sys_user_permission_set[0].valid_from = new Date(T + 2_000).toISOString();
    const ql = makeSeamQl(tables);

    const at = (nowMs: number) => ({ ...OPTS, nowMs });

    const before = await resolveUserAuthzGrants(ql, 'u1', at(T));
    expect(before.permissions).not.toContain('admin_full_access');

    const after = await resolveUserAuthzGrants(ql, 'u1', at(T + 2_001));
    expect(after.permissions).toContain('admin_full_access');
  });
});

// ── Pin 4 — peer membership (#11633 B.3) ────────────────────────────────────

describe("pin 4 — user X's envelope changes when user Y's sys_member row is written", () => {
  it("inserting Y's membership through the engine appears in X's org_user_ids on the next resolution", async () => {
    cacheOn(3_600_000);
    const ql = makeSeamQl(adminTables());

    const before = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    expect(before.org_user_ids).not.toContain('u_y');

    // A DIFFERENT user's row in the same organization — the write whose
    // consequence lands on X. Coarse invalidation gets this right by
    // construction; a per-user keyed scheme is exactly where it would break.
    await ql.insert('sys_member', { user_id: 'u_y', organization_id: 'org_a', role: 'member' });

    const after = await resolveUserAuthzGrants(ql, 'u1', OPTS);
    expect(after.org_user_ids).toContain('u_y');
  });
});

// ── Pin 5 — seed isolation (#11633 B.2) ─────────────────────────────────────

describe('pin 5 — seeds are part of the answer, so seeds are part of the key', () => {
  it('different seedPermissions never see each other, ordering holds, and the suppressed sys_user read stays suppressed', async () => {
    cacheOn();
    const ql = makeSeamQl(adminTables());
    const seedsA: ResolveUserAuthzGrantsOptions = {
      tenantId: 'org_a', nowMs: T, seedEmail: 'a@x.com', seedPermissions: ['scope_a2', 'scope_a1', 'ai_seat'],
    };
    const seedsB: ResolveUserAuthzGrantsOptions = {
      tenantId: 'org_a', nowMs: T, seedEmail: 'b@x.com', seedPermissions: ['scope_b', 'ai_seat'],
    };

    const a1 = await resolveUserAuthzGrants(ql, 'u1', seedsA);
    // Seeds come FIRST and in caller order — the contractual ordering the
    // existing golden pins for the uncached path.
    expect(a1.permissions.slice(0, 3)).toEqual(['scope_a2', 'scope_a1', 'ai_seat']);
    expect(a1.email).toBe('a@x.com');

    // B is a different principal shape → a different entry → a real resolve.
    const readsAfterA = ql.calls.length;
    const b1 = await resolveUserAuthzGrants(ql, 'u1', seedsB);
    expect(ql.calls.length).toBeGreaterThan(readsAfterA);
    expect(b1.permissions).toContain('scope_b');
    expect(b1.permissions).not.toContain('scope_a1');
    expect(b1.email).toBe('b@x.com');

    // A's entry survived B's miss — and serves A byte-identically.
    const a2 = await resolveExpectingZeroReads(ql, 'u1', seedsA);
    expect(a2).toEqual(a1);

    // The seeded-API-key path's SUPPRESSED `sys_user` read is preserved in the
    // query multiset: email + ai_seat are seeded and no platform admins are
    // declared, so NO resolution in this test may touch `sys_user` (#11633
    // B.2's query-multiset half — the reason the seedless-envelope option was
    // rejected; see the cache module's keying doc).
    expect(ql.calls.every((c) => c.object !== 'sys_user')).toBe(true);
  });
});

// ── The ruled bypass (core half of pin 6) ───────────────────────────────────

describe('bypassGrantsCache — the ruled force-fresh path', () => {
  it('a bypassed resolution never reads FROM the cache: it observes a change no seam reported', async () => {
    cacheOn(3_600_000);
    const tables = adminTables();
    const ql = makeSeamQl(tables);

    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    // Mutate rows directly — entry stays live, nothing retired it.
    tables.sys_user_permission_set.length = 0;
    const stale = await resolveExpectingZeroReads(ql, 'u1', OPTS);
    expect(stale.permissions).toContain('admin_full_access'); // control: cache IS stale

    const fresh = await resolveUserAuthzGrants(ql, 'u1', { ...OPTS, bypassGrantsCache: true });
    expect(fresh.permissions).not.toContain('admin_full_access');
  });

  it('a bypassed resolution never writes INTO the cache: the stale entry stands after it', async () => {
    cacheOn(3_600_000);
    const tables = adminTables();
    const ql = makeSeamQl(tables);

    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    tables.sys_user_permission_set.length = 0;
    await resolveUserAuthzGrants(ql, 'u1', { ...OPTS, bypassGrantsCache: true });

    // If the bypass had committed its fresh answer, this hit would now be
    // fresh. It must not be — a bypassed resolution repopulating the cache
    // would hand the NEXT cached caller an envelope resolved outside the
    // cache's own snapshot discipline.
    const after = await resolveExpectingZeroReads(ql, 'u1', OPTS);
    expect(after.permissions).toContain('admin_full_access');
  });
});

// ── The decline rule — no seam, no cache ────────────────────────────────────

describe('a ql without the #11968 seams declines to cache (never degrades to TTL-only)', () => {
  it('the recording double (find only, no writeEpoch/registerMiddleware) resolves uncached every time', async () => {
    cacheOn(3_600_000);
    const ql = makeRecordingQl(adminTables());
    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    const afterFirst = ql.calls.length;
    await resolveUserAuthzGrants(ql, 'u1', OPTS);
    // Same reads again: a ql whose writes this cache cannot see is a ql whose
    // answers it must not serve stale — declining IS the contract.
    expect(ql.calls.length).toBe(afterFirst * 2);
  });
});

// ── Pin 9 — multi-node: the bus narrows, the TTL bounds ─────────────────────

describe('pin 9 — two nodes over one database', () => {
  it("WITH a bus: node 1's write retires node 2's entry in one hop (reason 'remote'), no clock advance", async () => {
    cacheOn(3_600_000);
    const tables = adminTables();
    const node1 = makeSeamQl(tables);
    const node2 = makeSeamQl(tables);
    // A bridge double with the real bridge's two rules: never forward a
    // 'remote' bump (loopback), deliver as 'remote' (authz-invalidation-bridge).
    node1.epoch.subscribe((_e, reason) => {
      if (reason !== 'remote') node2.epoch.bump('remote');
    });

    const before = await resolveUserAuthzGrants(node2, 'u1', OPTS);
    expect(before.permissions).toContain('admin_full_access');
    await resolveExpectingZeroReads(node2, 'u1', OPTS); // control: node 2 is serving its entry

    await node1.delete('sys_user_permission_set', { user_id: 'u1' });

    const after = await resolveUserAuthzGrants(node2, 'u1', OPTS);
    expect(after.permissions).not.toContain('admin_full_access');
  });

  it('WITHOUT a bus: node 2 stays stale inside the TTL (the accepted window) and CONVERGES at the TTL — the bound exists independently of the transport', async () => {
    const TTL = 5_000;
    cacheOn(TTL);
    const tables = adminTables();
    const node1 = makeSeamQl(tables);
    const node2 = makeSeamQl(tables);
    const at = (nowMs: number) => ({ ...OPTS, nowMs });

    const before = await resolveUserAuthzGrants(node2, 'u1', at(T));
    expect(before.permissions).toContain('admin_full_access');

    await node1.delete('sys_user_permission_set', { user_id: 'u1' });

    // Node 2 heard nothing. Inside the TTL it answers from its entry — this
    // IS the staleness window the deployment accepted by setting a TTL, and
    // the one the boot-time posture statement names out loud.
    const stale = await resolveExpectingZeroReads(node2, 'u1', at(T + TTL - 1));
    expect(stale.permissions).toContain('admin_full_access');

    // …and the TTL is the correctness contract: past it, node 2 converges
    // with no message ever delivered.
    const converged = await resolveUserAuthzGrants(node2, 'u1', at(T + TTL + 1));
    expect(converged.permissions).not.toContain('admin_full_access');
  });
});
