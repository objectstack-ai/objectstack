// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D9] The self-registration grant settles on the FIRST
 * MEMBERSHIP, under every posture: the grant (`sys_user_permission_set`) is an
 * organization row, so it is written with a membership and owned by that
 * membership's organization — never without one.
 *
 *  - `single`: the reconciler binds the Default Organization in the same
 *    `user.create.after` hook, just before the grant settles, so a sign-up
 *    ends with exactly the grant it always had, owned by the Default
 *    Organization.
 *  - A wall: the registrant belongs to no organization at sign-up, so sign-up
 *    writes NO grant; it persists a pending claim (`sys_verification`, a
 *    deployment-level store) and the first `sys_member` row written for the
 *    user — creating an organization, accepting an invitation, being added —
 *    lands the one grant, owned by that organization. A second membership
 *    writes no second grant.
 *
 * The engine double runs registered middleware around every insert the way
 * `ObjectQL.executeWithMiddleware` does (driver step innermost, `opCtx.result`
 * set before the chain unwinds), because the first-membership seam is a
 * `sys_member` insert middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';

const USER = { id: 'usr_registrant', email: 'ada@example.com', name: 'Ada' };
const SET = 'member_default';
const CLAIM_IDENTIFIER = `self-registration-grant:${USER.id}`;

type Tables = Map<string, any[]>;
type Mw = (opCtx: any, next: () => Promise<void>) => Promise<void>;

/** Equality, plus the one operator the writer sends (`$gt` on a date); every combinator is refused. */
function matches(row: any, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`memory engine: unsupported combinator ${k}`);
    if (v && typeof v === 'object' && !(v instanceof Date) && '$gt' in v) {
      return new Date(row[k]).getTime() > new Date(v.$gt).getTime();
    }
    return row[k] === v;
  });
}

/**
 * An in-memory engine over `tables` (shared across engines to model a store
 * that outlives a restart). `withMiddleware: false` models an engine that
 * offers no middleware seam.
 */
function memoryEngine(tables: Tables = new Map(), opts: { withMiddleware?: boolean } = {}) {
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const middlewares: Mw[] = [];
  let seq = 0;
  const engine: any = {
    tables,
    async insert(object: string, data: any) {
      const opCtx: any = { object, operation: 'insert', data };
      const chain = async (index: number): Promise<void> => {
        if (index < middlewares.length) return middlewares[index](opCtx, () => chain(index + 1));
        const row = { id: data.id ?? `row_${++seq}`, ...data };
        rows(object).push(row);
        opCtx.result = { ...row };
      };
      await chain(0);
      return opCtx.result;
    },
    async find(object: string, q: any = {}) {
      let out = rows(object).filter((r) => matches(r, q.where));
      if (typeof q.limit === 'number') out = out.slice(0, q.limit);
      return out.map((r) => ({ ...r }));
    },
    async delete(object: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(object);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(object, keep);
      return table.length - keep.length;
    },
  };
  if (opts.withMiddleware !== false) {
    engine.registerMiddleware = (fn: Mw) => {
      middlewares.push(fn);
    };
  }
  return engine;
}

const SINGLE = { defaultOrgId: async () => 'org_default' };
const WALLED = { defaultOrgId: async () => null };

function makeManager(engine: any, tenancy: { defaultOrgId(): Promise<string | null> }) {
  const errors: string[] = [];
  const manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    getTenancy: () => tenancy,
    logger: { error: (m: string) => errors.push(String(m)), warn: () => {}, info: () => {}, debug: () => {} },
  } as never);
  return { manager: manager as any, errors };
}

/**
 * The `user.create.after` composition for an ADMITTED self-registrant: the
 * admission gate staged the set, then the hook runs the membership reconciler
 * and the grant settle, in that order.
 */
async function signUp(manager: any) {
  manager.stageSelfRegistrationGrant(USER.email, SET);
  await manager.settleMembership(USER.id);
  await manager.settleSelfRegistrationGrant(USER);
}

const grantsOf = (engine: any) => engine.tables.get('sys_user_permission_set') ?? [];
const claimsOf = (engine: any) => engine.tables.get('sys_verification') ?? [];

describe('[ADR-0131 D3] under single the grant lands at sign-up, owned by the Default Organization', () => {
  it('writes exactly the grant it always had — one row, the Default Organization, no claim', async () => {
    const engine = memoryEngine();
    const { manager, errors } = makeManager(engine, SINGLE);
    await signUp(manager);
    expect(errors).toEqual([]);
    expect(engine.tables.get('sys_member')).toMatchObject([{ user_id: USER.id, organization_id: 'org_default' }]);
    expect(grantsOf(engine)).toHaveLength(1);
    expect(grantsOf(engine)[0]).toMatchObject({ user_id: USER.id, permission_set: SET, organization_id: 'org_default' });
    expect(claimsOf(engine)).toEqual([]);
  });
});

