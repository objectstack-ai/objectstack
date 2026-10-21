// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21666] A create that NAMES an organization meets the Layer 0 write wall —
 * the same wall, with the same answer, as the update that re-points one.
 *
 * ## The defect this pins shut
 *
 * Middleware A (this package's insert stamp) used to OVERWRITE a supplied
 * `organization_id` with the caller's active organization in every user
 * context. Measured over `POST /api/v1/data/:object` on a walled boot with
 * this package mounted: a create naming another tenant's organization answered
 * 201 and stored the row in the caller's own organization, while the PATCH
 * that names the same organization and the array insert (which the stamp never
 * touched) were both refused `403 PERMISSION_DENIED`. One operation, two
 * answers, and the caller of the 201 had no way to tell its input had been
 * replaced.
 *
 * The stamp now FILLS an absent value only (ADR-0105 D5). A supplied value
 * goes on to `@objectstack/plugin-security`'s Layer 0 write wall (step 3.7,
 * ADR-0095 D1), which is what the PATCH meets.
 *
 * ## What is real here
 *
 * The engine (`ObjectQL`), the driver (`SqliteWasmDriver`, the one `objectstack
 * dev` uses), THIS package's `OrganizationsPlugin` — registered as the
 * `org-scoping` service and installing its middleware first, the order
 * `objectstack serve` mounts it in — and the real `SecurityPlugin`. Nothing
 * stands in for either middleware. The fixture is the plugin context: a
 * service map carrying the engine, a metadata reader over it, the two
 * permission sets below, and the `tenancy` service's resolved posture.
 * `ensureDefaultOrganization` is switched off because it bootstraps
 * `sys_*` rows this engine does not register; it installs nothing the insert
 * path reads.
 *
 * ## The two object shapes
 *
 * - `qa_assignment` DECLARES its own `organization_id`, the shape of
 *   `sys_user_permission_set`, where the defect was measured: nothing but the
 *   wall stands between a supplied value and the stored row.
 * - `qa_ledger` carries the platform-injected `organization_id`, the shape of
 *   every app object. The column is `readonly`, and [#24822] the engine's
 *   static-`readonly` strip leaves a non-system caller's explicit value on the
 *   row only where the wall judges it: the wall's seam declares
 *   `judgesOrganization`. There an admitted value is stored as sent and a
 *   refused one never reaches the strip. Everywhere else, the strip takes the
 *   value exactly as before. Those paths are a `single` boot, a stack without
 *   the security plugin, a platform operator crossing the wall, and a seam
 *   that carries a business `check` alone. The last block pins both halves.
 *
 * ## [#21682] The stamp is not a caller write
 *
 * The last block pins the report half of the same seam: a create that names
 * no organization is filled by Middleware A, and `droppedFields` (the REST
 * create doors collect it through the `onFieldsDropped` listener driven here)
 * must not name that fill as a key the caller sent. A key the caller DID send
 * is still reported, and the array insert and the `single` posture answer
 * as they did before.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SecurityPlugin } from '@objectstack/plugin-security';
import type { PermissionSet } from '@objectstack/spec/security';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { OrganizationsPlugin } from './organizations-plugin.js';

/** The caller's active organization. */
const OWN_ORG = 'org_alpha';
/** Another tenant — the caller holds no membership in it. */
const FOREIGN_ORG = 'org_north';
/** A sister organization the caller ALSO holds under `group` only. */
const SISTER_ORG = 'org_south';

const DECLARED = 'qa_assignment';
const INJECTED = 'qa_ledger';
const PRIVATE = 'qa_vault';
const UNWALLED = 'qa_catalog';

const OBJECTS = [
  {
    name: DECLARED,
    label: 'Assignment',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      organization_id: { name: 'organization_id', type: 'text' },
    },
  },
  {
    name: INJECTED,
    label: 'Ledger',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
    },
  },
  // [#24822] A PRIVATE object, also on the injected column: its posture lets a
  // platform operator CROSS the wall (ADR-0095 D3), so the wall judges no
  // organization for that caller there.
  {
    name: PRIVATE,
    label: 'Vault',
    access: { default: 'private' },
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
    },
  },
  // [#24822] Tenancy switched off, and an AUTHORED read-only `organization_id`:
  // Layer 0 composes nothing on it, so no wall judges the column.
  {
    name: UNWALLED,
    label: 'Catalog',
    tenancy: { enabled: false },
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      organization_id: { name: 'organization_id', type: 'text', readonly: true },
    },
  },
];

