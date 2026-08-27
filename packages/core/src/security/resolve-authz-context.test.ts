// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveAuthzContext, resolveUserAuthzGrants, resolveLocalizationContext } from './resolve-authz-context.js';
import { POSTURE_RANK } from './posture-ladder.js';
import { hashApiKey } from './api-key.js';
import type { AuthzPosture } from '@objectstack/spec/security';

/**
 * Contract test for the SINGLE authorization resolver. Every authorization
 * source MUST be honored here — this is the regression net that would have
 * caught the REST-vs-dispatcher drift (the REST copy had silently dropped
 * sys_user_position / sys_position_permission_set / platform_admin / ai_seat).
 */

// Minimal in-memory ObjectQL: find(object, { where, limit }) with `===` + `$in`
// match, and the caller's `limit` ENFORCED.
//
// [#10978] The bound is not decoration. A double that matches `where` and hands
// back every row it matched cannot tell a read bounded at 200 from the same read
// bounded at 1000, or from one carrying no bound at all — so raising a limit,
// lowering it, or folding two reads that carry different ones is green BY
// CONSTRUCTION, and the production symptom is a silently truncated result set
// rather than an error. On this file's path that truncation is an authorization
// input: `resolveUserAuthzGrants` reads `sys_member` twice, `{user_id}` at 200
// and `{organization_id}` at 1000, and the obvious "same object, fold them"
// cleanup silently caps the fellow-org peer list (`org_user_ids`, an RLS input)
// at 200 for any organization with more members.
//
// PRESENCE, not truthiness — `limit: 0` means "return no records" and `0` is
// falsy, so `opts.limit ? …` would answer a request for NOTHING with the WHOLE
// table. That is a measured door in this repo, not a hypothetical: see the
// `query.limit !== undefined` comment in `driver-memory`'s `memory-driver.ts`.
// Bounding AFTER the filter matches the real read path (filter → sort → offset →
// limit); these doubles implement no ordering, and no read on this path asks for
// one.
function bounded<T>(rows: T[], opts: any): T[] {
  return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
}

function makeQl(tables: Record<string, any[]>) {
  return {
    async find(object: string, opts: any) {
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      return bounded(
        rows.filter((r) =>
          Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
            return r[k] === v;
          }),
        ),
        opts,
      );
    },
  };
}
const session = (userId: string, opts: { email?: string; org?: string } = {}) =>
  async () => ({ user: { id: userId, email: opts.email }, session: { activeOrganizationId: opts.org ?? null } });
const H = () => new Headers();

describe('resolveAuthzContext — single source of truth', () => {
  it('resolves a custom role granted via sys_user_position (the REST-drift bug)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1', email: 'ada@x.com' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.positions).toContain('contributor');
  });

  it('normalizes sys_member org roles (owner -> org_owner)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', role: 'owner', organization_id: 'o1' }],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    expect(ctx.positions).toContain('org_owner');
  });

  it('resolves role-bound permission sets (sys_position_permission_set)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [],
      sys_position: [{ id: 'r1', name: 'contributor' }],
      sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
      sys_permission_set: [{ id: 'ps1', name: 'contributor_ps', system_permissions: ['cap_x'] }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).toContain('contributor_ps');
    expect(ctx.systemPermissions).toContain('cap_x');
  });

  it('derives platform_admin from an UNSCOPED admin_full_access user grant', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null }],
      sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.positions).toContain('platform_admin');
  });

  it('does NOT derive platform_admin from an ORG-scoped admin_full_access grant', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: 'o1' }],
      sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    expect(ctx.positions).not.toContain('platform_admin');
  });

  it('synthesizes ai_seat from sys_user.ai_access (sqlite integer 1)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1', ai_access: 1 }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).toContain('ai_seat');
  });

  it('anonymous (no session, no api key) → empty context', async () => {
    const ctx = await resolveAuthzContext({ ql: makeQl({}), headers: H(), getSession: async () => undefined });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.positions).toEqual([]);
    expect(ctx.permissions).toEqual([]);
  });
});

// A counting ObjectQL: records how many find() calls hit each object so we can
// assert the de-duplication of redundant authz/localization reads (#2409).
function makeCountingQl(tables: Record<string, any[]>) {
  const counts: Record<string, number> = {};
  return {
    counts,
    async find(object: string, opts: any) {
      counts[object] = (counts[object] ?? 0) + 1;
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      return bounded(
        rows.filter((r) =>
          Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
            return r[k] === v;
          }),
        ),
        opts,
      );
    },
  };
}

