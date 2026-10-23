// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §1 · #25095, ruling 6345869077] A `controlled_by_parent` detail
 * whose one required `master_detail` is not writable (`readonly: true`,
 * `system: true`, or both) is a declaration the parse refuses
 * (`controlledByParentMasterRefusal`, shape `master-not-writable`). An object
 * reaches the registry with it only through a door that does not parse — this
 * suite registers it raw, through `registerApp` — and there the write gate
 * refuses every write that sets the master reference, `422 INVALID_METADATA`
 * with the parse's own message, before any master is asked and before
 * anything is written:
 *
 *  - every insert, single or batch, whether or not its body names a master;
 *  - every update whose body carries the reference key, a master or `null`.
 *
 * Why the raw door alone pins it (ruling 6345869077 item 6): the three doors
 * that skip the parse — `defineStack` with `strict: false`, plugin code's raw
 * `registerApp` / `registerObject`, and an 18.0.0-era `sys_metadata` row the
 * boot registers under `[metadata_spec_invalid]` — all end in the one
 * `SchemaRegistry` entry the gate's resolver reads through `ql.getSchema()`,
 * so a declaration from any of them reaches the gate in the same form.
 *
 * One rule for both flags, for a member and for a platform admin alike, on an
 * ordinary object and on a `sys_`-named one (which the engine treats
 * differently on insert — the rule does not). What stays as it was:
 *
 *  - rows already stored keep their master: the caller still reads them, an
 *    update that leaves the key alone lands, and a delete lands;
 *  - a system write is not the write gate's;
 *  - a detail declared as the in-repo `controlled_by_parent` objects declare
 *    theirs (`Field.masterDetail`, `required: true`, through the parse) takes
 *    the same writes, so the refusal is the declaration's and nothing else's.
 *
 * Real stack: `ObjectQL` over better-sqlite3, the real `SecurityPlugin`, the
 * real sharing service and middleware, a member's context assembled by
 * `resolveAuthzContext` and `assembleExecutionContext`, a platform admin's
 * carried posture, and the engine's security source wired as a kernel wires
 * it, so a detail read composes the engine's `ReadableIds` leaf over its master.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectSchema, Field, controlledByParentMasterRefusal } from '@objectstack/spec/data';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const ORG = 'org_cbp_unw';
const POSTURE = 'isolated' as const;
const MEMBER = 'u_cbp_unw_member';
const ADMIN = 'u_cbp_unw_admin';

const MASTER = 'qa_cbp_unw_master';
const MASTER_ROWS = ['qa_cbp_unw_master_1', 'qa_cbp_unw_master_2'] as const;

/** The flags a master reference may not carry under ADR-0055 §1. */
const FLAGGED = {
  readonly: { readonly: true },
  system: { system: true },
  'readonly and system': { readonly: true, system: true },
} as const;
type Flagged = keyof typeof FLAGGED;
const FLAG_NAMES = Object.keys(FLAGGED) as Flagged[];

/** An ordinary object, and one whose `sys_` name the engine exempts from its readonly insert strip. */
const PREFIXES = { ordinary: '', 'sys_-named': 'sys_' } as const;
type Prefix = keyof typeof PREFIXES;
const PREFIX_NAMES = Object.keys(PREFIXES) as Prefix[];

const detailName = (prefix: Prefix, flags: Flagged) => `${PREFIXES[prefix]}qa_cbp_unw_${flags.replace(/ /g, '_')}`;
const FLAGGED_DETAILS = PREFIX_NAMES.flatMap((prefix) =>
  FLAG_NAMES.map((flags) => ({ prefix, flags, name: detailName(prefix, flags) })),
);
/** Declared as the in-repo `controlled_by_parent` objects declare their master, and parsed. */
const IN_REPO_SHAPE = 'qa_cbp_unw_in_repo_shape';