/** Plain CRUD and no row-level policy — the wall is the only thing judging the organization. */
const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/**
 * [#24822] The same member under a business insert `check` on the injected-column
 * object. Step 3.6 then installs the stored-image seam on its own, with no wall
 * behind it wherever the posture composes none.
 */
const MEMBER_WITH_CHECK: PermissionSet = {
  ...MEMBER,
  rowLevelSecurity: [
    { name: 'ledger_not_blocked', object: INJECTED, operation: 'insert', check: "record.name != 'blocked'" },
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

const SYS_CTX = { isSystem: true };
const MEMBER_CTX = { userId: 'usr_member', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
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

/**
 * [#24822] What an insert's stored-image seam looked like once every middleware
 * had run: whether one was installed, and whether it declared that it judges
 * the organization (`PostHookWriteImageCheck.judgesOrganization`).
 */
interface SeamSighting { installed: boolean; judgesOrganization: unknown }

interface Booted {
  engine: ObjectQL;
  /** `organization_id` as the engine handed it to the `beforeInsert` chain, per insert. */
  seenByHooks: unknown[];
  /** A table's rows read straight off the driver, past every scope. */
  table: (name: string) => Promise<Array<Record<string, unknown>>>;
  /** [#24822] One sighting per insert that reached the engine. */
  seams: SeamSighting[];
  /** [#24822] Every line the engine logged at WARN. */
  warns: string[];
}

/**
 * `organizations: false` boots without this package, the way `serve` boots the
 * `single` posture — the control for the [#21682] block. [#24822]
 * `security: false` boots without the Layer 0 wall, and `member` replaces the
 * member's permission set.
 */
async function boot(
  posture: Posture = 'isolated',
  {
    organizations: mountOrganizations = true,
    security: mountSecurity = true,
    member = MEMBER,
  }: { organizations?: boolean; security?: boolean; member?: PermissionSet } = {},
): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' } as never) as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.create-explicit-organization-wall',
    name: 'A create naming an organization meets the Layer 0 write wall',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const seenByHooks: unknown[] = [];
  for (const object of [DECLARED, INJECTED]) {
    engine.on('beforeInsert', object, (async (ctx: { input: { data: Record<string, unknown> } }) => {
      seenByHooks.push(ctx.input.data.organization_id);
    }) as never);
  }

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [member, PLATFORM_ADMIN],
    },
    tenancy: { posture },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, service: unknown) => {
      services[name] = service;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    // Lifecycle hooks are recorded and never fired: the membership-policy
    // gate waits on `kernel:bootstrapped`, which belongs to a kernel boot,
    // not to the insert path under test.
    hook: vi.fn(),
  };
  const organizations = mountOrganizations ? new OrganizationsPlugin({ ensureDefaultOrganization: false }) : null;
  const security = mountSecurity ? new SecurityPlugin({ fallbackPermissionSet: 'member_default' }) : null;
  // Kernel order: every init, then every start — organizations first, as `serve` mounts it.
  await organizations?.init(ctx as never);
  await security?.init(ctx as never);
  await organizations?.start(ctx as never);
  await security?.start(ctx as never);
  if (organizations) {
    expect(services['org-scoping'], 'the real runtime is the org-scoping service').toBe(organizations);
  } else {
    expect('org-scoping' in services, 'the control boots without the runtime').toBe(false);
  }
  // The expected refusals log at WARN through the engine's own logger.
  const warns: string[] = [];
  vi.spyOn((engine as unknown as { logger: { warn: (m: unknown) => void } }).logger, 'warn')
    .mockImplementation((m: unknown) => { warns.push(String(m)); });

  // [#24822] Registered LAST, so it runs innermost: every other middleware has
  // installed what it installs on the operation by the time this reads it.
  const seams: SeamSighting[] = [];
  engine.registerMiddleware((async (opCtx: { operation: string; postHookWriteImageCheck?: { judgesOrganization?: unknown } }, next: () => Promise<void>) => {
    if (opCtx.operation === 'insert') {
      seams.push({
        installed: opCtx.postHookWriteImageCheck !== undefined,
        judgesOrganization: opCtx.postHookWriteImageCheck?.judgesOrganization,
      });
    }
    await next();
  }) as never);

  for (const object of [DECLARED, INJECTED]) {
    await engine.insert(object, { id: 'r1', name: 'seeded', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
  }
  seenByHooks.length = 0;
  seams.length = 0;
  warns.length = 0;

  const table = async (name: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  return { engine, seenByHooks, table, seams, warns };
}

interface Outcome { ok: boolean; code?: string; status?: number; message?: string }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status, message: String(err.message ?? e) };
  }
};

