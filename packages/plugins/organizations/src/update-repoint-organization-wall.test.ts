// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24822] An UPDATE that re-points `organization_id` meets the Layer 0 write
 * wall, and gets the wall's answer: a re-point the caller's organization scope
 * admits is STORED as sent, one it does not is refused `403
 * PERMISSION_DENIED`. ⛔ Never silently dropped, and never wider than the wall.
 * The insert half of the same card is `create-explicit-organization-wall.test.ts`.
 *
 * ## The defect this pins shut
 *
 * Under `group`, a member whose active organization is A and whose membership
 * set holds C updated a row of an app object, naming `organization_id: C`. The
 * wall (`@objectstack/plugin-security` step 3.7) judged C and admitted it, on
 * the payload and on the stored image. Then the engine's static-`readonly`
 * update strip took it, because the platform's injected tenant column declares
 * `readonly: true`, and the row stayed in A: a 2xx whose only signals were a
 * `droppedFields` entry and a WARN. A DECLARED-column object stored the same
 * re-point, so the injected-column objects were the inconsistent half.
 *
 * Now step 3.7's seam declares `judgesOrganization` on a single-payload update
 * too, and the engine leaves the re-point on the row for the wall's verdict,
 * by id and by predicate, through one helper shared with the insert half.
 *
 * ## What is real here
 *
 * The engine (`ObjectQL`), the driver (`SqliteWasmDriver`), THIS package's
 * `OrganizationsPlugin` registered as the `org-scoping` service, and the real
 * `SecurityPlugin`: the stack the insert half measured on. An innermost probe
 * middleware records each update's seam and the organizations it judged.
 *
 * ## The matrix
 *
 * - `group`: a re-point to C stored, by id and by predicate, nothing reported,
 *   shown to `beforeUpdate`; D refused; strict stores C; a member with NO
 *   active organization re-points the same way.
 * - `isolated`: naming the active organization is stored and not reported;
 *   another one is refused.
 * - [#22278] an EMPTIED organization (`null`, `''`) stays refused on both
 *   paths, under both postures, and no stamp refills it.
 * - An ARRAY update payload, where step 3.7 composes no seam: no spare.
 * - The gates kept: the falsy payload id beside `where.id` (#19989), and the
 *   step 2.7 pre-image selection (a row outside the scope is never re-pointed
 *   into it).
 * - F4: an AUTHORED read-only `organization_id` keeps the strip.
 * - Every path where no wall judges the column keeps the strip, cell for cell:
 *   `single` with and without a business `check`, `single` under strict,
 *   `group` and `isolated` without the security plugin, a platform operator
 *   crossing the wall, a tenancy-disabled object, and `preserveAudit`, whose
 *   update-only exemption never reaches `organization_id`. A system context
 *   never met the strip.
 * - The `update`-mode `validate()` preview runs no middleware, so it is
 *   wall-blind: it still reports the drop of an admitted re-point.
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
/** A sister organization the caller ALSO holds under `group` only. */
const SISTER_ORG = 'org_south';
/** Another tenant: the caller holds no membership in it. */
const FOREIGN_ORG = 'org_north';

const DECLARED = 'qa_assignment';
const INJECTED = 'qa_ledger';
const PRIVATE = 'qa_vault';
const UNWALLED = 'qa_catalog';
const AUTHORED = 'qa_authored';

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
  {
    name: PRIVATE,
    label: 'Vault',
    access: { default: 'private' },
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
    },
  },
  {
    name: AUTHORED,
    label: 'Authored',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      organization_id: { name: 'organization_id', type: 'text', readonly: true },
    },
  },
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

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/** The same member under a business update `check`: step 3.6 then installs a seam of its own. */
const MEMBER_WITH_CHECK: PermissionSet = {
  ...MEMBER,
  rowLevelSecurity: [
    { name: 'ledger_not_blocked', object: INJECTED, operation: 'update', check: "record.name != 'blocked'" },
  ],
} as unknown as PermissionSet;

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
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const GROUP_NO_ACTIVE_ORG_CTX = { userId: 'usr_member', positions: [], permissions: [], posture: 'MEMBER', accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ADMIN_CTX = { userId: 'usr_admin', tenantId: OWN_ORG, positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };
const GROUP_ADMIN_CTX = { ...ADMIN_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };

type Posture = 'isolated' | 'group' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** What one update's stored-image seam looked like, and the organizations it judged. */
interface SeamSighting { installed: boolean; judgesOrganization: unknown; judged: unknown[] | null }

interface Booted {
  engine: ObjectQL;
  /** `organization_id` as the engine handed it to `beforeUpdate`: `'absent'` when not on the payload. */
  seenByHooks: unknown[];
  table: (name: string) => Promise<Array<Record<string, unknown>>>;
  seams: SeamSighting[];
  warns: string[];
}

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
    id: 'com.objectstack.qa.update-repoint-organization-wall',
    name: 'An update re-pointing an organization meets the Layer 0 write wall',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const seenByHooks: unknown[] = [];
  for (const { name } of OBJECTS) {
    engine.on('beforeUpdate', name, (async (ctx: { input: { data: Record<string, unknown> } }) => {
      const data = ctx.input.data;
      seenByHooks.push(Object.prototype.hasOwnProperty.call(data, 'organization_id') ? data.organization_id : 'absent');
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
    hook: vi.fn(),
  };
  const organizations = mountOrganizations ? new OrganizationsPlugin({ ensureDefaultOrganization: false }) : null;
  const security = mountSecurity ? new SecurityPlugin({ fallbackPermissionSet: 'member_default' }) : null;
  await organizations?.init(ctx as never);
  await security?.init(ctx as never);
  await organizations?.start(ctx as never);
  await security?.start(ctx as never);
  const warns: string[] = [];
  vi.spyOn((engine as unknown as { logger: { warn: (m: unknown) => void } }).logger, 'warn')
    .mockImplementation((m: unknown) => { warns.push(String(m)); });

  // Registered LAST, so it runs innermost: every other middleware has
  // installed what it installs by the time this reads it.
  const seams: SeamSighting[] = [];
  engine.registerMiddleware((async (
    opCtx: { operation: string; postHookWriteImageCheck?: { judgesOrganization?: unknown; evaluate: (rows: readonly Record<string, unknown>[]) => unknown } },
    next: () => Promise<void>,
  ) => {
    if (opCtx.operation === 'update') {
      const sighting: SeamSighting = {
        installed: opCtx.postHookWriteImageCheck !== undefined,
        judgesOrganization: opCtx.postHookWriteImageCheck?.judgesOrganization,
        judged: null,
      };
      seams.push(sighting);
      const seam = opCtx.postHookWriteImageCheck;
      if (seam) {
        const evaluate = seam.evaluate.bind(seam);
        seam.evaluate = (rows) => {
          sighting.judged = rows.map((row) => row?.organization_id);
          return evaluate(rows);
        };
      }
    }
    await next();
  }) as never);

  for (const { name } of OBJECTS) {
    await engine.insert(name, { id: 'r1', name: 'seeded', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
  }
  // [step 2.7] A row OUTSIDE the caller's scope, which no re-point may pull in.
  await engine.insert(INJECTED, { id: 'r9', name: 'elsewhere', organization_id: FOREIGN_ORG }, { context: SYS_CTX } as never);
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

/**
 * One update with the listener the REST update doors wire, so `dropped` is
 * the response's `droppedFields`. `by: 'id'` updates `r1` by its id;
 * `by: 'predicate'` updates every row named `seeded` through `multi: true`.
 */
const repoint = async (
  b: Booted,
  object: string,
  organization: unknown,
  context: object,
  by: 'id' | 'predicate',
  extra: Record<string, unknown> = {},
) => {
  const dropped: DroppedFieldsEvent[] = [];
  const onFieldsDropped = (e: DroppedFieldsEvent) => { dropped.push(e); };
  const outcome = await attempt(() => by === 'id'
    ? b.engine.update(object, { id: 'r1', organization_id: organization } as never, { context, onFieldsDropped, ...extra } as never)
    : b.engine.update(object, { organization_id: organization } as never, { where: { name: 'seeded' }, multi: true, context, onFieldsDropped, ...extra } as never));
  return { outcome, dropped };
};

/** The engine's read-only WARN lines that name `organization_id`. */
const organizationWarnings = (b: Booted) => b.warns.filter((line) => line.includes("Field 'organization_id'"));

const READONLY_DROP = (object: string) => [{ object, fields: ['organization_id'], reason: 'readonly' }];
const SEEDED = (object: string, organization: string = OWN_ORG) =>
  object === INJECTED
    ? [{ id: 'r1', organization_id: organization }, { id: 'r9', organization_id: FOREIGN_ORG }]
    : [{ id: 'r1', organization_id: organization }];
const PATHS = ['id', 'predicate'] as const;

const expectWallRefusal = (outcome: Outcome, object: string) => {
  expect(outcome.ok, 'expected a refusal, got a completed write').toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message).toContain(`the update would place '${object}' in another tenant`);
};

const expectEmptiedRefusal = (outcome: Outcome, object: string) => {
  expect(outcome.ok, 'expected a refusal, got a completed write').toBe(false);
  expect(outcome.code).toBe('PERMISSION_DENIED');
  expect(outcome.status).toBe(403);
  expect(outcome.message).toContain(`the update would leave '${object}' with no organization`);
};

/** The wall judged the stored image, declared it, and saw `organization` on it. */
const judgedAs = (organization: string): SeamSighting[] => [{ installed: true, judgesOrganization: true, judged: [organization] }];

describe('[#24822] `group`: a re-point the membership set admits is stored as sent', () => {
  for (const by of PATHS) {
    it(`by ${by}: a re-point to a sister organization is stored THERE, shown to beforeUpdate, and nothing is reported`, async () => {
      const b = await boot('group');

      const { outcome, dropped } = await repoint(b, INJECTED, SISTER_ORG, GROUP_CTX, by);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED, SISTER_ORG));
      expect(dropped, 'a value stored as sent is not a dropped field').toEqual([]);
      expect(organizationWarnings(b)).toEqual([]);
      expect(b.seenByHooks, 'beforeUpdate sees the organization that will be stored').toEqual([SISTER_ORG]);
      expect(b.seams, 'the wall judged the stored image and declared it').toEqual(judgedAs(SISTER_ORG));
    });

    it(`by ${by}: a re-point outside the membership set is still refused, and nothing moves`, async () => {
      const b = await boot('group');

      const { outcome } = await repoint(b, INJECTED, FOREIGN_ORG, GROUP_CTX, by);

      expectWallRefusal(outcome, INJECTED);
      expect(b.seenByHooks, 'refused before the engine ran its hooks').toEqual([]);
      expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
    });

    it(`by ${by}: an in-process strictReadonlyWrites re-point to a sister organization is stored, not refused`, async () => {
      const b = await boot('group');

      const { outcome } = await repoint(b, INJECTED, SISTER_ORG, GROUP_CTX, by, { strictReadonlyWrites: true });

      expect(outcome.ok, outcome.message).toBe(true);
      expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED, SISTER_ORG));
    });
  }

  it('naming the row\'s own organization is stored as sent and no longer reported', async () => {
    const b = await boot('group');

    const { outcome, dropped } = await repoint(b, INJECTED, OWN_ORG, GROUP_CTX, 'id');

    expect(outcome.ok, outcome.message).toBe(true);
    expect(dropped).toEqual([]);
    expect(organizationWarnings(b)).toEqual([]);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
  });

  it('a member with NO active organization re-points within its membership set the same way; outside it, refused', async () => {
    const b = await boot('group');

    const admitted = await repoint(b, INJECTED, SISTER_ORG, GROUP_NO_ACTIVE_ORG_CTX, 'id');
    expect(admitted.outcome.ok, admitted.outcome.message).toBe(true);
    expect(admitted.dropped).toEqual([]);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED, SISTER_ORG));

    const refused = await repoint(b, INJECTED, FOREIGN_ORG, GROUP_NO_ACTIVE_ORG_CTX, 'id');
    expectWallRefusal(refused.outcome, INJECTED);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED, SISTER_ORG));
  });

  it('CONTROL: a DECLARED-column object already stored the same re-point, by id and by predicate', async () => {
    const b = await boot('group');

    const viaId = await repoint(b, DECLARED, SISTER_ORG, GROUP_CTX, 'id');
    expect(viaId.outcome.ok, viaId.outcome.message).toBe(true);
    const viaPredicate = await repoint(b, DECLARED, OWN_ORG, GROUP_CTX, 'predicate');
    expect(viaPredicate.outcome.ok, viaPredicate.outcome.message).toBe(true);
    expect([...viaId.dropped, ...viaPredicate.dropped]).toEqual([]);
    expect(await b.table(DECLARED)).toEqual(SEEDED(DECLARED));
  });

  it('[step 2.7] a row outside the scope is never re-pointed into it: the scoped selection does not reach it', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => b.engine.update(INJECTED, { id: 'r9', organization_id: SISTER_ORG } as never, { context: GROUP_CTX } as never));

    expect(outcome.ok, 'expected the row outside the scope to be unreachable').toBe(false);
    expect(outcome.code).toBe('RECORD_NOT_FOUND');
    expect(outcome.status).toBe(404);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
  });

  it('[#19989] a falsy payload id beside where.id is refused, and nothing moves', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => b.engine.update(INJECTED, { id: '', organization_id: SISTER_ORG } as never, { where: { id: 'r1' }, context: GROUP_CTX } as never));

    expect(outcome.ok, 'expected a refusal').toBe(false);
    expect(outcome.code).toBe('PERMISSION_DENIED');
    expect(outcome.status).toBe(403);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
  });
});

