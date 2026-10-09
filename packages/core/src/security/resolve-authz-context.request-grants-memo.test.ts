// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The request-scoped grants memo (`request-grants-memo.ts`): inside one
 * `resolveAuthzContext` call, a session read that resolved the principal's
 * grants — plugin-auth's `customSession` hook does, for the payload's
 * `positions[]` — serves the resolver's own step 2 instead of every grant read
 * being issued a second time.
 *
 * What these pins hold, in the order the suite states them:
 *
 *  1. EQUIVALENCE, per caller class. For every principal shape the resolver
 *     discriminates — platform administrator (both anchors), organization
 *     owner, admin and member, a non-member whose claimed organization is
 *     dropped (walled) or stands (single), an API-key principal with scopes and
 *     a stamped organization, and an anonymous request — the envelope a request
 *     resolves with the memo serving step 2 is deep-equal to the envelope step
 *     2 resolves on its own. "On its own" is the baseline here because, before
 *     the memo, step 2 never saw the session read's resolution at all: the
 *     baseline's session read resolves nothing, so its step 2 is exactly the
 *     computation the pre-memo code ran.
 *  2. THE COUNT. With the memo, one request issues exactly ONE resolution's
 *     grant reads; through an engine without the write-epoch seam (the memo
 *     declines there) it issues two — the pre-memo count, measured in the
 *     same suite. The first request on an engine registers the write observer
 *     and reads twice.
 *  3. ISOLATION. Two interleaved requests from different callers keep their
 *     own grants; nothing outlives the request; a continuation the request
 *     started reads afresh once the request settled; a session read against a
 *     second engine and a nested `resolveAuthzContext` serve nothing to the
 *     outer step 2.
 *  4. FRESHNESS. A write that bumped the epoch BEFORE the first resolution
 *     opened and lands before step 2, a write still in flight at step 2, a
 *     write that starts and lands in between, a non-write epoch bump, a
 *     validity boundary between the two clocks, a `bypass` caller and a failed
 *     first read all make step 2 read afresh — and a step-2 clock later than
 *     the first resolution's but inside its validity window is served.
 *  5. NO ALIASING. The session payload's arrays and the envelope's are
 *     distinct objects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { hashApiKey } from './api-key.js';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import {
  resolveAuthzContext,
  resolveUserAuthzGrants,
  type ResolvedAuthzContext,
  type UserAuthzGrants,
} from './resolve-authz-context.js';
import { makeRecordingQl, type RecordedCall } from './__tests__/resolve-authz-context.batch-equivalence.testkit.js';

const T0 = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const API_KEY = 'osk_request_memo_key';

const ENV_KEYS = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_PLATFORM_OWNER_EMAIL'] as const;
let ambient: Record<string, string | undefined> = {};

beforeEach(() => {
  ambient = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetPlatformAdminEmailMemo();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ambient[k] === undefined) delete process.env[k];
    else process.env[k] = ambient[k];
  }
  resetPlatformAdminEmailMemo();
});