describe('resolveAuthzContext — request-scoped read de-duplication (#2409)', () => {
  it('reads sys_user at most once even when both email fallback and ai_seat need it', async () => {
    // No email in the session → email fallback reads sys_user; ai_seat synthesis
    // also needs sys_user. Previously these were two separate queries.
    const ql = makeCountingQl({
      sys_user: [{ id: 'u1', email: 'ada@x.com', ai_access: 1 }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.email).toBe('ada@x.com');
    expect(ctx.permissions).toContain('ai_seat');
    expect(ql.counts.sys_user).toBe(1);
  });
});

describe('resolveLocalizationContext — batched fallback read (#2409)', () => {
  it('reads sys_setting once (all three keys) when no settings service is wired', async () => {
    const ql = makeCountingQl({
      sys_setting: [
        { namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'Asia/Tokyo' },
        { namespace: 'localization', key: 'locale', scope: 'tenant', value: 'ja-JP' },
        { namespace: 'localization', key: 'currency', scope: 'tenant', value: 'JPY' },
      ],
    });
    const loc = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(loc).toEqual({ timezone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' });
    expect(ql.counts.sys_setting).toBe(1);
  });

  it('falls back to UTC / en-US when no rows exist', async () => {
    const ql = makeCountingQl({ sys_setting: [] });
    const loc = await resolveLocalizationContext({ ql });
    expect(loc.timezone).toBe('UTC');
    expect(loc.locale).toBe('en-US');
    expect(loc.currency).toBeUndefined();
  });

  // [#10826] The settings-service path prefers ONE grouped getMany over three
  // per-key get()s; an older service without getMany keeps the three gets;
  // a thrown getMany lands in the same direct-$in fallback a thrown get did.
  it('prefers settings.getMany (one grouped call) and never calls per-key get', async () => {
    const getMany = { calls: 0 };
    const settings = {
      get: async () => { throw new Error('per-key get must not be called'); },
      getMany: async (ns: string, keys: readonly string[]) => {
        getMany.calls += 1;
        expect(ns).toBe('localization');
        expect([...keys].sort()).toEqual(['currency', 'locale', 'timezone']);
        return {
          timezone: { value: 'Asia/Tokyo' },
          locale: { value: 'ja-JP' },
          currency: { value: 'JPY' },
        };
      },
    };
    const ql = makeCountingQl({ sys_setting: [] });
    const loc = await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(loc).toEqual({ timezone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' });
    expect(getMany.calls).toBe(1);
    expect(ql.counts.sys_setting ?? 0).toBe(0); // service answered — no direct read
  });

  it('a service without getMany keeps the three per-key gets (older deployments)', async () => {
    let gets = 0;
    const settings = {
      get: async (_ns: string, key: string) => {
        gets += 1;
        return { value: key === 'timezone' ? 'Asia/Tokyo' : key === 'locale' ? 'ja-JP' : 'JPY' };
      },
    };
    const ql = makeCountingQl({ sys_setting: [] });
    const loc = await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(loc).toEqual({ timezone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' });
    expect(gets).toBe(3);
  });

  it('a thrown getMany falls back to the direct $in read, same as a broken service', async () => {
    const settings = {
      get: async () => { throw new Error('unused'); },
      getMany: async () => { throw new Error('store exploded'); },
    };
    const ql = makeCountingQl({
      sys_setting: [
        { namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'Europe/Paris' },
      ],
    });
    const loc = await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(loc.timezone).toBe('Europe/Paris');
    expect(ql.counts.sys_setting).toBe(1); // the batched $in fallback ran once
  });

  // ── [#11222 items 2 + 3] LEGS, and the resolution context ────────────────
  //
  // The pins above count CALLS (`getMany.calls`, `gets === 3`). #10826's whole
  // calibration is that the three reads it collapsed already ran in ONE leg —
  // "a query-count fix, not a latency fix" (cloud#1539). Nothing pinned that.
  // A future edit turning the per-key fallback's `Promise.all` into a
  // sequential `for` loop takes legs 1 -> 3 while every call-count assertion
  // above stays green; legs are the latency multiplier, so that regression is
  // exactly the one the existing pins cannot see.
  //
  // And the `getMany` double above is declared with TWO parameters, so it is
  // structurally unable to observe the third argument: drop `sctx` from the
  // production call and all three pins stay green. The rig's double takes it.

  /**
   * A settings-service double that MEASURES what the resolver asks for.
   *
   *  - `queries` — every row load. `loadRows` stands in for the real service's
   *    namespace row load, so one call is one `sys_setting` query.
   *  - `legs` — every row load that STARTS while nothing else is in flight,
   *    i.e. the number of sequential round-trip WAVES. Three loads issued
   *    inside one `Promise.all` all increment `inFlight` synchronously before
   *    any of them resumes past its first `await`, so they count as ONE leg;
   *    three awaited in sequence count as three. That is the leg definition
   *    cloud#1539 used, and it is what makes "3 queries, 1 leg" measurable
   *    rather than asserted.
   *
   * `batched: false` reproduces the pre-#10826 occupant (only `get`), which is
   * also the shape the resolver still falls back to for a host-provided
   * settings service that predates `getMany`.
   */
  function makeSettingsRig(
    values: Record<string, unknown>,
    { batched }: { batched: boolean },
  ) {
    const stats = { queries: 0, legs: 0 };
    const calls: Array<{ method: string; args: any[] }> = [];
    let inFlight = 0;
    const loadRows = async () => {
      stats.queries += 1;
      if (inFlight === 0) stats.legs += 1; // nothing else in flight -> a new wave
      inFlight += 1;
      try {
        await Promise.resolve();
        return values;
      } finally {
        inFlight -= 1;
      }
    };
    const pick = (loaded: Record<string, unknown>, key: string) =>
      key in loaded
        ? { value: loaded[key], source: 'tenant' }
        : { value: undefined, source: 'default' };
    const rig: any = {
      stats,
      calls,
      async get(namespace: string, key: string, ctx: any) {
        calls.push({ method: 'get', args: [namespace, key, ctx] });
        return pick(await loadRows(), key);
      },
    };
    if (batched) {
      // NOTE the THIRD parameter — this is item 3's fix, not a detail: the
      // double must accept `ctx` to be able to assert it was forwarded.
      rig.getMany = async (namespace: string, keys: readonly string[], ctx: any) => {
        calls.push({ method: 'getMany', args: [namespace, [...keys], ctx] });
        const loaded = await loadRows();
        const out: Record<string, unknown> = {};
        for (const key of keys) out[key] = pick(loaded, key);
        return out;
      };
    }
    return rig;
  }

  const VALUES = { timezone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' };
  const EXPECTED = { timezone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' };

  it('a per-key occupant issues three namespace reads in ONE leg (the pre-#10826 cost)', async () => {
    const settings = makeSettingsRig(VALUES, { batched: false });
    const ql = makeCountingQl({ sys_setting: [] });
    const loc = await resolveLocalizationContext({ ql, settings, tenantId: 'o1', userId: 'u1' });
    expect(loc).toEqual(EXPECTED);
    expect(settings.stats).toEqual({ queries: 3, legs: 1 });
    // The settings path answered, so the direct `sys_setting` fallback is not
    // reached — the three reads above are the whole cost.
    expect(ql.counts.sys_setting ?? 0).toBe(0);
  });

  it('the batched occupant issues ONE namespace read, in the same ONE leg', async () => {
    const settings = makeSettingsRig(VALUES, { batched: true });
    const ql = makeCountingQl({ sys_setting: [] });
    const loc = await resolveLocalizationContext({ ql, settings, tenantId: 'o1', userId: 'u1' });
    expect(loc).toEqual(EXPECTED);
    // queries 3 -> 1, legs 1 -> 1. #10826 was correctly scheduled as a
    // query-count fix; the `legs` half is what a sequential-loop regression
    // would move, and it is now pinned in both directions.
    expect(settings.stats).toEqual({ queries: 1, legs: 1 });
    expect(ql.counts.sys_setting ?? 0).toBe(0);
  });

  it('asks for all three keys of the one namespace in a single call, with the resolution context', async () => {
    const settings = makeSettingsRig(VALUES, { batched: true });
    await resolveLocalizationContext({
      ql: makeCountingQl({ sys_setting: [] }),
      settings,
      tenantId: 'o1',
      userId: 'u1',
    });
    expect(settings.calls).toEqual([
      {
        method: 'getMany',
        args: ['localization', ['timezone', 'locale', 'currency'], { tenantId: 'o1', userId: 'u1' }],
      },
    ]);
  });
});

// Simulates a fresh environment: `sys_setting` not migrated/written yet, so
// every read rejects the way the real sql-driver's "no such table" does.
// Shared by the #10221 cache block below and the #11877 leg-narrowing block
// after it, which needs the same backend fault standing BEHIND a settings
// refusal.
function makeMissingTableQl() {
  const counts = { sys_setting: 0 };
  return {
    counts,
    async find(_object: string) {
      counts.sys_setting += 1;
      throw new Error('no such table: sys_setting');
    },
  };
}

// #10221: a fresh environment's `sys_setting` table doesn't exist yet, so
// EVERY request's read used to fail and the sql-driver's `[sql-driver]
// DATABASE_ERROR` warning repeated once per request, burying real errors.
// The #2409 batching above already collapsed one request down to a single
// query; this collapses the FAILING query across requests with a short TTL
// cache — but ONLY the failure, never a successful (or legitimately empty)
// read on a `ql` that offers no way to learn a write happened. (#11966 later
// added the success cache behind exactly that seam; the failure memo below is
// untouched by it, and a dedicated pin in `resolve-localization-cache.test.ts`
// holds it untouched — retiring it on a write would restart this very spam.) A first version cached every outcome, mirroring
// `packages/plugins/plugin-audit/src/audit-writers.ts` (`resolveWriteLocale`)'s
// existing memoization of this same read — that broke
// `packages/qa/dogfood/test/analytics-timezone.dogfood.test.ts` (#1982/#2018),
// which writes a new org timezone and expects the very next analytics read to
// bucket under it. See the cache doc on `resolveLocalizationContext` for why
// audit-writer's staleness tolerance doesn't transfer here.
describe('resolveLocalizationContext — failure-only cross-request cache (#10221)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-query on a second call within the TTL window when the read fails (same tenant)', async () => {
    const ql = makeMissingTableQl();
    const first = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    const second = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    // Functional behavior is unchanged — still the built-in defaults — the
    // second call just doesn't repeat the failing query (and its log line).
    expect(first).toEqual({ timezone: 'UTC', locale: 'en-US', currency: undefined });
    expect(second).toEqual(first);
    expect(ql.counts.sys_setting).toBe(1);
  });

  it('re-queries once the TTL expires, so the cache self-heals once the table/migration lands', async () => {
    const ql = makeMissingTableQl();
    await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(ql.counts.sys_setting).toBe(1);
    await vi.advanceTimersByTimeAsync(30_001);
    await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(ql.counts.sys_setting).toBe(2);
  });

  it('keys the failure cache per tenant, so a lookup for one tenant never reuses another tenant\'s entry', async () => {
    const qlA = makeMissingTableQl();
    // Reuse the SAME underlying table state across two tenant-scoped calls by
    // routing both through one `ql`, distinguished only by `tenantId` in the
    // cache key (the direct-read fallback query itself is not tenant-scoped
    // in its `where`, matching the real resolver's existing behavior).
    await resolveLocalizationContext({ ql: qlA, tenantId: 'tenant-a' });
    await resolveLocalizationContext({ ql: qlA, tenantId: 'tenant-b' });
    expect(qlA.counts.sys_setting).toBe(2);
    // A repeat for the first tenant hits its own cache entry, not tenant-b's.
    await resolveLocalizationContext({ ql: qlA, tenantId: 'tenant-a' });
    expect(qlA.counts.sys_setting).toBe(2);
  });

  it('keys the failure cache per `ql` instance, so two environments in one process never share a cached outcome', async () => {
    const qlA = makeMissingTableQl();
    const qlB = makeMissingTableQl();
    await resolveLocalizationContext({ ql: qlA, tenantId: 'o1' });
    await resolveLocalizationContext({ ql: qlB, tenantId: 'o1' });
    expect(qlA.counts.sys_setting).toBe(1);
    expect(qlB.counts.sys_setting).toBe(1);
  });

  // The dogfood-test guard (#1982/#2018 golden regression): a SUCCESSFUL read
  // must never be served stale. Simulates the exact shape of the failing CI
  // scenario — a settings write changes the effective row between two calls —
  // entirely at this unit level, without booting the dogfood stack.
  //
  // [#11966] `makeCountingQl` carries no write-epoch seam, and that is now
  // load-bearing rather than incidental: leg C caches a success ONLY behind an
  // engine that can tell it a write happened, so this double pins the
  // seam-ABSENT arm — where the pre-#11966 multiset must survive byte for byte.
  // The seam-PRESENT arm is `resolve-localization-cache.test.ts`, which pins
  // the same staleness property through the invalidation instead of through the
  // absence of a cache.
  it('without an engine write-epoch seam, a successful read is never cached: a value change between two calls is visible on the very next call', async () => {
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'UTC' }];
    const ql = makeCountingQl({ sys_setting: rows });
    const first = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(first.timezone).toBe('UTC');
    // Simulate a settings write landing between the two calls — no TTL
    // advance, so a cache would still be "fresh" if one existed.
    rows[0].value = 'America/Los_Angeles';
    const second = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(second.timezone).toBe('America/Los_Angeles');
    expect(ql.counts.sys_setting).toBe(2);
  });

  // A legitimate empty result (table exists, no settings configured for this
  // tenant yet) is a successful read too — not a failure — so on a seam-less
  // `ql` it must not be cached either: the first write for a previously-
  // unconfigured tenant must be visible on the very next call, same as the
  // value-change case above. (#11966: same seam-absent arm as that case.)
  it('without a seam, a legitimate empty result is not cached either: the first write for a previously-unconfigured tenant is visible immediately', async () => {
    const rows: Array<{ namespace: string; key: string; scope: string; value: string }> = [];
    const ql = makeCountingQl({ sys_setting: rows });
    const first = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(first).toEqual({ timezone: 'UTC', locale: 'en-US', currency: undefined });
    rows.push({ namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'Asia/Tokyo' });
    const second = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(second.timezone).toBe('Asia/Tokyo');
    expect(ql.counts.sys_setting).toBe(2);
  });
});

// ── #11877 — a SETTINGS-SERVICE refusal must not populate the failure memo ──
//
// The memo above exists for one thing (#10221): a `sys_setting` query that
// actively FAILS must not re-run — and re-log the driver's line — on every
// request. Its write condition was wider than that. `failed` was set by SIX
// legs and only ONE of them is the backend fault the cache's own docblock
// describes:
//
//   settings.getMany(...) threw            — the grouped read (settings leg)
//   settings.get(...) threw          × 3   — the older per-key arm (settings)
//   the settings block threw               — "service unavailable" (settings)
//   ql.find('sys_setting', ...) threw      — THE backend fault
//
// The five settings legs are reachable INSIDE the settings engine's bind
// window: `SettingsService.getMany` refuses all-or-nothing for a
// `localization` namespace whose manifest is not (yet) registered. So a
// caller that deliberately re-reads AFTER the bind — the #11580 repair does
// exactly that, re-resolving at `kernel:bootstrapped` — could be answered
// from the memo taken inside the window, within the 30s TTL, with nothing in
// the output saying the correction did not happen.
//
// And directly against this cache's own docblock ("a successful read is NEVER
// cached"): a settings refusal standing alongside a perfectly SUCCESSFUL
// direct read memoized that successful value for 30s — the exact staleness
// `analytics-timezone.dogfood.test.ts` (#1982/#2018) exists to forbid.
//
// So the memo is written only for the backend-fault leg now. #10221's
// protection is untouched, and BOTH directions are pinned below: a genuine
// backend fault still memoizes — including with a settings refusal standing
// in front of it — while a settings refusal alone no longer does.
describe('resolveLocalizationContext — only a backend fault populates the memo (#11877)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** What the workspace has PERSISTED — answerable only once the engine binds. */
  const CONFIGURED = { timezone: 'Asia/Shanghai', locale: 'zh-CN', currency: 'CNY' };

  // The all-or-nothing refusal `SettingsService.getMany` gives for a namespace
  // whose manifest is not (yet) registered. It throws out of an in-memory
  // registry check — before any query, before any log line — which is why
  // memoizing THIS leg never suppressed a query or a log line to begin with.
  function makeBindWindowSettings() {
    const state = { bound: false, getManyCalls: 0 };
    return {
      state,
      get: async () => {
        throw new Error('per-key get must not be called on the batched arm');
      },
      getMany: async () => {
        state.getManyCalls += 1;
        if (!state.bound) throw new Error("unknown settings namespace 'localization'");
        return {
          timezone: { value: CONFIGURED.timezone },
          locale: { value: CONFIGURED.locale },
          currency: { value: CONFIGURED.currency },
        };
      },
    };
  }

  // ── the reproduction this card was filed without ────────────────────────
  //
  // Pre-bind read inside the window (settings refuses, `sys_setting` answers
  // an ordinary empty result) → deliberate post-bind re-read 1s later, well
  // inside the 30s TTL. The clock is FAKE and advanced explicitly; nothing
  // here sleeps on the wall clock.
  it('a post-bind re-read inside the TTL is answered by the now-bound service, not by the pre-bind memo', async () => {
    const settings = makeBindWindowSettings();
    const ql = makeCountingQl({ sys_setting: [] });

    const preBind = await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(preBind).toEqual({ timezone: 'UTC', locale: 'en-US', currency: undefined });
    expect(settings.state.getManyCalls).toBe(1);

    settings.state.bound = true; // the settings engine binds
    await vi.advanceTimersByTimeAsync(1_000); // still deep inside the 30s window

    const postBind = await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    // The re-read must REACH the service (a memo hit would never call it) and
    // must carry the configured values, which exist only behind the bind.
    expect(settings.state.getManyCalls).toBe(2);
    expect(postBind).toEqual({ timezone: 'Asia/Shanghai', locale: 'zh-CN', currency: 'CNY' });
  });

  // The same refusal, but the direct read SUCCEEDS with rows. The memoized
  // value here was a correct, successful answer — frozen for 30s by a leg that
  // has nothing to do with the backend.
  it('a settings refusal never freezes a SUCCESSFUL direct read: a row change is visible on the very next call', async () => {
    const settings = makeBindWindowSettings(); // stays unbound → refuses every call
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'UTC' }];
    const ql = makeCountingQl({ sys_setting: rows });

    const first = await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(first.timezone).toBe('UTC');

    rows[0].value = 'America/Los_Angeles'; // a settings write lands, no TTL advance
    const second = await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(second.timezone).toBe('America/Los_Angeles');
    expect(ql.counts.sys_setting).toBe(2);
  });

  // The older per-key arm (a service with no `getMany`): three `get` legs,
  // same rule.
  it('the per-key get legs do not populate the memo either', async () => {
    const state = { bound: false, gets: 0 };
    const settings = {
      get: async (_ns: string, key: string) => {
        state.gets += 1;
        if (!state.bound) throw new Error("unknown settings namespace 'localization'");
        return { value: (CONFIGURED as Record<string, string>)[key] };
      },
    };
    const ql = makeCountingQl({ sys_setting: [] });

    expect(await resolveLocalizationContext({ ql, settings, tenantId: 'o1' })).toEqual({
      timezone: 'UTC',
      locale: 'en-US',
      currency: undefined,
    });
    expect(state.gets).toBe(3);

    state.bound = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await resolveLocalizationContext({ ql, settings, tenantId: 'o1' })).toEqual({
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
      currency: 'CNY',
    });
    expect(state.gets).toBe(6);
  });

  // The whole-block leg: a `get` that throws SYNCHRONOUSLY never attaches its
  // `.catch`, so the throw escapes `Promise.all` into the outer
  // "settings service unavailable → direct read" handler. Same rule.
  it('the outer "settings service unavailable" leg does not populate the memo either', async () => {
    const state = { bound: false, gets: 0 };
    const settings = {
      // Deliberately NOT async: this throws before a promise exists.
      get: (_ns: string, key: string) => {
        state.gets += 1;
        if (!state.bound) throw new Error('settings service unavailable');
        return Promise.resolve({ value: (CONFIGURED as Record<string, string>)[key] });
      },
    };
    const ql = makeCountingQl({ sys_setting: [] });

    expect(await resolveLocalizationContext({ ql, settings, tenantId: 'o1' })).toEqual({
      timezone: 'UTC',
      locale: 'en-US',
      currency: undefined,
    });

    state.bound = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await resolveLocalizationContext({ ql, settings, tenantId: 'o1' })).timezone).toBe('Asia/Shanghai');
  });

  // ── the half that must be PRESERVED (#10221) ────────────────────────────
  //
  // Narrowing the write condition must not narrow it to nothing. A settings
  // refusal standing in FRONT of a genuinely failing `sys_setting` read is the
  // real #10221 environment (fresh deployment: no manifest registered yet AND
  // no table yet) — the failing query must still be memoized there.
  it('still memoizes when a settings refusal stands in front of a genuine backend fault', async () => {
    const settings = makeBindWindowSettings(); // unbound → refuses
    const ql = makeMissingTableQl(); // and the direct read throws

    await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(ql.counts.sys_setting).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    // Memo hit: the failing query — and the driver's log line for it — did not
    // repeat. The settings refusal is re-attempted (it is free), but that is
    // not what #10221 was protecting.
    expect(ql.counts.sys_setting).toBe(1);

    await vi.advanceTimersByTimeAsync(30_001);
    await resolveLocalizationContext({ ql, settings, tenantId: 'o1' });
    expect(ql.counts.sys_setting).toBe(2); // and it still self-heals on expiry
  });
});

