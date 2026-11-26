// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U6; Open item 10, option A 「组织可改,新开一处设置」] Who sets,
 * reads and clears an organization's display decimal places for a standard
 * unit code, on a real stack:
 *
 *  - the REAL `SecurityPlugin` with the shipped permission sets, so a member's
 *    read comes from `member_default`'s `sys_standard_unit_setting` line and
 *    an administrator's writes from `organization_admin`'s;
 *  - the REAL `sys_standard_unit_setting` object
 *    (`@objectstack/platform-objects`), so its organization-scoped unique key,
 *    its closed code set, its range and its rule are what the engine enforces;
 *  - the REAL `AuditPlugin`, so every set, change and clear lands in
 *    `sys_audit_log`;
 *  - the REAL caller resolution (`resolveAuthzContext`, then
 *    `assembleExecutionContext`) over the identity rows seeded below;
 *  - the `isolated` tenancy posture, so the tenant wall stands.
 *
 * What it holds: an organization administrator or owner sets, changes and
 * clears (deletes) a setting, each act audited; a member reads the settings
 * and writes none; another organization's setting is never read, changed or
 * cleared; and an organization holding a setting refuses its own delete until
 * the setting is cleared, as it does for an exchange rate.
 *
 * Refusals assert the wire `code` AND `status` the data door maps the engine's
 * error to (ADR-0112), and that nothing was stored or changed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel, resolveAuthzContext, assembleExecutionContext, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SysStandardUnitSetting } from '@objectstack/platform-objects/system';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = 'sys_standard_unit_setting';
const ORG = 'org_unit_settings';
const OTHER = 'org_unit_settings_other';
const ALICE = 'usr_unit_settings_alice';
const CAROL = 'usr_unit_settings_carol';
const OWEN = 'usr_unit_settings_owen';

const inOrg = (organizationId: string) => ({ isSystem: true, tenantId: organizationId }) as const;
const SYS = inOrg(ORG);

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
        id: 'test.standard-unit-setting-grants',
        namespace: 'unitsettings',
        version: '1.0.0',
        type: 'plugin',
        name: 'Standard unit setting grants fixture',
        objects: [SysUser, SysMember, SysOrganization, SysStandardUnitSetting],
      });
    },
  };
}

/** The thrown error, and the wire answer the data door maps it to. */
async function refusal(run: () => Promise<unknown>): Promise<{ status: number; code: string; fields: string[]; thrown: any }> {
  let thrown: unknown;
  try {
    await run();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'the call was refused').toBeDefined();
  const wire = mapDataError(thrown, OBJ);
  const fields = ((wire.body as { fields?: Array<{ field: string; code: string }> }).fields ?? []).map((f) => f.field);
  return { status: wire.status, code: String(wire.body.code), fields, thrown };
}

