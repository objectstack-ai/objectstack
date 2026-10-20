// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0123 D2/D4 · ADR-0131 D9 · ADR-0095 D3] A PLATFORM OPERATOR whose
 * session has no active organization, inserting into a tenant object whose
 * posture lets it cross the wall, gets the same refusal a member gets —
 * `403 PERMISSION_DENIED` naming the missing active organization — under
 * every walled posture. Measured on the real stack (ObjectQL + SqlDriver +
 * SecurityPlugin), never a 500 and never a row.
 *
 * ## The rule
 *
 * A true `PLATFORM_ADMIN` crosses the Layer 0 wall on a posture-permitting
 * object (`access.default: 'private'`, ADR-0095 D3), so the wall's own
 * no-active-organization refusal does not reach it. Crossing lets the
 * operator READ every organization's rows and UPDATE them where they are;
 * it does not give a NEW row somewhere to land. A session's new row lands
 * in its active organization — the engine stamps it from `tenantId` and
 * strips the column from a session payload — and ADR-0131 D9 refuses an
 * organization-less write under a walled posture ("nothing defaults to any
 * owner other than the derivable one"). So the insert was refused, but by
 * the engine, as an organization-less SYSTEM write:
 * `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` with status 500 and its prose
 * withheld from the wire. The wall now judges the stored image of that
 * insert and gives it the member's answer, before the engine is reached.
 *
 * ## What this file pins, per walled posture
 *
 * - the operator's insert is refused with exactly the member's D2 answer
 *   (the member's refusal on the same object is the control), single and
 *   bulk, and nothing is stored;
 * - the unchanged neighbours: the operator WITH an active organization is
 *   admitted and the row lands there; a row a `beforeInsert` hook places in
 *   an organization is admitted (the stored image is judged, not the
 *   payload); the operator's update of an existing row is admitted and the
 *   row keeps its organization; its insert into an object
 *   that opted out of tenancy is admitted; its read spans every
 *   organization; and a SYSTEM context with no organization still meets the
 *   engine's own refusal, untouched.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const OWN_ORG = 'org_a';
const OTHER_ORG = 'org_b';

const FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
  // An app hook derives the row's organization from this field (below).
  target_org: { name: 'target_org', type: 'text' },
};

const OBJECTS = [
  // A PRIVATE tenant object: the platform injects `organization_id`, and the
  // posture permits a platform operator to cross the wall (ADR-0095 D3).
  { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: FIELDS },
  // An object that opted out of tenancy: no organization column, no wall.
  { name: 'qa_global', label: 'Global', systemFields: { tenant: false }, fields: FIELDS },
];

/**
 * Plain CRUD and no row-level policy — Layer 0 is the only enforcer under test.
 * The wildcard does not cover a `private` object (ADR-0066 D2), so the member
 * holds an explicit grant on it: the member's control then meets the wall on
 * the very object the operator writes, not an object-permission denial.
 */
const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': CRUD, qa_vault: CRUD },
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

const SEED_CTX = { isSystem: true, userId: 'usr_system', tenantId: OWN_ORG };

/**
 * The subject: a platform operator whose session has no active organization.
 * ONE context for every posture; it holds a membership, so under `group` it
 * is not the empty-set case either.
 */
const OPERATOR_NO_ORG = {
  userId: 'usr_admin',
  positions: [],
  permissions: ['admin_full_access'],
  posture: 'PLATFORM_ADMIN',
  accessible_org_ids: [OWN_ORG],
};
/** The same operator one `set-active` later — the single-fact control. */
const OPERATOR_ACTIVE = { ...OPERATOR_NO_ORG, tenantId: OWN_ORG };
/** The member in the same state: the D2 answer this file holds the operator to. */
const MEMBER_NO_ORG = {
  userId: 'usr_a',
  positions: [],
  permissions: [],
  posture: 'MEMBER',
  accessible_org_ids: [OWN_ORG],
};

type Posture = 'isolated' | 'group';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  /** A table's rows read straight off the driver, past every scope. */
  table: (name: string) => Promise<Array<Record<string, unknown>>>;
}

const SEEDED = [
  { id: 'r1', name: 'own', organization_id: OWN_ORG },
  { id: 'r2', name: 'other', organization_id: OTHER_ORG },
];

