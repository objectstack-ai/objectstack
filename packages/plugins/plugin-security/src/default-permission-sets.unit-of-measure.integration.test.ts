// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U3; Open items 2 and 11] Who reads and writes an organization's
 * units of measure, and what a write may do to one, on a real stack:
 *
 *  - the REAL `SecurityPlugin` with the shipped permission sets, so a member's
 *    read comes from `member_default`'s `sys_unit` line and an administrator's
 *    writes from `organization_admin`'s wildcard;
 *  - the REAL `sys_unit` object (`@objectstack/platform-objects`), so the
 *    organization-scoped unique key and the object's `validations` are what
 *    the engine enforces;
 *  - the REAL caller resolution (`resolveAuthzContext`, then
 *    `assembleExecutionContext`) over the identity rows seeded below.
 *
 * What it holds: every member reads the units and writes none (the seat's U3
 * note; Open item 2); an organization administrator or owner creates, relabels
 * and edits a ratio (L1); the organization code namespace (U3), the immutable
 * code and dimension (L1) and the one-way retirement are refused through the
 * engine's rule validator; and a retired code can never be created again,
 * because the retired row keeps holding its organization-scoped unique key
 * (Open item 11).
 *
 * Refusals assert the wire `code` AND `status` the data door maps the engine's
 * error to (ADR-0112), and that nothing was stored.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ObjectKernel,
  resolveAuthzContext,
  assembleExecutionContext,
  markFlowWriteReferenceCheck,
  type Plugin,
  type PluginContext,
} from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SysUnit } from '@objectstack/platform-objects/system';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = 'sys_unit';
const ORG = 'org_units';
const ALICE = 'usr_units_alice';
const CAROL = 'usr_units_carol';
const OWEN = 'usr_units_owen';

const SYS = { isSystem: true, tenantId: ORG } as const;
/**
 * A `runAs: 'system'` automation run with no triggering user, built by the
 * constructor the automation runtime builds it with
 * (`resolveRunDataContext`, `@objectstack/service-automation`): elevated,
 * acting as `svc:flow:<name>`, in the trigger's organization.
 */
const AUTOMATION = markFlowWriteReferenceCheck({
  isSystem: true,
  actor: 'svc:flow:units_cleanup',
  tenantId: ORG,
  positions: [],
  permissions: [],
});
/** An application object whose quantities declare their unit (ADR-0158 U4, U5). */
const MATERIAL = 'units_material';

type Row = Record<string, any>;
type Ctx = Record<string, unknown>;

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

function objectsPlugin(): Plugin {
  return {
    name: 'test.objects',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.unit-of-measure-grants',
        namespace: 'units',
        version: '1.0.0',
        type: 'plugin',
        name: 'Unit of measure grants fixture',
        objects: [
          SysUser,
          SysMember,
          SysOrganization,
          SysUnit,
          {
            name: MATERIAL,
            label: 'Material',
            fields: {
              title: { type: 'text', label: 'Title' },
              uom: { type: 'text', label: 'Unit' },
              weight: { type: 'number', label: 'Weight', unitConfig: { unitMode: 'record', unitField: 'uom', unitDimension: 'mass' } },
              base_uom: { type: 'text', label: 'Base unit', unitConfig: { unitMode: 'code' } },
            },
          },
        ],
      });
    },
  };
}

/** The wire answer a refused engine call maps to, as the data door sends it. */
async function refusal(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  let thrown: unknown;
  try {
    await run();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `the ${OBJ} call was refused`).toBeDefined();
  const wire = mapDataError(thrown, OBJ);
  return { status: wire.status, code: String(wire.body.code) };
}

/** A validation refusal: the wire envelope, and which field failed which constraint (the rule that fired). */
async function invalid(run: () => Promise<unknown>): Promise<{ status: number; code: string; fields: string[] }> {
  let thrown: unknown;
  try {
    await run();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `the ${OBJ} write was refused`).toBeDefined();
  const wire = mapDataError(thrown, OBJ);
  const fields = ((wire.body as { fields?: Array<{ field: string; code: string }> }).fields ?? []).map((f) => `${f.field}:${f.code}`);
  return { status: wire.status, code: String(wire.body.code), fields };
}

const FAILED = (...fields: string[]) => ({ status: 400, code: 'VALIDATION_FAILED', fields });

