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
 *   every app object. The engine strips that column from a non-system payload
 *   as `readonly` AFTER the wall has judged it, so here an admitted value is
 *   re-derived, and a refused one never reaches the strip.
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
];

/** Plain CRUD and no row-level policy — the wall is the only thing judging the organization. */
const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
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

interface Booted {
  engine: ObjectQL;
  /** `organization_id` as the engine handed it to the `beforeInsert` chain, per insert. */
  seenByHooks: unknown[];
  /** A table's rows read straight off the driver, past every scope. */
  table: (name: string) => Promise<Array<Record<string, unknown>>>;
}

/**
 * `organizations: false` boots without this package, the way `serve` boots the
 * `single` posture — the control for the [#21682] block.
 */
async function boot(posture: Posture = 'isolated', { organizations: mountOrganizations = true } = {}): Promise<Booted> {
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
      list: async () => [MEMBER, PLATFORM_ADMIN],
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
  const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  // Kernel order: every init, then every start — organizations first, as `serve` mounts it.
  await organizations?.init(ctx as never);
  await security.init(ctx as never);
  await organizations?.start(ctx as never);
  await security.start(ctx as never);
  if (organizations) {
    expect(services['org-scoping'], 'the real runtime is the org-scoping service').toBe(organizations);
  } else {
    expect('org-scoping' in services, 'the control boots without the runtime').toBe(false);
  }
  // The expected refusals log at WARN through the engine's own logger.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  for (const object of [DECLARED, INJECTED]) {
    await engine.insert(object, { id: 'r1', name: 'seeded', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
  }
  seenByHooks.length = 0;

  const table = async (name: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  return { engine, seenByHooks, table };
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

  it('a caller that sends the readonly key itself still sees it reported, the same key the stamp fills', async () => {
    const b = await boot();

    const { outcome, dropped } = await createReporting(b, INJECTED, { id: 'r2', name: 'new', organization_id: OWN_ORG }, MEMBER_CTX);

    expect(outcome.ok, outcome.message).toBe(true);
    expect(dropped).toEqual([{ object: INJECTED, fields: ['organization_id'], reason: 'readonly' }]);
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