/** Every grant row the matrix needs, fresh per call so a test may mutate its copy. */
function makeTables(): Record<string, any[]> {
  return {
    sys_user: [
      { id: 'u_padmin', email: 'padmin@x.com' },
      { id: 'u_root', email: 'root@x.com', email_verified: true },
      { id: 'u_owner', email: 'owner@x.com' },
      { id: 'u_admin', email: 'admin@x.com' },
      { id: 'u_member', email: 'member@x.com', ai_access: 1 },
      { id: 'u_outsider', email: 'outsider@x.com' },
    ],
    sys_member: [
      { user_id: 'u_owner', organization_id: 'org_a', role: 'owner' },
      { user_id: 'u_admin', organization_id: 'org_a', role: 'admin' },
      { user_id: 'u_member', organization_id: 'org_a', role: 'member' },
      { user_id: 'u_member', organization_id: 'org_b', role: 'owner' },
      { user_id: 'u_outsider', organization_id: 'org_b', role: 'member' },
    ],
    sys_user_position: [
      { user_id: 'u_member', position: 'auditor', organization_id: 'org_a' },
      { user_id: 'u_member', position: 'temp_role', organization_id: null, valid_until: iso(T0 + DAY) },
      { user_id: 'u_outsider', position: 'auditor', organization_id: 'org_a' },
    ],
    sys_position: [
      { id: 'p_auditor', name: 'auditor', organization_id: 'org_a' },
      { id: 'p_temp', name: 'temp_role', organization_id: null },
      { id: 'p_orgadmin', name: 'org_admin', organization_id: 'org_a' },
      { id: 'p_everyone', name: 'everyone', organization_id: 'org_a' },
    ],
    sys_position_permission_set: [
      { position_id: 'p_auditor', permission_set_id: 'ps_read' },
      { position_id: 'p_temp', permission_set_id: 'ps_temp' },
      { position_id: 'p_orgadmin', permission_set_id: 'ps_orgadmin' },
      { position_id: 'p_everyone', permission_set_id: 'ps_base' },
    ],
    sys_user_permission_set: [
      { user_id: 'u_padmin', permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: null },
      { user_id: 'u_member', permission_set_id: 'ps_tools', permission_set: 'org_tools', organization_id: 'org_a' },
    ],
    sys_permission_set: [
      { id: 'ps_admin', name: 'admin_full_access', system_permissions: ['manage_users'] },
      { id: 'ps_read', name: 'read_all', tab_permissions: { crm: 'visible' } },
      { id: 'ps_temp', name: 'temp_tools' },
      { id: 'ps_orgadmin', name: 'organization_admin', tab_permissions: { crm: 'default_on' } },
      { id: 'ps_base', name: 'base_access', tab_permissions: { crm: 'default_off' } },
      { id: 'ps_tools', name: 'org_tools', system_permissions: '["export_reports"]' },
    ],
    // An API key owned by the organization member, stamped with org_a, with two scopes.
    sys_api_key: [
      {
        id: 'key_member',
        key: hashApiKey(API_KEY),
        revoked: false,
        user_id: 'u_member',
        active_organization_id: 'org_a',
        scopes: '["data:read","reports:export"]',
      },
    ],
  };
}

/** A write-epoch seam shaped like `@objectstack/objectql`'s (`readWriteEpoch` checks all three members). */
function makeEpoch() {
  return {
    current: 0,
    bump(_reason: string) { this.current += 1; },
    subscribe(_listener: (epoch: number, reason: string) => void) { return () => {}; },
  };
}

type Middleware = (ctx: { object: string; operation: string }, next: () => Promise<void>) => Promise<void>;

type Ql = ReturnType<typeof makeRecordingQl> & {
  writeEpoch?: ReturnType<typeof makeEpoch>;
  registerMiddleware?: (fn: Middleware) => void;
  /** How many middlewares are registered — the observer is one. */
  middlewareCount: () => number;
  /**
   * A write, run the way `ObjectQL.executeWithMiddleware` runs one: the epoch
   * is bumped FIRST, synchronously, then the middleware chain runs and `land`
   * — the driver step — is the innermost call.
   */
  write: (object: string, operation: 'insert' | 'update' | 'delete', land: () => Promise<void>) => Promise<void>;
};

/** Run `ctx` through `middlewares`, `innermost` at the bottom — the engine's onion. */
async function runChain(middlewares: Middleware[], ctx: { object: string; operation: string }, innermost: () => Promise<void>) {
  const applicable = [...middlewares];
  let index = 0;
  const next = async (): Promise<void> => {
    if (index < applicable.length) {
      const mw = applicable[index++];
      await mw(ctx, next);
    } else {
      await innermost();
    }
  };
  await next();
}

/**
 * The recording double, with the two engine seams the memo requires: the
 * write epoch and `registerMiddleware`. Reads go through the middleware chain,
 * as the engine's do; writes go through {@link Ql.write}.
 */
function makeQl(tables: Record<string, any[]>, opts: { epoch?: boolean; middleware?: boolean } = {}): Ql {
  const recording = makeRecordingQl(tables);
  const middlewares: Middleware[] = [];
  const find = recording.find.bind(recording);
  const ql = recording as Ql;
  if (opts.epoch !== false) ql.writeEpoch = makeEpoch();
  if (opts.middleware !== false) ql.registerMiddleware = (fn: Middleware) => { middlewares.push(fn); };
  ql.middlewareCount = () => middlewares.length;
  ql.find = async (object: string, q: any) => {
    let rows: any;
    await runChain(middlewares, { object, operation: 'find' }, async () => { rows = await find(object, q); });
    return rows;
  };
  ql.write = (object, operation, land) => {
    ql.writeEpoch?.bump('write');
    return runChain(middlewares, { object, operation }, land);
  };
  return ql;
}

