// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §1] A `controlled_by_parent` detail whose one required
 * `master_detail` is not writable (`readonly: true`, `system: true`, or both)
 * is a declaration the parse refuses (`controlledByParentMasterRefusal`, shape
 * `master-not-writable`). An object reaches the registry with it only through a
 * door that does not parse — this suite registers it raw, through
 * `registerApp` — and there the write gate holds the parse's line for the one
 * write that mints a detail:
 *
 *  - an insert that names a master is refused `422 INVALID_METADATA` with the
 *    parse's own message, before any master is asked, and nothing is stored —
 *    a single create and a batch create, for every flag;
 *  - an insert that names no master keeps the answer it had
 *    (`422 MISSING_REQUIRED_FIELD`);
 *  - rows already stored keep their master: the caller still reads them, a
 *    note-only update lands, and an update that names the master reference
 *    leaves the row under a master the caller reads;
 *  - the same detail declared with an ordinary required master takes the same
 *    inserts, so the refusal is the declaration's and nothing else's;
 *  - a system write is not the write gate's, and is untouched.
 *
 * Real stack: `ObjectQL` over better-sqlite3, the real `SecurityPlugin`, the
 * real sharing service and middleware, and a member's context assembled by
 * `resolveAuthzContext` and `assembleExecutionContext`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectSchema, controlledByParentMasterRefusal } from '@objectstack/spec/data';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_cbp_unw';
const POSTURE = 'isolated' as const;
const MEMBER = 'u_cbp_unw_member';

const MASTER = 'qa_cbp_unw_master';
const MASTER_ROWS = ['qa_cbp_unw_master_1', 'qa_cbp_unw_master_2'] as const;

/** The flags a master reference may not carry under ADR-0055 §1, one detail each. */
const FLAGGED = {
  readonly: { readonly: true },
  system: { system: true },
  'readonly and system': { readonly: true, system: true },
} as const;
type Flagged = keyof typeof FLAGGED;
const detailName = (flags: Flagged | 'none') => `qa_cbp_unw_detail_${flags.replace(/ /g, '_')}`;

const masterFields = {
  name: { name: 'name', type: 'text' },
  owner_id: { name: 'owner_id', type: 'text' },
  created_by: { name: 'created_by', type: 'text' },
};
const detailFields = (flags: Record<string, boolean>) => ({
  note: { name: 'note', type: 'text' },
  created_by: { name: 'created_by', type: 'text' },
  master: { name: 'master', type: 'master_detail', required: true, reference: MASTER, ...flags },
});
const detailOf = (flags: Flagged | 'none') => ({
  name: detailName(flags),
  label: detailName(flags),
  sharingModel: 'controlled_by_parent',
  fields: detailFields(flags === 'none' ? {} : FLAGGED[flags]),
});

type Outcome =
  | { kind: 'landed' }
  | { kind: 'refused'; code?: string; status?: number; message: string };

const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ({ kind: 'landed' as const }),
    (e: unknown) => {
      const x = e as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown } | null;
      const status = x?.statusCode ?? x?.status;
      return {
        kind: 'refused' as const,
        code: x?.code == null ? undefined : String(x.code),
        status: status == null ? undefined : Number(status),
        message: String(x?.message),
      };
    },
  );

