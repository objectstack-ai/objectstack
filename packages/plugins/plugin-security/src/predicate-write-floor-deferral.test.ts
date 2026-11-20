// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#35802] The #5492 floor composition on the PREDICATE write path.
//
// The by-id write pre-image gate (step 2.7) lets `ISharingService`'s tri-state
// write verdict replace the platform's own ownership floor (`owner_only_writes`
// / `owner_only_deletes`, `created_by == current_user.id`) for the one row it
// names: `allow` replaces it, `abstain` and `deny` keep it. A predicate write
// (`multi: true` update, delete by `where`) names no row, so that deferral was
// never reached and the floor stayed an unconditional AND on its Layer 1: a
// Modify All holder, a non-creator owner and an `edit`-share target matched
// only the rows they had created, and the write answered a smaller success.
//
// The fix gives each matched row the floor would refuse the by-id decision for
// that row. So the pin is a comparison, row for row, against the by-id path as
// it stands: for every caller and both verbs, the rows a predicate write over
// the 4-row owner x creator matrix changes are exactly the rows a by-id write
// of each id admits, measured on a second copy of the matrix. Each case also
// names the set it expects, so the comparison cannot pass by both paths
// drifting together.
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory), the real `SharingService` as the kernel's
// `sharing` service with its middleware on the engine after this plugin's,
// and the platform's own `member_default` set carrying the ownership floor —
// the rig `controlled-by-parent-owner-may-edit.test.ts` boots. The #5492 file
// (`row-write-widener-composition.test.ts`) drives the same composition over
// an engine double, which cannot run a predicate write's composed AST, its
// nested read questions or the sharing middleware's bulk scope; every one of
// them decides a row here.
//
//   pwf_deal   owner_id + created_by, `public_read` OWD: every member reads
//              every row, and record sharing enforces on writes.
//   pwf_memo   `ownership: 'none'` (no owner_id): record sharing abstains, so
//              the platform floor is the only row-level write gate (the #5492
//              E2 control).
//
// Both are ORDINARY tenant business objects — tenancy left on, no
// `access.default: 'private'` — because that posture is what withholds the
// Layer 1 superuser short-circuit (ADR-0066 ①): on a tenancy-disabled object
// a Modify All holder skips business row-level security altogether, and the
// floor this file is about would never be composed for them.
//
// The matrix, one fresh copy per write (`batch` is the predicate):
//
//   r1  owner ALICE  created by ALICE
//   r2  owner ALICE  created by CAROL
//   r3  owner BOB    created by ALICE
//   r4  owner BOB    created by CAROL
//
// DAVE holds an `edit`-level share on r2 and r3.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
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

const DEAL = 'pwf_deal';
const MEMO = 'pwf_memo';
const ORG = 'org_pwf';

/** Owns r1 and r2, created r1 and r3: the owner who created some of what they own. */
const ALICE = 'usr_alice';
/** Owns r3 and r4, created none of them: the non-creator owner. */
const BOB = 'usr_bob';
/** Created r2 and r4, owns none of them: the creator who is not the owner. */
const CAROL = 'usr_carol';
/** Holds View and Modify All on both objects; owns and created nothing. */
const MANAGER = 'usr_manager';
/** Holds an `edit`-level share on r2 and r3; owns and created nothing. */
const DAVE = 'usr_dave';
/** Holds Modify All under an authored update policy that admits only open deals. */
const NARROW = 'usr_narrow';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const MODIFY_ALL = { ...CRUD, viewAllRecords: true, modifyAllRecords: true };
const REP_SET = PermissionSetSchema.parse({ name: 'pwf_rep', objects: { [DEAL]: CRUD, [MEMO]: CRUD } });
const MANAGER_SET = PermissionSetSchema.parse({ name: 'pwf_manager', objects: { [DEAL]: MODIFY_ALL, [MEMO]: MODIFY_ALL } });
/**
 * Modify All, and an APP-AUTHORED update policy beside it. On an ordinary
 * business object Modify All does not bypass write-side row-level security
 * (ADR-0066 ①), so the policy still binds every row whose floor is replaced.
 */
const NARROW_SET = PermissionSetSchema.parse({
  name: 'pwf_narrow',
  objects: { [DEAL]: MODIFY_ALL },
  rowLevelSecurity: [{ name: 'pwf_open_deals_only', object: DEAL, operation: 'update', using: "stage == 'open'" }],
});
const SETS = [MEMBER_DEFAULT, REP_SET, MANAGER_SET, NARROW_SET];

/** The execution context `resolveAuthzContext` hands the middleware for an organization member holding the sets. */
const memberOf = (userId: string, set: string) => ({
  userId,
  tenantId: ORG,
  positions: ['org_member'],
  permissions: [set, 'member_default'],
  posture: 'MEMBER',
});