describe('grant validity windows (ADR-0091 D1/D2)', () => {
  const NOW = Date.parse('2026-07-10T12:00:00Z');
  const PAST = '2026-07-01T00:00:00Z';
  const FUTURE = '2026-08-01T00:00:00Z';

  it('an expired sys_user_position row does not resolve', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [
        { user_id: 'u1', position: 'approver', organization_id: null, valid_until: PAST },
        { user_id: 'u1', position: 'contributor', organization_id: null },
      ],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).not.toContain('approver');
    expect(ctx.positions).toContain('contributor'); // null bounds = unbounded, unchanged
  });

  it('a not-yet-active sys_user_position row (future valid_from) does not resolve', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'approver', organization_id: null, valid_from: FUTURE }],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).not.toContain('approver');
  });

  it('a row inside its [from, until) window resolves; until is exclusive', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [
        { user_id: 'u1', position: 'stand_in', organization_id: null, valid_from: PAST, valid_until: FUTURE },
        // Boundary: valid_until exactly NOW → inactive AT the bound (half-open).
        { user_id: 'u1', position: 'boundary', organization_id: null, valid_until: '2026-07-10T12:00:00Z' },
      ],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).toContain('stand_in');
    expect(ctx.positions).not.toContain('boundary');
  });

  it('an expired direct permission-set grant resolves to nothing — including platform_admin derivation', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'u1', permission_set_id: 'psA', organization_id: null, valid_until: PAST },
      ],
      sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.permissions).not.toContain('admin_full_access');
    expect(ctx.positions).not.toContain('platform_admin');
  });

  it('fails closed on an unparseable valid_until', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'approver', organization_id: null, valid_until: 'not-a-date' }],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).not.toContain('approver');
  });

  // ── #10982 — the sys_member half: ONE row, ONE answer ───────────────────
  //
  // `resolveUserAuthzGrants` reads `sys_member` ONCE and derives two facts from
  // it: `accessible_org_ids` (the `group` posture's read reach) and the
  // org-administration role projection into `positions`. Only the first applied
  // the ADR-0091 window, so a lapsed membership granted no org ACCESS while
  // still conferring its org-admin ROLE — two answers from one row.
  //
  // Maintainer ruling, 2026-08-22 live session (item 2): **A — the role
  // projection honours the window. A lapsed membership is NO MEMBERSHIP, not
  // merely no org access.** Fail-closed per ADR-0091 D2. The fix is one
  // `isGrantActive` call in the `activeMembers` filter, placed BEFORE the
  // derivation — the shape §6 already gives `sys_user_permission_set`.
  //
  // ⚠️ `sys_member` declares NEITHER bound today, and `isGrantActive` reads an
  // absent bound as unbounded, so no shipped row can be lapsed and none changes
  // answer. The unbounded leg below is what says that out loud; without it this
  // block would be satisfied by an implementation that filtered everything and
  // silently un-admined every real org member.
  describe('#10982 — a lapsed sys_member row confers no role either', () => {
    it('a lapsed membership projects NO org role, and no org access — one row, one answer', async () => {
      const ql = makeQl({
        sys_user: [{ id: 'u1' }],
        sys_member: [{ user_id: 'u1', role: 'member', organization_id: 'o1', valid_until: PAST }],
        sys_user_position: [],
        sys_user_permission_set: [],
      });
      const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }), nowMs: NOW });
      // The half that was already correct.
      expect(ctx.accessible_org_ids).toEqual([]);
      // The half this card fixes — it used to carry `org_member`.
      expect(ctx.positions).not.toContain('org_member');
      // `everyone` is the ADR-0090 D5 audience anchor, held by every
      // AUTHENTICATED principal and NOT membership-derived: asserted present so
      // the line above cannot pass by the resolver having returned nothing.
      expect(ctx.positions).toContain('everyone');
    });

    it('a not-yet-active membership (future valid_from) projects no role either', async () => {
      const ql = makeQl({
        sys_user: [{ id: 'u1' }],
        sys_member: [{ user_id: 'u1', role: 'admin', organization_id: 'o1', valid_from: FUTURE }],
        sys_user_position: [],
        sys_user_permission_set: [],
      });
      const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }), nowMs: NOW });
      expect(ctx.positions).not.toContain('org_admin');
      expect(ctx.accessible_org_ids).toEqual([]);
    });

    // ⛔ LOAD-BEARING. An implementation that dropped every membership row would
    // satisfy every lapsed assertion above while un-admining the entire
    // installed base. Both rows sit in the SAME organization on purpose: the
    // active-org filter cannot explain either verdict, so the ONLY thing
    // separating them is the validity window — a blanket filter fails the first
    // assertion, and no filter at all fails the second.
    it('an ACTIVE membership still projects its role — the lapsed legs cannot pass vacuously', async () => {
      const tables = {
        sys_user: [{ id: 'u1' }],
        sys_member: [
          { user_id: 'u1', role: 'owner', organization_id: 'o2', valid_until: PAST },
          { user_id: 'u1', role: 'member', organization_id: 'o2', valid_from: PAST, valid_until: FUTURE },
        ],
        sys_user_position: [],
        sys_user_permission_set: [],
      };
      const ctx = await resolveAuthzContext({
        ql: makeQl(tables), headers: H(), getSession: session('u1', { org: 'o2' }), nowMs: NOW,
      });
      expect(ctx.positions).toContain('org_member'); // the in-window row still grants
      expect(ctx.positions).not.toContain('org_owner'); // the lapsed one, same org, does not
      expect(ctx.accessible_org_ids).toEqual(['o2']); // and the two halves agree
    });

    // ⛔ LOAD-BEARING, the safe-to-land-now leg. `sys_member` has no
    // `valid_from`/`valid_until` columns, so EVERY shipped row looks like this.
    // If this reddens, the change is not a tightening — it is a regression on
    // every existing deployment.
    it('a membership with NO bounds is unbounded — every shipped row is unaffected', async () => {
      const ql = makeQl({
        sys_user: [{ id: 'u1' }],
        sys_member: [{ user_id: 'u1', role: 'owner,member', organization_id: 'o1' }],
        sys_user_position: [],
        sys_user_permission_set: [],
      });
      const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }), nowMs: NOW });
      expect(ctx.positions).toContain('org_owner');
      expect(ctx.positions).toContain('org_member');
      expect(ctx.accessible_org_ids).toEqual(['o1']);
    });

    // ── The escalation the card is filed on ──────────────────────────────
    //
    // Make the lapsed row's role `owner` and the question stops being tidiness:
    // `org_owner` is a capability-bearing name. A suite that only checked
    // `org_member` would not catch a regression here, so the rung is pinned in
    // BOTH directions on the same fixture shape.
    //
    // ⚠️ Which escalation path this closes, stated precisely, because the two
    // differ: `derivePosture` reads HELD CAPABILITY GRANTS, never the
    // better-auth role (ADR-0095 D2/D3). The role reaches TENANT_ADMIN by two
    // routes — (P) `org_owner` resolves a `sys_position` row whose bound set is
    // an org-admin grant, entirely inside this resolver; and (D) plugin-security's
    // `reconcileOrgAdminGrant` provisions a direct `sys_user_permission_set`
    // row from the role. This fix closes (P). It deliberately does NOT reach
    // into (D): that row is standing authority in its own right, carrying its
    // OWN ADR-0091 window, and revoking someone else's grant row from a read
    // path is not this resolver's job. Both are pinned below so the boundary is
    // a measured fact rather than an assumption.
    const orgOwnerPositionTables = (memberRow: Record<string, unknown>) => ({
      sys_user: [{ id: 'esc' }],
      sys_member: [{ user_id: 'esc', role: 'owner', organization_id: 'o1', ...memberRow }],
      sys_user_position: [],
      sys_user_permission_set: [],
      sys_position: [{ id: 'pos_owner', name: 'org_owner' }],
      sys_position_permission_set: [{ position_id: 'pos_owner', permission_set_id: 'psO' }],
      sys_permission_set: [{ id: 'psO', name: 'organization_admin' }],
    });

    it('escalation, BEFORE: an ACTIVE owner membership still resolves TENANT_ADMIN', async () => {
      const ctx = await resolveAuthzContext({
        ql: makeQl(orgOwnerPositionTables({})), headers: H(),
        getSession: session('esc', { org: 'o1' }), nowMs: NOW,
      });
      expect(ctx.positions).toContain('org_owner');
      expect(ctx.permissions).toContain('organization_admin');
      expect(ctx.posture).toBe('TENANT_ADMIN');
    });

    it('escalation, AFTER: a LAPSED owner membership resolves MEMBER, not TENANT_ADMIN', async () => {
      const ctx = await resolveAuthzContext({
        ql: makeQl(orgOwnerPositionTables({ valid_until: PAST })), headers: H(),
        getSession: session('esc', { org: 'o1' }), nowMs: NOW,
      });
      expect(ctx.positions).not.toContain('org_owner');
      // The rung falls with the name: `org_owner` never resolves its
      // `sys_position` row, so the bound org-admin set is never collected.
      expect(ctx.permissions).not.toContain('organization_admin');
      expect(ctx.posture).toBe('MEMBER');
      expect(ctx.accessible_org_ids).toEqual([]);
    });

    it('the boundary: a DIRECT org-admin grant is standing authority and survives the lapse — by design', async () => {
      // Route (D). The role is only the PROVISIONING source (ADR-0095 D3); the
      // grant row it caused is separate authority with its own window. So the
      // role projection goes quiet while the capability keeps resolving. This
      // is the correct layering, not a residual hole — but it IS the reason the
      // rung can outlive the membership, so it is pinned rather than assumed.
      const ql = makeQl({
        sys_user: [{ id: 'esc2' }],
        sys_member: [{ user_id: 'esc2', role: 'owner', organization_id: 'o1', valid_until: PAST }],
        sys_user_position: [],
        sys_user_permission_set: [{ user_id: 'esc2', permission_set_id: 'psO', organization_id: 'o1' }],
        sys_permission_set: [{ id: 'psO', name: 'organization_admin' }],
      });
      const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('esc2', { org: 'o1' }), nowMs: NOW });
      expect(ctx.positions).not.toContain('org_owner'); // the role projection is closed
      expect(ctx.permissions).toContain('organization_admin'); // the grant row is not
      expect(ctx.posture).toBe('TENANT_ADMIN');
      expect(ctx.accessible_org_ids).toEqual([]); // and access is still withheld
    });
  });
});

