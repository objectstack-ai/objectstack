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
import { ObjectKernel, resolveAuthzContext, assembleExecutionContext, type Plugin, type PluginContext } from '@objectstack/core';
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
        objects: [SysUser, SysMember, SysOrganization, SysUnit],
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
        expect(await storedById(id)).toMatchObject({ code, label: 'Box of 12', dimension: 'count', ratio: 10, retired: false });
      });
    });
  }

  describe('the rules a write meets', () => {
    for (const code of ['KGM', 'H87', 'C62', 'EA', 'box_12']) {
      it(`refuses the code ${code} outside the organization namespace: 400 VALIDATION_ERROR, nothing stored`, async () => {
        expect(await refusal(() => insert(as.carol, { code, label: 'Taken', dimension: 'count', ratio: 1 }))).toEqual({
          status: 400,
          code: 'VALIDATION_ERROR',
        });
        expect(await stored({ code })).toEqual([]);
      });
    }

    it('refuses changing a code or a dimension: 400 VALIDATION_ERROR, the row unchanged', async () => {
      expect(await refusal(() => update(as.carol, seeded, { code: 'JIN2' }))).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(await refusal(() => update(as.carol, seeded, { dimension: 'volume' }))).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(await storedById(seeded)).toMatchObject({ code: 'JIN1', dimension: 'mass' });
    });

    it('refuses a ratio dimension with no ratio and a package unit with one: 400 VALIDATION_ERROR', async () => {
      expect(await refusal(() => insert(as.carol, { code: 'NO_RATIO', label: 'x', dimension: 'length' }))).toEqual({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(await refusal(() => insert(as.carol, { code: 'CRATE_X', label: 'x', dimension: 'package', ratio: 4 }))).toEqual({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
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

      expect(await refusal(() => update(as.carol, id, { retired: false }))).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect((await storedById(id))?.retired).toBe(true);

      // The same code with another dimension, ratio and label: the hazard
      // ADR-0158 Open item 11 names. The retired row holds the key.
      const again = await refusal(() => insert(as.carol, { code: 'SACK_50', label: 'Sack (new)', dimension: 'volume', ratio: 0.05 }));
      expect(again.status).toBe(409);
      expect(await stored({ code: 'SACK_50' })).toHaveLength(1);
      expect((await storedById(id))).toMatchObject({ label: 'Sack', dimension: 'mass', ratio: 50, retired: true });
    });
  });
});
