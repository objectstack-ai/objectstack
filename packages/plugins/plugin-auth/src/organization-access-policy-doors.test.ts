// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0069 TL;DR 6] The organization's access policy at the two session
 * doors its sibling file (`organization-access-policy.test.ts`) reaches only
 * at hook level, through the real better-auth pipeline:
 *
 *  - **An objectstack mount's in-process session read.** A raw route under the
 *    auth base path (`gateAdmin`, and every route that reads its caller's
 *    session itself) reads it through `auth.api.getSession`, with no request.
 *    `customSession` judges the organization's IP list on it with the address
 *    the mount established (`runAtMountDoor`), as it does on the
 *    better-auth-served door — and, with no door open, judges the limits only.
 *    The mount half (the middleware opens the door with the D5 gate's address)
 *    is pinned on the real routes in `allowed-ip-ranges.pin.test.ts`.
 *  - **The real `/organization/set-active` route.** A switch into an
 *    organization whose idle limit the session is past is refused and the
 *    session ended, and NOTHING refreshes the session's last activity before
 *    the switch is judged: were better-auth's session middleware to run
 *    `customSession` (whose heartbeat refreshes `last_activity_at`) ahead of
 *    the `session.update.before` hook, the idle rule at the switch would be
 *    silently defeated.
 *
 * A file of its own: the sibling's harness file is another card's surface in
 * flight; the engine double here is that file's, copied.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { inProcessSessionReadInput } from '@objectstack/types';
import { AuthManager } from './auth-manager';
import { runAtMountDoor } from './request-client-address';

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
const PASSWORD = 'S3cure!Passw0rd-doors';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
const IN_A = '10.1.0.7';
const IN_B = '10.2.0.7';
const EMAIL = 'alice@alpha.test';
const MIN = 60_000;

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
 * One self-registered member of `memberships`, the first of which their
 * sessions are scoped to at sign-in, under the organization policies given.
 */
async function deployment(policies: Record<string, Record<string, unknown>>, memberships: readonly string[]) {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
    emailAndPassword: { enabled: true, requireEmailVerification: false },
  } as any);
  vi.spyOn(manager as any, 'selfRegistrationSetResolvable').mockResolvedValue(true);
  manager.setOrganizationAccessPolicySource({
    read: async (id) => policies[id] ?? {},
    anyOrganizationRequiresMfa: async () => false,
  });
  for (const id of [ORG_A, ORG_B]) {
    await engine.insert('sys_organization', { id, name: id, slug: id.replace('_', '-'), created_at: new Date() });
  }
  const res = await post(manager, '/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Alice' }, '127.0.0.1');
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === EMAIL);
  engine.tables.set('sys_member', (engine.tables.get('sys_member') ?? []).filter((m: any) => m.user_id !== user.id));
  for (const org of memberships) {
    await engine.insert('sys_member', { user_id: user.id, organization_id: org, role: 'member', created_at: new Date() });
  }
  return { engine, manager };
}

const scopedTo = (row: any) => row.active_organization_id ?? row.activeOrganizationId;