describe('audience anchors in the resolver (ADR-0090 D5)', () => {
  it('every authenticated principal implicitly holds `everyone` (additive, no cliff)', async () => {
    const ql = makeQl({
      sys_member: [{ user_id: 'u1', role: 'member', organization_id: 'o1' }],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    // holding an explicit position must NOT cost the baseline anchor
    expect(ctx.positions).toContain('contributor');
    expect(ctx.positions).toContain('everyone');
  });

  it('anonymous resolution never gains `everyone`', async () => {
    const ql = makeQl({});
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: async () => undefined });
    expect(ctx.positions).not.toContain('everyone');
    expect(ctx.userId).toBeUndefined();
  });
});

/**
 * [ADR-0095 D2/D3] Posture-ladder resolution. A `principal × grants → posture`
 * matrix asserting the rung is DERIVED from held capability grants
 * (`admin_full_access` → PLATFORM_ADMIN; `organization_admin` → TENANT_ADMIN;
 * otherwise MEMBER), never from a better-auth role, plus the strict-nesting
 * ordering (PLATFORM_ADMIN > TENANT_ADMIN > MEMBER). `EXTERNAL` is never
 * resolved — no external principal type exists yet.
 */
describe('resolveAuthzContext — posture ladder (ADR-0095 D2/D3)', () => {
  // Each fixture returns the ql tables + the session getter for one principal.
  const FIXTURES: Record<string, { ql: any; getSession: any }> = {
    // Unscoped admin_full_access grant → the platform-admin capability.
    platform_admin: {
      ql: makeQl({
        sys_user: [{ id: 'pa' }],
        sys_member: [],
        sys_user_position: [],
        sys_user_permission_set: [{ user_id: 'pa', permission_set_id: 'psA', organization_id: null }],
        sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
      }),
      getSession: session('pa'),
    },
    // Org-scoped organization_admin grant (auto-provisioned from role=admin).
    tenant_admin: {
      ql: makeQl({
        sys_user: [{ id: 'ta' }],
        sys_member: [{ user_id: 'ta', role: 'admin', organization_id: 'o1' }],
        sys_user_position: [],
        sys_user_permission_set: [{ user_id: 'ta', permission_set_id: 'psO', organization_id: 'o1' }],
        sys_permission_set: [{ id: 'psO', name: 'organization_admin' }],
      }),
      getSession: session('ta', { org: 'o1' }),
    },
    // Ordinary member — no admin capability grant.
    member: {
      ql: makeQl({
        sys_user: [{ id: 'm' }],
        sys_member: [{ user_id: 'm', role: 'member', organization_id: 'o1' }],
        sys_user_position: [],
        sys_user_permission_set: [],
        sys_permission_set: [],
      }),
      getSession: session('m', { org: 'o1' }),
    },
    // Authenticated but no active org — still the MEMBER floor, not EXTERNAL.
    no_org_member: {
      ql: makeQl({
        sys_user: [{ id: 'n' }],
        sys_member: [],
        sys_user_position: [],
        sys_user_permission_set: [],
      }),
      getSession: session('n'),
    },
  };

  const EXPECTED_POSTURE: Record<string, AuthzPosture> = {
    platform_admin: 'PLATFORM_ADMIN',
    tenant_admin: 'TENANT_ADMIN',
    member: 'MEMBER',
    no_org_member: 'MEMBER',
  };

  it('resolves the principal × grants → posture matrix', async () => {
    const actual: Record<string, AuthzPosture | undefined> = {};
    for (const [name, fx] of Object.entries(FIXTURES)) {
      const ctx = await resolveAuthzContext({ ql: fx.ql, headers: H(), getSession: fx.getSession });
      actual[name] = ctx.posture;
    }
    expect(actual).toEqual(EXPECTED_POSTURE);
  });

  it('posture is strictly nested: PLATFORM_ADMIN > TENANT_ADMIN > MEMBER', async () => {
    const rank = async (name: string) => {
      const fx = FIXTURES[name];
      const ctx = await resolveAuthzContext({ ql: fx.ql, headers: H(), getSession: fx.getSession });
      return POSTURE_RANK[ctx.posture!];
    };
    expect(await rank('platform_admin')).toBeGreaterThan(await rank('tenant_admin'));
    expect(await rank('tenant_admin')).toBeGreaterThan(await rank('member'));
  });

  it('platform-admin grant wins over a co-held org-admin grant (capability, not role)', async () => {
    // A principal who is BOTH an org admin (role) AND holds the unscoped
    // platform grant resolves PLATFORM_ADMIN — derivation reads the capability,
    // so the higher rung wins regardless of the better-auth role.
    const ql = makeQl({
      sys_user: [{ id: 'both' }],
      sys_member: [{ user_id: 'both', role: 'admin', organization_id: 'o1' }],
      sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'both', permission_set_id: 'psA', organization_id: null },
        { user_id: 'both', permission_set_id: 'psO', organization_id: 'o1' },
      ],
      sys_permission_set: [
        { id: 'psA', name: 'admin_full_access' },
        { id: 'psO', name: 'organization_admin' },
      ],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('both', { org: 'o1' }) });
    expect(ctx.posture).toBe('PLATFORM_ADMIN');
  });

  it('anonymous principal carries no posture rung', async () => {
    const ctx = await resolveAuthzContext({ ql: makeQl({}), headers: H(), getSession: async () => undefined });
    expect(ctx.posture).toBeUndefined();
  });
});