describe('[#24822] `isolated`: the wall is the active organization', () => {
  for (const by of PATHS) {
    it(`by ${by}: naming the active organization is stored as sent, with nothing reported`, async () => {
      const b = await boot('isolated');

      const { outcome, dropped } = await repoint(b, INJECTED, OWN_ORG, MEMBER_CTX, by);

      expect(outcome.ok, outcome.message).toBe(true);
      expect(dropped).toEqual([]);
      expect(organizationWarnings(b)).toEqual([]);
      expect(b.seams).toEqual(judgedAs(OWN_ORG));
      expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
    });

    it(`by ${by}: a re-point to any other organization is still refused, and nothing moves`, async () => {
      const b = await boot('isolated');

      const { outcome } = await repoint(b, INJECTED, SISTER_ORG, MEMBER_CTX, by);

      expectWallRefusal(outcome, INJECTED);
      expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
    });
  }
});

describe('[#22278] an EMPTIED organization stays refused on update, and no stamp refills it', () => {
  for (const posture of ['group', 'isolated'] as const) {
    for (const by of PATHS) {
      for (const emptied of [null, ''] as const) {
        it(`\`${posture}\`, by ${by}, ${JSON.stringify(emptied)}: refused, and the row keeps its organization`, async () => {
          const b = await boot(posture);

          const { outcome } = await repoint(b, INJECTED, emptied, posture === 'group' ? GROUP_CTX : MEMBER_CTX, by);

          expectEmptiedRefusal(outcome, INJECTED);
          expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
        });
      }
    }
  }
});