const masterFields = {
  name: { name: 'name', type: 'text' },
  owner_id: { name: 'owner_id', type: 'text' },
  created_by: { name: 'created_by', type: 'text' },
};
const detailFields = (flags: Flagged) => ({
  note: { name: 'note', type: 'text' },
  created_by: { name: 'created_by', type: 'text' },
  master: { name: 'master', type: 'master_detail', required: true, reference: MASTER, ...FLAGGED[flags] },
});
const flaggedDetail = (prefix: Prefix, flags: Flagged) => ({
  name: detailName(prefix, flags),
  label: detailName(prefix, flags),
  sharingModel: 'controlled_by_parent',
  fields: detailFields(flags),
});
const inRepoShape = () =>
  ObjectSchema.parse({
    name: IN_REPO_SHAPE,
    label: IN_REPO_SHAPE,
    sharingModel: 'controlled_by_parent',
    fields: {
      note: Field.text({ label: 'Note' }),
      created_by: Field.text({ label: 'Created by' }),
      master: Field.masterDetail(MASTER, { label: 'Master', required: true, deleteBehavior: 'cascade' }),
    },
  });

/** The parse's own refusal of a flagged declaration — the text the gate's refusal carries. */
const parseRefusal = (prefix: Prefix, flags: Flagged) =>
  controlledByParentMasterRefusal(detailName(prefix, flags), 'controlled_by_parent', detailFields(flags));