const create = (b: Booted, object: string, data: unknown, context: object) =>
  b.engine.insert(object, data as never, { context } as never);
const repoint = (b: Booted, object: string, organization: string, context: object) =>
  b.engine.update(object, { id: 'r1', organization_id: organization } as never, { context } as never);

/** The wall's refusal on the ADR-0112 envelope: code and status, plus the verb it names. */
const expectWallRefusal = (outcome: Outcome, verb: 'insert' | 'update', object: string) => {
  expect(outcome.ok, 'expected a refusal, got a completed write').toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message).toContain(`the ${verb} would place '${object}' in another tenant`);
};

const SEEDED = [{ id: 'r1', organization_id: OWN_ORG }];

const CALLERS: Array<[string, object]> = [
  ['a member', MEMBER_CTX],
  ['a platform administrator', ADMIN_CTX],
];

describe('[#21666] a create naming an organization meets the Layer 0 write wall, as the PATCH does', () => {
  for (const object of [DECLARED, INJECTED]) {
    for (const [who, context] of CALLERS) {
      it(`${who}: a create naming another tenant's organization is refused with the PATCH's code — ${object}`, async () => {
        const b = await boot();

        const created = await attempt(() => create(b, object, { id: 'r2', name: 'new', organization_id: FOREIGN_ORG }, context));
        const patched = await attempt(() => repoint(b, object, FOREIGN_ORG, context));

        expectWallRefusal(created, 'insert', object);
        expectWallRefusal(patched, 'update', object);
        expect({ code: created.code, status: created.status }).toEqual({ code: patched.code, status: patched.status });
        expect(await b.table(object), 'nothing stored, nothing moved').toEqual(SEEDED);
      });
    }

    it(`an array insert naming another tenant's organization gets the single-row answer — ${object}`, async () => {
      const b = await boot();

      const bulk = await attempt(() => create(b, object, [{ id: 'r2', name: 'new', organization_id: FOREIGN_ORG }], ADMIN_CTX));
      const single = await attempt(() => create(b, object, { id: 'r3', name: 'new', organization_id: FOREIGN_ORG }, ADMIN_CTX));

      expectWallRefusal(bulk, 'insert', object);
      expectWallRefusal(single, 'insert', object);
      expect(await b.table(object)).toEqual(SEEDED);
    });

    it(`a create naming no organization is stamped with the active organization before the hooks run — ${object}`, async () => {
      const b = await boot();

      const outcome = await attempt(() => create(b, object, { id: 'r2', name: 'new' }, MEMBER_CTX));

      expect(outcome.ok, outcome.message).toBe(true);
      expect(b.seenByHooks, 'the beforeInsert chain sees the stamp').toEqual([OWN_ORG]);
      expect(await b.table(object)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
    });

    it(`a create naming the caller's own active organization is admitted and stored there — ${object}`, async () => {
      const b = await boot();

      const outcome = await attempt(() => create(b, object, { id: 'r2', name: 'new', organization_id: OWN_ORG }, MEMBER_CTX));

      expect(outcome.ok, outcome.message).toBe(true);
      expect(await b.table(object)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
    });
  }

  // [#2937] The forged-organization insert by an ordinary member stays refused.
  // What refuses it moved: it was the stamp rewriting the value; it is now the
  // Layer 0 wall, loudly, with the row never stored anywhere.
  it('[#2937] a member forging another tenant\'s organization_id on insert is refused, and no row lands in either tenant', async () => {
    const b = await boot();

    const outcome = await attempt(() => create(b, DECLARED, { id: 'r2', name: 'forged', organization_id: FOREIGN_ORG }, MEMBER_CTX));

    expectWallRefusal(outcome, 'insert', DECLARED);
    expect(b.seenByHooks, 'refused before the engine ran its hooks').toEqual([]);
    expect(await b.table(DECLARED)).toEqual(SEEDED);
  });

  it('a system context keeps an explicit cross-organization value — the seed-replay path meets neither the stamp nor the wall', async () => {
    const b = await boot();

    const outcome = await attempt(() => create(b, DECLARED, { id: 'r2', name: 'replayed', organization_id: FOREIGN_ORG }, SYS_CTX));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(await b.table(DECLARED)).toEqual([...SEEDED, { id: 'r2', organization_id: FOREIGN_ORG }]);
  });

  describe('under the `group` posture the wall is the membership set, for the create as for the PATCH', () => {
    const GROUP_MEMBER_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };

    it('a create naming a sister organization the caller holds is admitted and stored THERE, as the PATCH moves the row there', async () => {
      const b = await boot('group');

      const created = await attempt(() => create(b, DECLARED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, GROUP_MEMBER_CTX));
      const patched = await attempt(() => repoint(b, DECLARED, SISTER_ORG, GROUP_MEMBER_CTX));

      expect(created.ok, created.message).toBe(true);
      expect(patched.ok, patched.message).toBe(true);
      expect(await b.table(DECLARED)).toEqual([
        { id: 'r1', organization_id: SISTER_ORG },
        { id: 'r2', organization_id: SISTER_ORG },
      ]);
    });

    it('a create naming an organization outside the membership set is refused with the PATCH\'s code', async () => {
      const b = await boot('group');

      const created = await attempt(() => create(b, DECLARED, { id: 'r2', name: 'new', organization_id: FOREIGN_ORG }, GROUP_MEMBER_CTX));
      const patched = await attempt(() => repoint(b, DECLARED, FOREIGN_ORG, GROUP_MEMBER_CTX));

      expectWallRefusal(created, 'insert', DECLARED);
      expectWallRefusal(patched, 'update', DECLARED);
      expect(await b.table(DECLARED)).toEqual(SEEDED);
    });
  });
});

/**
 * One create with the listener the REST create doors wire
 * (`ObjectStackProtocolImplementation.createData` / `createManyData` hand
 * `onFieldsDropped` to `engine.insert` and answer what it collected as
 * `droppedFields`), so `dropped` is the response's `droppedFields`.
 */
const createReporting = async (b: Booted, object: string, data: unknown, context: object) => {
  const dropped: DroppedFieldsEvent[] = [];
  const outcome = await attempt(() => b.engine.insert(object, data as never, {
    context,
    onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
  } as never));
  return { outcome, dropped };
};

/** [#24822] The engine's read-only WARN lines that name `organization_id`. */
const organizationWarnings = (b: Booted) => b.warns.filter((line) => line.includes("Field 'organization_id'"));

describe('[#21682] droppedFields names only keys the caller sent, so the organization stamp is not one', () => {
  for (const [who, context] of CALLERS) {
    it(`${who}: a walled create naming no organization reports no dropped field, and is stored in the active organization`, async () => {
      const b = await boot();

      const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new' }, context);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped, 'the fill is the platform\'s write, not a key the caller lost').toEqual([]);
      expect(b.seenByHooks, 'the beforeInsert chain still sees the stamp').toEqual([OWN_ORG]);
      expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
    });
  }

  // [#24822] This cell used to pin the report of the key: the strip took the
  // caller's own organization and the stamp put the same value back. The wall
  // judges that value on a walled insert, so it is now stored as sent, and
  // nothing was dropped to report. Its `single` twin below, where no wall
  // judges the column, still reports it.
  it('[#24822] isolated: a caller that sends its own active organization has it stored as sent, and nothing is reported', async () => {
    const b = await boot();

    const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', organization_id: OWN_ORG }, MEMBER_CTX);

    expect(outcome.ok, outcome.message).toBe(true);
    expect(dropped, 'a value stored as sent is not a dropped field').toEqual([]);
    expect(organizationWarnings(b), 'and no read-only WARN names it').toEqual([]);
    expect(b.seenByHooks, 'the beforeInsert chain sees the value the caller sent').toEqual([OWN_ORG]);
    expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
  });

  it('a readonly key the caller sends beside the fill is reported alone', async () => {
    // `created_by` is an injected readonly column. No audit hook stamps it in
    // this composition, so the caller's value is the one the strip takes.
    const b = await boot();

    const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', created_by: 'usr_forged' }, MEMBER_CTX);

    expect(outcome.ok, outcome.message).toBe(true);
    expect(dropped).toEqual([{ object: INJECTED, fields: ['created_by'], reason: 'readonly' }]);
  });

  it('the array insert is unchanged: a row naming no organization reports nothing', async () => {
    const b = await boot();

    const { outcome, dropped } = await createReporting(b, INJECTED, [{ id: 'r2', name: 'new' }], MEMBER_CTX);

    expect(outcome.ok, outcome.message).toBe(true);
    expect(dropped).toEqual([]);
    expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
  });

  describe('the `single` posture, booted without this package, is unchanged', () => {
    it('a create naming no organization reports nothing', async () => {
      const b = await boot('single', { organizations: false });

      const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new' }, MEMBER_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual([]);
      expect(b.seenByHooks, 'no runtime, so no stamp').toEqual([undefined]);
    });

    it('a create naming an organization still reports it as readonly', async () => {
      const b = await boot('single', { organizations: false });

      const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', organization_id: OWN_ORG }, MEMBER_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual([{ object: INJECTED, fields: ['organization_id'], reason: 'readonly' }]);
    });
  });
});