/**
 * #3356 — the userId-driven core, callable WITHOUT an HTTP request. A
 * `runAs:'user'` automation run knows the triggering user's id (the record-change
 * hook session carries only that) and must build the SAME positions/permissions
 * envelope a direct REST request from that user would resolve, so its data ops
 * enforce RLS as that user — not the bare member/everyone fallback.
 */
describe('resolveUserAuthzGrants — userId-driven authz for non-HTTP surfaces (#3356)', () => {
  it("resolves a known user's positions + permission-set names from the DB", async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1', email: 'ada@x.com' }],
      sys_member: [{ user_id: 'u1', role: 'admin', organization_id: 'o1' }],
      sys_user_position: [{ user_id: 'u1', position: 'approver', organization_id: null }],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null }],
      sys_permission_set: [{ id: 'psA', name: 'ehr_all', system_permissions: ['cap_ehr'] }],
    });
    const grants = await resolveUserAuthzGrants(ql, 'u1', { tenantId: 'o1' });
    expect(grants.positions).toContain('org_admin'); // sys_member owner/admin normalized
    expect(grants.positions).toContain('approver'); // sys_user_position
    expect(grants.positions).toContain('everyone'); // implicit audience anchor
    expect(grants.permissions).toContain('ehr_all'); // user-scoped permission set
    expect(grants.systemPermissions).toContain('cap_ehr');
    expect(grants.email).toBe('ada@x.com');
  });

  it('matches resolveAuthzContext for the same user — one resolver, one envelope', async () => {
    const tables = {
      sys_user: [{ id: 'u1', email: 'ada@x.com' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_position: [{ id: 'r1', name: 'contributor' }],
      sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
      sys_permission_set: [{ id: 'ps1', name: 'contributor_ps', system_permissions: ['cap_x'] }],
    };
    const viaHttp = await resolveAuthzContext({ ql: makeQl(tables), headers: H(), getSession: session('u1') });
    const viaUser = await resolveUserAuthzGrants(makeQl(tables), 'u1');
    expect([...viaUser.positions].sort()).toEqual([...viaHttp.positions].sort());
    expect([...viaUser.permissions].sort()).toEqual([...viaHttp.permissions].sort());
    expect([...viaUser.systemPermissions].sort()).toEqual([...viaHttp.systemPermissions].sort());
    expect(viaUser.posture).toBe(viaHttp.posture);
  });

  it('seeds caller-supplied permissions FIRST, then appends resolved set names', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_permission_set: [{ id: 'ps1', name: 'sales_ps' }],
    });
    const grants = await resolveUserAuthzGrants(ql, 'u1', { seedPermissions: ['api:scope'] });
    expect(grants.permissions[0]).toBe('api:scope');
    expect(grants.permissions).toContain('sales_ps');
  });

  it('a caller-supplied email wins over the sys_user read', async () => {
    const ql = makeQl({ sys_user: [{ id: 'u1', email: 'db@x.com' }], sys_member: [], sys_user_position: [], sys_user_permission_set: [] });
    const grants = await resolveUserAuthzGrants(ql, 'u1', { seedEmail: 'session@x.com' });
    expect(grants.email).toBe('session@x.com');
  });

  it('a user with no grants gets the implicit everyone anchor, empty permissions (never null)', async () => {
    const ql = makeQl({ sys_user: [{ id: 'u1' }], sys_member: [], sys_user_position: [], sys_user_permission_set: [] });
    const grants = await resolveUserAuthzGrants(ql, 'u1');
    expect(grants.positions).toEqual(['everyone']);
    expect(grants.permissions).toEqual([]);
    expect(grants.org_user_ids).toEqual(['u1']);
  });

  it('fail-closed: no data engine yields an empty-but-valid envelope and never throws', async () => {
    const grants = await resolveUserAuthzGrants(undefined, 'u1', { seedPermissions: ['api:scope'] });
    expect(grants.positions).toEqual([]);
    expect(grants.permissions).toEqual(['api:scope']);
    expect(grants.org_user_ids).toEqual(['u1']);
  });

  it('drops permission-set grants outside their validity window (ADR-0091)', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null, valid_until: past }],
      sys_permission_set: [{ id: 'psA', name: 'expired_ps' }],
    });
    const grants = await resolveUserAuthzGrants(ql, 'u1');
    expect(grants.permissions).not.toContain('expired_ps');
  });
});