/**
 * A double the memo has already seen: one anonymous request (no reads) has
 * registered the write observer, so the NEXT request is the first that may be
 * served — the request that registers it stores nothing for that engine.
 */
async function armedQl(tables: Record<string, any[]>): Promise<Ql> {
  const ql = makeQl(tables);
  await resolveAuthzContext({ ql, headers: {} });
  expect(ql.calls.length).toBe(0);
  expect(ql.middlewareCount()).toBe(1);
  return ql;
}

interface SessionFixture {
  user: { id: string; email?: string };
  session: { id: string; activeOrganizationId: string | null; token: string };
}

const sessionOf = (userId: string, email: string, activeOrganizationId: string | null): SessionFixture => ({
  user: { id: userId, email },
  session: { id: `sess_${userId}`, activeOrganizationId, token: `tok_${userId}` },
});

/**
 * A session read that resolves the principal's grants the way plugin-auth's
 * `customSession` hook asks for them: the session's active organization as the
 * tenant and the session's email as the seed. `nowMs` is injected only so the
 * fixtures' validity windows are deterministic; the memo keys on neither clock.
 */
function sessionReadThatResolves(
  ql: Ql,
  fixture: SessionFixture | null,
  nowMs: number = T0,
  sink?: { payload?: any; grants?: UserAuthzGrants },
) {
  return async () => {
    if (!fixture) return null;
    let grants: UserAuthzGrants | undefined;
    try {
      grants = await resolveUserAuthzGrants(ql, fixture.user.id, {
        tenantId: fixture.session.activeOrganizationId ?? undefined,
        seedEmail: fixture.user.email ? String(fixture.user.email) : undefined,
        nowMs,
      });
    } catch {
      // The hook fails closed to an empty positions[] and lets the request go on.
    }
    const payload = {
      user: { ...fixture.user, positions: grants?.positions ?? [], isPlatformAdmin: grants?.posture === 'PLATFORM_ADMIN' },
      session: fixture.session,
    };
    if (sink) { sink.payload = payload; sink.grants = grants; }
    return payload;
  };
}

/** The same session, read without resolving anything — the pre-memo step 2's only input. */
function sessionReadOnly(fixture: SessionFixture | null) {
  return async () => (fixture ? { user: { ...fixture.user }, session: fixture.session } : null);
}

const callKey = (c: RecordedCall) => JSON.stringify([c.object, c.where, c.limit]);
const multiset = (calls: RecordedCall[]) => calls.map(callKey).sort();

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const withoutMembersAuditor = (rows: any[]) =>
  rows.filter((r) => !(r.user_id === 'u_member' && r.position === 'auditor'));

interface CallerClass {
  name: string;
  fixture: SessionFixture | null;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  tenancyPosture?: 'isolated' | 'single';
  /** What the class must resolve to, so the matrix cannot pass on two equally wrong envelopes. */
  expect: (ctx: ResolvedAuthzContext) => void;
}