describe('sys_standard_unit_setting on a real stack: administrator sets and clears, member reads, organizations stay apart', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  const as: Record<string, Ctx> = {};
  let grams = '';
  let otherGrams = '';

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
  const remove = (ctx: Ctx, id: string) => ql.delete(OBJ, { where: { id }, context: ctx } as never);
  const list = async (ctx: Ctx) => (await ql.find(OBJ, { context: ctx } as never)) as Row[];
  const stored = async (where: Row, organizationId = ORG) =>
    (await ql.find(OBJ, { where, context: inOrg(organizationId) } as never)) as Row[];
  const storedById = async (id: string, organizationId = ORG) => (await stored({ id }, organizationId))[0];
  const ledger = async (recordId: string) =>
    ((await ql.find('sys_audit_log', { where: { object_name: OBJ, record_id: recordId }, context: { isSystem: true } } as never)) as Row[]);

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    // The multi-organization posture a deployment with organizations runs in:
    // with it the security plugin raises Layer 0, the tenant wall (ADR-0095
    // D1, ADR-0105 D1), which is what keeps another organization's setting
    // out of reach. Without it the posture is `single` and no wall stands.
    kernel.registerService('tenancy', { posture: 'isolated' });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.use(new SecurityPlugin({ defaultPermissionSets }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    for (const [id, slug] of [[ORG, 'unit-settings'], [OTHER, 'unit-settings-other']]) {
      await ql.insert('sys_organization', { id, name: slug, slug }, { context: { isSystem: true } } as never);
    }
    const role: Record<string, string> = { [ALICE]: 'member', [CAROL]: 'admin', [OWEN]: 'owner' };
    for (const userId of Object.keys(role)) {
      await ql.insert(
        'sys_user',
        { id: userId, name: userId, email: `${userId}@unit-settings.test`, email_verified: true },
        { context: SYS } as never,
      );
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: role[userId] }, { context: SYS } as never);
    }
    for (const [key, userId] of [['alice', ALICE], ['carol', CAROL], ['owen', OWEN]] as const) as[key] = await contextOf(userId);
    grams = String((await insert(as.carol, { code: 'GRM', decimal_places: 3 })).id);
    // The other organization sets the same code its own way.
    otherGrams = String((await ql.insert(OBJ, { code: 'GRM', decimal_places: 1 }, { context: inOrg(OTHER) } as never) as Row).id);
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

  for (const key of ['carol', 'owen'] as const) {
    describe(`an organization ${key === 'carol' ? 'administrator' : 'owner'}`, () => {
      it('sets a setting, changes it and clears it, and each act is audited', async () => {
        const code = key === 'carol' ? 'KGM' : 'H87';
        const id = String((await insert(as[key], { code, decimal_places: 2 })).id);
        // Stamped with the writer's organization: the setting is the organization's.
        expect(await storedById(id)).toMatchObject({ code, decimal_places: 2, organization_id: ORG });

        await update(as[key], id, { decimal_places: 0 });
        expect(await storedById(id)).toMatchObject({ code, decimal_places: 0 });

        await remove(as[key], id);
        expect(await stored({ code })).toEqual([]);

        await vi.waitFor(async () =>
          expect((await ledger(id)).map((r) => r.action).sort()).toEqual(['create', 'delete', 'update']),
        );
        const change = (await ledger(id)).find((r) => r.action === 'update')!;
        expect(JSON.parse(String(change.old_value))).toMatchObject({ decimal_places: 2 });
        expect(JSON.parse(String(change.new_value))).toMatchObject({ decimal_places: 0 });
        expect(change.tenant_id).toBe(ORG);
      });
    });
  }

  describe('a member', () => {
    it("reads the organization's settings, so a quantity displays with the same default for them", async () => {
      expect((await list(as.alice)).map((r) => [r.code, r.decimal_places])).toEqual([['GRM', 3]]);
    });

    it('sets, changes and clears none: 403 PERMISSION_DENIED, nothing stored or changed', async () => {
      expect(await refusal(() => insert(as.alice, { code: 'MTR', decimal_places: 2 }))).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
      expect(await stored({ code: 'MTR' })).toEqual([]);
      expect(await refusal(() => update(as.alice, grams, { decimal_places: 5 }))).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
      expect(await refusal(() => remove(as.alice, grams))).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
      expect(await storedById(grams)).toMatchObject({ code: 'GRM', decimal_places: 3 });
    });
  });

  describe("another organization's setting", () => {
    it('is never read, by list or by id, by a member or an administrator', async () => {
      for (const key of ['alice', 'carol'] as const) {
        expect((await list(as[key])).map((r) => r.id), key).not.toContain(otherGrams);
        expect(await ql.find(OBJ, { where: { id: otherGrams }, context: as[key] } as never), key).toEqual([]);
      }
    });

    it('is never changed or cleared by an administrator of this organization', async () => {
      await update(as.carol, otherGrams, { decimal_places: 6 }).catch(() => undefined);
      await remove(as.carol, otherGrams).catch(() => undefined);
      expect(await storedById(otherGrams, OTHER)).toMatchObject({ code: 'GRM', decimal_places: 1, organization_id: OTHER });
      expect(await storedById(grams)).toMatchObject({ code: 'GRM', decimal_places: 3, organization_id: ORG });
    });
  });

  describe('the rules a write meets', () => {
    it('refuses a code that is not a standard unit, an organization code included: 400 VALIDATION_FAILED on code', async () => {
      for (const code of ['BOX_12', 'kgm', 'EA']) {
        expect(await refusal(() => insert(as.carol, { code, decimal_places: 1 })), code).toMatchObject({
          status: 400,
          code: 'VALIDATION_FAILED',
          fields: ['code'],
        });
        expect(await stored({ code }), code).toEqual([]);
      }
    });

    it('refuses decimal places outside 0 to 12, or with a fraction: 400 VALIDATION_FAILED on decimal_places', async () => {
      for (const decimal_places of [-1, 13, 1.5]) {
        expect(await refusal(() => insert(as.carol, { code: 'LTR', decimal_places })), String(decimal_places)).toMatchObject({
          status: 400,
          code: 'VALIDATION_FAILED',
          fields: ['decimal_places'],
        });
      }
      expect(await stored({ code: 'LTR' })).toEqual([]);
    });

    it('refuses a second setting of the same code: 409 UNIQUE_VIOLATION, the first kept', async () => {
      expect(await refusal(() => insert(as.carol, { code: 'GRM', decimal_places: 4 }))).toMatchObject({ status: 409, code: 'UNIQUE_VIOLATION' });
      expect(await stored({ code: 'GRM' })).toHaveLength(1);
    });

    it('refuses changing the code of a setting: 400 VALIDATION_FAILED on code, the row unchanged', async () => {
      expect(await refusal(() => update(as.carol, grams, { code: 'MGM' }))).toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        fields: ['code'],
      });
      expect(await storedById(grams)).toMatchObject({ code: 'GRM', decimal_places: 3 });
    });
  });

  describe("an organization's delete", () => {
    const GONE = 'org_unit_settings_gone';
    const organizations = async (ids: string[]) =>
      ((await ql.find('sys_organization', { where: { id: { $in: ids } }, context: { isSystem: true } } as never)) as Row[]).map((r) => r.id);

    it('is refused 409 DELETE_RESTRICTED naming this object while a setting remains, and goes through once it is cleared', async () => {
      await ql.insert('sys_organization', { id: GONE, name: 'gone', slug: 'unit-settings-gone' }, { context: { isSystem: true } } as never);
      const setting = (await ql.insert(OBJ, { code: 'TNE', decimal_places: 0 }, { context: inOrg(GONE) } as never)) as Row;

      const refused = await refusal(() => ql.delete('sys_organization', { where: { id: GONE }, context: SYS } as never));
      expect(refused).toMatchObject({ status: 409, code: 'DELETE_RESTRICTED' });
      expect(refused.thrown.dependentObject).toBe(OBJ);
      expect(await organizations([GONE])).toEqual([GONE]);

      await ql.delete(OBJ, { where: { id: setting.id }, context: inOrg(GONE) } as never);
      await expect(ql.delete('sys_organization', { where: { id: GONE }, context: SYS } as never)).resolves.toBe(true);
      expect(await organizations([GONE])).toEqual([]);
    });
  });
});