describe('[ADR-0131 D3/D9] under a wall the grant waits for the first membership', () => {
  it('sign-up writes no grant: it persists one claim, deployment-level, naming the set', async () => {
    const engine = memoryEngine();
    const { manager, errors } = makeManager(engine, WALLED);
    await signUp(manager);
    expect(errors).toEqual([]);
    expect(engine.tables.get('sys_member') ?? []).toEqual([]);
    expect(grantsOf(engine)).toEqual([]);
    expect(claimsOf(engine)).toHaveLength(1);
    const claim = claimsOf(engine)[0];
    expect(claim).toMatchObject({ identifier: CLAIM_IDENTIFIER, value: SET });
    expect('organization_id' in claim).toBe(false);
    expect(new Date(claim.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('the first membership lands exactly one grant, owned by its organization, and consumes the claim', async () => {
    const engine = memoryEngine();
    const { manager, errors } = makeManager(engine, WALLED);
    await signUp(manager);
    // Creating an organization: better-auth writes the creator's owner row.
    await engine.insert('sys_member', { id: 'mem_1', user_id: USER.id, organization_id: 'org_acme', role: 'owner' });
    expect(errors).toEqual([]);
    expect(grantsOf(engine)).toHaveLength(1);
    expect(grantsOf(engine)[0]).toMatchObject({ user_id: USER.id, permission_set: SET, organization_id: 'org_acme' });
    expect(claimsOf(engine)).toEqual([]);
  });

  it('a second membership writes no second self-registration grant', async () => {
    const engine = memoryEngine();
    const { manager } = makeManager(engine, WALLED);
    await signUp(manager);
    await engine.insert('sys_member', { id: 'mem_1', user_id: USER.id, organization_id: 'org_acme', role: 'owner' });
    await engine.insert('sys_member', { id: 'mem_2', user_id: USER.id, organization_id: 'org_beta', role: 'member' });
    expect(grantsOf(engine)).toHaveLength(1);
    expect(grantsOf(engine)[0].organization_id).toBe('org_acme');
  });

  it('the claim survives a restart: a fresh manager over the same store settles it on the first membership', async () => {
    const tables: Tables = new Map();
    const before = memoryEngine(tables);
    await signUp(makeManager(before, WALLED).manager);
    expect(claimsOf(before)).toHaveLength(1);

    // A restart: new engine and manager instances, the same stored rows, no
    // in-memory stage carried over.
    const after = memoryEngine(tables);
    const { errors } = makeManager(after, WALLED);
    await after.insert('sys_member', { id: 'mem_1', user_id: USER.id, organization_id: 'org_acme', role: 'member' });
    expect(errors).toEqual([]);
    expect(grantsOf(after)).toHaveLength(1);
    expect(grantsOf(after)[0]).toMatchObject({ user_id: USER.id, permission_set: SET, organization_id: 'org_acme' });
  });

  it('a membership of a user who holds no claim (invited, operator-created) writes no grant', async () => {
    const engine = memoryEngine();
    makeManager(engine, WALLED);
    await engine.insert('sys_member', { id: 'mem_1', user_id: 'usr_invited', organization_id: 'org_acme', role: 'member' });
    expect(grantsOf(engine)).toEqual([]);
  });

  it('an expired claim is not honoured', async () => {
    const engine = memoryEngine();
    makeManager(engine, WALLED);
    engine.tables.set('sys_verification', [
      { id: 'ver_old', identifier: CLAIM_IDENTIFIER, value: SET, expires_at: new Date(Date.now() - 1000) },
    ]);
    await engine.insert('sys_member', { id: 'mem_1', user_id: USER.id, organization_id: 'org_acme', role: 'owner' });
    expect(grantsOf(engine)).toEqual([]);
  });

  it('an engine with no middleware seam parks nothing: the registrant is reported ungranted at sign-up', async () => {
    const engine = memoryEngine(new Map(), { withMiddleware: false });
    const { manager, errors } = makeManager(engine, WALLED);
    await signUp(manager);
    expect(grantsOf(engine)).toEqual([]);
    expect(claimsOf(engine)).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`'${SET}' was NOT granted`);
  });
});

describe('the first-membership seam is registered once per engine', () => {
  it('two managers over one engine settle a claim once', async () => {
    const engine = memoryEngine();
    const register = vi.spyOn(engine, 'registerMiddleware');
    const { manager } = makeManager(engine, WALLED);
    makeManager(engine, WALLED);
    expect(register).toHaveBeenCalledTimes(1);
    await signUp(manager);
    await engine.insert('sys_member', { id: 'mem_1', user_id: USER.id, organization_id: 'org_acme', role: 'owner' });
    expect(grantsOf(engine)).toHaveLength(1);
  });
});