type Role = 'r1' | 'r2' | 'r3' | 'r4';
const ROLES: readonly Role[] = ['r1', 'r2', 'r3', 'r4'];
const MATRIX: Record<Role, { owner_id: string; created_by: string }> = {
  r1: { owner_id: ALICE, created_by: ALICE },
  r2: { owner_id: ALICE, created_by: CAROL },
  r3: { owner_id: BOB, created_by: ALICE },
  r4: { owner_id: BOB, created_by: CAROL },
};
/** The rows DAVE's `edit` shares name. */
const SHARED_WITH_DAVE: readonly Role[] = ['r2', 'r3'];

let engine: ObjectQL;
let seq = 0;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.predicate-write-floor-deferral',
    name: 'The platform ownership floor on a predicate write',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysRecordShare,
      SysUser,
      SysOrganization,
      SysMember,
      SysUserPosition,
      SysUserPermissionSet,
      {
        name: DEAL,
        label: 'Deal',
        sharingModel: 'public_read',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          batch: { name: 'batch', type: 'text' },
          stage: { name: 'stage', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
          created_by: { name: 'created_by', type: 'text' },
          organization_id: { name: 'organization_id', type: 'text' },
        },
      },
      {
        name: MEMO,
        label: 'Memo',
        sharingModel: 'public_read',
        ownership: 'none',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          batch: { name: 'batch', type: 'text' },
          created_by: { name: 'created_by', type: 'text' },
          organization_id: { name: 'organization_id', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert('sys_user', [ALICE, BOB, CAROL, MANAGER, DAVE, NARROW].map((id) => ({
    id, name: id, email: `${id}@pwf.test`,
  })), SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'PWF', slug: 'pwf' }], SYS);

  let securityService: unknown;
  let sharing: SharingService | undefined;
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
  sharing = new SharingService({ engine: engine as never, securityService: () => securityService as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

type Ids = Record<Role, string>;

/** A fresh copy of the matrix under one `batch`, with DAVE's shares on it. */
async function seedDeals(stages: Partial<Record<Role, string>> = {}): Promise<{ batch: string; ids: Ids }> {
  const batch = `batch_${++seq}`;
  const ids = Object.fromEntries(ROLES.map((role) => [role, `${batch}_${role}`])) as Ids;
  await engine.insert(DEAL, ROLES.map((role) => ({
    id: ids[role], name: 'as seeded', batch, stage: stages[role] ?? 'open', organization_id: ORG, ...MATRIX[role],
  })), SYS);
  for (const role of SHARED_WITH_DAVE) {
    await engine.insert('sys_record_share', {
      object_name: DEAL, record_id: ids[role], recipient_type: 'user', recipient_id: DAVE,
      access_level: 'edit', source: 'manual',
    }, SYS);
  }
  return { batch, ids };
}

const storedDeal = (id: string) =>
  engine.findOne(DEAL, { where: { id }, context: { isSystem: true } } as never) as Promise<Record<string, unknown> | null>;

/** Which rows of the matrix a write changed: renamed (update) or gone (delete). */
async function changedRows(object: string, ids: Ids, verb: 'update' | 'delete', roles: readonly Role[] = ROLES): Promise<Role[]> {
  const out: Role[] = [];
  for (const role of roles) {
    const row = (await engine.findOne(object, { where: { id: ids[role] }, context: { isSystem: true } } as never)) as
      | Record<string, unknown>
      | null;
    if (verb === 'delete' ? row == null : row?.name === 'written') out.push(role);
  }
  return out;
}

const predicateWrite = (object: string, verb: 'update' | 'delete', batch: string, caller: object): Promise<unknown> =>
  verb === 'update'
    ? engine.update(object, { name: 'written' }, { where: { batch }, multi: true, context: { ...caller } } as never)
    : engine.delete(object, { where: { batch }, multi: true, context: { ...caller } } as never);

/**
 * The ORACLE: a by-id write of each row, one at a time, on its own copy of the
 * matrix. A row is admitted when the write answers and the row changed; a
 * refusal must be the record-level denial or the read door's not-found, never
 * anything else.
 */
async function byIdAdmits(object: string, verb: 'update' | 'delete', ids: Ids, caller: object, roles: readonly Role[] = ROLES): Promise<Role[]> {
  const admitted: Role[] = [];
  for (const role of roles) {
    try {
      if (verb === 'update') {
        await engine.update(object, { name: 'written' }, { where: { id: ids[role] }, context: { ...caller } } as never);
      } else {
        await engine.delete(object, { where: { id: ids[role] }, context: { ...caller } } as never);
      }
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      expect([403, 404], `by-id ${verb} of ${role}: ${String(e?.message)}`).toContain(status);
      continue;
    }
    admitted.push(role);
  }
  // Admitted means the row really changed, not only that no error came back.
  expect(await changedRows(object, ids, verb, roles)).toEqual(admitted);
  return admitted;
}

/** Predicate write on one copy, by-id writes on another; both must name `expected`. */
async function expectPredicateMatchesById(
  verb: 'update' | 'delete',
  caller: object,
  expected: readonly Role[],
  stages: Partial<Record<Role, string>> = {},
): Promise<void> {
  const predicateCopy = await seedDeals(stages);
  await predicateWrite(DEAL, verb, predicateCopy.batch, caller);
  const byPredicate = await changedRows(DEAL, predicateCopy.ids, verb);

  const byIdCopy = await seedDeals(stages);
  const byId = await byIdAdmits(DEAL, verb, byIdCopy.ids, caller);

  expect(byPredicate, 'the predicate write changes exactly the rows the by-id path admits').toEqual(byId);
  expect(byId, 'the by-id oracle answers the set this case expects').toEqual([...expected]);
}

describe('[#35802] a predicate write composes the platform ownership floor per row, as the by-id write does', () => {
  describe('(a) the owner who created some of what they own — ALICE', () => {
    it('predicate update: the rows she owns, created by her or not (r1, r2)', async () => {
      await expectPredicateMatchesById('update', memberOf(ALICE, REP_SET.name), ['r1', 'r2']);
    });
    it('predicate delete: the rows she owns (r1, r2); r3, which she created and does not own, stays', async () => {
      await expectPredicateMatchesById('delete', memberOf(ALICE, REP_SET.name), ['r1', 'r2']);
    });
  });

  describe('(b) the owner who created none of it — BOB', () => {
    it('predicate update: every row he owns (r3, r4)', async () => {
      await expectPredicateMatchesById('update', memberOf(BOB, REP_SET.name), ['r3', 'r4']);
    });
    it('predicate delete: every row he owns (r3, r4)', async () => {
      await expectPredicateMatchesById('delete', memberOf(BOB, REP_SET.name), ['r3', 'r4']);
    });
  });

  describe('(c) the creator who owns none of it — CAROL (no allow verdict on any row)', () => {
    it('predicate update: nothing — creating a row is not owning it', async () => {
      await expectPredicateMatchesById('update', memberOf(CAROL, REP_SET.name), []);
    });
    it('predicate delete: nothing', async () => {
      await expectPredicateMatchesById('delete', memberOf(CAROL, REP_SET.name), []);
    });
  });

  describe('(d) the Modify All manager — owns and created nothing', () => {
    it('predicate update: every row', async () => {
      await expectPredicateMatchesById('update', memberOf(MANAGER, MANAGER_SET.name), ['r1', 'r2', 'r3', 'r4']);
    });
    it('predicate delete: every row', async () => {
      await expectPredicateMatchesById('delete', memberOf(MANAGER, MANAGER_SET.name), ['r1', 'r2', 'r3', 'r4']);
    });
    it('an authored update policy still binds the rows whose floor is replaced (ADR-0066 ①)', async () => {
      // r1 and r4 are closed: the manager's own set admits updates of open
      // deals only, so Modify All replaces the PLATFORM floor and leaves the
      // authored policy standing — by id and by predicate alike.
      await expectPredicateMatchesById('update', memberOf(NARROW, NARROW_SET.name), ['r2', 'r3'], { r1: 'closed', r4: 'closed' });
    });
  });

  describe('the edit-share target — DAVE, shares on r2 and r3', () => {
    it('predicate update: the shared rows (r2, r3)', async () => {
      await expectPredicateMatchesById('update', memberOf(DAVE, REP_SET.name), ['r2', 'r3']);
    });
    it('predicate delete: nothing — an edit share widens update, never delete (ADR-0111 D3)', async () => {
      await expectPredicateMatchesById('delete', memberOf(DAVE, REP_SET.name), []);
    });
  });

  describe('CONTROL: where record sharing abstains, the floor is the only row-level write gate and it stays', () => {
    async function seedMemos(): Promise<{ batch: string; ids: Ids }> {
      const batch = `memo_batch_${++seq}`;
      const ids = Object.fromEntries(ROLES.map((role) => [role, `${batch}_${role}`])) as Ids;
      await engine.insert(MEMO, ROLES.map((role) => ({
        id: ids[role], name: 'as seeded', batch, created_by: MATRIX[role].created_by, organization_id: ORG,
      })), SYS);
      return { batch, ids };
    }

    for (const verb of ['update', 'delete'] as const) {
      it(`predicate ${verb} by ALICE on an owner-less object: only the rows she created (r1, r3)`, async () => {
        const caller = memberOf(ALICE, REP_SET.name);
        const predicateCopy = await seedMemos();
        await predicateWrite(MEMO, verb, predicateCopy.batch, caller);
        const byPredicate = await changedRows(MEMO, predicateCopy.ids, verb);

        const byIdCopy = await seedMemos();
        const byId = await byIdAdmits(MEMO, verb, byIdCopy.ids, caller);

        expect(byPredicate).toEqual(byId);
        expect(byId).toEqual(['r1', 'r3']);
      });
    }
  });

  it('the matched rows are written once each, and a row outside the predicate is never touched', async () => {
    const inside = await seedDeals();
    const outside = await seedDeals();
    await predicateWrite(DEAL, 'update', inside.batch, memberOf(MANAGER, MANAGER_SET.name));
    expect(await changedRows(DEAL, inside.ids, 'update')).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(await changedRows(DEAL, outside.ids, 'update')).toEqual([]);
    expect((await storedDeal(inside.ids.r4))?.owner_id).toBe(BOB);
  });
});