/** See the explain-enforce-parity suite: a torn-down rig's async storages are released once its last row is judged. */
const releaseAsyncContexts = (...owners: object[]): void => {
  for (const owner of owners) {
    for (const value of Object.values(owner)) if (value instanceof AsyncLocalStorage) value.disable();
  }
};

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  // A door that does not parse: the declarations go to the registry as written.
  engine.registerApp({
    id: 'com.objectstack.qa.cbp-unwritable-master-insert',
    name: 'An insert naming a master under a master reference the declaration keeps from the author is refused',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: MASTER, label: 'Master', sharingModel: 'public_read_write', fields: masterFields },
      detailOf('none'),
      ...(Object.keys(FLAGGED) as Flagged[]).map(detailOf),
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less permission-set catalogue row below exists only on a
  // store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): that table is this store's.
  await relaxTenantColumns(engine as never, ['sys_permission_set']);

  const e = engine as unknown as {
    insert: (o: string, row: Record<string, unknown>, opts: never) => Promise<unknown>;
    getDriver: (o: string) => { create: (o: string, row: Record<string, unknown>) => Promise<unknown> };
    logger: { warn: () => void };
  };
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: ORG }, SYS);
  await e.insert('sys_user', { id: MEMBER, name: MEMBER, email: `${MEMBER}@example.test` }, SYS);
  await e.insert('sys_member', { id: `mem_${MEMBER}`, user_id: MEMBER, organization_id: ORG, role: 'member' }, SYS);
  const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;
  const WRITER = 'qa_cbp_unw_writer';
  const sets = [
    ...defaultPermissionSets,
    PermissionSetSchema.parse({
      name: WRITER,
      objects: {
        [MASTER]: { allowRead: true, allowEdit: true },
        [detailName('none')]: CRUD,
        ...Object.fromEntries((Object.keys(FLAGGED) as Flagged[]).map((f) => [detailName(f), CRUD])),
      },
    }),
  ];
  await e.getDriver('sys_permission_set').create('sys_permission_set', {
    id: `ps_${WRITER}`, name: WRITER, label: WRITER, organization_id: null, managed_by: 'admin', active: true,
    object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  await e.insert('sys_user_permission_set', { id: `ups_${MEMBER}`, user_id: MEMBER, permission_set: WRITER, organization_id: ORG }, SYS);
  for (const id of MASTER_ROWS) {
    await e.insert(MASTER, { id, name: id, owner_id: MEMBER, created_by: MEMBER, organization_id: ORG }, SYS);
  }

  let security: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s: { name?: string }) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    tenancy: { posture: POSTURE },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => {
      if (name === 'security') security = svc;
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
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
  // The row gates log the writes they refuse.
  vi.spyOn(e.logger, 'warn').mockImplementation(() => undefined);

  const authz = await resolveAuthzContext({
    userAuthGates: undefined,
    apiKeyLifecycle: undefined,
    ql: engine,
    headers: {},
    getSession: async () => ({
      user: { id: MEMBER },
      session: { id: `sess_${MEMBER}`, userId: MEMBER, activeOrganizationId: ORG },
    }),
    tenancyPosture: POSTURE,
  } as never);
  const member = assembleExecutionContext({
    authz,
    oauth: undefined,
    localization: undefined,
    requestLocale: undefined,
    accessToken: undefined,
  } as never) as Record<string, unknown>;

  return {
    member: () => ({ ...member }),
    /** The master walk the gate runs once per master it asks about, for counting. */
    walk: () =>
      vi.spyOn(plugin as unknown as { assertControlledByParentChainEditable: () => Promise<void> }, 'assertControlledByParentChainEditable'),
    insert: (detail: string, data: Record<string, unknown> | Record<string, unknown>[], context: Record<string, unknown>) =>
      outcomeOf(engine.insert(detail, data as never, { context } as never)),
    update: (detail: string, id: string, data: Record<string, unknown>, context: Record<string, unknown>) =>
      outcomeOf(engine.update(detail, data, { where: { id }, context } as never)),
    /** A row as a system read sees it: its master and its note, or `null` when there is none. */
    stored: async (detail: string, id: string) => {
      const row = (await engine.findOne(detail, { where: { id }, context: { isSystem: true } } as never)) as
        | Record<string, unknown>
        | null;
      return row ? { master: row.master ?? null, note: row.note ?? null } : null;
    },
    /** The ids of the rows the caller's own read returns, of those named. */
    readable: async (detail: string, ids: readonly string[], context: Record<string, unknown>) => {
      const rows = (await engine.find(detail, { where: { id: { $in: [...ids] } }, context } as never)) as Array<{ id: string }>;
      return rows.map((r) => r.id).sort();
    },
    /** A detail row written as the platform would write it, under a master. */
    seed: (detail: string, id: string, master: string) =>
      e.getDriver(detail).create(detail, { id, note: 'seeded', created_by: MEMBER, master, organization_id: ORG }),
    systemInsert: (detail: string, row: Record<string, unknown>) => outcomeOf(e.insert(detail, row, SYS)),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;
const FLAG_NAMES = Object.keys(FLAGGED) as Flagged[];

/** The parse's own refusal of a flagged declaration — the text the gate's refusal carries. */
const parseRefusal = (flags: Flagged) =>
  controlledByParentMasterRefusal(detailName(flags), 'controlled_by_parent', detailFields(FLAGGED[flags]));

describe('ADR-0055 §1 — an insert naming a master under a master reference the declaration keeps from the author', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  it('each flagged declaration is one the parse refuses, at `fields`, as `master-not-writable`; the ordinary one parses', () => {
    for (const flags of FLAG_NAMES) {
      expect({ flags, shape: parseRefusal(flags)?.shape }).toEqual({ flags, shape: 'master-not-writable' });
      const parsed = ObjectSchema.safeParse(detailOf(flags));
      expect({ flags, success: parsed.success }).toEqual({ flags, success: false });
      if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('fields');
    }
    expect(ObjectSchema.safeParse(detailOf('none')).success).toBe(true);
  });

  for (const flags of FLAG_NAMES) {
    it(`${flags}: a single create naming a master is refused 422 INVALID_METADATA with the parse's message, before any master is asked, and nothing is stored`, async () => {
      const detail = detailName(flags);
      const walk = rig.walk();
      try {
        const id = `${detail}_single`;
        const outcome = await rig.insert(detail, { id, note: 'x', master: MASTER_ROWS[0] }, rig.member());
        expect(outcome).toMatchObject({ kind: 'refused', code: 'INVALID_METADATA', status: 422 });
        expect((outcome as { message: string }).message).toBe(
          `[Security] Configuration defect: insert on '${detail}' cannot be written. ${parseRefusal(flags)!.message}`,
        );
        expect(walk).not.toHaveBeenCalled();
        expect(await rig.stored(detail, id)).toBeNull();
      } finally {
        walk.mockRestore();
      }
    });

    it(`${flags}: a batch create is refused whole when any row names a master, and nothing is stored`, async () => {
      const detail = detailName(flags);
      const ids = [`${detail}_batch_1`, `${detail}_batch_2`];
      const outcome = await rig.insert(
        detail,
        [{ id: ids[0], note: 'x' }, { id: ids[1], note: 'x', master: MASTER_ROWS[1] }],
        rig.member(),
      );
      expect(outcome).toMatchObject({ kind: 'refused', code: 'INVALID_METADATA', status: 422 });
      for (const id of ids) expect({ id, row: await rig.stored(detail, id) }).toEqual({ id, row: null });
    });

    it(`${flags}: a create naming no master keeps its own answer, 422 MISSING_REQUIRED_FIELD`, async () => {
      const detail = detailName(flags);
      const id = `${detail}_no_master`;
      const outcome = await rig.insert(detail, { id, note: 'x' }, rig.member());
      expect(outcome).toMatchObject({ kind: 'refused', code: 'MISSING_REQUIRED_FIELD', status: 422 });
      expect(await rig.stored(detail, id)).toBeNull();
    });

    it(`${flags}: a stored row keeps its master — still read, a note-only update lands, and an update naming the reference leaves it under a master the caller reads`, async () => {
      const detail = detailName(flags);
      const id = `${detail}_stored`;
      await rig.seed(detail, id, MASTER_ROWS[0]);
      expect(await rig.readable(detail, [id], rig.member())).toEqual([id]);

      expect(await rig.update(detail, id, { note: 'written' }, rig.member())).toEqual({ kind: 'landed' });
      expect(await rig.stored(detail, id)).toEqual({ master: MASTER_ROWS[0], note: 'written' });

      expect(await rig.update(detail, id, { master: MASTER_ROWS[1] }, rig.member())).toEqual({ kind: 'landed' });
      const after = await rig.stored(detail, id);
      expect(MASTER_ROWS).toContain(after?.master);
      expect(await rig.readable(detail, [id], rig.member())).toEqual([id]);
    });

    it(`${flags}: a system create is not the write gate's, and lands under its master`, async () => {
      const detail = detailName(flags);
      const id = `${detail}_system`;
      expect(await rig.systemInsert(detail, { id, note: 'x', master: MASTER_ROWS[0], organization_id: ORG })).toEqual({ kind: 'landed' });
      expect(await rig.stored(detail, id)).toEqual({ master: MASTER_ROWS[0], note: 'x' });
    });
  }

  it('the same detail with an ordinary required master takes the same creates, and reads them back under that master', async () => {
    const detail = detailName('none');
    expect(await rig.insert(detail, { id: `${detail}_single`, note: 'x', master: MASTER_ROWS[0] }, rig.member())).toEqual({ kind: 'landed' });
    expect(
      await rig.insert(detail, [{ id: `${detail}_batch_1`, note: 'x', master: MASTER_ROWS[0] }, { id: `${detail}_batch_2`, note: 'x', master: MASTER_ROWS[1] }], rig.member()),
    ).toEqual({ kind: 'landed' });
    expect(await rig.stored(detail, `${detail}_single`)).toEqual({ master: MASTER_ROWS[0], note: 'x' });
    expect(await rig.stored(detail, `${detail}_batch_2`)).toEqual({ master: MASTER_ROWS[1], note: 'x' });
    expect(await rig.readable(detail, [`${detail}_single`, `${detail}_batch_1`, `${detail}_batch_2`], rig.member())).toEqual(
      [`${detail}_batch_1`, `${detail}_batch_2`, `${detail}_single`],
    );
  });
});
