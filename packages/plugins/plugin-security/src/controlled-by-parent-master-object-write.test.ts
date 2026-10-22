// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3] Writing a `controlled_by_parent` detail requires EDIT access to
 * its master, and the master's OBJECT-level edit admission is the one its own
 * write door asks.
 *
 * §3: "editing/deleting/creating a detail requires edit access to its master".
 * The master-edit gate's object-level leg is therefore the master write door's
 * object gate, asked of an `update` on the master with that door's own inputs:
 *
 *  - the master's posture resolves, and an unresolvable one refuses;
 *  - the capabilities the master requires for `update` are held;
 *  - the CRUD grant is asked under the master's posture.
 *
 * Pinned at every door that asks the leg: an insert, a by-id update and a
 * by-id delete through the engine, and the security service's master-detail
 * write check (`checkControlledByParentWrite`) that the parent gates of other
 * subsystems ask. Each refusal is the leg's own, `object_permission`, and
 * writes nothing.
 *
 * The controls hold the change to exactly that rule: a principal the master's
 * own door admits for an `update` keeps writing its details, and so does a
 * super-user grant and a master that carries none of the three inputs.
 *
 * Real stack: `ObjectQL` over better-sqlite3 and the real `SecurityPlugin`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ControlledByParentWriteOutcome } from '@objectstack/spec/contracts';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_cbp_mow';
const ME = 'u_cbp_mow_me';

/** A master whose posture its own door asks. */
const MASTER_POSTURE = 'qa_cbp_mow_master_posture';
/** A master that requires a capability for an update. */
const MASTER_CAPABILITY = 'qa_cbp_mow_master_capability';
/** A master that carries none of the three inputs. */
const MASTER_PLAIN = 'qa_cbp_mow_master_plain';
/** A master name no registry resolves. */
const MASTER_UNRESOLVED = 'qa_cbp_mow_master_unresolved';

const DETAIL_POSTURE = 'qa_cbp_mow_detail_posture';
const DETAIL_CAPABILITY = 'qa_cbp_mow_detail_capability';
const DETAIL_PLAIN = 'qa_cbp_mow_detail_plain';
const DETAIL_UNRESOLVED = 'qa_cbp_mow_detail_unresolved';

const CAPABILITY = 'qa_cbp_mow_capability';
const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;

const SET = {
  readMasters: 'qa_cbp_mow_read_masters',
  broad: 'qa_cbp_mow_broad',
  superUser: 'qa_cbp_mow_super_user',
  editPostureMaster: 'qa_cbp_mow_edit_posture_master',
  editCapabilityMaster: 'qa_cbp_mow_edit_capability_master',
  capabilityHolder: 'qa_cbp_mow_capability_holder',
} as const;

type Outcome = { kind: 'landed' } | { kind: 'refused'; code?: string; status?: number };

const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ({ kind: 'landed' as const }),
    (e: unknown) => {
      const x = e as { code?: unknown; status?: unknown; statusCode?: unknown } | null;
      const status = x?.statusCode ?? x?.status;
      return {
        kind: 'refused' as const,
        code: x?.code == null ? undefined : String(x.code),
        status: status == null ? undefined : Number(status),
      };
    },
  );

const REFUSED = { kind: 'refused', code: 'PERMISSION_DENIED', status: 403 } as const;
const LEG_REFUSAL: ControlledByParentWriteOutcome = { outcome: 'deny', leg: 'object_permission' };

/** Release a torn-down rig's async storages (see the explain-enforce-parity suite). */
const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