const CALLER_CLASSES: CallerClass[] = [
  {
    name: 'platform administrator — unscoped admin_full_access grant (single posture)',
    fixture: sessionOf('u_padmin', 'padmin@x.com', null),
    expect: (ctx) => {
      expect(ctx.posture).toBe('PLATFORM_ADMIN');
      expect(ctx.positions[0]).toBe('platform_admin');
    },
  },
  {
    name: 'platform administrator — declared administrator email (isolated posture)',
    fixture: sessionOf('u_root', 'root@x.com', null),
    env: { OS_TENANCY_POSTURE: 'isolated', OS_PLATFORM_OWNER_EMAIL: 'root@x.com' },
    tenancyPosture: 'isolated',
    expect: (ctx) => {
      expect(ctx.posture).toBe('PLATFORM_ADMIN');
      expect(ctx.permissions).toContain('admin_full_access');
    },
  },
  {
    name: 'organization owner',
    fixture: sessionOf('u_owner', 'owner@x.com', 'org_a'),
    tenancyPosture: 'isolated',
    expect: (ctx) => {
      expect(ctx.tenantId).toBe('org_a');
      expect(ctx.positions).toContain('org_owner');
      expect(ctx.org_user_ids).toEqual(expect.arrayContaining(['u_owner', 'u_admin', 'u_member']));
    },
  },
  {
    name: 'organization admin',
    fixture: sessionOf('u_admin', 'admin@x.com', 'org_a'),
    tenancyPosture: 'isolated',
    expect: (ctx) => {
      expect(ctx.positions).toContain('org_admin');
      expect(ctx.posture).toBe('TENANT_ADMIN');
    },
  },
  {
    name: 'organization member',
    fixture: sessionOf('u_member', 'member@x.com', 'org_a'),
    tenancyPosture: 'isolated',
    expect: (ctx) => {
      expect(ctx.posture).toBe('MEMBER');
      expect(ctx.positions).toEqual(expect.arrayContaining(['org_member', 'auditor', 'temp_role', 'everyone']));
      expect(ctx.permissions).toEqual(expect.arrayContaining(['org_tools', 'read_all', 'temp_tools', 'ai_seat']));
      expect(ctx.accessible_org_ids.sort()).toEqual(['org_a', 'org_b']);
    },
  },
  {
    name: 'non-member claiming an organization — walled posture drops the claim',
    fixture: sessionOf('u_outsider', 'outsider@x.com', 'org_a'),
    tenancyPosture: 'isolated',
    expect: (ctx) => {
      expect(ctx.tenantId).toBeUndefined();
      expect(ctx.positions).not.toContain('auditor');
      expect(ctx.org_user_ids).toEqual(['u_outsider']);
    },
  },
  {
    name: 'non-member claiming an organization — single posture keeps the claim',
    fixture: sessionOf('u_outsider', 'outsider@x.com', 'org_a'),
    expect: (ctx) => {
      expect(ctx.tenantId).toBe('org_a');
      expect(ctx.positions).not.toContain('org_member');
    },
  },
  {
    // The session read is never called for an admitted key: step 2 is the
    // request's only resolution, with the key's scopes as seeds.
    name: 'API-key principal with scopes and a stamped organization (isolated posture)',
    fixture: sessionOf('u_member', 'member@x.com', 'org_a'),
    headers: { 'x-api-key': API_KEY },
    tenancyPosture: 'isolated',
    expect: (ctx) => {
      expect(ctx.userId).toBe('u_member');
      expect(ctx.tenantId).toBe('org_a');
      expect(ctx.permissions.slice(0, 2)).toEqual(['data:read', 'reports:export']);
      expect(ctx.positions).toContain('org_member');
    },
  },
  {
    name: 'anonymous request',
    fixture: null,
    expect: (ctx) => {
      expect(ctx.userId).toBeUndefined();
      expect(ctx.positions).toEqual([]);
    },
  },
];

async function resolveBoth(c: CallerClass) {
  for (const [k, v] of Object.entries(c.env ?? {})) process.env[k] = v;
  resetPlatformAdminEmailMemo();

  const memoQl = await armedQl(makeTables());
  const withMemo = await resolveAuthzContext({
    ql: memoQl,
    headers: c.headers ?? {},
    getSession: sessionReadThatResolves(memoQl, c.fixture),
    nowMs: T0,
    tenancyPosture: c.tenancyPosture,
  });

  const baselineQl = makeQl(makeTables());
  const baseline = await resolveAuthzContext({
    ql: baselineQl,
    headers: c.headers ?? {},
    getSession: sessionReadOnly(c.fixture),
    nowMs: T0,
    tenancyPosture: c.tenancyPosture,
  });
  return { withMemo, baseline, memoQl, baselineQl };
}

describe('request-scoped grants memo — the same decision for every caller class', () => {
  for (const c of CALLER_CLASSES) {
    it(`${c.name}: same envelope as step 2 resolved on its own, one resolution's reads`, async () => {
      const { withMemo, baseline, memoQl, baselineQl } = await resolveBoth(c);

      c.expect(baseline);
      expect(withMemo).toEqual(baseline);
      // The request issued exactly the reads step 2 issues on its own — the
      // session read's resolution WAS step 2's — never those plus a second set.
      expect(multiset(memoQl.calls)).toEqual(multiset(baselineQl.calls));
    });
  }
});

