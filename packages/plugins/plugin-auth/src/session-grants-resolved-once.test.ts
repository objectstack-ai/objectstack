// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// One request, one resolution of the caller's grants — through the REAL hook.
//
// `resolveAuthzContext` (core) learns who the caller is from the transport's
// `getSession`. Against this plugin that is better-auth's `getSession`, whose
// `customSession` hook (`auth-manager.ts`) resolves the principal's grants for
// the payload's `positions[]`; `resolveAuthzContext` then resolves them again
// for the request envelope. Core's request-scoped memo serves the second from
// the first — but only when both ask for the SAME resolution, so the hook must
// pass exactly the arguments `resolveAuthzContext` passes for that session.
// Core's own suite pins the memo against a stand-in hook; only this suite can
// show that the real hook and the real resolver agree on those arguments.
//
// The measurement is a read count on the engine double, taken around one
// `resolveAuthzContext` call whose `getSession` is the real better-auth one:
//
//   - with the engine's write-epoch and middleware seams present (the double
//     runs them the way the engine does), on a warm engine, the grant tables
//     are read by ONE resolution;
//   - with the seam removed, core's memo declines and the same request reads
//     them twice — the count before the memo existed, measured on the same
//     engine and the same session;
//   - the two envelopes are deep-equal, per caller class.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
// [#10126] A static import, so this dist-resolved workspace dep's first
// transform is paid at module load rather than inside a clocked test body.
import { resolveAuthzContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
// The SAME double the security-axis suite drives (a second engine double would
// be a second looseness risk and a new `check:engine-double-contract` row).
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
// [#23184] better-auth's first module load is paid HERE, at module load, and
// not inside the first clocked case: clocked windows measure behaviour, never
// loading (AGENTS.md, Build & Test). `AuthManager` reaches every vendor module
// through a lazy `await import()` (the package root stays light on purpose), so
// without these lines the file's first case paid about half a second of vendor
// module evaluation on a dev container. The list is what the managers in this
// file (and the bearer-rotation cases it imports) boot through; a module it
// misses is still loaded in the first case, as before. The module cache hands
// `AuthManager` these same instances, and this file changes no environment the
// vendor reads at load (better-auth captures `NODE_ENV` when its env module is
// first evaluated), so nothing a case runs is different.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import '@better-auth/oauth-provider';
import '@better-auth/core/context';
import '@better-auth/core/error';
import 'better-auth/plugins/admin';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-grants-once';
const BASE = 'http://localhost:3000/api/v1/auth';
const ORG = 'org_once';
const OTHER_ORG = 'org_other';

/** The tables only the grant resolver reads — better-auth's own session read never touches them. */
const GRANT_ONLY_TABLES = new Set([
  'sys_user_position',
  'sys_user_permission_set',
  'sys_position',
  'sys_position_permission_set',
  'sys_permission_set',
]);

const signUp = (manager: AuthManager, email: string, name: string) => {
  inviteForAudienceGate(manager, email);
  return manager.handleRequest(
    new Request(`${BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
};

const signIn = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${BASE}/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

const bearerFrom = (response: Response): string => {
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('no set-auth-token on the response');
  return token;
};

const userIdFor = (engine: any, email: string): string => {
  const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/**
 * Give the double the two engine seams core's memo requires, run the way
 * `ObjectQL.executeWithMiddleware` runs them: a write bumps the epoch FIRST,
 * then the middleware chain runs with the driver step innermost; reads go
 * through the same chain. Plus a read/write recorder switched on only around
 * the request being measured. Wraps the instance's own methods; the double
 * itself is unchanged.
 */
function instrument(engine: any) {
  const epoch = {
    current: 0,
    bump(_reason: string) { this.current += 1; },
    subscribe(_listener: (epoch: number, reason: string) => void) { return () => {}; },
  };
  engine.writeEpoch = epoch;
  type Mw = (ctx: { object: string; operation: string }, next: () => Promise<void>) => Promise<void>;
  const middlewares: Mw[] = [];
  engine.registerMiddleware = (fn: Mw) => { middlewares.push(fn); };
  const chain = async (ctx: { object: string; operation: string }, innermost: () => Promise<unknown>) => {
    const applicable = [...middlewares];
    let index = 0;
    let result: unknown;
    const next = async (): Promise<void> => {
      if (index < applicable.length) await applicable[index++](ctx, next);
      else result = await innermost();
    };
    await next();
    return result;
  };
  const reads: string[] = [];
  const writes: string[] = [];
  let recording = false;
  for (const verb of ['insert', 'update', 'delete'] as const) {
    const original = engine[verb].bind(engine);
    engine[verb] = async (...args: any[]) => {
      epoch.bump('write');
      if (recording) writes.push(`${verb} ${String(args[0])}`);
      return chain({ object: String(args[0]), operation: verb }, () => original(...args));
    };
  }
  for (const verb of ['findOne', 'count'] as const) {
    const original = engine[verb].bind(engine);
    engine[verb] = async (...args: any[]) => chain({ object: String(args[0]), operation: verb }, () => original(...args));
  }
  const originalFind = engine.find.bind(engine);
  engine.find = async (name: string, q?: any) => {
    if (recording) reads.push(name);
    return chain({ object: name, operation: 'find' }, () => originalFind(name, q));
  };
  return {
    reads,
    middlewareCount: () => middlewares.length,
    async measure<T>(fn: () => Promise<T>): Promise<{ value: T; reads: string[]; writes: string[] }> {
      reads.length = 0;
      writes.length = 0;
      recording = true;
      try {
        const value = await fn();
        return { value, reads: [...reads], writes: [...writes] };
      } finally {
        recording = false;
      }
    },
  };
}

const arrange = async (config: Record<string, unknown> = {}) => {
  const engine: any = createMemoryEngine();
  const probe = instrument(engine);
  const manager = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...config } as any);

  await signUp(manager, 'owner@example.com', 'Org Owner');
  await signUp(manager, 'member@example.com', 'Org Member');
  await signUp(manager, 'leaver@example.com', 'Removed Member');
  await signUp(manager, 'operator@example.com', 'Platform Operator');
  const ownerId = userIdFor(engine, 'owner@example.com');
  const memberId = userIdFor(engine, 'member@example.com');
  const leaverId = userIdFor(engine, 'leaver@example.com');
  const operatorId = userIdFor(engine, 'operator@example.com');

  await engine.insert('sys_organization', { id: ORG, name: 'Once Org', slug: 'once-org' });
  await engine.insert('sys_organization', { id: OTHER_ORG, name: 'Other Org', slug: 'other-org' });
  await engine.insert('sys_member', { organization_id: ORG, user_id: ownerId, role: 'owner' });
  await engine.insert('sys_member', { organization_id: ORG, user_id: memberId, role: 'member' });
  // The leaver's only membership at sign-in is ORG, so sign-in stamps ORG as
  // the session's active organization (the test removes it afterwards).
  await engine.insert('sys_member', { id: 'mem_leaver', organization_id: ORG, user_id: leaverId, role: 'member' });

  // A position held in the active organization, carrying a permission set.
  await engine.insert('sys_position', { id: 'pos_reviewer', name: 'reviewer', organization_id: ORG });
  await engine.insert('sys_permission_set', { id: 'ps_review', name: 'review_tools' });
  await engine.insert('sys_position_permission_set', { position_id: 'pos_reviewer', permission_set_id: 'ps_review' });
  await engine.insert('sys_user_position', { user_id: memberId, position: 'reviewer', organization_id: ORG });
  await engine.insert('sys_user_position', { user_id: leaverId, position: 'reviewer', organization_id: ORG });

  // The platform operator: an admin_full_access user grant owned by the Default
  // Organization (the single-posture anchor; no tenancy posture is configured
  // here). The Default Organization is a third organization nobody is a member of.
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' });
  await engine.insert('sys_permission_set', { id: 'ps_admin', name: 'admin_full_access' });
  await engine.insert('sys_user_permission_set', { user_id: operatorId, permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: 'org_default' });

  const bearers = {
    owner: bearerFrom(await signIn(manager, 'owner@example.com')),
    member: bearerFrom(await signIn(manager, 'member@example.com')),
    leaver: bearerFrom(await signIn(manager, 'leaver@example.com')),
    operator: bearerFrom(await signIn(manager, 'operator@example.com')),
  };
  return { engine, probe, manager, bearers, ids: { ownerId, memberId, leaverId, operatorId } };
};

/**
 * A WARM kernel: the first request through the resolver registers core's write
 * observer on the engine, and that request stores nothing for the engine (it
 * reads twice). Every later request is the case the count is about.
 *
 * [#24061] An in-process session read signs no JWT any more, so it no longer
 * mints the signing key either. [#25343] The one write a session read still
 * makes is the `last_activity_at` heartbeat, which runs on every deployment at
 * most once a minute. [#26638] A session is born with `last_activity_at` =
 * `created_at`, so a request inside its first minute writes nothing either:
 * the warm-up is one request per session, each writing nothing, which is the
 * steady state of a live session. A write inside the request is still
 * declined across — pinned below with that same heartbeat, on a session last
 * touched more than a minute ago.
 */
const arrangeWarm = async () => {
  const a = await arrange();
  const observersBefore = a.probe.middlewareCount();
  const warm = await resolveRequest(a, a.bearers.owner);
  expect(warm.writes).toEqual([]);
  expect(a.probe.middlewareCount()).toBe(observersBefore + 1);
  for (const bearer of [a.bearers.member, a.bearers.leaver, a.bearers.operator]) {
    expect((await resolveRequest(a, bearer)).writes).toEqual([]);
  }
  return a;
};

type Arranged = Awaited<ReturnType<typeof arrange>>;

/** One request through the real resolver with the real better-auth session read. */
async function resolveRequest(a: Arranged, bearer: string | null, tenancyPosture?: 'isolated') {
  const auth: any = await a.manager.getAuthInstance();
  const headers = new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {});
  return a.probe.measure(() =>
    resolveAuthzContext({
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ql: a.engine,
      headers,
      getSession: (h: any) => auth.api.getSession({ headers: h }),
      tenancyPosture,
    }),
  );
}

/** The same request with the epoch seam removed: core's memo declines, as before it existed. */
async function resolveRequestWithoutMemo(a: Arranged, bearer: string | null, tenancyPosture?: 'isolated') {
  const seam = a.engine.writeEpoch;
  delete a.engine.writeEpoch;
  try {
    return await resolveRequest(a, bearer, tenancyPosture);
  } finally {
    a.engine.writeEpoch = seam;
  }
}

const grantOnlyReads = (reads: string[]) => reads.filter((n) => GRANT_ONLY_TABLES.has(n));
const countOf = (reads: string[], name: string) => reads.filter((n) => n === name).length;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/**
 * [#23184] Every case signs up four users (four production-parameter scrypt
 * derivations under fresh salts) and signs all four in again (the same
 * password against the same salt, answered by the memo from the bytes the
 * sign-up produced: `__tests__/scrypt-memo.testkit.ts`). Each case builds its
 * own engine, instrumentation and manager, and the read counts are taken on
 * that case's own engine (core's request memo is scoped per request and per
 * engine), so the cases run concurrently and the fresh derivations overlap on
 * the libuv pool. The console stubs above are the only shared state; lifted
 * early by another case's `restoreAllMocks`, they cost log output and no
 * assertion.
 */
const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

describe.concurrent('the real customSession hook and resolveAuthzContext resolve the caller\'s grants once per request', () => {
  it('organization member: one resolution of grant reads, the same envelope as the two-resolution path', async () => {
    const a = await arrangeWarm();
    const once = await resolveRequest(a, a.bearers.member);
    const twice = await resolveRequestWithoutMemo(a, a.bearers.member);

    // The population, stated: a warm request (nothing written inside it), a
    // session that claims the organization, and a position that resolves — so
    // the count below is over a real resolution.
    expect(once.writes).toEqual([]);
    expect(once.value.tenantId).toBe(ORG);
    expect(once.value.positions).toEqual(expect.arrayContaining(['org_member', 'reviewer', 'everyone']));
    expect(once.value.permissions).toContain('review_tools');

    expect(once.value).toEqual(twice.value);
    // Leg 1 reads each user-keyed grant table exactly once per resolution.
    expect(countOf(once.reads, 'sys_user_position')).toBe(1);
    expect(countOf(once.reads, 'sys_user_permission_set')).toBe(1);
    expect(countOf(twice.reads, 'sys_user_position')).toBe(2);
    expect(countOf(twice.reads, 'sys_user_permission_set')).toBe(2);
    // Every grant-only read the memo saved, and nothing else.
    expect(grantOnlyReads(twice.reads).length).toBe(2 * grantOnlyReads(once.reads).length);
  });

  it('the request saves exactly one resolution\'s reads — six for a caller in an organization', async () => {
    const a = await arrangeWarm();
    const once = await resolveRequest(a, a.bearers.member);
    const twice = await resolveRequestWithoutMemo(a, a.bearers.member);
    // sys_user, sys_member (own), sys_user_position, sys_member (peers),
    // sys_user_permission_set, sys_metadata_activation. [ADR-0131 D3/D4] The
    // positions, their sets and the set bodies are read from the catalog
    // in-process; the one ledger read answers which are switched off.
    expect(twice.reads.length - once.reads.length).toBe(6);
  });

  it('organization owner and platform operator: same envelope, one resolution', async () => {
    const a = await arrangeWarm();
    for (const bearer of [a.bearers.owner, a.bearers.operator]) {
      const once = await resolveRequest(a, bearer);
      const twice = await resolveRequestWithoutMemo(a, bearer);
      expect(once.value).toEqual(twice.value);
      expect(countOf(once.reads, 'sys_user_position')).toBe(1);
      expect(countOf(twice.reads, 'sys_user_position')).toBe(2);
    }
    const operator = await resolveRequest(a, a.bearers.operator);
    expect(operator.value.posture).toBe('PLATFORM_ADMIN');
    const owner = await resolveRequest(a, a.bearers.owner);
    expect(owner.value.positions).toContain('org_owner');
  });

  it('a removed member whose session still claims the organization: the claim is dropped exactly as before', async () => {
    const a = await arrangeWarm();
    // Offboarded after sign-in — moved to another organization — while the
    // live session keeps naming ORG.
    await a.engine.delete('sys_member', { where: { id: 'mem_leaver' } });
    await a.engine.insert('sys_member', { organization_id: OTHER_ORG, user_id: a.ids.leaverId, role: 'member' });
    const auth: any = await a.manager.getAuthInstance();
    const claimed = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${a.bearers.leaver}` }) });
    expect(claimed?.session?.activeOrganizationId).toBe(ORG);

    const once = await resolveRequest(a, a.bearers.leaver, 'isolated');
    const twice = await resolveRequestWithoutMemo(a, a.bearers.leaver, 'isolated');
    expect(once.value).toEqual(twice.value);
    expect(once.value.tenantId).toBeUndefined();
    expect(once.value.positions).not.toContain('reviewer');
    expect(once.value.org_user_ids).toEqual([a.ids.leaverId]);
    expect(once.value.accessible_org_ids).toEqual([OTHER_ORG]);
    // The hook's resolution (claimed org) serves step 2; the re-resolution with
    // NO organization is its own and is read afresh: two, against three.
    expect(countOf(once.reads, 'sys_user_position')).toBe(2);
    expect(countOf(twice.reads, 'sys_user_position')).toBe(3);
  });

  it('anonymous request: nothing is resolved either way', async () => {
    const a = await arrangeWarm();
    const once = await resolveRequest(a, null);
    const twice = await resolveRequestWithoutMemo(a, null);
    expect(once.value).toEqual(twice.value);
    expect(once.value.userId).toBeUndefined();
    expect(grantOnlyReads(once.reads)).toEqual([]);
  });

  it('the session read outside resolveAuthzContext is untouched: the payload still resolves its own positions', async () => {
    const a = await arrangeWarm();
    const auth: any = await a.manager.getAuthInstance();
    const { value: payload, reads } = await a.probe.measure(() =>
      auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${a.bearers.member}` }) }),
    );
    expect((payload as any)?.user?.positions).toEqual(expect.arrayContaining(['org_member', 'reviewer']));
    expect(countOf(reads, 'sys_user_position')).toBe(1);
  });

  it.each([
    ['the default config (no session limit)', {}],
    ['an idle timeout', { sessionIdleTimeoutMinutes: 30 }],
  ])('a write inside the request (the heartbeat, under %s): the memo declines, the envelope is unchanged', async (_label, config) => {
    // [ADR-0069 D4] The hook stamps the session's `last_activity_at` AFTER it
    // resolved the grants — at most once a minute. [#25343] On every
    // deployment, not only where an idle timeout is configured: that
    // once-a-minute request is the one that pays the second resolution.
    const a = await arrange(config);
    // [#26638] A session is born with `last_activity_at` = `created_at`, so
    // the member's session is moved to one last touched two minutes ago: the
    // request below is then the once-a-minute one that writes.
    const lastTouched = new Date(Date.now() - 2 * 60_000).toISOString();
    for (const row of a.engine.tables.get('sys_session') ?? []) {
      if (row.user_id === a.ids.memberId) row.last_activity_at = lastTouched;
    }
    // Register core's write observer with an anonymous request first (no
    // session, nothing written), so the ONLY reason left for the member's
    // first request to read twice is the write inside it.
    const observersBefore = a.probe.middlewareCount();
    const anonymous = await resolveRequest(a, null);
    expect(anonymous.writes).toEqual([]);
    expect(a.probe.middlewareCount()).toBe(observersBefore + 1);
    const first = await resolveRequest(a, a.bearers.member);
    // The write happened between the hook's resolution and step 2…
    expect(first.writes).toContain('update sys_session');
    // …so step 2 read afresh: two resolutions, the pre-memo count.
    expect(countOf(first.reads, 'sys_user_position')).toBe(2);
    const warm = await resolveRequestWithoutMemo(a, a.bearers.member);
    expect(first.value).toEqual(warm.value);
  });
});
