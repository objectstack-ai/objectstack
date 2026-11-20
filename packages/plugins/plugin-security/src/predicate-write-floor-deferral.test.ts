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
//
// Every sharing write verdict the service is asked is recorded
// (`verdictCalls`), so a case can say which rows a predicate write asked
// about, and with which verb, besides which rows it wrote.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { idsOfReadableScope } from './security-plugin-authz-middleware.js';
import { predicateWriteFloorDropIds } from './security-plugin-sharing-verdicts.js';
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
/**
 * A delegator outside the floor: an organization ADMIN (the floor binds the
 * `org_member` position only) holding Modify All through a stored grant, so
 * neither the floor nor the sharing write scope narrows its half of an
 * on-behalf-of write.
 */
const ERIN = 'usr_erin';

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
/** An APP-AUTHORED update widener beside the platform floor: any open deal, whoever created it. */
const WIDENER_SET = PermissionSetSchema.parse({
  name: 'pwf_widener',
  objects: { [DEAL]: CRUD },
  rowLevelSecurity: [{ name: 'pwf_open_deals_widener', object: DEAL, operation: 'update', using: "stage == 'open'" }],
});
/** A CHECK-only update policy: an updated deal must be an EMEA deal. It has no `using`, so it narrows no match. */
const EMEA_CHECK_SET = PermissionSetSchema.parse({
  name: 'pwf_emea_check',
  objects: { [DEAL]: CRUD },
  rowLevelSecurity: [{ name: 'pwf_stays_in_emea', object: DEAL, operation: 'update', check: "region == 'emea'" }],
});
const SETS = [MEMBER_DEFAULT, REP_SET, MANAGER_SET, NARROW_SET, WIDENER_SET, EMEA_CHECK_SET];

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
let sharing: SharingService | undefined;
let seq = 0;

/** Every write verdict the sharing service was asked, in order. */
const verdictCalls: { verb: 'edit' | 'delete'; object: string; recordId: string }[] = [];
/** The `where` each update of a deal reached the driver side of the middleware chain with, while `captureWhere` is on. */
const capturedWheres: unknown[] = [];
let captureWhere = false;

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
          region: { name: 'region', type: 'text' },
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
  await engine.insert('sys_user', [ALICE, BOB, CAROL, MANAGER, DAVE, NARROW, ERIN].map((id) => ({
    id, name: id, email: `${id}@pwf.test`,
  })), SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'PWF', slug: 'pwf' }], SYS);
  // The two delegators of the on-behalf-of cases. A delegator's sets are
  // resolved from the store (its membership and its stored grants), never
  // from the request; the live callers' come from the request alone, so these
  // rows change nothing about CAROL as a caller. CAROL is an ordinary member
  // (the floor binds her) holding Modify All (so her sharing write scope is
  // the organization); ERIN is an admin holding Modify All (no floor).
  await engine.insert('sys_member', [
    { id: 'mem_carol', user_id: CAROL, organization_id: ORG, role: 'member' },
    { id: 'mem_erin', user_id: ERIN, organization_id: ORG, role: 'admin' },
  ], SYS);
  const grants = (engine as any).getDriver('sys_user_permission_set');
  for (const userId of [CAROL, ERIN]) {
    await grants.create('sys_user_permission_set', {
      id: `ups_${userId}`, user_id: userId, permission_set: MANAGER_SET.name, organization_id: ORG,
    });
  }

  let securityService: unknown;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? SETS.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => SETS,
    },
    get sharing() { return sharing; },
    // The isolated posture: Layer 0, the tenant wall, is composed onto every
    // write this file makes (the default `single` posture composes none).
    tenancy: { posture: 'isolated' },
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
  const service = sharing as any;
  const checkEdit = service.checkEdit.bind(service);
  const checkDelete = service.checkDelete.bind(service);
  service.checkEdit = (object: string, recordId: string, context: unknown) => {
    verdictCalls.push({ verb: 'edit', object, recordId });
    return checkEdit(object, recordId, context);
  };
  service.checkDelete = (object: string, recordId: string, context: unknown) => {
    verdictCalls.push({ verb: 'delete', object, recordId });
    return checkDelete(object, recordId, context);
  };
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  // Registered last, so it runs after this plugin's and the sharing
  // middleware's composition: what it records is the predicate the write runs.
  engine.registerMiddleware((async (opCtx: any, next: () => Promise<unknown>) => {
    if (captureWhere && opCtx.object === DEAL && opCtx.operation === 'update' && opCtx.ast) {
      capturedWheres.push(JSON.parse(JSON.stringify(opCtx.ast.where ?? null)));
    }
    return next();
  }) as never, { object: '*' });
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

type Ids = Record<Role, string>;

