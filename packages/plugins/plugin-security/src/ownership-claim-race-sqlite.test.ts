// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D4] Two members of one queue claim the same parked row at the same
 * moment, over the REAL stack: `ObjectQL`, `SqlDriver` on better-sqlite3
 * `:memory:` (a single-connection pool), `SecurityPlugin` and
 * `SharingService`. Exactly one claim lands; the loser answers
 * `409 CONCURRENT_UPDATE`, never "not found" and never "forbidden" because it
 * lost a race; the stored owner is the winner.
 *
 * The cells cross the two answers a lost race used to get with the two unit
 * shapes the engine has: an object with no metadata `beforeUpdate` hook opens
 * no unit of work for the write; one with such a hook opens the after-abort
 * unit (`opensAfterAbortUnit`'s side-writing term). When that unit enclosed the
 * middleware chain, the loser's whole write — the authorization gate's
 * caller-scoped pre-image read included — waited on the single connection for
 * the winner's commit, and then read a row it no longer owned: `private`
 * answered 404 (it cannot see the row), `public_read` answered 403 (it can see
 * it but not edit it). The unit now opens around the engine body only, so both
 * gates read the parked row and the conditional write decides.
 *
 * The rest of the file is the non-regression half: a true not-found still
 * answers 404, and a row the caller cannot read still answers as not found
 * (no existence leak), on the hooked object whose writes open the unit.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const CASE = 'cq_case';
const ORG = 'org_cq';
const QUEUE = 'cq_intake';
const A = 'usr_cq_a';
const B = 'usr_cq_b';
/** Rounds per cell: the race is a scheduling fact, so one round proves little. */
const ROUNDS = 25;
const SET = PermissionSetSchema.parse({
  name: 'cq_member',
  objects: { [CASE]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});
const SETS = [MEMBER_DEFAULT, SET];
const memberOf = (userId: string) => ({
  userId, tenantId: ORG, positions: ['org_member'], permissions: [SET.name, 'member_default'], posture: 'MEMBER',
});
const QUIET = { debug() {}, info() {}, warn() {}, error() {} };

async function boot(opts: { sharingModel: 'private' | 'public_read'; beforeHook: boolean }) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.claim-race', name: 'claim race', version: '1.0.0', type: 'plugin', scope: 'system',
    objects: [SysRecordShare, SysUser, SysOrganization, SysMember, SysUserPosition, SysUserPermissionSet, {
      name: CASE, label: 'Case', sharingModel: opts.sharingModel, tenancy: { enabled: false },
      fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } },
    }],
  } as never);
  await engine.syncSchemas();
  if (opts.beforeHook) {
    // A metadata-bound hook that does nothing: its presence alone is what
    // makes the engine open the after-abort unit for this object's updates.
    bindHooksToEngine(engine as never, [{ name: 'cq_touch', object: CASE, events: ['beforeUpdate'], handler: () => {} } as never], {
      packageId: 'app:cq', logger: QUIET as never,
    });
  }
  await engine.insert('sys_user', [A, B].map((id) => ({ id, name: id, email: `${id}@cq.test` })), SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'CQ', slug: 'cq' }], SYS);
  let securityService: unknown;
  let sharing: SharingService | undefined;
  const queues = {
    queuesOf: async (u: string) => ([A, B].includes(u) ? [QUEUE] : []),
    isMember: async (u: string, q: string) => q === QUEUE && [A, B].includes(u),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? SETS.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => SETS,
    },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { if (name === 'security') securityService = svc; },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => securityService as never, ownershipQueues: () => queues as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  return engine;
}

/** Seed a row straight through the driver, below every gate. */
const seed = (engine: ObjectQL, row: Record<string, unknown>) =>
  (engine as any).getDriver(CASE).create(CASE, row);
const claim = (engine: ObjectQL, id: string, user: string) =>
  engine.update(CASE, { id, owner_id: user }, { where: { id }, context: memberOf(user) } as never);
const outcome = (r: PromiseSettledResult<unknown>): string =>
  r.status === 'fulfilled' ? 'fulfilled' : `${(r.reason as any)?.code}/${(r.reason as any)?.status}`;

for (const sharingModel of ['private', 'public_read'] as const) {
  for (const beforeHook of [false, true]) {
    describe(`[ADR-0142 D4] concurrent claims — ${sharingModel} OWD, ${beforeHook ? 'metadata beforeUpdate hook (the unit opens)' : 'no hook (no unit)'}`, () => {
      it(`exactly one claim lands and every loser answers 409 CONCURRENT_UPDATE, over ${ROUNDS} rounds`, async () => {
        const engine = await boot({ sharingModel, beforeHook });
        const losers: Record<string, number> = {};
        for (let round = 0; round < ROUNDS; round++) {
          const id = `case_${round}`;
          await seed(engine, { id, name: 'parked', owner_id: null, queue: QUEUE });
          const settled = await Promise.allSettled([claim(engine, id, A), claim(engine, id, B)]);
          const won = settled.flatMap((r, i) => (r.status === 'fulfilled' ? [[A, B][i]] : []));
          expect(won, `round ${round}: ${settled.map(outcome).join(' | ')}`).toHaveLength(1);
          for (const r of settled) {
            if (r.status === 'rejected') {
              const key = outcome(r);
              losers[key] = (losers[key] ?? 0) + 1;
            }
          }
          const stored = await engine.findOne(CASE, { where: { id } } as never, SYS);
          expect((stored as any)?.owner_id, `round ${round}: the stored owner is the winner`).toBe(won[0]);
        }
        expect(losers).toEqual({ 'CONCURRENT_UPDATE/409': ROUNDS });
      });
    });
  }
}

describe('[ADR-0142 D4] the unit around the engine body keeps the gate\'s refusals — private OWD, hooked object', () => {
  it('a row that is gone still answers 404 RECORD_NOT_FOUND', async () => {
    const engine = await boot({ sharingModel: 'private', beforeHook: true });
    await seed(engine, { id: 'case_gone', name: 'parked', owner_id: null, queue: QUEUE });
    await engine.delete(CASE, { where: { id: 'case_gone' }, context: { isSystem: true } } as never);
    const err = await claim(engine, 'case_gone', A).then(() => undefined, (e: unknown) => e);
    expect(err).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('a row the caller cannot read answers as not found, never as forbidden', async () => {
    const engine = await boot({ sharingModel: 'private', beforeHook: true });
    await seed(engine, { id: 'case_theirs', name: 'owned', owner_id: B, queue: null });
    const err = await claim(engine, 'case_theirs', A).then(() => undefined, (e: unknown) => e);
    expect(err).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
    const stored = await engine.findOne(CASE, { where: { id: 'case_theirs' } } as never, SYS);
    expect((stored as any)?.owner_id).toBe(B);
  });
});
