// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0123 D2 · ADR-0105 D2/D5] A tenant-scoped INSERT from a session with no
 * active organization gets the ADR-0123 D2 refusal under EVERY walled posture,
 * `group` included — measured on the real stack (ObjectQL + SqlDriver +
 * SecurityPlugin), never a 500 and never a row.
 *
 * ## The rule
 *
 * Under `group` the caller's membership set (`accessible_org_ids`) bounds what
 * it may READ (ADR-0105 D2), and a new row lands in the ACTIVE organization,
 * the default write target the engine stamps from `tenantId` (ADR-0105 D5). A
 * session with no active organization therefore has no organization to place a
 * new row in. ADR-0123 D2 answers that state with `403 PERMISSION_DENIED`, a
 * message naming the missing active organization, and `isolated` always did.
 *
 * `group` used to let that insert through the Layer 0 wall, whose scope test
 * reads the membership set there, and the engine then refused the row as an
 * organization-less SYSTEM write (`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`,
 * status 500). Nothing was stored, so it failed closed; the defect was the
 * answer. The wall now judges the stored image in that case and refuses it
 * with the same D2 answer, before the engine is reached.
 *
 * ## What this file pins
 *
 * - `group`: refused with the D2 answer, and no row is stored;
 * - `isolated` (control, unchanged): the same context gets the same answer —
 *   the two outcomes are compared whole, so "exactly what `isolated` answers"
 *   is measured rather than restated;
 * - `group` (control): the same member WITH an active organization is
 *   admitted, and the row lands in that organization;
 * - `group` (control): a session with NO membership at all keeps the D2
 *   refusal it already had;
 * - `group` (control): reads with no active organization still span the
 *   membership set — the posture's design, untouched.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

/** Two organizations the member belongs to, and one it does not. */
const OWN_ORG = 'org_a';
const SISTER_ORG = 'org_c';
const OTHER_ORG = 'org_b';

/** A public tenant object: the platform injects `organization_id`, so Layer 0 walls it. */
const OBJECTS = [
  {
    name: 'qa_task',
    label: 'Task',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
    },
  },
];

/** Plain CRUD and no row-level policy — Layer 0 is the only enforcer under test. */
const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: OWN_ORG };

/**
 * The subject: an authenticated member of two organizations whose session has
 * no active organization. ONE context for every posture, so the `isolated`
 * control differs from the `group` case in the posture alone.
 */
const NO_ACTIVE_ORG_CTX = {
  userId: 'usr_a',
  positions: [],
  permissions: [],
  posture: 'MEMBER',
  accessible_org_ids: [OWN_ORG, SISTER_ORG],
};
/** The same member one `set-active` later — the single-fact control. */
const ACTIVE_ORG_CTX = { ...NO_ACTIVE_ORG_CTX, tenantId: OWN_ORG };
/** A session that belongs to no organization at all. */
const NO_MEMBERSHIP_CTX = { userId: 'usr_z', positions: [], permissions: [], posture: 'MEMBER', accessible_org_ids: [] };

type Posture = 'isolated' | 'group';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  /** The table read straight off the driver, past every scope. */
  table: () => Promise<Array<Record<string, unknown>>>;
}

const SEEDED = [
  { id: 'r1', name: 'own', organization_id: OWN_ORG },
  { id: 'r2', name: 'other', organization_id: OTHER_ORG },
  { id: 'r3', name: 'sister', organization_id: SISTER_ORG },
];

async function boot(posture: Posture): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.no-active-organization-insert-union-scope',
    name: 'No active organization, union-scope posture',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // The posture the package's other real-stack posture pins boot: the
  // `org-scoping` sentinel activates the wall and `tenancy` names the posture,
  // which SecurityPlugin also hands the engine (`setTenancyPostureProvider`).
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER],
    },
    'org-scoping': { name: 'com.objectstack.org-scoping' },
    tenancy: { posture },
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

  await engine.insert('qa_task', SEEDED.map((r) => ({ ...r })), { context: SYS_CTX } as never);

  const table = async () => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver('qa_task');
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex('qa_task').select('id', 'name', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { engine, table };
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

const create = (b: Booted, data: unknown, context: object) =>
  b.engine.insert('qa_task', data as never, { context } as never);

/** The ADR-0123 D2 answer on the ADR-0112 envelope: `code` + `status`, then the D4 naming. */
const expectNoActiveOrganizationRefusal = (outcome: Outcome) => {
  expect(outcome.ok, 'expected a refusal, got a completed write').toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  // ADR-0123 D4: the refusal names what is missing, so it cannot be mistaken
  // for an ordinary permission denial.
  expect(outcome.message).toMatch(/no active organization/i);
};

describe('[ADR-0123 D2] a tenant-scoped insert from a session with no active organization — real stack', () => {
  it('group: is refused 403 PERMISSION_DENIED naming the missing active organization, and stores nothing', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => create(b, { id: 'n1', name: 'new' }, NO_ACTIVE_ORG_CTX));

    expectNoActiveOrganizationRefusal(outcome);
    expect(await b.table(), 'no row stored, NULL-organization or otherwise').toEqual(SEEDED);
  });

  it('group: a bulk insert is refused as a whole, and stores nothing', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => create(b, [{ id: 'n1', name: 'a' }, { id: 'n2', name: 'b' }], NO_ACTIVE_ORG_CTX));

    expectNoActiveOrganizationRefusal(outcome);
    expect(await b.table()).toEqual(SEEDED);
  });

  it('isolated (control, unchanged): the same context gets the same refusal, and group answers exactly what isolated answers', async () => {
    const isolated = await boot('isolated');
    const group = await boot('group');

    const isolatedOutcome = await attempt(() => create(isolated, { id: 'n1', name: 'new' }, NO_ACTIVE_ORG_CTX));
    const groupOutcome = await attempt(() => create(group, { id: 'n1', name: 'new' }, NO_ACTIVE_ORG_CTX));

    expectNoActiveOrganizationRefusal(isolatedOutcome);
    expect(await isolated.table()).toEqual(SEEDED);
    expect(groupOutcome, 'group answers exactly what isolated answers').toEqual(isolatedOutcome);
  });

  it('group (control): the same member WITH an active organization is admitted, and the row lands in it', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => create(b, { id: 'n1', name: 'new' }, ACTIVE_ORG_CTX));

    expect(outcome, 'expected the write to be admitted').toEqual({ ok: true });
    expect(await b.table()).toEqual([{ id: 'n1', name: 'new', organization_id: OWN_ORG }, ...SEEDED]);
  });

  it('group (control): a session with no membership at all keeps the D2 refusal', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => create(b, { id: 'n1', name: 'new' }, NO_MEMBERSHIP_CTX));

    expectNoActiveOrganizationRefusal(outcome);
    expect(await b.table()).toEqual(SEEDED);
  });

  it('group (control): reads with no active organization still span the membership set', async () => {
    const b = await boot('group');

    const rows = (await b.engine.find('qa_task', { context: NO_ACTIVE_ORG_CTX } as never)) as Array<Record<string, unknown>>;

    expect(rows.map((r) => r.id).sort()).toEqual(['r1', 'r3']);
  });
});