// ── [#8287] API-key organization admission ─────────────────────────────────

/**
 * The two refusals that need the resolver rather than the verifier: one
 * because it needs the caller's membership set (resolved here, once), one
 * because the refusal must not silently fall through to the session path.
 */
describe('resolveAuthzContext — API-key organization (#8287)', () => {
  const raw = 'osk_ctx_probe';
  const keyHeaders = () => ({ 'x-api-key': raw });
  const tables = (member: any[]) => ({
    sys_api_key: [{ key: hashApiKey(raw), revoked: false, user_id: 'u1', active_organization_id: 'org_a' }],
    sys_user: [{ id: 'u1', email: 'ada@x.com' }],
    sys_member: member,
    sys_user_position: [],
    sys_user_permission_set: [],
  });

  it('adopts the key organization as the request tenant when membership holds', async () => {
    const ql = makeQl(tables([{ user_id: 'u1', organization_id: 'org_a', role: 'member' }]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    expect(ctx.userId).toBe('u1');
    expect(ctx.tenantId).toBe('org_a');
    expect(ctx.authRefusal).toBeUndefined();
  });

  /**
   * Fail-closed at VERIFY time, not revoke-on-event. Membership ends through
   * better-auth org endpoints, SCIM deprovisioning, a direct `sys_member`
   * delete, or an ADR-0091 window simply lapsing — a revoke-on-removal hook
   * must catch every one of those or it silently misses.
   *
   * The result is NO PRINCIPAL, deliberately: degrading to a user-only
   * principal would answer 200 with zero rows, which is the silent-empty class
   * this card exists to remove.
   */
  it('refuses a key whose owner is no longer a member of its organization', async () => {
    const ql = makeQl(tables([{ user_id: 'u1', organization_id: 'org_other', role: 'member' }]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.tenantId).toBeUndefined();
    expect(ctx.permissions).toEqual([]);
    expect(ctx.authRefusal?.reason).toBe('organization_membership_ended');
  });

  it('refuses when the membership row exists but its ADR-0091 window has lapsed', async () => {
    const ql = makeQl(tables([
      { user_id: 'u1', organization_id: 'org_a', role: 'member', valid_until: '2000-01-01T00:00:00Z' },
    ]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.authRefusal?.reason).toBe('organization_membership_ended');
  });

  it('the same key under `group` is refused too — the wall is membership-derived there as well', async () => {
    const ql = makeQl(tables([{ user_id: 'u1', organization_id: 'org_other', role: 'member' }]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'group' });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.authRefusal?.reason).toBe('organization_membership_ended');
  });

  /**
   * Under `single` there is no organization boundary to cross, and a
   * deployment with no membership rows at all would otherwise have every
   * stamped key refused.
   */
  it('does NOT apply the membership check under `single`', async () => {
    const ql = makeQl(tables([]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'single' });
    expect(ctx.userId).toBe('u1');
    expect(ctx.authRefusal).toBeUndefined();
  });

  /**
   * A refused key must NOT fall through to the session path. Falling through
   * would be MORE permissive than the behaviour this replaced — an API key
   * already outranks a session — and a refusal that quietly becomes a session
   * login is not a refusal.
   */
  it('a refused org-less key does not fall through to the session', async () => {
    const ql = makeQl({
      sys_api_key: [{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }],
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({
      ql,
      headers: keyHeaders(),
      getSession: session('u1', { org: 'org_a' }),
      tenancyPosture: 'isolated',
    });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.authRefusal?.reason).toBe('organization_required');
  });

  /**
   * The membership check is a set test on data the resolver has ALREADY read
   * to build `accessible_org_ids` — it must not add a query. Counting reads is
   * how that stays true: a later refactor that re-reads `sys_member` for this
   * check turns a free assertion into a per-request cost, silently.
   */
  it('costs zero additional queries (sys_member is read once)', async () => {
    let memberReads = 0;
    const inner = makeQl(tables([{ user_id: 'u1', organization_id: 'org_a', role: 'member' }]));
    const ql = {
      async find(object: string, opts: any) {
        if (object === 'sys_member') memberReads += 1;
        return inner.find(object, opts);
      },
    };
    await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    // One read for `accessible_org_ids`, one for the fellow-org peer list that
    // an ACTIVE tenant already triggered before this change. The membership
    // assertion adds neither.
    expect(memberReads).toBe(2);
  });
});

/**
 * [#8613 / ADR-0049] `sys_permission_set.active` and `sys_position.active` —
 * enforce-or-remove, enforced.
 *
 * Both objects ship a Deactivate action whose dialog promises, in four locales,
 * that access stops. Nothing read the column, so the promise was false: the
 * assignments kept granting and the admin who trusted the dialog did not take
 * the action that would actually have worked.
 *
 * This is the ONLY seam where either flag is enforceable. Downstream in
 * plugin-security the position → permission-set linkage is already collapsed
 * into a flat `permissions` list, so a set held via a deactivated position is
 * indistinguishable there from one granted directly — filtering there would
 * over-revoke a set the user also holds in their own right.
 *
 * The predicate is "explicitly deactivated", not "explicitly active": absent
 * means ACTIVE, so a row that predates the column keeps working. Every fixture
 * above this block carries no `active` key at all and is the pin for that
 * direction — requiring `true` would have turned this file red wholesale, which
 * is what it would do to deployed data.
 */
describe('[#8613] the `active` flag on the grant catalogues (ADR-0049)', () => {
  const withActive = (v: unknown) => ({
    sys_user: [{ id: 'u1' }],
    sys_member: [],
    sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
    sys_user_permission_set: [],
    sys_position: [{ id: 'r1', name: 'contributor', active: v }],
    sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
    sys_permission_set: [{ id: 'ps1', name: 'contributor_ps', system_permissions: ['cap_x'] }],
  });

  // ── sys_position ──────────────────────────────────────────────────────────

  it('a DEACTIVATED position stops granting its permission sets', async () => {
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(false)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.permissions).not.toContain('contributor_ps');
    expect(ctx.systemPermissions).not.toContain('cap_x');
  });

  it('…and its NAME leaves `positions` too, or the name alone would resolve the set', async () => {
    // `resolvePermissionSetsForContext` requests `context.positions` as
    // permission-set names (position names are commonly reused as set names),
    // so a name left standing would resolve the same grant one layer down.
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(false)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.positions).not.toContain('contributor');
    // The audience anchor is untouched — it is not the deactivated row.
    expect(ctx.positions).toContain('everyone');
  });

  it('an ACTIVE position still grants (the flag is not a blanket revocation)', async () => {
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(true)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.positions).toContain('contributor');
    expect(ctx.permissions).toContain('contributor_ps');
    expect(ctx.systemPermissions).toContain('cap_x');
  });

  it('an ABSENT `active` column grants — deployed rows are not mass-revoked', async () => {
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(undefined)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.positions).toContain('contributor');
    expect(ctx.permissions).toContain('contributor_ps');
  });

  it('the 0/1 storage shape deactivates too — what the primary driver returns', async () => {
    const off = await resolveAuthzContext({
      ql: makeQl(withActive(0)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(off.permissions).not.toContain('contributor_ps');
    const on = await resolveAuthzContext({
      ql: makeQl(withActive(1)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(on.permissions).toContain('contributor_ps');
  });

  it('a position name with NO `sys_position` row is untouched (org roles, memberships)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', role: 'owner', organization_id: 'o1' }],
      sys_user_position: [],
      sys_user_permission_set: [],
      // `org_owner` is projected from the membership and has no catalogue row —
      // there is no flag to read, so nothing may be inferred from its absence.
      sys_position: [{ id: 'r9', name: 'something_else', active: false }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    expect(ctx.positions).toContain('org_owner');
  });

  it('deactivating ONE position leaves the others granting', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [
        { user_id: 'u1', position: 'contributor', organization_id: null },
        { user_id: 'u1', position: 'reviewer', organization_id: null },
      ],
      sys_user_permission_set: [],
      sys_position: [
        { id: 'r1', name: 'contributor', active: false },
        { id: 'r2', name: 'reviewer', active: true },
      ],
      sys_position_permission_set: [
        { position_id: 'r1', permission_set_id: 'ps1' },
        { position_id: 'r2', permission_set_id: 'ps2' },
      ],
      sys_permission_set: [
        { id: 'ps1', name: 'contributor_ps' },
        { id: 'ps2', name: 'reviewer_ps' },
      ],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).not.toContain('contributor_ps');
    expect(ctx.permissions).toContain('reviewer_ps');
    expect(ctx.positions).not.toContain('contributor');
    expect(ctx.positions).toContain('reviewer');
  });

  // ── sys_permission_set ────────────────────────────────────────────────────

  it('a DEACTIVATED permission set grants nothing — name, capabilities and tabs', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_permission_set: [{
        id: 'ps1',
        name: 'crm_full',
        active: false,
        system_permissions: ['cap_x'],
        tab_permissions: { crm: 'visible' },
      }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).not.toContain('crm_full');
    expect(ctx.systemPermissions).not.toContain('cap_x');
    expect(ctx.tabPermissions?.crm).toBeUndefined();
  });

  it('THE HIGH-BLAST-RADIUS CASE: a deactivated admin_full_access confers no PLATFORM_ADMIN', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null }],
      sys_permission_set: [{
        id: 'psA',
        name: 'admin_full_access',
        active: false,
        system_permissions: ['manage_users'],
      }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    // Dropped BEFORE the derivation, so the posture cannot be read off a set
    // that no longer grants — the whole point of filtering at §6b rather than
    // after it.
    expect(ctx.permissions).not.toContain('admin_full_access');
    expect(ctx.posture).not.toBe('PLATFORM_ADMIN');
    expect(ctx.positions).not.toContain('platform_admin');
    expect(ctx.systemPermissions).not.toContain('manage_users');
  });

  it('deactivating ONE set leaves the others granting', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'u1', permission_set_id: 'ps1', organization_id: null },
        { user_id: 'u1', permission_set_id: 'ps2', organization_id: null },
      ],
      sys_permission_set: [
        { id: 'ps1', name: 'crm_full', active: false },
        { id: 'ps2', name: 'crm_read', active: true },
      ],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).not.toContain('crm_full');
    expect(ctx.permissions).toContain('crm_read');
  });

  it('a set held via BOTH a deactivated position and a direct grant still resolves', async () => {
    // The over-revocation this seam is chosen to avoid: the direct grant is a
    // separate authority and the position's deactivation may not touch it.
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_position: [{ id: 'r1', name: 'contributor', active: false }],
      sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
      sys_permission_set: [{ id: 'ps1', name: 'crm_full' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).toContain('crm_full');
    expect(ctx.positions).not.toContain('contributor');
  });

  it('resolveUserAuthzGrants enforces it too — the non-HTTP surfaces share the seam', async () => {
    const grants = await resolveUserAuthzGrants(makeQl(withActive(false)), 'u1');
    expect(grants.permissions).not.toContain('contributor_ps');
    expect(grants.positions).not.toContain('contributor');
  });
});