describe('request-scoped grants memo — the round-trip count', () => {
  const member = sessionOf('u_member', 'member@x.com', 'org_a');

  it('one request issues ONE resolution of grant reads; the pre-memo path (no epoch seam) issues two', async () => {
    const standaloneQl = makeQl(makeTables());
    await resolveUserAuthzGrants(standaloneQl, 'u_member', { tenantId: 'org_a', seedEmail: 'member@x.com', nowMs: T0 });
    const oneResolution = standaloneQl.calls.length;
    // [ADR-0131 D4] Ten: the member's organization grant reads its set by name,
    // the organization's own row and the organization-less one, where the id
    // read was one.
    expect(oneResolution).toBe(10);

    const memoQl = await armedQl(makeTables());
    const withMemo = await resolveAuthzContext({ ql: memoQl, headers: {}, getSession: sessionReadThatResolves(memoQl, member), nowMs: T0 });
    expect(memoQl.calls.length).toBe(oneResolution);
    expect(multiset(memoQl.calls)).toEqual(multiset(standaloneQl.calls));

    // An engine without the write-epoch seam: the memo declines, and the
    // request makes the two resolutions it made before the memo existed.
    const noSeamQl = makeQl(makeTables(), { epoch: false });
    const noSeam = await resolveAuthzContext({ ql: noSeamQl, headers: {}, getSession: sessionReadThatResolves(noSeamQl, member), nowMs: T0 });
    expect(noSeamQl.calls.length).toBe(2 * oneResolution);
    expect(noSeam).toEqual(withMemo);

    // …and one that cannot register a middleware (no write observer) declines too.
    const noMiddlewareQl = makeQl(makeTables(), { middleware: false });
    const noMiddleware = await resolveAuthzContext({ ql: noMiddlewareQl, headers: {}, getSession: sessionReadThatResolves(noMiddlewareQl, member), nowMs: T0 });
    expect(noMiddlewareQl.calls.length).toBe(2 * oneResolution);
    expect(noMiddleware).toEqual(withMemo);
  });

  it('the request that registers the engine\'s write observer stores nothing for it; the next one is served', async () => {
    const ql = makeQl(makeTables());
    expect(ql.middlewareCount()).toBe(0);
    const first = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member), nowMs: T0 });
    expect(ql.middlewareCount()).toBe(1);
    expect(ql.calls.length).toBe(20);
    const before = ql.calls.length;
    const second = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member), nowMs: T0 });
    expect(ql.calls.length - before).toBe(10);
    expect(ql.middlewareCount()).toBe(1);
    expect(second).toEqual(first);
  });
});