const refusedWith = (operation: 'insert' | 'update', prefix: Prefix, flags: Flagged) => ({
  kind: 'refused',
  code: 'INVALID_METADATA',
  status: 422,
  message:
    `[Security] Configuration defect: ${operation} on '${detailName(prefix, flags)}' cannot be written. `
    + parseRefusal(prefix, flags)!.message,
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

const CALLERS = ['a member', 'a platform admin'] as const;
type Caller = (typeof CALLERS)[number];
/** A short, id-safe tag per caller, so each case writes rows of its own. */
const tag = (caller: Caller) => (caller === 'a member' ? 'm' : 'a');

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  // A door that does not parse: the flagged declarations go to the registry as written.
  engine.registerApp({
    id: 'com.objectstack.qa.cbp-unwritable-master',
    name: 'A write that sets a master reference the declaration keeps from the author is refused',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      { name: MASTER, label: 'Master', sharingModel: 'public_read_write', fields: masterFields },
      inRepoShape(),
      ...FLAGGED_DETAILS.map(({ prefix, flags }) => flaggedDetail(prefix, flags)),
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
        [IN_REPO_SHAPE]: CRUD,
        ...Object.fromEntries(FLAGGED_DETAILS.map(({ name }) => [name, CRUD])),
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
  // The engine's security source, as `ObjectQLPlugin.init` wires it on a kernel (ADR-0139 D2).
  wireEngineSecuritySource(engine, () => plugin);
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
  const callers: Record<Caller, () => Record<string, unknown>> = {
    'a member': () => ({ ...member }),
    'a platform admin': () => ({
      userId: ADMIN, tenantId: ORG, positions: [], permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN',
    }),
  };

  /** A row as a system read sees it: its master and its note, or `null` when there is none. */
  const stored = async (detail: string, id: string) => {
    const row = (await engine.findOne(detail, { where: { id }, context: { isSystem: true } } as never)) as
      | Record<string, unknown>
      | null;
    return row ? { master: row.master ?? null, note: row.note ?? null } : null;
  };

  return {
    as: (caller: Caller) => callers[caller](),
    /** The master walk the gate runs once per master it asks about, for counting. */
    walk: () =>
      vi.spyOn(plugin as unknown as { assertControlledByParentChainEditable: () => Promise<void> }, 'assertControlledByParentChainEditable'),
    /** An insert (one row, or a batch), and what it left stored under each id it named. */
    insert: async (detail: string, rows: Record<string, unknown>[], context: Record<string, unknown>, batch: boolean) => {
      const outcome = await outcomeOf(engine.insert(detail, (batch ? rows : rows[0]) as never, { context } as never));
      const left: Record<string, unknown> = {};
      for (const row of rows) left[String(row.id)] = await stored(detail, String(row.id));
      return { outcome, stored: left };
    },
    /** A by-id update, and the row it left. */
    update: async (detail: string, id: string, data: Record<string, unknown>, context: Record<string, unknown>) => ({
      outcome: await outcomeOf(engine.update(detail, data, { where: { id }, context } as never)),
      stored: await stored(detail, id),
    }),
    /** A by-id delete, and the row it left. */
    remove: async (detail: string, id: string, context: Record<string, unknown>) => ({
      outcome: await outcomeOf(engine.delete(detail, { where: { id }, context } as never)),
      stored: await stored(detail, id),
    }),
    stored,
    /** The ids of the rows the caller's own read returns, of those named. */
    readable: async (detail: string, ids: readonly string[], context: Record<string, unknown>) => {
      const rows = (await engine.find(detail, { where: { id: { $in: [...ids] } }, context } as never)) as Array<{ id: string }>;
      return rows.map((r) => r.id).sort();
    },
    /** A detail row written as the platform would write it, under a master. */
    seed: async (detail: string, id: string, master: string) => {
      await e.getDriver(detail).create(detail, { id, note: 'seeded', created_by: MEMBER, master, organization_id: ORG });
    },
    systemInsert: (detail: string, row: Record<string, unknown>) => outcomeOf(e.insert(detail, row, SYS)),
    teardown: async () => {
      try { await engine.destroy(); } catch { /* noop */ }
      releaseAsyncContexts(engine, plugin);
    },
  };
}

type Rig = Awaited<ReturnType<typeof boot>>;

describe('ADR-0055 §1 — a write that sets a master reference the declaration keeps from the author', () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(); });
  afterAll(async () => { await rig.teardown(); });

  it('each flagged declaration is one the parse refuses, at `fields`, as `master-not-writable`; the in-repo shape parses', () => {
    for (const { prefix, flags, name } of FLAGGED_DETAILS) {
      expect({ name, shape: parseRefusal(prefix, flags)?.shape }).toEqual({ name, shape: 'master-not-writable' });
      const parsed = ObjectSchema.safeParse(flaggedDetail(prefix, flags));
      expect({ name, success: parsed.success }).toEqual({ name, success: false });
      if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('fields');
    }
    expect(inRepoShape().fields.master).toMatchObject({ type: 'master_detail', required: true, readonly: false });
  });

  describe.each(CALLERS)('as %s', (caller) => {
    describe.each(FLAGGED_DETAILS)('on $name', ({ prefix, flags, name: detail }) => {
      const id = (what: string) => `${detail}_${tag(caller)}_${what}`;

      it('a single create naming a master is refused before any master is asked, and nothing is stored', async () => {
        const walk = rig.walk();
        try {
          const row = { id: id('single'), note: 'x', master: MASTER_ROWS[0] };
          expect(await rig.insert(detail, [row], rig.as(caller), false)).toEqual({
            outcome: refusedWith('insert', prefix, flags),
            stored: { [row.id]: null },
          });
          expect(walk).not.toHaveBeenCalled();
        } finally {
          walk.mockRestore();
        }
      });

      it('a single create naming no master is refused the same way, and nothing is stored', async () => {
        const row = { id: id('no_master'), note: 'x' };
        expect(await rig.insert(detail, [row], rig.as(caller), false)).toEqual({
          outcome: refusedWith('insert', prefix, flags),
          stored: { [row.id]: null },
        });
      });

      it('a batch create is refused whole, and nothing is stored', async () => {
        const rows = [
          { id: id('batch_1'), note: 'x', master: MASTER_ROWS[0] },
          { id: id('batch_2'), note: 'x', master: MASTER_ROWS[1] },
        ];
        expect(await rig.insert(detail, rows, rig.as(caller), true)).toEqual({
          outcome: refusedWith('insert', prefix, flags),
          stored: { [rows[0].id]: null, [rows[1].id]: null },
        });
      });

      it('an update whose body names a master is refused before any master is asked, and the row keeps its own', async () => {
        await rig.seed(detail, id('repoint'), MASTER_ROWS[0]);
        const walk = rig.walk();
        try {
          expect(await rig.update(detail, id('repoint'), { master: MASTER_ROWS[1] }, rig.as(caller))).toEqual({
            outcome: refusedWith('update', prefix, flags),
            stored: { master: MASTER_ROWS[0], note: 'seeded' },
          });
          expect(walk).not.toHaveBeenCalled();
        } finally {
          walk.mockRestore();
        }
      });

      it('an update whose body empties the reference is refused, and the row keeps its master', async () => {
        await rig.seed(detail, id('empty'), MASTER_ROWS[0]);
        expect(await rig.update(detail, id('empty'), { note: 'x', master: null }, rig.as(caller))).toEqual({
          outcome: refusedWith('update', prefix, flags),
          stored: { master: MASTER_ROWS[0], note: 'seeded' },
        });
      });

      it('a stored row keeps its master: still read, an update that leaves the key alone lands, and a delete lands', async () => {
        const kept = id('kept');
        const gone = id('gone');
        await rig.seed(detail, kept, MASTER_ROWS[0]);
        await rig.seed(detail, gone, MASTER_ROWS[1]);
        expect(await rig.readable(detail, [kept, gone], rig.as(caller))).toEqual([gone, kept].sort());

        expect(await rig.update(detail, kept, { note: 'written' }, rig.as(caller))).toEqual({
          outcome: { kind: 'landed' },
          stored: { master: MASTER_ROWS[0], note: 'written' },
        });
        expect(await rig.remove(detail, gone, rig.as(caller))).toEqual({ outcome: { kind: 'landed' }, stored: null });
        expect(await rig.readable(detail, [kept, gone], rig.as(caller))).toEqual([kept]);
      });
    });

    describe(`on ${IN_REPO_SHAPE}, declared as the in-repo controlled_by_parent objects declare their master`, () => {
      const id = (what: string) => `${IN_REPO_SHAPE}_${tag(caller)}_${what}`;

      it('single and batch creates land, and read back under their masters', async () => {
        const single = await rig.insert(IN_REPO_SHAPE, [{ id: id('single'), note: 'x', master: MASTER_ROWS[0] }], rig.as(caller), false);
        expect(single).toEqual({ outcome: { kind: 'landed' }, stored: { [id('single')]: { master: MASTER_ROWS[0], note: 'x' } } });
        const batch = await rig.insert(
          IN_REPO_SHAPE,
          [{ id: id('batch_1'), note: 'x', master: MASTER_ROWS[0] }, { id: id('batch_2'), note: 'x', master: MASTER_ROWS[1] }],
          rig.as(caller),
          true,
        );
        expect(batch).toEqual({
          outcome: { kind: 'landed' },
          stored: { [id('batch_1')]: { master: MASTER_ROWS[0], note: 'x' }, [id('batch_2')]: { master: MASTER_ROWS[1], note: 'x' } },
        });
        expect(await rig.readable(IN_REPO_SHAPE, [id('single'), id('batch_1'), id('batch_2')], rig.as(caller))).toEqual(
          [id('batch_1'), id('batch_2'), id('single')],
        );
      });

      it('an update naming a master re-points the row, one leaving the key alone lands, and a delete lands', async () => {
        await rig.seed(IN_REPO_SHAPE, id('repoint'), MASTER_ROWS[0]);
        await rig.seed(IN_REPO_SHAPE, id('gone'), MASTER_ROWS[0]);
        expect(await rig.update(IN_REPO_SHAPE, id('repoint'), { master: MASTER_ROWS[1] }, rig.as(caller))).toEqual({
          outcome: { kind: 'landed' },
          stored: { master: MASTER_ROWS[1], note: 'seeded' },
        });
        expect(await rig.update(IN_REPO_SHAPE, id('repoint'), { note: 'written' }, rig.as(caller))).toEqual({
          outcome: { kind: 'landed' },
          stored: { master: MASTER_ROWS[1], note: 'written' },
        });
        expect(await rig.remove(IN_REPO_SHAPE, id('gone'), rig.as(caller))).toEqual({ outcome: { kind: 'landed' }, stored: null });
      });
    });
  });

  it.each(FLAGGED_DETAILS)("a system create on $name is not the write gate's, and lands under its master", async ({ name: detail }) => {
    const id = `${detail}_system`;
    expect(await rig.systemInsert(detail, { id, note: 'x', master: MASTER_ROWS[0], organization_id: ORG })).toEqual({ kind: 'landed' });
    expect(await rig.stored(detail, id)).toEqual({ master: MASTER_ROWS[0], note: 'x' });
  });
});