describe('[#24822] an ARRAY update payload: step 3.7 composes no seam, so nothing is spared', () => {
  it('no seam declares the organization judged, the update completes nothing, and the row keeps its organization', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => b.engine.update(INJECTED, [{ organization_id: SISTER_ORG }] as never, { where: { id: 'r1' }, context: GROUP_CTX } as never));

    expect(outcome.ok, 'an array payload is not a write the engine completes').toBe(false);
    expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined, judged: null }]);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
  });
});

describe('[#24822] F4: an AUTHORED read-only organization_id on a walled object keeps the update strip', () => {
  for (const by of PATHS) {
    it(`by ${by}: the wall judges and declares it, and the author's declaration keeps the strip: taken, reported, refused under strict`, async () => {
      const b = await boot('group');

      const { outcome, dropped } = await repoint(b, AUTHORED, SISTER_ORG, GROUP_CTX, by);
      expect(outcome.ok, outcome.message).toBe(true);
      expect(await b.table(AUTHORED), 'the row keeps its organization').toEqual(SEEDED(AUTHORED));
      expect(dropped).toEqual(READONLY_DROP(AUTHORED));
      expect(organizationWarnings(b)).toHaveLength(1);
      expect(b.seams, 'the seam declares it, and the engine still keeps the strip').toEqual(judgedAs(OWN_ORG));

      const strict = await repoint(b, AUTHORED, SISTER_ORG, GROUP_CTX, by, { strictReadonlyWrites: true });
      expect(strict.outcome.code).toBe('ERR_READONLY_FIELD_REJECTED');
      expect(await b.table(AUTHORED)).toEqual(SEEDED(AUTHORED));
    });
  }
});