type Overrides = Partial<Record<Role, Record<string, unknown>>>;

/** A fresh copy of the matrix under one `batch`, with DAVE's shares on it. */
async function seedDeals(overrides: Overrides = {}): Promise<{ batch: string; ids: Ids }> {
  const batch = `batch_${++seq}`;
  const ids = Object.fromEntries(ROLES.map((role) => [role, `${batch}_${role}`])) as Ids;
  await engine.insert(DEAL, ROLES.map((role) => ({
    id: ids[role], name: 'as seeded', batch, stage: 'open', region: 'emea', organization_id: ORG, ...MATRIX[role],
    ...overrides[role],
  })), SYS);
  for (const role of SHARED_WITH_DAVE) {
    await engine.insert('sys_record_share', {
      object_name: DEAL, record_id: ids[role], recipient_type: 'user', recipient_id: DAVE,
      access_level: 'edit', source: 'manual', organization_id: ORG,
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

/** The verdicts asked since `from` about the rows of one copy of the matrix, as `verb:role`, in matrix order. */
function verdictsAsked(from: number, ids: Ids): string[] {
  const roleOf = new Map(ROLES.map((role) => [ids[role], role] as const));
  return verdictCalls
    .slice(from)
    .filter((c) => c.object === DEAL && roleOf.has(c.recordId))
    .map((c) => `${c.verb}:${roleOf.get(c.recordId)}`)
    .sort();
}

/**
 * Predicate write on one copy, by-id writes on another; both must name
 * `expected`. Answers the verdicts the PREDICATE write asked, as `verb:role`.
 */
async function expectPredicateMatchesById(
  verb: 'update' | 'delete',
  caller: object,
  expected: readonly Role[],
  overrides: Overrides = {},
): Promise<string[]> {
  const predicateCopy = await seedDeals(overrides);
  const from = verdictCalls.length;
  await predicateWrite(DEAL, verb, predicateCopy.batch, caller);
  const asked = verdictsAsked(from, predicateCopy.ids);
  const byPredicate = await changedRows(DEAL, predicateCopy.ids, verb);

  const byIdCopy = await seedDeals(overrides);
  const byId = await byIdAdmits(DEAL, verb, byIdCopy.ids, caller);

  expect(byPredicate, 'the predicate write changes exactly the rows the by-id path admits').toEqual(byId);
  expect(byId, 'the by-id oracle answers the set this case expects').toEqual([...expected]);
  return asked;
}

/** A caller acting on behalf of `delegator` (ADR-0090 D10). */
const onBehalfOf = (caller: object, delegator: string) => ({ ...caller, onBehalfOf: { userId: delegator } });

describe('[#35802] a predicate write composes the platform ownership floor per row, as the by-id write does', () => {
  describe('(a) the owner who created some of what they own — ALICE', () => {
    it('predicate update: the rows she owns, created by her or not (r1, r2)', async () => {
      const asked = await expectPredicateMatchesById('update', memberOf(ALICE, REP_SET.name), ['r1', 'r2']);
      // The rows the floor already admits (r1 and r3, which she created) are
      // set aside: a verdict is asked only about the two it refuses.
      expect(asked).toEqual(['edit:r2', 'edit:r4']);
    });
    it('predicate delete: the rows she owns (r1, r2); r3, which she created and does not own, stays', async () => {
      const asked = await expectPredicateMatchesById('delete', memberOf(ALICE, REP_SET.name), ['r1', 'r2']);
      expect(asked).toEqual(['delete:r2', 'delete:r4']);
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
      const asked = await expectPredicateMatchesById('update', memberOf(NARROW, NARROW_SET.name), ['r2', 'r3'], {
        r1: { stage: 'closed' },
        r4: { stage: 'closed' },
      });
      // Where an authored write-class policy remains once the floor is
      // replaced, replacing it admits no row the floor refused (policies
      // compose by OR, so such a row fails the authored policy too), and no
      // verdict is asked: before, r1 and r4 were each asked one for nothing.
      expect(asked).toEqual([]);
    });
  });

  describe('the edit-share target — DAVE, shares on r2 and r3', () => {
    it('predicate update: the shared rows (r2, r3)', async () => {
      const asked = await expectPredicateMatchesById('update', memberOf(DAVE, REP_SET.name), ['r2', 'r3']);
      expect(asked).toEqual(['edit:r1', 'edit:r2', 'edit:r3', 'edit:r4']);
    });
    it('predicate delete: nothing — an edit share widens update, never delete (ADR-0111 D3)', async () => {
      const asked = await expectPredicateMatchesById('delete', memberOf(DAVE, REP_SET.name), []);
      // The verb reaches the verdict: a delete asks `checkDelete`, which no
      // share answers `allow`, and never `checkEdit`. (The rows alone cannot
      // show it: the sharing middleware's bulk delete scope is the owner set,
      // so r2 and r3 would stay even if the edit verdict were asked.)
      expect(asked).toEqual(['delete:r1', 'delete:r2', 'delete:r3', 'delete:r4']);
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

  describe("a write on another user's behalf keeps both principals' floors, as its by-id write does (ADR-0090 D10)", () => {
    // CAROL, the delegator, is an ordinary member (the floor binds her) with
    // Modify All (her sharing write scope is the organization); ERIN is an
    // admin with Modify All, whom no floor binds. Not one verdict is asked
    // for a delegated predicate write: its by-id write keeps both floors too.
    for (const verb of ['update', 'delete'] as const) {
      it(`BOB on behalf of CAROL, ${verb}: nothing — r4 (his, created by her) is refused by his own floor alone`, async () => {
        const asked = await expectPredicateMatchesById(verb, onBehalfOf(memberOf(BOB, REP_SET.name), CAROL), []);
        expect(asked).toEqual([]);
      });
    }
    it("ALICE on behalf of CAROL, update: nothing — r1 is refused by CAROL's floor alone, r2 by ALICE's alone", async () => {
      const asked = await expectPredicateMatchesById('update', onBehalfOf(memberOf(ALICE, REP_SET.name), CAROL), []);
      expect(asked).toEqual([]);
    });
    // The positive case. ERIN's Modify All is the depth her agent leg acts
    // at (ADR-0090 D10, ruled 2026-09-08: a ceiling that declares no depth
    // leaves the delegator's standing), so the sharing scope reaches every
    // row; ALICE's own floor is what holds back r2 and r4, which she did not
    // create. Acting for herself she writes r2 (she owns it).
    for (const verb of ['update', 'delete'] as const) {
      it(`ALICE on behalf of ERIN, ${verb}: r1 and r3, the rows she created — her own floor still holds back r2 and r4`, async () => {
        const asked = await expectPredicateMatchesById(verb, onBehalfOf(memberOf(ALICE, REP_SET.name), ERIN), ['r1', 'r3']);
        expect(asked).toEqual([]);
      });
    }
  });

  describe('the relief only ever adds rows', () => {
    it('an owner-creator under an authored widener still writes the closed row she created and owns, and no verdict is asked', async () => {
      // The by-id write of r1 is refused: replacing the floor in `floor OR
      // widener` leaves the widener alone, and r1 is closed. That narrowing is
      // the by-id composition's, reported out of scope; the predicate path
      // keeps writing r1, as it did before this change. (By id, the open r3
      // and r4 are written too: an authored row-write policy that admits a
      // row answers the sharing gate there, while the predicate path's bulk
      // sharing scope stays the owner set. Also not this change's.)
      const caller = memberOf(ALICE, WIDENER_SET.name);
      const overrides: Overrides = { r1: { stage: 'closed' } };
      const copy = await seedDeals(overrides);
      const from = verdictCalls.length;
      await predicateWrite(DEAL, 'update', copy.batch, caller);
      expect(verdictsAsked(from, copy.ids)).toEqual([]);
      expect(await changedRows(DEAL, copy.ids, 'update')).toEqual(['r1', 'r2']);

      const byIdCopy = await seedDeals(overrides);
      expect(await byIdAdmits(DEAL, 'update', byIdCopy.ids, caller), 'the by-id corner, reported out of scope').not.toContain('r1');
    });
  });

  describe('S1, the declared narrowing: a newly matched row that fails a check-only policy refuses the whole update', () => {
    it('ALICE under a check-only EMEA policy, r2 in APAC: by id r1 is written and r2 refused; by predicate the write is refused whole', async () => {
      // Before this change the predicate write matched r1 alone (the floor)
      // and answered success with r1 written. r2 is now matched, because its
      // by-id write would replace the floor, and its new image fails the
      // check that by-id write is held to; a predicate update is refused whole
      // by the first image that fails.
      const caller = memberOf(ALICE, EMEA_CHECK_SET.name);
      const overrides: Overrides = { r2: { region: 'apac' } };
      const copy = await seedDeals(overrides);
      const refusal = (await predicateWrite(DEAL, 'update', copy.batch, caller).then(
        () => null,
        (e: unknown) => e,
      )) as { code?: unknown; statusCode?: unknown; status?: unknown } | null;
      expect(refusal, 'the predicate update is refused').not.toBeNull();
      expect(refusal?.code).toBe('PERMISSION_DENIED');
      expect(refusal?.statusCode ?? refusal?.status).toBe(403);
      expect(await changedRows(DEAL, copy.ids, 'update')).toEqual([]);

      const byIdCopy = await seedDeals(overrides);
      expect(await byIdAdmits(DEAL, 'update', byIdCopy.ids, caller)).toEqual(['r1']);
    });
  });

  it('a predicate write over more candidates than one verdict batch (25) asks about each row once and writes every one', async () => {
    const batch = `bulk_${++seq}`;
    const ids = Array.from({ length: 60 }, (_, i) => `${batch}_${String(i).padStart(2, '0')}`);
    await engine.insert(DEAL, ids.map((id) => ({
      id, name: 'as seeded', batch, stage: 'open', region: 'emea', organization_id: ORG, owner_id: BOB, created_by: CAROL,
    })), SYS);
    const from = verdictCalls.length;
    await predicateWrite(DEAL, 'update', batch, memberOf(BOB, REP_SET.name));
    const asked = verdictCalls.slice(from).filter((c) => c.object === DEAL && ids.includes(c.recordId));
    expect(asked.map((c) => `${c.verb}:${c.recordId}`).sort()).toEqual(ids.map((id) => `edit:${id}`));
    const rows = (await engine.find(DEAL, { where: { batch }, fields: ['id', 'name'], context: { isSystem: true } } as never)) as
      Array<{ id: string; name: string }>;
    expect(rows.filter((r) => r.name === 'written').map((r) => r.id).sort()).toEqual(ids);
  });

  it('the tenant wall (Layer 0) is composed back around the relieved Layer 1', async () => {
    const { batch, ids } = await seedDeals();
    capturedWheres.length = 0;
    captureWhere = true;
    try {
      await predicateWrite(DEAL, 'update', batch, memberOf(BOB, REP_SET.name));
    } finally {
      captureWhere = false;
    }
    // The relief ran (BOB created neither row he owns) ...
    expect(await changedRows(DEAL, ids, 'update')).toEqual(['r3', 'r4']);
    // ... and the predicate the write ran with still names the organization.
    expect(capturedWheres).toHaveLength(1);
    expect(JSON.stringify(capturedWheres[0])).toContain(JSON.stringify(ORG));
  });

  it('idsOfReadableScope keeps every scalar row-address kind, bigint included, and nothing else', () => {
    expect(idsOfReadableScope({ id: { $in: ['a', 2, 3n, null, undefined, true, { $eq: 'x' }] } })).toEqual(['a', 2, 3n]);
    expect(idsOfReadableScope({ id: 'a' })).toEqual([]);
    expect(idsOfReadableScope({})).toEqual([]);
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

describe('[#35802] predicateWriteFloorDropIds: the by-id floor decision, asked per row', () => {
  // A double of the by-id decision that answers like a write authority with an
  // `edit` share on every row: the floor is replaced for an update, never for
  // a delete. It records what it was asked, as `verb:id:delegated`.
  const shareHolder = (log: string[]) => ({
    resolvePreImageFloorDrop: async (op: string, _object: string, id: string, _ctx: unknown, _sets: unknown, delegated: boolean) => {
      log.push(`${op}:${id}:${delegated}`);
      return op === 'update';
    },
  });

  it('asks the verb it is handed, about each row, and answers the rows whose floor that verb replaces', async () => {
    const log: string[] = [];
    expect(await predicateWriteFloorDropIds.call(shareHolder(log) as never, 'update', DEAL, ['a', 'b'], {}, [], false)).toEqual(['a', 'b']);
    expect(await predicateWriteFloorDropIds.call(shareHolder(log) as never, 'delete', DEAL, ['a', 'b'], {}, [], false)).toEqual([]);
    expect(log).toEqual(['update:a:false', 'update:b:false', 'delete:a:false', 'delete:b:false']);
  });

  it('asks nothing for a delegated write', async () => {
    const log: string[] = [];
    expect(await predicateWriteFloorDropIds.call(shareHolder(log) as never, 'update', DEAL, ['a', 'b'], {}, [], true)).toEqual([]);
    expect(log).toEqual([]);
  });

  it('asks about every candidate exactly once, at most 25 at a time, and keeps each id as it came', async () => {
    let inFlight = 0;
    let peak = 0;
    const asked: string[] = [];
    const host = {
      resolvePreImageFloorDrop: async (_op: string, _object: string, id: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        asked.push(id);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return Number(id) % 2 === 0;
      },
    };
    const ids = Array.from({ length: 60 }, (_, i) => i);
    const dropped = await predicateWriteFloorDropIds.call(host as never, 'update', DEAL, ids, {}, [], false);
    expect(asked).toEqual(ids.map(String));
    expect(dropped).toEqual(ids.filter((i) => i % 2 === 0));
    expect(peak).toBe(25);
  });
});