describe('request-scoped grants memo — isolation', () => {
  it('two interleaved requests from different callers keep their own grants', async () => {
    const ql = await armedQl(makeTables());
    const owner = sessionOf('u_owner', 'owner@x.com', 'org_a');
    const member = sessionOf('u_member', 'member@x.com', 'org_b');

    // Both session reads resolve and commit before EITHER step 2 runs, so
    // each step 2 looks up its entry while the other caller's exists too.
    const ownerRead = deferred();
    const memberRead = deferred();
    const release = deferred();
    const gated = (read: () => Promise<any>, done: { resolve: () => void }) => async () => {
      const payload = await read();
      done.resolve();
      await release.promise;
      return payload;
    };

    const pOwner = resolveAuthzContext({ ql, headers: {}, getSession: gated(sessionReadThatResolves(ql, owner), ownerRead), nowMs: T0, tenancyPosture: 'isolated' });
    const pMember = resolveAuthzContext({ ql, headers: {}, getSession: gated(sessionReadThatResolves(ql, member), memberRead), nowMs: T0, tenancyPosture: 'isolated' });
    await Promise.all([ownerRead.promise, memberRead.promise]);
    release.resolve();
    const [ownerCtx, memberCtx] = await Promise.all([pOwner, pMember]);

    const baselineOwner = await resolveAuthzContext({ ql: makeQl(makeTables()), headers: {}, getSession: sessionReadOnly(owner), nowMs: T0, tenancyPosture: 'isolated' });
    const baselineMember = await resolveAuthzContext({ ql: makeQl(makeTables()), headers: {}, getSession: sessionReadOnly(member), nowMs: T0, tenancyPosture: 'isolated' });
    expect(ownerCtx).toEqual(baselineOwner);
    expect(memberCtx).toEqual(baselineMember);
    expect(ownerCtx.userId).toBe('u_owner');
    expect(memberCtx.positions).toContain('org_owner'); // the member OWNS org_b
    expect(ownerCtx.org_user_ids).not.toContain('u_outsider');
    expect(memberCtx.org_user_ids).toEqual(expect.arrayContaining(['u_member', 'u_outsider']));
    // Two requests, one resolution each — neither holds a user grant that
    // applies where it operates, so neither reads a set by name.
    expect(ql.calls.length).toBe(16);
  });

  it('nothing outlives the request: the next request reads the grants as they are now', async () => {
    const tables = makeTables();
    const ql = await armedQl(tables);
    const member = sessionOf('u_member', 'member@x.com', 'org_a');

    const first = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member), nowMs: T0, tenancyPosture: 'isolated' });
    expect(first.positions).toContain('auditor');

    // Revoked with NO epoch bump and outside the chain: what retires the first
    // request's resolution is the end of that request, and nothing else.
    tables.sys_user_position = withoutMembersAuditor(tables.sys_user_position);
    const before = ql.calls.length;
    const second = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member), nowMs: T0, tenancyPosture: 'isolated' });
    expect(second.positions).not.toContain('auditor');
    expect(second.permissions).not.toContain('read_all');
    expect(ql.calls.length - before).toBe(10);
  });

  it('a continuation the request started reads afresh once the request settled', async () => {
    const ql = await armedQl(makeTables());
    const member = sessionOf('u_member', 'member@x.com', 'org_a');
    const settled = deferred();
    let late: Promise<UserAuthzGrants> | undefined;

    const read = sessionReadThatResolves(ql, member);
    await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => {
        const payload = await read();
        // Started INSIDE the request's async context, run after it settled.
        late = settled.promise.then(() => resolveUserAuthzGrants(ql, 'u_member', { tenantId: 'org_a', seedEmail: 'member@x.com', nowMs: T0 }));
        return payload;
      },
      nowMs: T0,
      tenancyPosture: 'isolated',
    });
    const before = ql.calls.length;
    settled.resolve();
    await late;
    expect(ql.calls.length - before).toBe(10);
  });

  it('a session read resolved against a SECOND engine serves nothing to the first engine\'s step 2', async () => {
    const qlA = await armedQl(makeTables());
    const qlB = await armedQl(makeTables());
    const member = sessionOf('u_member', 'member@x.com', 'org_a');
    const ctx = await resolveAuthzContext({
      ql: qlA,
      headers: {},
      getSession: sessionReadThatResolves(qlB, member),
      nowMs: T0,
      tenancyPosture: 'isolated',
    });
    expect(qlB.calls.length).toBe(10);
    expect(qlA.calls.length).toBe(10);
    const baseline = await resolveAuthzContext({ ql: makeQl(makeTables()), headers: {}, getSession: sessionReadOnly(member), nowMs: T0, tenancyPosture: 'isolated' });
    expect(ctx).toEqual(baseline);
  });

  it('a nested resolveAuthzContext inside the session read serves nothing to the outer step 2', async () => {
    const ql = await armedQl(makeTables());
    const member = sessionOf('u_member', 'member@x.com', 'org_a');
    const ctx = await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => {
        // The inner call resolves twice-over-once in ITS OWN scope: its session
        // read's resolution serves its step 2 (10 reads), and that scope closes.
        const inner = await resolveAuthzContext({
          ql,
          headers: {},
          getSession: sessionReadThatResolves(ql, member),
          nowMs: T0,
          tenancyPosture: 'isolated',
        });
        expect(inner.userId).toBe('u_member');
        return sessionReadOnly(member)();
      },
      nowMs: T0,
      tenancyPosture: 'isolated',
    });
    // Inner 8, outer step 2 afresh 8.
    expect(ql.calls.length).toBe(20);
    const baseline = await resolveAuthzContext({ ql: makeQl(makeTables()), headers: {}, getSession: sessionReadOnly(member), nowMs: T0, tenancyPosture: 'isolated' });
    expect(ctx).toEqual(baseline);
  });
});

