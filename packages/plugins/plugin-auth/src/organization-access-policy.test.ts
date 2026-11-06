// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0069 TL;DR 6] The access policy, per organization
 * (`organization-access-policy.ts`): the per-key floor rule, and two
 * organizations in one deployment, each with its own allowed IP ranges and
 * session limits, enforced on its own members through the real better-auth
 * pipeline (`handleRequest`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import {
  accessPolicyFloorRefusal,
  accessPolicyWritePredicate,
  effectiveMfaLevel,
  effectiveSessionLimits,
  rangeWithin,
  readOrganizationAccessPolicy,
  tighterLimit,
} from './organization-access-policy';
import { allowedIpRangesWritePredicate } from './allowed-ip-ranges';

describe('the floor, per key', () => {
  it('limits: the smaller positive value holds, 0 is no limit', () => {
    expect(tighterLimit(60, 0)).toBe(60);
    expect(tighterLimit(0, 15)).toBe(15);
    expect(tighterLimit(60, 15)).toBe(15);
    expect(tighterLimit(15, 60)).toBe(15);
    expect(tighterLimit(0, 0)).toBe(0);
  });

  it('ranges: a range is inside another only when it is narrower and matched', () => {
    expect(rangeWithin('10.1.0.0/16', '10.0.0.0/8')).toBe(true);
    expect(rangeWithin('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(rangeWithin('10.0.0.0/8', '10.1.0.0/16')).toBe(false);
    expect(rangeWithin('192.168.0.0/16', '10.0.0.0/8')).toBe(false);
    expect(rangeWithin('2001:db8:1::/48', '2001:db8::/32')).toBe(true);
    expect(rangeWithin('2001:db8::/32', '10.0.0.0/8')).toBe(false);
  });

  it('enforcement holds the floor whatever an organization stores', () => {
    const floor = { sessionIdleTimeoutMinutes: 30, sessionAbsoluteMaxHours: 8, maxConcurrentSessions: 3, mfaRequirement: 'administrators' as const };
    // A looser stored row (written around the save door) changes nothing.
    const loose = readOrganizationAccessPolicy({
      session_idle_timeout_minutes: 600, session_absolute_max_hours: 100, max_concurrent_sessions_per_user: 50, mfa_required: 'off',
    });
    expect(effectiveSessionLimits(floor, loose)).toEqual({ idleMinutes: 30, absoluteHours: 8, concurrent: 3 });
    expect(effectiveMfaLevel(floor, loose)).toBe('administrators');
    const tight = readOrganizationAccessPolicy({
      session_idle_timeout_minutes: 10, session_absolute_max_hours: 2, max_concurrent_sessions_per_user: 1, mfa_required: 'everyone',
    });
    expect(effectiveSessionLimits(floor, tight)).toEqual({ idleMinutes: 10, absoluteHours: 2, concurrent: 1 });
    expect(effectiveMfaLevel(floor, tight)).toBe('everyone');
  });

  it('an organization cannot save a value below the deployment floor', () => {
    const floor = {
      allowedIpRanges: ['10.0.0.0/8'],
      sessionIdleTimeoutMinutes: 30,
      sessionAbsoluteMaxHours: 8,
      maxConcurrentSessions: 3,
      mfaRequirement: 'administrators' as const,
    };
    // Loosening: refused, naming the deployment's value.
    expect(accessPolicyFloorRefusal('allowed_ip_ranges', '10.1.0.0/16\n192.168.0.0/16', floor)?.constraint)
      .toEqual({ range: '192.168.0.0/16', deploymentRanges: ['10.0.0.0/8'] });
    expect(accessPolicyFloorRefusal('session_idle_timeout_minutes', 31, floor)?.constraint).toEqual({ max: 30 });
    expect(accessPolicyFloorRefusal('session_absolute_max_hours', 9, floor)?.constraint).toEqual({ max: 8 });
    expect(accessPolicyFloorRefusal('max_concurrent_sessions_per_user', 4, floor)?.constraint).toEqual({ max: 3 });
    // Tightening, the deployment's own value, and each key's zero value: saved.
    expect(accessPolicyFloorRefusal('allowed_ip_ranges', '10.1.0.0/16', floor)).toBeUndefined();
    expect(accessPolicyFloorRefusal('allowed_ip_ranges', '', floor)).toBeUndefined();
    expect(accessPolicyFloorRefusal('session_idle_timeout_minutes', 30, floor)).toBeUndefined();
    expect(accessPolicyFloorRefusal('session_idle_timeout_minutes', 0, floor)).toBeUndefined();
    expect(accessPolicyFloorRefusal('mfa_required', 'everyone', floor)).toBeUndefined();
    expect(accessPolicyFloorRefusal('mfa_required', 'administrators', floor)).toBeUndefined();
    expect(accessPolicyFloorRefusal('mfa_required', 'off', floor)).toBeUndefined();
    expect(accessPolicyFloorRefusal('mfa_required', null, floor)).toBeUndefined();
    // Against an `everyone` deployment, `administrators` is weaker.
    expect(accessPolicyFloorRefusal('mfa_required', 'administrators', { mfaRequirement: 'everyone' })?.constraint)
      .toEqual({ minimum: 'everyone' });
    // A deployment that sets nothing bounds nothing.
    expect(accessPolicyFloorRefusal('allowed_ip_ranges', '192.168.0.0/16', {})).toBeUndefined();
    expect(accessPolicyFloorRefusal('session_idle_timeout_minutes', 9999, {})).toBeUndefined();
  });

  it('the refusal is in the caller\'s language', () => {
    const refusal = accessPolicyFloorRefusal('session_idle_timeout_minutes', 31, { sessionIdleTimeoutMinutes: 30 }, 'zh-CN');
    expect(refusal?.message).toContain('30');
    expect(refusal?.message).not.toMatch(/deployment/);
  });

  it('the save check refuses an organization list that leaves out the saving address', async () => {
    const manager = { resolveClientAddress: (t: { remoteAddress?: string }) => t.remoteAddress };
    const predicate = accessPolicyWritePredicate(
      () => ({ allowedIpRanges: [] }),
      allowedIpRangesWritePredicate(() => manager, { recovery: false }),
    );
    const refusal = await predicate({ key: 'allowed_ip_ranges', next: '10.1.0.0/16', transport: { remoteAddress: '192.0.2.7' } });
    expect(refusal?.constraint).toEqual({ clientAddress: '192.0.2.7' });
    // The env-override way back reopens only the deployment's list, so an
    // organization's refusal does not name it.
    expect(refusal?.message).not.toContain('OS_AUTH_ALLOWED_IP_RANGES');
    expect(await predicate({ key: 'allowed_ip_ranges', next: '10.1.0.0/16', transport: { remoteAddress: '10.1.2.3' } }))
      .toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Two organizations in one deployment, through the real better-auth pipeline
// ───────────────────────────────────────────────────────────────────────────

const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
      }
      return eq(actual, v);
    });
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      assertEngineFindOnePredicate(name, q);
      const row = rows(name).find((r) => matches(r, q.where));
      return row ? project(row, q.fields) : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      if (typeof q.limit === 'number') out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-30922';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
const IN_A = '10.1.0.7';
const IN_B = '10.2.0.7';

const post = (manager: AuthManager, path: string, body: unknown, remoteAddress: string, cookie?: string) =>
  manager.handleRequest(
    new Request(`http://localhost:3000/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { remoteAddress },
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/**
 * A deployment with two organizations, Alpha (members may come only from
 * 10.1.0.0/16, idle timeout 5 minutes) and Beta (only from 10.2.0.0/16, no
 * idle timeout), and one plain member of each. The deployment sets no list
 * and no idle timeout of its own.
 */
async function twoOrganizationDeployment() {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    // Two self-registered members: open self-registration (the second
    // sign-up is past the first-user bypass).
    audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
    emailAndPassword: { enabled: true, requireEmailVerification: false },
  } as any);
  // The open audience's declared set has no security catalog behind this
  // harness; it resolves here, as it does on a composed deployment.
  vi.spyOn(manager as any, 'selfRegistrationSetResolvable').mockResolvedValue(true);
  const policies: Record<string, Record<string, unknown>> = {
    [ORG_A]: { allowed_ip_ranges: '10.1.0.0/16', session_idle_timeout_minutes: 5 },
    [ORG_B]: { allowed_ip_ranges: '10.2.0.0/16' },
  };
  manager.setOrganizationAccessPolicySource({
    read: async (id) => policies[id] ?? {},
    anyOrganizationRequiresMfa: async () => false,
  });
  for (const [email, org] of [['alice@alpha.test', ORG_A], ['bob@beta.test', ORG_B]] as const) {
    const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email }, '127.0.0.1');
    expect(res.status, `${email}: ${await res.clone().text()}`).toBe(200);
    const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
    // Whatever membership the sign-up settled is replaced by the one under test.
    engine.tables.set('sys_member', (engine.tables.get('sys_member') ?? []).filter((m: any) => m.user_id !== user.id));
    await engine.insert('sys_member', { user_id: user.id, organization_id: org, role: 'member', created_at: new Date() });
  }
  return { engine, manager };
}

const signIn = (manager: AuthManager, email: string, remoteAddress: string) =>
  post(manager, '/sign-in/email', { email, password: PASSWORD }, remoteAddress);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('two organizations, each policy enforced on its own members', () => {
  it('each organization\'s allowed IP ranges admit its own members from its own ranges only', async () => {
    const { manager } = await twoOrganizationDeployment();

    const aliceHome = await signIn(manager, 'alice@alpha.test', IN_A);
    expect(aliceHome.status).toBe(200);
    const aliceAway = await signIn(manager, 'alice@alpha.test', IN_B);
    expect(aliceAway.status).toBe(403);
    expect(((await aliceAway.json()) as any).code).toBe('IP_NOT_ALLOWED');

    const bobHome = await signIn(manager, 'bob@beta.test', IN_B);
    expect(bobHome.status).toBe(200);
    const bobAway = await signIn(manager, 'bob@beta.test', IN_A);
    expect(bobAway.status).toBe(403);
    expect(((await bobAway.json()) as any).code).toBe('IP_NOT_ALLOWED');
  });

  it('a refused scoping leaves no session behind', async () => {
    const { engine, manager } = await twoOrganizationDeployment();
    const before = (engine.tables.get('sys_session') ?? []).length;
    expect((await signIn(manager, 'alice@alpha.test', IN_B)).status).toBe(403);
    expect((engine.tables.get('sys_session') ?? []).length).toBe(before);
  });

  it('a tenant-level administrator is held by the deployment\'s list only (break-glass)', async () => {
    const { manager } = await twoOrganizationDeployment();
    vi.spyOn(manager as any, 'isPlatformAdminUserId').mockResolvedValue(true);
    expect((await signIn(manager, 'alice@alpha.test', IN_B)).status).toBe(200);
  });

  it('each organization\'s idle timeout ends its own members\' sessions only', async () => {
    const { engine, manager } = await twoOrganizationDeployment();
    const alice = cookieFrom(await signIn(manager, 'alice@alpha.test', IN_A));
    const bob = cookieFrom(await signIn(manager, 'bob@beta.test', IN_B));
    // Both sessions were scoped at creation (ADR-0093 D9) and last active an hour ago.
    // (The sign-up sessions from the harness carry another organization or none.)
    const scopedTo = (row: any) => row.active_organization_id ?? row.activeOrganizationId;
    const sessions = ((engine.tables.get('sys_session') ?? []) as any[]).filter((row) => [ORG_A, ORG_B].includes(scopedTo(row)));
    expect(sessions.map(scopedTo).sort()).toEqual([ORG_A, ORG_B]);
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    for (const row of sessions) Object.assign(row, { last_activity_at: hourAgo });
    const getSession = (cookie: string, remoteAddress: string) =>
      manager.handleRequest(
        new Request('http://localhost:3000/api/v1/auth/get-session', { headers: { cookie } }),
        { remoteAddress },
      );
    // The detecting request revokes in place (ADR-0069 D4); the next one is anonymous.
    await getSession(alice, IN_A);
    await getSession(bob, IN_B);
    const alive = async (cookie: string, address: string) => {
      const res = await getSession(cookie, address);
      if (res.status !== 200) return false;
      return Boolean(((await res.json().catch(() => null)) as any)?.user?.id);
    };
    expect(await alive(alice, IN_A)).toBe(false);
    expect(await alive(bob, IN_B)).toBe(true);
  });

  it('a session the organization\'s list no longer admits is ended on its next auth-door read (roaming)', async () => {
    const { manager } = await twoOrganizationDeployment();
    const alice = cookieFrom(await signIn(manager, 'alice@alpha.test', IN_A));
    const read = (address: string) =>
      manager.handleRequest(
        new Request('http://localhost:3000/api/v1/auth/get-session', { headers: { cookie: alice } }),
        { remoteAddress: address },
      );
    const alive = async (address: string) => {
      const res = await read(address);
      if (res.status !== 200) return false;
      return Boolean(((await res.json().catch(() => null)) as any)?.user?.id);
    };
    expect(await alive(IN_A)).toBe(true);
    // From outside Alpha's ranges: the detecting read ends the session in place…
    await read(IN_B);
    // …and it stays ended, even back inside the ranges.
    expect(await alive(IN_A)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The concurrent cap and the active-organization switch
// ───────────────────────────────────────────────────────────────────────────

describe('the concurrent cap: the deployment counts every session, an organization its own', () => {
  const MIN = 60_000;
  async function withSessions(config: Record<string, unknown>, policies: Record<string, Record<string, unknown>>) {
    const engine = createMemoryEngine();
    const manager = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine, ...config } as any);
    manager.setOrganizationAccessPolicySource({ read: async (id) => policies[id] ?? {}, anyOrganizationRequiresMfa: async () => false });
    const now = Date.now();
    const add = (id: string, org: string, minutesAgo: number) =>
      engine.insert('sys_session', {
        id, user_id: 'u1', active_organization_id: org,
        created_at: new Date(now - minutesAgo * MIN), last_activity_at: new Date(now - minutesAgo * MIN),
        expires_at: new Date(now + 60 * MIN),
      });
    return { engine, manager, add };
  }
  const revoked = (engine: any) =>
    ((engine.tables.get('sys_session') ?? []) as any[]).filter((r) => r.revoked_at).map((r) => r.id).sort();

  it('an organization cap ends only that organization\'s oldest sessions, never another organization\'s', async () => {
    const { engine, manager, add } = await withSessions({}, { [ORG_A]: { max_concurrent_sessions_per_user: 1 } });
    await add('b_old', ORG_B, 50);
    await add('a_old', ORG_A, 40);
    await add('a_new', ORG_A, 1);
    await (manager as any).enforceConcurrentCap('u1', ORG_A, 'a_new');
    expect(revoked(engine)).toEqual(['a_old']);
  });

  it('a switch into a strict organization is swept with the switching session kept', async () => {
    const { engine, manager, add } = await withSessions({}, { [ORG_A]: { max_concurrent_sessions_per_user: 1 } });
    await add('a_newer', ORG_A, 5);
    await add('b_switching', ORG_B, 30); // older, and switching into Alpha
    await (manager as any).enforceConcurrentCap('u1', ORG_A, 'b_switching');
    expect(revoked(engine)).toEqual(['a_newer']);
  });

  it('the session hook sweeps the target organization\'s cap when a session switches in', async () => {
    const { engine, manager, add } = await withSessions({}, { [ORG_A]: { max_concurrent_sessions_per_user: 1 } });
    await add('a_newer', ORG_A, 5);
    await add('b_switching', ORG_B, 30);
    const hooks: any = (manager as any).composeDatabaseHooks();
    const ctx = { context: { session: { session: { id: 'b_switching', userId: 'u1', activeOrganizationId: ORG_B }, user: { id: 'u1' } } } };
    await hooks.session.update.before({ activeOrganizationId: ORG_A }, ctx);
    expect(revoked(engine)).toEqual(['a_newer']);
  });

  it('the deployment cap still counts every session, whatever organization', async () => {
    const { engine, manager, add } = await withSessions({ maxConcurrentSessions: 2 }, {});
    await add('a1', ORG_A, 30);
    await add('b1', ORG_B, 20);
    await add('a2', ORG_A, 1);
    await (manager as any).enforceConcurrentCap('u1', ORG_A, 'a2');
    expect(revoked(engine)).toEqual(['a1']);
  });
});

describe('a switch of the active organization is judged against the target\'s limits', () => {
  const MIN = 60_000;
  async function deployment(policies: Record<string, Record<string, unknown>>) {
    const engine = createMemoryEngine();
    const manager = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine } as any);
    manager.setOrganizationAccessPolicySource({ read: async (id) => policies[id] ?? {}, anyOrganizationRequiresMfa: async () => false });
    await engine.insert('sys_session', {
      id: 's1', user_id: 'u1', active_organization_id: ORG_B,
      created_at: new Date(Date.now() - 60 * MIN), last_activity_at: new Date(Date.now() - 30 * MIN),
      expires_at: new Date(Date.now() + 60 * MIN),
    });
    return { engine, manager };
  }
  const row = (engine: any) => ((engine.tables.get('sys_session') ?? []) as any[]).find((r) => r.id === 's1');

  it('a session idle past the target\'s idle limit is ended and the switch refused; last activity is not refreshed first', async () => {
    const { engine, manager } = await deployment({ [ORG_A]: { session_idle_timeout_minutes: 10 } });
    const lastBefore = row(engine).last_activity_at;
    const hooks: any = (manager as any).composeDatabaseHooks();
    const ctx = { context: { session: { session: { id: 's1', userId: 'u1', activeOrganizationId: ORG_B }, user: { id: 'u1' } } } };
    const refused = await hooks.session.update.before({ activeOrganizationId: ORG_A }, ctx).then(() => undefined, (e: any) => e);
    expect(refused?.body?.code ?? refused?.code).toBe('UNAUTHENTICATED');
    expect(row(engine).revoke_reason).toBe('idle_timeout');
    expect(row(engine).last_activity_at).toEqual(lastBefore);
  });

  it('the absolute limit is judged too, and a target with no limits admits the switch', async () => {
    const { engine, manager } = await deployment({ [ORG_A]: { session_absolute_max_hours: 0 }, [ORG_B]: {} });
    expect(await manager.judgeSessionSwitch('s1', ORG_A)).toBe('admitted');
    expect(row(engine).revoked_at).toBeUndefined();
    const strict = await deployment({ [ORG_A]: { session_absolute_max_hours: 1 } });
    // 60 minutes old against a one-hour limit: not over yet.
    expect(await strict.manager.judgeSessionSwitch('s1', ORG_A)).toBe('admitted');
    row(strict.engine).created_at = new Date(Date.now() - 61 * MIN);
    expect(await strict.manager.judgeSessionSwitch('s1', ORG_A)).toBe('ended');
    expect(row(strict.engine).revoke_reason).toBe('absolute_max');
  });
});

describe('the retired mfaRequired option is refused, never dropped', () => {
  it('at construction, naming the replacement', () => {
    expect(() => new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', mfaRequired: true } as any))
      .toThrow(/mfaRequired option was retired.*mfaRequirement: 'everyone'/);
    expect(() => new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', mfaRequirement: 'all' } as any))
      .toThrow(/invalid mfaRequirement "all"/);
  });

  it('on a config patch', () => {
    const manager = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', mfaRequirement: 'administrators' } as any);
    expect(() => manager.applyConfigPatch({ mfaRequired: false } as any)).toThrow(/mfaRequired option was retired/);
    expect(manager.getDeploymentAccessFloor().mfaRequirement).toBe('administrators');
  });
});