describe('sys_unit on a real stack: member read, administrator write, and the rules a write meets', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  const as: Record<string, Ctx> = {};
  let seeded = '';

  const contextOf = async (userId: string): Promise<Ctx> => {
    const authz = await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `ses_${userId}`, userId, activeOrganizationId: ORG },
      }),
    } as never);
    return assembleExecutionContext({
      authz,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as never) as unknown as Ctx;
  };

  const insert = (ctx: Ctx, data: Row) => ql.insert(OBJ, data, { context: ctx } as never) as Promise<Row>;
  const update = (ctx: Ctx, id: string, data: Row) => ql.update(OBJ, data, { where: { id }, context: ctx } as never);
  const list = async (ctx: Ctx) => (await ql.find(OBJ, { context: ctx } as never)) as Row[];
  const stored = async (where: Row) => (await ql.find(OBJ, { where, context: SYS } as never)) as Row[];
  const storedById = async (id: string) => (await stored({ id }))[0];

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new SecurityPlugin({ defaultPermissionSets }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    await ql.insert('sys_organization', { id: ORG, name: 'Units Co', slug: 'units-co' }, { context: SYS } as never);
    const role: Record<string, string> = { [ALICE]: 'member', [CAROL]: 'admin', [OWEN]: 'owner' };
    for (const userId of Object.keys(role)) {
      await ql.insert(
        'sys_user',
        { id: userId, name: userId, email: `${userId}@units-co.test`, email_verified: true },
        { context: SYS } as never,
      );
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: role[userId] }, { context: SYS } as never);
    }
    for (const [key, userId] of [['alice', ALICE], ['carol', CAROL], ['owen', OWEN]] as const) as[key] = await contextOf(userId);
    seeded = String(
      (await insert(as.carol, { code: 'JIN1', label: 'Jin', dimension: 'mass', ratio: 0.5 })).id,
    );
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the fixture is armed: each persona holds the position this suite is about', () => {
    expect(as.alice.positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
    expect(as.carol.positions).toEqual(expect.arrayContaining(['org_admin', 'everyone']));
    expect(as.owen.positions).toEqual(expect.arrayContaining(['org_owner', 'everyone']));
    expect(as.carol.positions).not.toContain('org_member');
  });

  describe('a member', () => {
    it("reads the organization's units, so a quantity's unit label displays to them", async () => {
      const rows = await list(as.alice);
      expect(rows.map((r) => r.code)).toContain('JIN1');
    });

    it('creates none: 403 PERMISSION_DENIED, nothing stored', async () => {
      expect(await refusal(() => insert(as.alice, { code: 'MEMBER_UNIT', label: 'Mine', dimension: 'count', ratio: 1 }))).toEqual({
        status: 403,
        code: 'PERMISSION_DENIED',
      });
      expect(await stored({ code: 'MEMBER_UNIT' })).toEqual([]);
    });

    it('edits none, the ratio included: 403 PERMISSION_DENIED, the row unchanged', async () => {
      expect(await refusal(() => update(as.alice, seeded, { ratio: 2 }))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect(await refusal(() => update(as.alice, seeded, { label: 'Renamed' }))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect(await storedById(seeded)).toMatchObject({ label: 'Jin', ratio: 0.5 });
    });
  });

  for (const key of ['carol', 'owen'] as const) {
    describe(`an organization ${key === 'carol' ? 'administrator' : 'owner'}`, () => {
      it('creates a unit, relabels it and edits its ratio', async () => {
        const code = `BOX_${key.toUpperCase()}`;
        const id = String((await insert(as[key], { code, label: 'Box', dimension: 'count', ratio: 12 })).id);
        await update(as[key], id, { label: 'Box of 12' });
        await update(as[key], id, { ratio: 10 });
        // Stamped with the writer's organization: the row is the organization's (U3).
        expect(await storedById(id)).toMatchObject({ code, label: 'Box of 12', dimension: 'count', ratio: 10, retired: false, organization_id: ORG });
      });
    });
  }

  describe('the rules a write meets', () => {
    for (const code of ['KGM', 'H87', 'C62', 'EA', 'box_12']) {
      it(`refuses the code ${code} outside the organization namespace: 400 VALIDATION_FAILED on code, nothing stored`, async () => {
        expect(await invalid(() => insert(as.carol, { code, label: 'Taken', dimension: 'count', ratio: 1 }))).toEqual(
          FAILED('code:invalid_format'),
        );
        expect(await stored({ code })).toEqual([]);
      });
    }

    it('refuses changing a code or a dimension: 400 VALIDATION_FAILED on that field, the row unchanged', async () => {
      expect(await invalid(() => update(as.carol, seeded, { code: 'JIN2' }))).toEqual(FAILED('code:rule_violation'));
      expect(await invalid(() => update(as.carol, seeded, { dimension: 'volume' }))).toEqual(FAILED('dimension:rule_violation'));
      expect(await storedById(seeded)).toMatchObject({ code: 'JIN1', dimension: 'mass' });
    });

    it('refuses a ratio dimension with no ratio and a package unit with one: 400 VALIDATION_FAILED on ratio', async () => {
      expect(await invalid(() => insert(as.carol, { code: 'NO_RATIO', label: 'x', dimension: 'length' }))).toEqual(
        FAILED('ratio:rule_violation'),
      );
      expect(await invalid(() => insert(as.carol, { code: 'CRATE_X', label: 'x', dimension: 'package', ratio: 4 }))).toEqual(
        FAILED('ratio:rule_violation'),
      );
      expect(await stored({ code: 'NO_RATIO' })).toEqual([]);
      expect(await stored({ code: 'CRATE_X' })).toEqual([]);
      const pallet = String((await insert(as.carol, { code: 'PALLET_EU', label: 'Euro pallet', dimension: 'package' })).id);
      expect(await storedById(pallet)).toMatchObject({ dimension: 'package', ratio: null });
    });
  });

  describe('a retired code stays retired (Open item 11)', () => {
    it('retires a unit, refuses bringing it back, and refuses creating its code again', async () => {
      const id = String((await insert(as.carol, { code: 'SACK_50', label: 'Sack', dimension: 'mass', ratio: 50 })).id);
      await update(as.carol, id, { retired: true });
      expect((await storedById(id))?.retired).toBe(true);

      expect(await invalid(() => update(as.carol, id, { retired: false }))).toEqual(FAILED('retired:rule_violation'));
      expect((await storedById(id))?.retired).toBe(true);

      // The same code with another dimension, ratio and label: the hazard
      // ADR-0158 Open item 11 names. The retired row holds the key.
      const again = await refusal(() => insert(as.carol, { code: 'SACK_50', label: 'Sack (new)', dimension: 'volume', ratio: 0.05 }));
      expect(again).toEqual({ status: 409, code: 'UNIQUE_VIOLATION' });
      expect(await stored({ code: 'SACK_50' })).toHaveLength(1);
      expect((await storedById(id))).toMatchObject({ label: 'Sack', dimension: 'mass', ratio: 50, retired: true });
    });
  });

  describe('an administrator edits every unit of the organization, not only their own', () => {
    it("the owner relabels the administrator's unit: the explicit `sys_unit` line keeps the edit the wildcard gave", async () => {
      await update(as.owen, seeded, { label: 'Jin (500 g)' });
      expect(await storedById(seeded)).toMatchObject({ code: 'JIN1', label: 'Jin (500 g)' });
      await update(as.carol, seeded, { label: 'Jin' });
    });
  });

  // [Requirement 1 on #35489 (7030061316), carried from #35581's review
  // (7016814814)] Retiring is the delete: the engine refuses a delete of a
  // unit for every caller it serves, before any middleware or hook, by id and
  // batched, and nothing is removed.
  describe('the engine refuses to delete a unit in every context: user, system and automation', () => {
    const callers: Array<[string, () => Ctx]> = [
      ['an organization administrator', () => as.carol],
      ['an organization owner', () => as.owen],
      ['a member', () => as.alice],
      ['a system writer ({ isSystem: true })', () => SYS],
      ['a system automation run (svc:flow, runAs system)', () => AUTOMATION],
    ];
    for (const [who, ctx] of callers) {
      it(`${who}: refused by id and batched, 405 ERR_UNIT_DELETE_REFUSED, every unit still stored`, async () => {
        const before = (await stored({})).length;
        expect(before).toBeGreaterThan(0);
        expect(await refusal(() => ql.delete(OBJ, { where: { id: seeded }, context: ctx() } as never))).toEqual({
          status: 405,
          code: 'ERR_UNIT_DELETE_REFUSED',
        });
        expect(await refusal(() => ql.delete(OBJ, { where: { dimension: 'mass' }, multi: true, context: ctx() } as never))).toEqual({
          status: 405,
          code: 'ERR_UNIT_DELETE_REFUSED',
        });
        expect((await stored({})).length).toBe(before);
        expect(await storedById(seeded)).toMatchObject({ code: 'JIN1', retired: false });
      });
    }

    it("the administrator's effective permissions offer no delete on units, and keep create and edit", async () => {
      const security = kernel.getService<{
        getEffectiveObjectPermissions(ctx: Ctx): Promise<Record<string, Record<string, unknown>>>;
      }>('security');
      for (const key of ['carol', 'owen'] as const) {
        const map = await security.getEffectiveObjectPermissions(as[key]);
        expect(map[OBJ], key).toMatchObject({ allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false });
        // `modifyAllRecords` would grant the delete on its own.
        expect(map[OBJ]?.modifyAllRecords, key).not.toBe(true);
      }
    });
  });

  // [ADR-0158 U5; Open item 9] The write check on a real stack: the
  // organization's own `sys_unit` rows, read elevated in the row's
  // organization, are members; a retired one is not.
  describe('a quantity names a member unit, or the write is refused', () => {
    const write = (ctx: Ctx, data: Row) => ql.insert(MATERIAL, data, { context: ctx } as never) as Promise<Row>;
    const materials = async (where: Row) => (await ql.find(MATERIAL, { where, context: SYS } as never)) as Row[];

    it('stores a standard code and an organization unit, written by an administrator and by a system writer', async () => {
      await write(as.carol, { title: 'std', uom: 'KGM', weight: 2, base_uom: 'H87' });
      await write(SYS, { title: 'org', uom: 'JIN1', weight: 3, base_uom: 'JIN1' });
      expect((await materials({ title: { $in: ['std', 'org'] } })).map((r) => r.uom).sort()).toEqual(['JIN1', 'KGM']);
    });

    it('refuses a retired unit (Requirement 2), a mis-cased code, a code of another dimension and a quantity with no code: 400, nothing stored', async () => {
      const crate = String((await insert(as.carol, { code: 'CRATE_9', label: 'Crate', dimension: 'mass', ratio: 9 })).id);
      await write(as.carol, { title: 'before-retire', uom: 'CRATE_9', weight: 1 });
      await update(as.carol, crate, { retired: true });
      for (const [title, row, code] of [
        ['retired', { uom: 'CRATE_9', weight: 1 }, 'ERR_UNIT_CODE_RETIRED'],
        ['lower', { uom: 'kgm', weight: 1 }, 'ERR_UNIT_CODE_UNKNOWN'],
        ['length', { uom: 'MTR', weight: 1 }, 'ERR_UNIT_DIMENSION_MISMATCH'],
        ['blank', { weight: 1 }, 'ERR_UNIT_CODE_REQUIRED'],
        ['piece', { base_uom: 'EA' }, 'ERR_UNIT_CODE_UNKNOWN'],
      ] as const) {
        expect(await refusal(() => write(as.carol, { title, ...row })), title).toEqual({ status: 400, code });
        expect(await materials({ title }), title).toEqual([]);
      }
      // Open item 9 case 2: the row resting on the retired unit refuses a quantity edit, and takes one once moved.
      const [resting] = await materials({ title: 'before-retire' });
      expect(await refusal(() => ql.update(MATERIAL, { weight: 2 }, { where: { id: resting!.id }, context: as.carol } as never))).toEqual({
        status: 400,
        code: 'ERR_UNIT_CODE_RETIRED',
      });
      await ql.update(MATERIAL, { title: 'renamed-resting' }, { where: { id: resting!.id }, context: as.carol } as never);
      await ql.update(MATERIAL, { uom: 'JIN1', weight: 2 }, { where: { id: resting!.id }, context: as.carol } as never);
      expect((await materials({ id: resting!.id }))[0]).toMatchObject({ title: 'renamed-resting', uom: 'JIN1', weight: 2 });
    });
  });
});
