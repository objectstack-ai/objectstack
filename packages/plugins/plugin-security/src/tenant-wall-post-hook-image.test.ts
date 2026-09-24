// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20013] The Layer 0 tenant write wall holds for the row that is STORED,
 * after the `beforeInsert` / `beforeUpdate` chain — for an insert, a by-id
 * update and a predicate update.
 *
 * ## The guarantee
 *
 * Step 3.7 of the security middleware (ADR-0095 D1, ADR-0105 D5) says a
 * write's `organization_id` must satisfy the SAME Layer 0 filter the read side
 * uses, so that in a non-platform user context the only organization a write
 * can place a row in is one the caller holds. The middleware judged that on
 * `opCtx.data` — the payload as the caller SENT it — before `next()` runs the
 * engine's hook chain. A value a hook wrote into `organization_id` after that
 * point was never judged by the wall, and the row was stored in whatever
 * organization the hook named.
 *
 * The fix judges the stored image as well, through the engine-run seam the
 * row-level `check` already uses (`OperationContext.postHookWriteImageCheck`),
 * installed whenever the wall applies to the write — with or without a
 * business `check`. The judgement of the payload as sent STAYS, so the change
 * only ever refuses more.
 *
 * ## What this file pins, on both SQL driver families, in the `isolated`
 * posture unless a cell says otherwise
 *
 * - the refusals: a hook-written `organization_id` outside the caller's
 *   organization scope is refused on a by-id update, an insert, an array
 *   insert and a predicate update, with step 3.7's own refusal
 *   (`PERMISSION_DENIED` / 403), and the driver's table is unchanged; the
 *   same when a business `check` is installed beside it (one composed seam),
 *   and under the `group` posture against the membership set;
 * - fail-closed: a host that never runs the installed judgement is refused
 *   rather than vouched for;
 * - the controls: an in-scope hook write is admitted; a supplied
 *   out-of-scope value is refused as before; the payload judgement still
 *   refuses a value a hook would have replaced (only refuses MORE); an update
 *   that does not touch the column is admitted on both update paths; an
 *   insert that leaves the column to the platform is admitted (ADR-0095 D1's
 *   "Not touched" concern: an ABSENT value is never judged); a platform
 *   administrator on a posture-permitting object and a system context are
 *   ungated as before; the `single` posture is unchanged; and the ADR-0094
 *   permission-set data door, which executes its write without the engine,
 *   still admits a platform administrator's write.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { SysPermissionSet } from './objects/index.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

/** The organization the caller holds (its active organization). */
const OWN_ORG = 'org_a';
/** An organization the caller does NOT hold. */
const OTHER_ORG = 'org_b';
/** A second organization the caller holds under `group` only. */
const SISTER_ORG = 'org_c';

/**
 * The hook shape: an app derives `organization_id` from another payload field
 * (`target_org`), so the payload as sent never carries the column itself.
 */
const HOOKED_FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
  target_org: { name: 'target_org', type: 'text' },
};

const OBJECTS = [
  // A public tenant object: Layer 0 walls every non-system caller on it.
  { name: 'qa_account', label: 'Account', fields: HOOKED_FIELDS },
  // The same shape under a business `check`, so step 3.6 installs its own
  // stored-row judgement beside the wall's.
  { name: 'qa_checked', label: 'Checked', fields: HOOKED_FIELDS },
  // A PRIVATE object: its posture permits a platform administrator to cross
  // the wall (ADR-0095 D1 exemption).
  { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: HOOKED_FIELDS },
];

/** Plain CRUD, no row-level policy on the wall's objects — Layer 0 is the enforcer under test. */
const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  rowLevelSecurity: [
    {
      name: 'checked_not_forbidden',
      object: 'qa_checked',
      operation: 'all',
      using: "record.name != 'forbidden'",
      check: "record.name != 'forbidden'",
    },
  ],
} as unknown as PermissionSet;

/** A platform operator: the superuser bit AND a platform-exclusive capability (ADR-0095 D3). */
const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
  },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: OWN_ORG };
const MEMBER_CTX = { userId: 'usr_a', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ADMIN_CTX = {
  userId: 'usr_admin',
  tenantId: OWN_ORG,
  positions: [],
  permissions: ['admin_full_access'],
  posture: 'PLATFORM_ADMIN',
};

type Posture = 'isolated' | 'group' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  /** Every `organization_id` a hook wrote, so "the hook ran" is measured. */
  hookWrites: unknown[];
  /** A table's rows read straight off the driver, past every scope. */
  table: (name: string) => Promise<Array<Record<string, unknown>>>;
}