describe('[#24822] where no wall judges the column, the update strip takes the re-point exactly as before', () => {
  /** Taken, reported, WARNed and withheld from the hook; the row keeps its organization. */
  const expectTaken = async (b: Booted, object: string, result: { outcome: Outcome; dropped: DroppedFieldsEvent[] }) => {
    expect(result.outcome.ok, result.outcome.message).toBe(true);
    expect(await b.table(object), 'the row keeps its organization').toEqual(SEEDED(object));
    expect(result.dropped).toEqual(READONLY_DROP(object));
    expect(organizationWarnings(b)).toHaveLength(1);
    expect(b.seenByHooks, 'withheld from the hook').toEqual(['absent']);
  };

  for (const by of PATHS) {
    it(`\`single\` without this package, by ${by}: taken; no seam`, async () => {
      const b = await boot('single', { organizations: false });

      await expectTaken(b, INJECTED, await repoint(b, INJECTED, SISTER_ORG, MEMBER_CTX, by));
      expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined, judged: null }]);
    });

    it(`\`single\` with a business update \`check\`, by ${by}: its seam is installed and does NOT declare the organization judged, so the re-point is taken`, async () => {
      const b = await boot('single', { organizations: false, member: MEMBER_WITH_CHECK });

      await expectTaken(b, INJECTED, await repoint(b, INJECTED, SISTER_ORG, MEMBER_CTX, by));
      expect(b.seams).toEqual([{ installed: true, judgesOrganization: undefined, judged: [OWN_ORG] }]);
    });

    for (const posture of ['group', 'isolated'] as const) {
      it(`\`${posture}\` without the security plugin, by ${by}: no wall, so the re-point is taken`, async () => {
        const b = await boot(posture, { security: false });

        await expectTaken(b, INJECTED, await repoint(b, INJECTED, SISTER_ORG, posture === 'group' ? GROUP_CTX : MEMBER_CTX, by));
        expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined, judged: null }]);
      });

      it(`\`${posture}\`: a platform operator crossing the wall on a private object, by ${by}: no seam, so the re-point is taken`, async () => {
        const b = await boot(posture);

        await expectTaken(b, PRIVATE, await repoint(b, PRIVATE, FOREIGN_ORG, posture === 'group' ? GROUP_ADMIN_CTX : ADMIN_CTX, by));
        expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined, judged: null }]);
      });
    }
  }

  it('`single` without a wall: an in-process strictReadonlyWrites re-point is still refused, and nothing moves', async () => {
    const b = await boot('single', { organizations: false });

    const { outcome } = await repoint(b, INJECTED, SISTER_ORG, MEMBER_CTX, 'id', { strictReadonlyWrites: true });

    expect(outcome.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED));
  });

  it('a tenancy-disabled object with an authored read-only organization_id: no wall, so the re-point is taken', async () => {
    const b = await boot('group');

    await expectTaken(b, UNWALLED, await repoint(b, UNWALLED, SISTER_ORG, GROUP_CTX, 'id'));
    expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined, judged: null }]);
  });

  it('`preserveAudit`: its update-only exemption never reaches organization_id, so with no wall the re-point is taken', async () => {
    const b = await boot('single', { organizations: false });

    await expectTaken(b, INJECTED, await repoint(b, INJECTED, SISTER_ORG, { ...MEMBER_CTX, preserveAudit: true }, 'id'));
  });

  it('a system context stores what it sends, by id and by predicate, as before: it meets neither the wall nor the strip', async () => {
    const b = await boot('group');

    const viaId = await repoint(b, INJECTED, FOREIGN_ORG, SYS_CTX, 'id');
    expect(viaId.outcome.ok, viaId.outcome.message).toBe(true);
    expect(viaId.dropped).toEqual([]);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED, FOREIGN_ORG));
    expect(b.seams).toEqual([{ installed: false, judgesOrganization: undefined, judged: null }]);
  });
});

describe('[#24822] the `update`-mode validate() preview is wall-blind (it runs no middleware)', () => {
  it('it still reports an admitted re-point as dropped, while the write stores it; and a refused one as dropped, while the write refuses it', async () => {
    const b = await boot('group');

    const admitted = await b.engine.validate(INJECTED, { id: 'r1', organization_id: SISTER_ORG }, { mode: 'update', context: GROUP_CTX as never });
    const refused = await b.engine.validate(INJECTED, { id: 'r1', organization_id: FOREIGN_ORG }, { mode: 'update', context: GROUP_CTX as never });

    expect(admitted.results[0]?.droppedFields).toEqual(READONLY_DROP(INJECTED));
    expect(refused.results[0]?.droppedFields).toEqual(READONLY_DROP(INJECTED));
    const write = await repoint(b, INJECTED, SISTER_ORG, GROUP_CTX, 'id');
    expect(write.outcome.ok, write.outcome.message).toBe(true);
    expect(await b.table(INJECTED)).toEqual(SEEDED(INJECTED, SISTER_ORG));
  });
});