describe('request-scoped grants memo — step 2 reads afresh whenever a fresh read could differ', () => {
  const member = sessionOf('u_member', 'member@x.com', 'org_a');
  const postWriteBaseline = async (nowMs = T0) => {
    const after = makeTables();
    after.sys_user_position = withoutMembersAuditor(after.sys_user_position);
    return resolveAuthzContext({ ql: makeQl(after), headers: {}, getSession: sessionReadOnly(member), nowMs, tenancyPosture: 'isolated' });
  };

  it('a revocation that bumped the epoch BEFORE the first resolution opened and lands before step 2', async () => {
    const tables = makeTables();
    const ql = await armedQl(tables);
    const landing = deferred();
    // W: the engine bumps the epoch and enters the chain NOW; its driver step
    // waits for `landing`, then the row is gone.
    const w = ql.write('sys_user_position', 'delete', async () => {
      await landing.promise;
      tables.sys_user_position = withoutMembersAuditor(tables.sys_user_position);
    });
    const read = sessionReadThatResolves(ql, member);
    const ctx = await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => {
        // The hook's resolution opens AFTER W's bump and reads the pre-W rows…
        const payload = await read();
        expect(payload?.user.positions).toContain('auditor');
        // …then W lands, before step 2.
        landing.resolve();
        await w;
        return payload;
      },
      nowMs: T0,
      tenancyPosture: 'isolated',
    });
    // The decision first: the request is authorised WITHOUT the revoked row…
    expect(ctx.positions).not.toContain('auditor');
    expect(ctx).toEqual(await postWriteBaseline());
    // …because step 2 read afresh after the landing.
    expect(ql.calls.length).toBe(20);
  });

  it('a write that bumped before the first resolution and is still in flight at step 2', async () => {
    const tables = makeTables();
    const ql = await armedQl(tables);
    const landing = deferred();
    const w = ql.write('sys_user_position', 'delete', async () => {
      await landing.promise;
      tables.sys_user_position = withoutMembersAuditor(tables.sys_user_position);
    });
    const ctx = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member), nowMs: T0, tenancyPosture: 'isolated' });
    expect(ql.calls.length).toBe(20);
    // Not landed yet: a fresh read still sees the row, and so did step 2.
    expect(ctx.positions).toContain('auditor');
    landing.resolve();
    await w;
  });

  it('a write that starts and lands between the two resolutions', async () => {
    const tables = makeTables();
    const ql = await armedQl(tables);
    const read = sessionReadThatResolves(ql, member);
    const ctx = await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => {
        const payload = await read();
        await ql.write('sys_user_position', 'delete', async () => {
          tables.sys_user_position = withoutMembersAuditor(tables.sys_user_position);
        });
        return payload;
      },
      nowMs: T0,
      tenancyPosture: 'isolated',
    });
    expect(ctx.positions).not.toContain('auditor');
    expect(ql.calls.length).toBe(20);
    expect(ctx).toEqual(await postWriteBaseline());
  });

  it('a non-write epoch bump between the two resolutions (a peer\'s hint, a declared permission set)', async () => {
    const ql = await armedQl(makeTables());
    const read = sessionReadThatResolves(ql, member);
    await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => {
        const payload = await read();
        ql.writeEpoch!.bump('remote');
        return payload;
      },
      nowMs: T0,
      tenancyPosture: 'isolated',
    });
    expect(ql.calls.length).toBe(20);
  });

  it('a write that starts while the first resolution is still reading', async () => {
    const ql = await armedQl(makeTables());
    const find = ql.find.bind(ql);
    let started = false;
    let w: Promise<void> | undefined;
    ql.find = async (object: string, opts: any) => {
      if (!started && object === 'sys_position') { started = true; w = ql.write('sys_audit_log', 'insert', async () => {}); }
      return find(object, opts);
    };
    await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member), nowMs: T0, tenancyPosture: 'isolated' });
    await w;
    expect(ql.calls.length).toBe(20);
  });

  it('a step-2 clock later than the first resolution\'s, inside its validity window, is served', async () => {
    // temp_role is valid until T0 + 1 day: T0 + 1 hour is inside the window.
    const ql = await armedQl(makeTables());
    const ctx = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member, T0), nowMs: T0 + HOUR, tenancyPosture: 'isolated' });
    expect(ql.calls.length).toBe(10);
    expect(ctx.positions).toContain('temp_role');
    const baseline = await resolveAuthzContext({ ql: makeQl(makeTables()), headers: {}, getSession: sessionReadOnly(member), nowMs: T0 + HOUR, tenancyPosture: 'isolated' });
    expect(ctx).toEqual(baseline);
  });

  it('a validity boundary between the two clocks, and a clock before the first resolution', async () => {
    // The session read resolves at T0 (temp_role active until T0 + 1 day);
    // step 2 asks at T0 + 2 days, past that boundary.
    const ql = await armedQl(makeTables());
    const ctx = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member, T0), nowMs: T0 + 2 * DAY, tenancyPosture: 'isolated' });
    expect(ctx.positions).not.toContain('temp_role');
    expect(ctx.permissions).not.toContain('temp_tools');
    expect(ql.calls.length).toBe(20);
    const baseline = await resolveAuthzContext({ ql: makeQl(makeTables()), headers: {}, getSession: sessionReadOnly(member), nowMs: T0 + 2 * DAY, tenancyPosture: 'isolated' });
    expect(ctx).toEqual(baseline);

    // A step-2 clock EARLIER than the resolution it would be served.
    const ql2 = await armedQl(makeTables());
    await resolveAuthzContext({ ql: ql2, headers: {}, getSession: sessionReadThatResolves(ql2, member, T0), nowMs: T0 - DAY, tenancyPosture: 'isolated' });
    expect(ql2.calls.length).toBe(20);
  });

  it('a bypassGrantsCache caller is never served from the memo', async () => {
    const ql = await armedQl(makeTables());
    const read = sessionReadThatResolves(ql, member);
    await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => {
        const payload = await read();
        await resolveUserAuthzGrants(ql, 'u_member', { tenantId: 'org_a', seedEmail: 'member@x.com', nowMs: T0, bypassGrantsCache: true });
        return payload;
      },
      nowMs: T0,
      tenancyPosture: 'isolated',
    });
    // session read 8 + the bypass caller's own 8 + step 2 served (0).
    expect(ql.calls.length).toBe(20);
  });

  it('a first resolution that failed is not remembered', async () => {
    const ql = await armedQl(makeTables());
    const find = ql.find.bind(ql);
    let failed = false;
    ql.find = async (object: string, opts: any) => {
      if (!failed && object === 'sys_user_permission_set') { failed = true; throw new Error('connection reset'); }
      return find(object, opts);
    };
    const sink: { payload?: any; grants?: UserAuthzGrants } = {};
    const ctx = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member, T0, sink), nowMs: T0, tenancyPosture: 'isolated' });
    expect(sink.grants).toBeUndefined();
    const baseline = await resolveAuthzContext({ ql: makeQl(makeTables()), headers: {}, getSession: sessionReadOnly(member), nowMs: T0, tenancyPosture: 'isolated' });
    expect(ctx).toEqual(baseline);
  });
});

describe('request-scoped grants memo — served values are clones', () => {
  it('the session payload and the request envelope never share an array', async () => {
    const ql = await armedQl(makeTables());
    const sink: { payload?: any; grants?: UserAuthzGrants } = {};
    const member = sessionOf('u_member', 'member@x.com', 'org_a');
    const ctx = await resolveAuthzContext({ ql, headers: {}, getSession: sessionReadThatResolves(ql, member, T0, sink), nowMs: T0, tenancyPosture: 'isolated' });
    expect(ql.calls.length).toBe(10);
    expect(ctx.positions).toEqual(sink.payload.user.positions);
    expect(ctx.positions).not.toBe(sink.payload.user.positions);
    ctx.positions.push('mutated_downstream');
    ctx.permissions.push('mutated_downstream');
    expect(sink.payload.user.positions).not.toContain('mutated_downstream');
    expect(sink.grants!.permissions).not.toContain('mutated_downstream');
  });
});