async function boot(makeDriver: () => unknown, posture: Posture = 'isolated'): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.tenant-wall-post-hook-image',
    name: 'Layer 0 tenant wall on the stored row',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const hookWrites: unknown[] = [];
  const stamp = (async (ctx: { input: { data: Record<string, unknown> } }) => {
    const target = ctx.input.data.target_org;
    if (typeof target !== 'string' || target === '') return;
    hookWrites.push(target);
    ctx.input.data.organization_id = target;
  }) as never;
  for (const object of ['qa_account', 'qa_checked', 'qa_vault']) {
    engine.on('beforeInsert', object, stamp);
    engine.on('beforeUpdate', object, stamp);
  }

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER, PLATFORM_ADMIN],
    },
  };
  if (posture !== 'single') {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    services.tenancy = { posture };
  }
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The expected refusals log at WARN through the engine's own logger.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  for (const object of ['qa_account', 'qa_checked', 'qa_vault']) {
    await engine.insert(
      object,
      [
        { id: 'r1', name: 'one', organization_id: OWN_ORG },
        { id: 'r2', name: 'two', organization_id: OWN_ORG },
      ],
      { context: SYS_CTX } as never,
    );
  }

  const table = async (name: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select('id', 'name', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  return { engine, hookWrites, table };
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' } as never)],
];

interface Outcome { ok: boolean; code?: string; status?: number; message?: string; developerMessage?: string }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string; developerMessage?: string };
    return {
      ok: false,
      code: err.code,
      status: err.statusCode ?? err.status,
      message: String(err.message ?? e),
      developerMessage: err.developerMessage,
    };
  }
};

/** Step 3.7's refusal, on the ADR-0112 envelope, never a bare throw. */
const expectTenantRefusal = (outcome: Outcome, operation: 'insert' | 'update', object = 'qa_account') => {
  expect(outcome.ok, 'expected a refusal, got a completed write').toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message, 'the refusal names the tenant wall and the verb')
    .toContain(`the ${operation} would place '${object}' in another tenant`);
};

const expectAdmitted = (outcome: Outcome) =>
  expect(outcome.ok, `expected the write to be admitted: ${outcome.developerMessage ?? outcome.message}`).toBe(true);

const SEEDED = [
  { id: 'r1', name: 'one', organization_id: OWN_ORG },
  { id: 'r2', name: 'two', organization_id: OWN_ORG },
];

const byId = (b: Booted, object: string, data: Record<string, unknown>, context: object = MEMBER_CTX) =>
  b.engine.update(object, data as never, { context } as never);
const insert = (b: Booted, object: string, data: unknown, context: object = MEMBER_CTX) =>
  b.engine.insert(object, data as never, { context } as never);