const textField = (name: string) => ({ name, type: 'text' });
const masterOf = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  sharingModel: 'public_read_write',
  ...extra,
  fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: textField('name') },
});
const detailOf = (name: string, master: string) => ({
  name,
  label: name,
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    note: textField('note'),
    master: { name: 'master', type: 'master_detail', required: true, reference: master },
  },
});

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.cbp-master-object-write',
    name: 'A controlled_by_parent detail is written only by a principal its master object admits for an update',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      masterOf(MASTER_POSTURE, { access: { default: 'private' } }),
      masterOf(MASTER_CAPABILITY, { requiredPermissions: { update: [CAPABILITY] } }),
      masterOf(MASTER_PLAIN),
      detailOf(DETAIL_POSTURE, MASTER_POSTURE),
      detailOf(DETAIL_CAPABILITY, MASTER_CAPABILITY),
      detailOf(DETAIL_PLAIN, MASTER_PLAIN),
      detailOf(DETAIL_UNRESOLVED, MASTER_UNRESOLVED),
    ],
  } as never);
  await engine.syncSchemas();

  const e = engine as unknown as {
    insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown>;
    getDriver: (o: string) => { create: (o: string, row: Record<string, unknown>) => Promise<unknown> };
    logger: { warn: () => void };
  };
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: ORG }, SYS);
  await e.insert('sys_user', { id: ME, name: ME, email: `${ME}@example.test` }, SYS);
  await e.insert('sys_member', { id: `mem_${ME}`, user_id: ME, organization_id: ORG, role: 'member' }, SYS);

  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({
      name: SET.readMasters,
      objects: {
        [MASTER_POSTURE]: { allowRead: true },
        [MASTER_CAPABILITY]: { allowRead: true },
        [MASTER_PLAIN]: { allowRead: true },
      },
    }),
    PermissionSetSchema.parse({ name: SET.broad, objects: { '*': CRUD } }),
    PermissionSetSchema.parse({
      name: SET.superUser,
      objects: { '*': { ...CRUD, viewAllRecords: true, modifyAllRecords: true } },
    }),
    PermissionSetSchema.parse({
      name: SET.editPostureMaster,
      objects: { [MASTER_POSTURE]: { allowRead: true, allowEdit: true }, [DETAIL_POSTURE]: CRUD },
    }),
    PermissionSetSchema.parse({
      name: SET.editCapabilityMaster,
      objects: { [MASTER_CAPABILITY]: { allowRead: true, allowEdit: true }, [DETAIL_CAPABILITY]: CRUD },
    }),
    PermissionSetSchema.parse({
      name: SET.capabilityHolder,
      objects: { [MASTER_CAPABILITY]: { allowRead: true, allowEdit: true }, [DETAIL_CAPABILITY]: CRUD },
      systemPermissions: [CAPABILITY],
    }),
  ];

  for (const master of [MASTER_POSTURE, MASTER_CAPABILITY, MASTER_PLAIN]) {
    await e.insert(master, { id: `${master}_row`, name: 'row' }, SYS);
  }

  let security: { checkControlledByParentWrite: (o: string, id: string, c: unknown) => Promise<ControlledByParentWriteOutcome> } | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s: { name?: string }) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    tenancy: { posture: 'single' },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => {
      if (name === 'security') security = svc as typeof security;
      else services[name] = svc;
    },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The engine's security source, as `ObjectQLPlugin.init` wires it on a kernel (ADR-0139 D2).
  wireEngineSecuritySource(engine, () => plugin);
  // The row gates log the writes they refuse.
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  let n = 0;
  return {
    engine,
    /**
     * A stored detail under `master`, written as SYSTEM (seed replay skips the
     * reference check). A driver write is not stamped, so it names the rig's
     * organization itself.
     */
    seedDetail: async (detail: string, master: string) => {
      const id = `${detail}_seed_${n++}`;
      await e.getDriver(detail).create(detail, { id, note: 'seeded', master, organization_id: ORG });
      return id;
    },
    stored: async (object: string, id: string) =>
      ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) ?? null) as Record<string, unknown> | null,
    checkWrite: (detail: string, id: string, context: unknown) =>
      security!.checkControlledByParentWrite(detail, id, { ...(context as object) }),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;

const member = (...permissions: string[]) => ({ userId: ME, positions: [], permissions, posture: 'MEMBER' });

let insertSeq = 0;

/** Insert, by-id update and by-id delete of one detail under `masterId`, and what each left stored. */
async function writeDetail(rig: Rig, detail: string, masterId: string, context: unknown) {
  const inserted = `${detail}_insert_${insertSeq++}`;
  const insert = await outcomeOf(
    rig.engine.insert(detail, { id: inserted, note: '', master: masterId }, { context: { ...(context as object) } } as never),
  );
  const updated = await rig.seedDetail(detail, masterId);
  const update = await outcomeOf(
    rig.engine.update(detail, { note: 'written' }, { where: { id: updated }, context: { ...(context as object) } } as never),
  );
  const deleted = await rig.seedDetail(detail, masterId);
  const del = await outcomeOf(rig.engine.delete(detail, { where: { id: deleted }, context: { ...(context as object) } } as never));
  return {
    insert,
    update,
    delete: del,
    insertedStored: (await rig.stored(detail, inserted)) !== null,
    updatedNote: (await rig.stored(detail, updated))?.note,
    deletedStored: (await rig.stored(detail, deleted)) !== null,
    check: await rig.checkWrite(detail, await rig.seedDetail(detail, masterId), context),
  };
}

const masterUpdate = (rig: Rig, master: string, context: unknown) =>
  outcomeOf(
    rig.engine.update(master, { name: 'written' }, { where: { id: `${master}_row` }, context: { ...(context as object) } } as never),
  );