/** The signed-in session's `sys_session` row: the one scoped to `organization`, not the sign-up's. */
const sessionRow = (engine: ReturnType<typeof createMemoryEngine>, organization: string) =>
  ((engine.tables.get('sys_session') ?? []) as any[]).find((r) => scopedTo(r) === organization && !r.revoked_at)
  ?? ((engine.tables.get('sys_session') ?? []) as any[]).find((r) => scopedTo(r) === organization);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("an objectstack mount's in-process session read judges the organization's IP list", () => {
  /** The read a raw mount makes: `auth.api.getSession` with the request's headers, no request. */
  const inProcessRead = async (manager: AuthManager, cookie: string) => {
    const api: any = await manager.getApi();
    return api.getSession(inProcessSessionReadInput(new Headers({ cookie })));
  };

  it('a session read at a mount from outside the list is ended in place, ip_not_allowed', async () => {
    const { engine, manager } = await deployment({ [ORG_A]: { allowed_ip_ranges: '10.1.0.0/16' } }, [ORG_A]);
    const signIn = await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD }, IN_A);
    expect(signIn.status).toBe(200);
    const cookie = cookieFrom(signIn);

    // From inside the ranges the mount's read is admitted and the session stays live.
    expect((await runAtMountDoor(IN_A, () => inProcessRead(manager, cookie)))?.user?.email).toBe(EMAIL);
    expect(sessionRow(engine, ORG_A)?.revoked_at).toBeFalsy();

    // From outside them the detecting read ends the session in place…
    await runAtMountDoor(IN_B, () => inProcessRead(manager, cookie));
    const row = sessionRow(engine, ORG_A);
    expect(row?.revoke_reason).toBe('ip_not_allowed');
    // …and the next read, back inside the ranges, is anonymous.
    expect(await runAtMountDoor(IN_A, () => inProcessRead(manager, cookie))).toBeNull();
  });

  it('an address the mount could not establish is refused under a set list, as at the HTTP door', async () => {
    const { engine, manager } = await deployment({ [ORG_A]: { allowed_ip_ranges: '10.1.0.0/16' } }, [ORG_A]);
    const cookie = cookieFrom(await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD }, IN_A));
    await runAtMountDoor(undefined, () => inProcessRead(manager, cookie));
    expect(sessionRow(engine, ORG_A)?.revoke_reason).toBe('ip_not_allowed');
  });

  it('a programmatic read with no door open judges the limits only, never the list', async () => {
    const { engine, manager } = await deployment({ [ORG_A]: { allowed_ip_ranges: '10.1.0.0/16' } }, [ORG_A]);
    const cookie = cookieFrom(await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD }, IN_A));
    expect((await inProcessRead(manager, cookie))?.user?.email).toBe(EMAIL);
    expect(sessionRow(engine, ORG_A)?.revoked_at).toBeFalsy();
  });
});

describe('the real /organization/set-active: no heartbeat before the switch is judged', () => {
  it("a session idle past the target's idle limit is refused and ended there, its last activity not refreshed first", async () => {
    // Beta: no limits, so a read in Beta refreshes the heartbeat. Alpha: a 10-minute idle limit.
    const { engine, manager } = await deployment({ [ORG_A]: { session_idle_timeout_minutes: 10 }, [ORG_B]: {} }, [ORG_B, ORG_A]);
    const signIn = await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD }, IN_B);
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const cookie = cookieFrom(signIn);
    const row = sessionRow(engine, ORG_B);
    expect(row, 'the sign-in scoped its session to Beta').toBeTruthy();
    // Idle in Beta for 30 minutes: past Alpha's limit, well past the heartbeat interval.
    const idleSince = new Date(Date.now() - 30 * MIN);
    row.last_activity_at = idleSince;

    const switched = await post(manager, '/organization/set-active', { organizationId: ORG_A }, IN_B, cookie);
    expect(switched.status, await switched.clone().text()).toBe(401);
    expect(((await switched.json()) as any)?.code).toBe('UNAUTHENTICATED');
    expect(row.revoke_reason).toBe('idle_timeout');
    expect(scopedTo(row)).toBe(ORG_B);
    // Nothing refreshed the activity the judgement read.
    expect(new Date(row.last_activity_at).getTime()).toBe(idleSince.getTime());
  });

  it('the control: a session idle within the limit switches, through the same route', async () => {
    const { engine, manager } = await deployment({ [ORG_A]: { session_idle_timeout_minutes: 10 }, [ORG_B]: {} }, [ORG_B, ORG_A]);
    const cookie = cookieFrom(await post(manager, '/sign-in/email', { email: EMAIL, password: PASSWORD }, IN_B));
    const row = sessionRow(engine, ORG_B);
    row.last_activity_at = new Date(Date.now() - 2 * MIN);
    const switched = await post(manager, '/organization/set-active', { organizationId: ORG_A }, IN_B, cookie);
    expect(switched.status, await switched.clone().text()).toBe(200);
    expect(row.revoked_at).toBeFalsy();
    expect(scopedTo(row)).toBe(ORG_A);
  });
});