const predicate = (b: Booted, object: string, data: Record<string, unknown>, context: object = MEMBER_CTX) =>
  b.engine.update(object, data as never, { where: { name: 'one' }, multi: true, context } as never);

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#20013] a hook-written organization_id is judged by the Layer 0 wall on the stored row — ${driverName}`, () => {
    it('by-id update: a hook-written organization outside the caller’s scope is refused, and nothing is stored', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => byId(b, 'qa_account', { id: 'r1', name: 'moved', target_org: OTHER_ORG }));

      expectTenantRefusal(outcome, 'update');
      expect(b.hookWrites, 'the hook ran and wrote the column').toEqual([OTHER_ORG]);
      expect(await b.table('qa_account')).toEqual(SEEDED);
    });

    it('insert: a hook-written organization outside the caller’s scope is refused, and no row is stored', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => insert(b, 'qa_account', { id: 'r3', name: 'new', target_org: OTHER_ORG }));

      expectTenantRefusal(outcome, 'insert');
      expect(b.hookWrites).toEqual([OTHER_ORG]);
      expect(await b.table('qa_account')).toEqual(SEEDED);
    });

    it('array insert: one hook-written row outside the scope refuses the whole write, and no row is stored', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => insert(b, 'qa_account', [
        { id: 'r3', name: 'in scope' },
        { id: 'r4', name: 'out of scope', target_org: OTHER_ORG },
      ]));

      expectTenantRefusal(outcome, 'insert');
      expect(b.hookWrites).toEqual([OTHER_ORG]);
      expect(await b.table('qa_account')).toEqual(SEEDED);
    });

    it('predicate update: a hook-written organization outside the scope is refused over the matched rows, and nothing is stored', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => predicate(b, 'qa_account', { target_org: OTHER_ORG }));

      expectTenantRefusal(outcome, 'update');
      expect(b.hookWrites.length, 'the per-row hook ran').toBeGreaterThan(0);
      expect(await b.table('qa_account')).toEqual(SEEDED);
    });

    it('with a business `check` installed beside it: the check admits the row, and the wall still refuses it (one composed seam)', async () => {
      const b = await boot(makeDriver);

      const byIdOutcome = await attempt(() => byId(b, 'qa_checked', { id: 'r1', name: 'allowed', target_org: OTHER_ORG }));
      expectTenantRefusal(byIdOutcome, 'update', 'qa_checked');
      const insertOutcome = await attempt(() => insert(b, 'qa_checked', { id: 'r3', name: 'allowed', target_org: OTHER_ORG }));
      expectTenantRefusal(insertOutcome, 'insert', 'qa_checked');

      expect(await b.table('qa_checked')).toEqual(SEEDED);
    });

    it('`group` posture: a hook-written organization outside the membership set is refused, and one inside it is admitted', async () => {
      const b = await boot(makeDriver, 'group');

      expectTenantRefusal(
        await attempt(() => byId(b, 'qa_account', { id: 'r1', target_org: OTHER_ORG }, GROUP_CTX)),
        'update',
      );
      expect(await b.table('qa_account')).toEqual(SEEDED);

      expectAdmitted(await attempt(() => byId(b, 'qa_account', { id: 'r1', target_org: SISTER_ORG }, GROUP_CTX)));
      expect((await b.table('qa_account'))[0]).toEqual({ id: 'r1', name: 'one', organization_id: SISTER_ORG });
    });
  });

  describe(`[#20013] fail-closed — ${driverName}`, () => {
    it('a host that never runs the installed wall judgement does not have its write vouched for', async () => {
      const b = await boot(makeDriver);
      // A middleware INSIDE the security one takes the installed judgement off
      // the operation before the engine sees it: the shape of a host that runs
      // the write without the seam. No business `check` applies to
      // `qa_account`, so the judgement it removes is the wall's alone, and
      // the payload would PASS it: the refusal is about the judgement not
      // running, not about values.
      let seen: { honoured?: boolean } | undefined;
      b.engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx.operation === 'update' && opCtx.postHookWriteImageCheck) {
          seen = opCtx.postHookWriteImageCheck;
          delete opCtx.postHookWriteImageCheck;
        }
        await next();
      });

      const outcome = await attempt(() => byId(b, 'qa_account', { id: 'r1', name: 'renamed' }));

      expect(outcome.ok, 'an unjudged write must not be reported as an allowed one').toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.developerMessage).toContain(
        "the update on 'qa_account' was executed without the Layer 0 tenant wall being evaluated on the stored row",
      );
      expect(seen, 'the judgement was installed with no business check in play').toBeTruthy();
      expect(seen?.honoured).not.toBe(true);
    });
  });

  describe(`[#20013] controls — ${driverName}`, () => {
    it('⭐ an in-scope hook write is admitted and stored on every path', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() => byId(b, 'qa_account', { id: 'r1', name: 'renamed', target_org: OWN_ORG })));
      expectAdmitted(await attempt(() => insert(b, 'qa_account', { id: 'r3', name: 'new', target_org: OWN_ORG })));
      expectAdmitted(await attempt(() => predicate(b, 'qa_account', { target_org: OWN_ORG })));

      expect(await b.table('qa_account')).toEqual([
        { id: 'r1', name: 'renamed', organization_id: OWN_ORG },
        { id: 'r2', name: 'two', organization_id: OWN_ORG },
        { id: 'r3', name: 'new', organization_id: OWN_ORG },
      ]);
    });

    it('a SUPPLIED out-of-scope organization_id is refused before anything runs, as before', async () => {
      const b = await boot(makeDriver);

      expectTenantRefusal(await attempt(() => byId(b, 'qa_account', { id: 'r1', organization_id: OTHER_ORG })), 'update');
      expectTenantRefusal(await attempt(() => insert(b, 'qa_account', { id: 'r3', name: 'x', organization_id: OTHER_ORG })), 'insert');
      expect(b.hookWrites, 'refused before the hook chain').toEqual([]);
      expect(await b.table('qa_account')).toEqual(SEEDED);
    });

    it('only refuses MORE: a supplied out-of-scope value stays refused even when a hook would replace it with an in-scope one', async () => {
      const b = await boot(makeDriver);

      expectTenantRefusal(
        await attempt(() => byId(b, 'qa_account', { id: 'r1', organization_id: OTHER_ORG, target_org: OWN_ORG })),
        'update',
      );
      expect(await b.table('qa_account')).toEqual(SEEDED);
    });

    it('⭐ an update that does not touch the column is admitted on both update paths (the stored row keeps its organization)', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() => byId(b, 'qa_account', { id: 'r2', name: 'second' })));
      expectAdmitted(await attempt(() => predicate(b, 'qa_account', { name: 'first' })));

      expect(await b.table('qa_account')).toEqual([
        { id: 'r1', name: 'first', organization_id: OWN_ORG },
        { id: 'r2', name: 'second', organization_id: OWN_ORG },
      ]);
    });

    it('⭐ an insert that leaves the column to the platform is admitted and lands in the caller’s organization (an absent value is never judged)', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() => insert(b, 'qa_account', { id: 'r3', name: 'new' })));

      expect((await b.table('qa_account'))[2]).toEqual({ id: 'r3', name: 'new', organization_id: OWN_ORG });
    });

    it('⭐ a platform administrator on a posture-permitting object is exempt, as today', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() => byId(b, 'qa_vault', { id: 'r1', target_org: OTHER_ORG }, ADMIN_CTX)));

      expect((await b.table('qa_vault'))[0]).toEqual({ id: 'r1', name: 'one', organization_id: OTHER_ORG });
    });

    it('⭐ a system-context write is ungated, as today', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() => byId(b, 'qa_account', { id: 'r1', target_org: OTHER_ORG }, SYS_CTX)));

      expect((await b.table('qa_account'))[0]).toEqual({ id: 'r1', name: 'one', organization_id: OTHER_ORG });
    });

    it('⭐ the `single` posture is unchanged: no wall, so the hook write lands', async () => {
      const b = await boot(makeDriver, 'single');

      expectAdmitted(await attempt(() => byId(b, 'qa_account', { id: 'r1', target_org: OTHER_ORG })));

      expect((await b.table('qa_account'))[0]).toEqual({ id: 'r1', name: 'one', organization_id: OTHER_ORG });
    });
  });

  describe(`[#20013] the ADR-0094 permission-set data door — ${driverName}`, () => {
    // The data door executes an insert/update of `sys_permission_set` ITSELF,
    // through the metadata protocol, and never calls `next()`: no engine
    // write, so no hook chain and no seam. Measured on the base: a platform
    // administrator's insert under the `isolated` posture is admitted while
    // Layer 0 walls the object (`organization_id = <active org>`).
    it('⭐ a platform administrator’s permission-set insert under a walled posture is still admitted', async () => {
      const engine = new ObjectQL();
      engine.registerDriver(makeDriver() as never, true);
      await engine.init();
      engine.registerApp({
        id: 'com.objectstack.qa.tenant-wall-post-hook-image.data-door',
        name: 'Data door under a walled posture',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SysPermissionSet],
      } as never);
      await engine.syncSchemas();
      engines.push(engine);
      const saved = new Map<string, unknown>();
      const protocol = {
        registerMutationProjector() { /* not exercised here */ },
        async saveMetaItem(req: { name: string; item: unknown }) { saved.set(req.name, req.item); return { success: true }; },
        async deleteMetaItem() { return { success: true }; },
        async getMetaItemLayered(req: { name: string }) {
          const body = saved.get(req.name) ?? null;
          return { type: 'permission', name: req.name, code: null, overlay: body, overlayScope: null, effective: body };
        },
      };
      const services: Record<string, unknown> = {
        manifest: { register: vi.fn() },
        objectql: engine,
        protocol,
        metadata: {
          get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
          list: async () => [...defaultPermissionSets],
        },
        'org-scoping': { name: 'com.objectstack.org-scoping' },
        tenancy: { posture: 'isolated' },
      };
      const ctx = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: (name: string) => {
          if (!(name in services)) throw new Error(`service not registered: ${name}`);
          return services[name];
        },
      };
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      await plugin.init(ctx as never);
      await plugin.start(ctx as never);
      vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
      let engineWriteRan = false;
      engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx.object === 'sys_permission_set' && opCtx.operation === 'insert' && !opCtx.context?.isSystem) {
          engineWriteRan = true;
        }
        await next();
      });

      const outcome = await attempt(() =>
        engine.insert('sys_permission_set', { name: 'door_set', label: 'Door set' } as never, { context: ADMIN_CTX } as never));

      expectAdmitted(outcome);
      expect(engineWriteRan, 'the data door executed the write itself').toBe(false);
      expect(saved.has('door_set'), 'the definition reached the metadata store').toBe(true);
    });
  });
}