async function boot(posture: Posture): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.no-active-organization-insert-platform-operator',
    name: 'No active organization, platform operator',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // The app's hook: it places a row in the organization `target_org` names.
  engine.on('beforeInsert', 'qa_vault', (async (ctx: { input: { data: Record<string, unknown> } }) => {
    const target = ctx.input.data.target_org;
    if (typeof target === 'string' && target !== '') ctx.input.data.organization_id = target;
  }) as never);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER, PLATFORM_ADMIN],
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
  // The expected refusals log through the engine's own logger.
  const engineLogger = (engine as unknown as { logger: { warn: () => void; error: () => void } }).logger;
  vi.spyOn(engineLogger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(engineLogger, 'error').mockImplementation(() => undefined);

  await engine.insert('qa_vault', SEEDED.map((r) => ({ ...r })), { context: SEED_CTX } as never);

  const table = async (name: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const columns = name === 'qa_global' ? ['id', 'name'] : ['id', 'name', 'organization_id'];
    const rows = await knex(name).select(...columns);
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

const insert = (b: Booted, object: string, data: unknown, context: object) =>
  b.engine.insert(object, data as never, { context } as never);

/** The ADR-0123 D2 answer on the ADR-0112 envelope: `code` + `status`, then the D4 naming. */
const expectNoActiveOrganizationRefusal = (outcome: Outcome) => {
  expect(outcome.ok, 'expected a refusal, got a completed write').toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  // ADR-0123 D4: the refusal names what is missing.
  expect(outcome.message).toMatch(/no active organization/i);
};

const expectAdmitted = (outcome: Outcome) =>
  expect(outcome, 'expected the write to be admitted').toEqual({ ok: true });

for (const posture of ['group', 'isolated'] as const) {
  describe(`[ADR-0123 D2 · ADR-0131 D9] a platform operator's insert with no active organization — ${posture}, real stack`, () => {
    it("is refused with exactly the member's D2 answer on the same object, and stores nothing", async () => {
      const b = await boot(posture);

      const operator = await attempt(() => insert(b, 'qa_vault', { id: 'n1', name: 'new' }, OPERATOR_NO_ORG));
      const member = await attempt(() => insert(b, 'qa_vault', { id: 'n1', name: 'new' }, MEMBER_NO_ORG));

      // The control first: the member's answer IS the D2 refusal.
      expectNoActiveOrganizationRefusal(member);
      expectNoActiveOrganizationRefusal(operator);
      expect(operator, "the operator gets exactly the member's answer").toEqual(member);
      expect(await b.table('qa_vault'), 'no row stored, NULL-organization or otherwise').toEqual(SEEDED);
    });

    it('a bulk insert is refused as a whole, and stores nothing', async () => {
      const b = await boot(posture);

      const outcome = await attempt(() =>
        insert(b, 'qa_vault', [{ id: 'n1', name: 'a' }, { id: 'n2', name: 'b' }], OPERATOR_NO_ORG),
      );

      expectNoActiveOrganizationRefusal(outcome);
      expect(await b.table('qa_vault')).toEqual(SEEDED);
    });

    it('control: the same operator WITH an active organization is admitted, and the row lands in it', async () => {
      const b = await boot(posture);

      expectAdmitted(await attempt(() => insert(b, 'qa_vault', { id: 'n1', name: 'new' }, OPERATOR_ACTIVE)));
      expect(await b.table('qa_vault')).toEqual([{ id: 'n1', name: 'new', organization_id: OWN_ORG }, ...SEEDED]);
    });

    it('control: a row a beforeInsert hook places in an organization is admitted — the stored image is judged', async () => {
      const b = await boot(posture);

      expectAdmitted(
        await attempt(() => insert(b, 'qa_vault', { id: 'n1', name: 'new', target_org: OTHER_ORG }, OPERATOR_NO_ORG)),
      );
      expect(await b.table('qa_vault')).toEqual([{ id: 'n1', name: 'new', organization_id: OTHER_ORG }, ...SEEDED]);
    });

    it("control: the operator's update of an existing row is admitted, and the row keeps its organization", async () => {
      const b = await boot(posture);

      expectAdmitted(
        await attempt(() => b.engine.update('qa_vault', { id: 'r1', name: 'renamed' } as never, { context: OPERATOR_NO_ORG } as never)),
      );
      expect(await b.table('qa_vault')).toEqual([{ id: 'r1', name: 'renamed', organization_id: OWN_ORG }, SEEDED[1]]);
    });

    it('control: an insert into an object that opted out of tenancy is admitted', async () => {
      const b = await boot(posture);

      expectAdmitted(await attempt(() => insert(b, 'qa_global', { id: 'g1', name: 'global' }, OPERATOR_NO_ORG)));
      expect(await b.table('qa_global')).toEqual([{ id: 'g1', name: 'global' }]);
    });

    it("control: the operator's read still spans every organization", async () => {
      const b = await boot(posture);

      const rows = (await b.engine.find('qa_vault', { context: OPERATOR_NO_ORG } as never)) as Array<Record<string, unknown>>;

      expect(rows.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    });

    it("control: a SYSTEM context with no organization still meets the engine's own refusal, untouched", async () => {
      const b = await boot(posture);

      const outcome = await attempt(() => insert(b, 'qa_vault', { id: 'n1', name: 'new' }, { isSystem: true }));

      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
      expect(outcome.status).toBe(500);
      expect(await b.table('qa_vault')).toEqual(SEEDED);
    });
  });
}