describe("a controlled_by_parent detail is not written by a principal its master's own write door refuses at the object gate", () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  describe("on the master's posture", () => {
    const context = member(SET.readMasters, SET.broad);

    it("the master's own write door refuses the update, and the principal reads the master (the precondition)", async () => {
      expect(await masterUpdate(rig, MASTER_POSTURE, context)).toMatchObject(REFUSED);
      const read = await rig.engine.findOne(MASTER_POSTURE, { where: { id: `${MASTER_POSTURE}_row` }, context: { ...context } } as never);
      expect(read).toBeTruthy();
    });

    it('insert, by-id update and by-id delete are refused, and nothing is written', async () => {
      const got = await writeDetail(rig, DETAIL_POSTURE, `${MASTER_POSTURE}_row`, context);
      expect(got.insert).toMatchObject(REFUSED);
      expect(got.update).toMatchObject(REFUSED);
      expect(got.delete).toMatchObject(REFUSED);
      expect(got.insertedStored).toBe(false);
      expect(got.updatedNote).toBe('seeded');
      expect(got.deletedStored).toBe(true);
    });

    it('the master-detail write check refuses on the object_permission leg', async () => {
      const id = await rig.seedDetail(DETAIL_POSTURE, `${MASTER_POSTURE}_row`);
      expect(await rig.checkWrite(DETAIL_POSTURE, id, context)).toEqual(LEG_REFUSAL);
    });

    it('an insert naming a master id that exists nowhere answers the same refusal', async () => {
      expect(
        await outcomeOf(
          rig.engine.insert(DETAIL_POSTURE, { id: 'qa_cbp_mow_dangling', note: '', master: 'qa_cbp_mow_no_such_master' }, { context: { ...context } } as never),
        ),
      ).toMatchObject(REFUSED);
    });
  });

  describe('on a capability the master requires for an update', () => {
    const context = member(SET.editCapabilityMaster);

    it("the master's own write door refuses the update (the precondition)", async () => {
      expect(await masterUpdate(rig, MASTER_CAPABILITY, context)).toMatchObject(REFUSED);
    });

    it('insert, by-id update and by-id delete are refused, and nothing is written', async () => {
      const got = await writeDetail(rig, DETAIL_CAPABILITY, `${MASTER_CAPABILITY}_row`, context);
      expect(got.insert).toMatchObject(REFUSED);
      expect(got.update).toMatchObject(REFUSED);
      expect(got.delete).toMatchObject(REFUSED);
      expect(got.insertedStored).toBe(false);
      expect(got.updatedNote).toBe('seeded');
      expect(got.deletedStored).toBe(true);
      expect(got.check).toEqual(LEG_REFUSAL);
    });
  });

  describe("on a master whose posture does not resolve", () => {
    const context = member(SET.broad);

    it('an insert is refused, and nothing is written', async () => {
      const got = await outcomeOf(
        rig.engine.insert(DETAIL_UNRESOLVED, { id: 'qa_cbp_mow_unresolved_insert', note: '', master: 'qa_cbp_mow_any' }, { context: { ...context } } as never),
      );
      expect(got).toMatchObject(REFUSED);
      expect(await rig.stored(DETAIL_UNRESOLVED, 'qa_cbp_mow_unresolved_insert')).toBeNull();
    });

    it('the master-detail write check refuses on the object_permission leg', async () => {
      const id = await rig.seedDetail(DETAIL_UNRESOLVED, 'qa_cbp_mow_any');
      expect(await rig.checkWrite(DETAIL_UNRESOLVED, id, context)).toEqual(LEG_REFUSAL);
    });
  });
});

describe("a principal its master's own write door admits for an update keeps writing the master's details", () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  const LANDS = { insert: { kind: 'landed' }, update: { kind: 'landed' }, delete: { kind: 'landed' } } as const;
  const WRITTEN = { insertedStored: true, updatedNote: 'written', deletedStored: false, check: { outcome: 'allow' } } as const;

  const CONTROLS = [
    { label: 'an object-level edit grant on the master', context: member(SET.editPostureMaster), master: MASTER_POSTURE, detail: DETAIL_POSTURE },
    { label: 'a super-user grant', context: member(SET.superUser), master: MASTER_POSTURE, detail: DETAIL_POSTURE },
    { label: 'the required capability with an edit grant', context: member(SET.capabilityHolder), master: MASTER_CAPABILITY, detail: DETAIL_CAPABILITY },
    { label: 'a master that carries none of the three inputs', context: member(SET.readMasters, SET.broad), master: MASTER_PLAIN, detail: DETAIL_PLAIN },
  ] as const;

  for (const { label, context, master, detail } of CONTROLS) {
    it(`${label}: the master's own door admits the update, and insert, by-id update and by-id delete of a detail land`, async () => {
      expect(await masterUpdate(rig, master, context)).toEqual({ kind: 'landed' });
      const got = await writeDetail(rig, detail, `${master}_row`, context);
      expect(got).toMatchObject({ ...LANDS, ...WRITTEN });
    });
  }

  it('a system context writes a detail under every master', async () => {
    for (const [detail, master] of [
      [DETAIL_POSTURE, `${MASTER_POSTURE}_row`],
      [DETAIL_CAPABILITY, `${MASTER_CAPABILITY}_row`],
      [DETAIL_UNRESOLVED, 'qa_cbp_mow_any'],
    ] as const) {
      const id = `${detail}_system`;
      expect(await outcomeOf(rig.engine.insert(detail, { id, note: '', master }, SYS))).toEqual({ kind: 'landed' });
      expect(await rig.stored(detail, id)).toBeTruthy();
    }
  });
});