/**
 * [#10978] The instrument's own contract.
 *
 * Every assertion in this file stands on `makeQl`, and a double that drops
 * `opts.limit` cannot fail a limit regression: raising a bound, lowering it, or
 * folding two reads that carry different ones all produce identical rows. These
 * cases pin the bound itself, so the blindness cannot come back unnoticed —
 * without them the `slice` is unverified and deleting it fails nothing.
 *
 * The measured population when this landed: 49 limit-blind query-honouring
 * doubles across 43 files, all 49 reached at runtime and 44 handed a real bound
 * (values 1 … 10000). Teaching all 49 to honour it broke 0 of 1062 tests — the
 * class was unobservable, not wrong.
 */
describe('the in-memory ObjectQL double honours `limit` (#10978)', () => {
  const rows = (n: number, org: string) =>
    Array.from({ length: n }, (_, i) => ({ user_id: `u${i}`, organization_id: org, role: 'member' }));

  it('bounds a matched read at the caller\'s limit', async () => {
    const ql = makeQl({ sys_member: rows(205, 'o1') });
    expect(await ql.find('sys_member', { where: { organization_id: 'o1' }, limit: 200 })).toHaveLength(200);
    expect(await ql.find('sys_member', { where: { organization_id: 'o1' } })).toHaveLength(205);
  });

  it('tells two bounds apart on the same read — the fold this card exists for', async () => {
    // `resolveUserAuthzGrants` reads sys_member twice: `{user_id}` at 200 and
    // `{organization_id}` at 1000. Folding them into one read would cap the
    // fellow-org peer list (`org_user_ids`, an RLS input) at 200. Under a
    // limit-blind double both bounds return 1005 rows and the fold is invisible.
    const ql = makeQl({ sys_member: rows(1005, 'o1') });
    const atOrgBound = await ql.find('sys_member', { where: { organization_id: 'o1' }, limit: 1000 });
    const atUserBound = await ql.find('sys_member', { where: { organization_id: 'o1' }, limit: 200 });
    expect(atOrgBound).toHaveLength(1000);
    expect(atUserBound).toHaveLength(200);
    expect(atOrgBound.length).not.toBe(atUserBound.length);
  });

  it('reads the bound by PRESENCE, not truthiness — `limit: 0` returns nothing', async () => {
    // `0` is falsy, so `opts.limit ? …` answers a request for NOTHING with the
    // WHOLE table. Measured door in this repo: `driver-memory` carries the same
    // fix as `query.limit !== undefined`.
    const ql = makeQl({ sys_member: rows(3, 'o1') });
    expect(await ql.find('sys_member', { where: { organization_id: 'o1' }, limit: 0 })).toHaveLength(0);
  });

  it('applies the bound AFTER the filter, never before it', async () => {
    // Bounding first would return rows the `where` excludes — a double that is
    // silently WRONG rather than merely unbounded.
    const ql = makeQl({ sys_member: [...rows(5, 'other'), ...rows(5, 'o1')] });
    const found = await ql.find('sys_member', { where: { organization_id: 'o1' }, limit: 3 });
    expect(found).toHaveLength(3);
    expect(found.every((r: any) => r.organization_id === 'o1')).toBe(true);
  });
});