/**
 * [#24822] An explicit `organization_id` on the platform-injected column is
 * stored as sent where the Layer 0 wall judges it, and taken as before
 * everywhere else.
 *
 * The wall has always judged a supplied value (the payload half of step 3.7),
 * and since #20013 it judges the stored row too. But the engine's
 * static-`readonly` strip then took the admitted value (the column declares
 * `readonly: true`), and the driver stamped the active organization in its
 * place: a 2xx, and a row in another organization than the one the caller
 * named and the wall admitted. Now the wall's seam declares that it judges
 * the insert's organization (`judgesOrganization`), and only then does the
 * engine leave the value for that verdict.
 *
 * The negative half is the larger one. Every path where no wall judged the
 * column keeps the strip, the WARN and the `droppedFields` report it had,
 * cell for cell: a `single` boot with and without a business `check` seam,
 * `group` and `isolated` without the security plugin, a tenancy-disabled
 * object with an authored read-only column, a platform operator crossing the
 * wall, and a system context, which the strip never judged. Honouring the
 * value on any of them would store a caller's organization with no wall
 * verdict at all.
 */
describe('[#24822] an explicit organization_id the wall judges is stored as sent; nowhere else is it honoured', () => {
  const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
  const GROUP_ADMIN_CTX = { ...ADMIN_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
  /** A platform operator with NO active organization (ADR-0123 D2 / #24821). */
  const ADMIN_NO_ORG_CTX = { userId: 'usr_admin', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };
  const READONLY_DROP = (object: string) => [{ object, fields: ['organization_id'], reason: 'readonly' }];
  const WALL_JUDGES = [{ installed: true, judgesOrganization: true }];

  const createStrict = (b: Booted, object: string, data: unknown, context: object) =>
    attempt(() => b.engine.insert(object, data as never, { context, strictReadonlyWrites: true } as never));

  /** The strict refusal on its own envelope: the code, the field and the verb. */
  const expectStrictRefusal = async (b: Booted, object: string, data: unknown, context: object) => {
    let thrown: { code?: unknown; fields?: unknown; operation?: unknown } | undefined;
    try {
      await b.engine.insert(object, data as never, { context, strictReadonlyWrites: true } as never);
    } catch (e) {
      thrown = e as typeof thrown;
    }
    expect(thrown, 'expected the strict write to be refused').toBeDefined();
    expect(thrown?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(thrown?.fields).toEqual(['organization_id']);
    expect(thrown?.operation).toBe('insert');
  };

  describe('`group`: the wall is the membership set', () => {
    it('a member\'s create naming a sister organization is stored THERE, with nothing reported', async () => {
      const b = await boot('group');

      const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, GROUP_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped, 'a value stored as sent is not a dropped field').toEqual([]);
      expect(organizationWarnings(b)).toEqual([]);
      expect(b.seenByHooks, 'the beforeInsert chain sees the value that will be stored').toEqual([SISTER_ORG]);
      expect(b.seams, 'the wall declared that it judges the organization').toEqual(WALL_JUDGES);
      expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: SISTER_ORG }]);
    });

    it('the array insert answers the same, row by row, beside a row the stamp fills', async () => {
      const b = await boot('group');

      const { outcome, dropped } = await createReporting(b, INJECTED, [
        { id: 'r2', name: 'named', organization_id: SISTER_ORG },
        { id: 'r3', name: 'left to the stamp' },
      ], GROUP_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual([]);
      expect(organizationWarnings(b)).toEqual([]);
      expect(b.seams).toEqual(WALL_JUDGES);
      expect(await b.table(INJECTED)).toEqual([
        ...SEEDED,
        { id: 'r2', organization_id: SISTER_ORG },
        { id: 'r3', organization_id: OWN_ORG },
      ]);
    });

    it('a create naming an organization outside the membership set is still refused, single and array, and nothing is stored', async () => {
      const b = await boot('group');

      const single = await attempt(() => create(b, INJECTED, { id: 'r2', name: 'new', organization_id: FOREIGN_ORG }, GROUP_CTX));
      const bulk = await attempt(() => create(b, INJECTED, [{ id: 'r3', name: 'new', organization_id: FOREIGN_ORG }], GROUP_CTX));

      expectWallRefusal(single, 'insert', INJECTED);
      expectWallRefusal(bulk, 'insert', INJECTED);
      expect(await b.table(INJECTED)).toEqual(SEEDED);
    });

    it('a create naming no organization is stamped with the active one and reports nothing', async () => {
      const b = await boot('group');

      const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new' }, GROUP_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual([]);
      expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
    });

    it('an in-process strictReadonlyWrites create naming a sister organization is stored, not refused: strict refuses only what the strip takes', async () => {
      const b = await boot('group');

      const outcome = await createStrict(b, INJECTED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, GROUP_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: SISTER_ORG }]);
    });
  });

  describe('`isolated`: the wall is the active organization', () => {
    it('a create naming the active organization is stored as sent, with nothing reported', async () => {
      const b = await boot('isolated');

      const { outcome, dropped } = await createReporting(b, INJECTED, [{ id: 'r2', name: 'new', organization_id: OWN_ORG }], MEMBER_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual([]);
      expect(organizationWarnings(b)).toEqual([]);
      expect(b.seams).toEqual(WALL_JUDGES);
      expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
    });

    it('a create naming any other organization is still refused, single and array, and nothing is stored', async () => {
      const b = await boot('isolated');

      const single = await attempt(() => create(b, INJECTED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, MEMBER_CTX));
      const bulk = await attempt(() => create(b, INJECTED, [{ id: 'r3', name: 'new', organization_id: SISTER_ORG }], MEMBER_CTX));

      expectWallRefusal(single, 'insert', INJECTED);
      expectWallRefusal(bulk, 'insert', INJECTED);
      expect(await b.table(INJECTED)).toEqual(SEEDED);
    });
  });

  describe('where no wall judges the column, the strip takes the value exactly as before', () => {
    it('`single` without this package: taken, reported, and stored in the context\'s organization; no seam', async () => {
      const b = await boot('single', { organizations: false });

      const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, MEMBER_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual(READONLY_DROP(INJECTED));
      expect(organizationWarnings(b)).toHaveLength(1);
      expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined }]);
      expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
    });

    it('`single` with a business insert `check`: its seam is installed and does NOT declare the organization judged, so the value is taken', async () => {
      const b = await boot('single', { organizations: false, member: MEMBER_WITH_CHECK });

      const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, MEMBER_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(b.seams, 'the business check installs a seam with no wall behind it').toEqual([
        { installed: true, judgesOrganization: undefined },
      ]);
      expect(dropped).toEqual(READONLY_DROP(INJECTED));
      expect(organizationWarnings(b)).toHaveLength(1);
      expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
    });

    it('`single` without a wall: an in-process strictReadonlyWrites create naming an organization is still refused, and nothing is stored', async () => {
      const b = await boot('single', { organizations: false });

      await expectStrictRefusal(b, INJECTED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, MEMBER_CTX);
      expect(await b.table(INJECTED)).toEqual(SEEDED);
    });

    for (const posture of ['group', 'isolated'] as const) {
      it(`\`${posture}\` without the security plugin: no wall, so the value is taken and reported, and the stamp's organization is stored`, async () => {
        const b = await boot(posture, { security: false });
        const context = posture === 'group' ? GROUP_CTX : MEMBER_CTX;

        const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, context);

        expect(outcome.ok, outcome.message).toBe(true);
        expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined }]);
        expect(dropped).toEqual(READONLY_DROP(INJECTED));
        expect(organizationWarnings(b)).toHaveLength(1);
        expect(await b.table(INJECTED)).toEqual([...SEEDED, { id: 'r2', organization_id: OWN_ORG }]);
      });

      it(`\`${posture}\`: a platform operator crossing the wall on a private object has the value taken and reported; no seam`, async () => {
        const b = await boot(posture);
        const context = posture === 'group' ? GROUP_ADMIN_CTX : ADMIN_CTX;

        const { outcome, dropped } = await createReporting(b, PRIVATE, { id: 'r2', name: 'new', organization_id: FOREIGN_ORG }, context);

        expect(outcome.ok, outcome.message).toBe(true);
        expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined }]);
        expect(dropped).toEqual(READONLY_DROP(PRIVATE));
        expect(await b.table(PRIVATE)).toEqual([{ id: 'r2', organization_id: OWN_ORG }]);
      });
    }

    it('a platform operator with NO active organization crossing on a private object: its seam does not declare the organization judged, so a named organization is taken and the insert is still refused', async () => {
      const b = await boot('isolated');

      const outcome = await attempt(() => create(b, PRIVATE, { id: 'r2', name: 'new', organization_id: FOREIGN_ORG }, ADMIN_NO_ORG_CTX));

      expect(b.seams, 'the operator\'s seam is installed (#24821) and judges no organization').toEqual([
        { installed: true, judgesOrganization: undefined },
      ]);
      expect(outcome.ok, 'expected the no-active-organization refusal').toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.message).toContain('has no active organization');
      expect(await b.table(PRIVATE)).toEqual([]);
    });

    it('a tenancy-disabled object with an authored read-only organization_id: no wall, so the value is taken and NULL is stored', async () => {
      const b = await boot('group');

      const { outcome, dropped } = await createReporting(b, UNWALLED, { id: 'r2', name: 'new', organization_id: SISTER_ORG }, GROUP_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined }]);
      expect(dropped).toEqual(READONLY_DROP(UNWALLED));
      expect(await b.table(UNWALLED)).toEqual([{ id: 'r2', organization_id: null }]);
    });

    it('a system context stores what it sends on the injected column, as before; it meets neither the stamp, the wall nor the strip', async () => {
      const b = await boot('group');

      const { outcome, dropped } = await createReporting(b, INJECTED, [
        { id: 'r2', name: 'replayed', organization_id: SISTER_ORG },
        { id: 'r3', name: 'replayed', organization_id: FOREIGN_ORG },
      ], SYS_CTX);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual([]);
      expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined }]);
      expect(await b.table(INJECTED)).toEqual([
        ...SEEDED,
        { id: 'r2', organization_id: SISTER_ORG },
        { id: 'r3', organization_id: FOREIGN_ORG },
      ]);
    });
  });
});
