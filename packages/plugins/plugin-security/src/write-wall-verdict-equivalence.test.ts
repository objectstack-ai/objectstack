// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25062] `writeWallVerdict` against the engine middleware's step 3.7.
 *
 * ## Why this file exists, and why it is an EQUIVALENCE
 *
 * `ObjectQL.validate()` previews a write without running middleware, so the
 * Layer 0 tenant wall never judged its rows: the import dry run reported a
 * caller's organization DROPPED where the write stores it as sent, and answered
 * VALID a row naming an organization the write refuses 403. Ruling 6336640643
 * (letter A) hands the preview the wall's own verdict per row: step 3.7's
 * judgement is composed by ONE method (`composeWriteTenantWall`) that the
 * middleware calls, and `writeWallVerdict` answers each row from that method.
 *
 * So this file asserts no expected verdict per case on its own. For each case
 * it drives the REAL registered middleware with the write, and asks the seam
 * about the same row under the same context, and requires the two to EQUAL:
 * admitted or refused, the refusal's code and message, and whether the wall
 * judges the organization (`judgesOrganization` on the installed seam). Two
 * doors that merely agree today drift the first time one grows an arm; this
 * is the pin that keeps them one door. The `field` the preview reports a
 * refusal under, which the write has no slot for, is pinned beside it.
 *
 * ## The harness
 *
 * Real `ObjectQL`, real `SqlDriver`, real `SecurityPlugin`, booted as
 * `insert-seam-judges-organization.test.ts` boots them. The middleware runs
 * through the engine's own chain with a terminal that stands in for the
 * engine's executor: it runs the installed `postHookWriteImageCheck` on the
 * image the engine would hand it (the rows as sent on an insert, the stored
 * row merged with the payload on a by-id update) and runs no strip. What the
 * engine's own strips then do to a row is the engine's half, pinned in
 * `@objectstack/objectql`'s `validate-write-wall-verdict.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const OWN_ORG = 'org_a';
const SISTER_ORG = 'org_c';
const FOREIGN_ORG = 'org_x';

const FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};

const OBJECTS = [
  { name: 'qa_account', label: 'Account', fields: FIELDS },
  // A private object: where a true platform operator CROSSES the wall
  // (ADR-0095 D3), as `insert-seam-judges-organization.test.ts` uses it.
  { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: FIELDS },
];

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

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
/** ADR-0123 D2: an authenticated session with no active organization. */
const ORGLESS_CTX = { userId: 'usr_a', positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
/** [#24784] A `group` member with a membership set and no active organization. */
const GROUP_NO_ACTIVE_CTX = { ...ORGLESS_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ADMIN_CTX = { userId: 'usr_admin', tenantId: OWN_ORG, positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };
/** [#24821] A platform operator crossing the wall with no active organization. */
const ADMIN_NO_ORG_CTX = { userId: 'usr_admin', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };

/** The stored row every by-id update case names, in the caller's own organization. */
const PRIOR = { id: 'r1', name: 'one', organization_id: OWN_ORG };

type Posture = 'isolated' | 'group' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.write-wall-verdict-equivalence',
    name: 'The write-wall verdict equals the middleware',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

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
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  await engine.insert('qa_account', { ...PRIOR }, { context: SYS_CTX } as never);
  return { engine, plugin };
}

type Verdict =
  | { admitted: true; judgesOrganization: boolean }
  | { admitted: false; code: unknown; message: string };

/** What the REAL middleware decides about this write, through the engine's own chain. */
async function middlewareVerdict(
  engine: ObjectQL,
  object: string,
  operation: 'insert' | 'update',
  context: Record<string, unknown>,
  data: Record<string, unknown> | Record<string, unknown>[],
): Promise<Verdict> {
  const opCtx: any = {
    object,
    operation,
    context: { ...context },
    data: Array.isArray(data) ? data.map((row) => ({ ...row })) : { ...data },
    // The engine's by-id update: the row named as `options.where.id`, no AST.
    options: operation === 'update' ? { where: { id: PRIOR.id } } : {},
  };
  const terminal = async () => {
    const seam = opCtx.postHookWriteImageCheck;
    if (!seam) return;
    seam.honoured = true;
    const sent = Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data];
    await seam.evaluate(operation === 'insert' ? sent : sent.map((row: Record<string, unknown>) => ({ ...PRIOR, ...row })));
  };
  try {
    await (engine as unknown as { executeWithMiddleware(o: unknown, t: () => Promise<void>): Promise<void> })
      .executeWithMiddleware(opCtx, terminal);
    return { admitted: true, judgesOrganization: opCtx.postHookWriteImageCheck?.judgesOrganization === true };
  } catch (e) {
    const err = e as { code?: unknown; message?: string };
    return { admitted: false, code: err.code, message: String(err.message ?? e) };
  }
}

/** What the seam answers about the same rows, one verdict per row. */
async function seamVerdicts(
  plugin: SecurityPlugin,
  object: string,
  operation: 'insert' | 'update',
  context: Record<string, unknown>,
  rows: Record<string, unknown>[],
) {
  const answered = await plugin.writeWallVerdict(object, operation, { ...context }, rows.map((row) => ({ ...row })));
  if (!answered) throw new Error('the seam did not ask the wall for a non-system user context');
  return answered;
}

const asVerdict = (v: Awaited<ReturnType<typeof seamVerdicts>>[number]): Verdict =>
  v.admitted
    ? { admitted: true, judgesOrganization: v.judgesOrganization }
    : { admitted: false, code: v.code, message: v.message };

describe('[#25062] writeWallVerdict equals step 3.7, case for case', () => {
  const CASES: Array<{
    label: string;
    posture: Posture;
    context: Record<string, unknown>;
    operation: 'insert' | 'update';
    object?: string;
    row: Record<string, unknown>;
    /** The field the PREVIEW reports a refusal under — the write has no slot for it. */
    refusedField?: 'organization_id' | '_record';
  }> = [
    // ── isolated ──
    { label: 'isolated member names its active organization', posture: 'isolated', context: MEMBER_CTX, operation: 'insert', row: { id: 'n1', name: 'n', organization_id: OWN_ORG } },
    { label: 'isolated member names a foreign organization (the forge guard)', posture: 'isolated', context: MEMBER_CTX, operation: 'insert', row: { id: 'n1', name: 'n', organization_id: FOREIGN_ORG }, refusedField: 'organization_id' },
    { label: 'isolated member names none', posture: 'isolated', context: MEMBER_CTX, operation: 'insert', row: { id: 'n1', name: 'n' } },
    { label: 'isolated session with no active organization (ADR-0123 D2 pre-test)', posture: 'isolated', context: ORGLESS_CTX, operation: 'insert', row: { id: 'n1', name: 'n' }, refusedField: '_record' },
    { label: 'no active organization AND a foreign value: the pre-test answers first', posture: 'isolated', context: ORGLESS_CTX, operation: 'insert', row: { id: 'n1', name: 'n', organization_id: FOREIGN_ORG }, refusedField: '_record' },
    { label: 'crossing operator with no active organization, a row naming none (#24821)', posture: 'isolated', context: ADMIN_NO_ORG_CTX, operation: 'insert', object: 'qa_vault', row: { id: 'n1', name: 'n' }, refusedField: '_record' },
    { label: 'crossing operator with no active organization, a row naming one', posture: 'isolated', context: ADMIN_NO_ORG_CTX, operation: 'insert', object: 'qa_vault', row: { id: 'n1', name: 'n', organization_id: SISTER_ORG } },
    { label: 'crossing operator with an active organization: no seam at all', posture: 'isolated', context: ADMIN_CTX, operation: 'insert', object: 'qa_vault', row: { id: 'n1', name: 'n', organization_id: SISTER_ORG } },
    { label: 'isolated by-id update re-pointing to a foreign organization', posture: 'isolated', context: MEMBER_CTX, operation: 'update', row: { name: 'm', organization_id: FOREIGN_ORG }, refusedField: 'organization_id' },
    { label: 'isolated by-id update emptying the organization (#22278)', posture: 'isolated', context: MEMBER_CTX, operation: 'update', row: { name: 'm', organization_id: '' }, refusedField: 'organization_id' },
    { label: 'isolated by-id update naming its own organization', posture: 'isolated', context: MEMBER_CTX, operation: 'update', row: { name: 'm', organization_id: OWN_ORG } },
    { label: 'isolated by-id update leaving the column alone', posture: 'isolated', context: MEMBER_CTX, operation: 'update', row: { name: 'm' } },
    // ── group ──
    { label: 'group member names a sister organization', posture: 'group', context: GROUP_CTX, operation: 'insert', row: { id: 'n1', name: 'n', organization_id: SISTER_ORG } },
    { label: 'group member names a foreign organization', posture: 'group', context: GROUP_CTX, operation: 'insert', row: { id: 'n1', name: 'n', organization_id: FOREIGN_ORG }, refusedField: 'organization_id' },
    { label: 'group member with no active organization, a row naming none (#24784)', posture: 'group', context: GROUP_NO_ACTIVE_CTX, operation: 'insert', row: { id: 'n1', name: 'n' }, refusedField: '_record' },
    { label: 'group member with no active organization, a row naming a sister', posture: 'group', context: GROUP_NO_ACTIVE_CTX, operation: 'insert', row: { id: 'n1', name: 'n', organization_id: SISTER_ORG } },
    { label: 'group by-id update re-pointing to a sister organization', posture: 'group', context: GROUP_CTX, operation: 'update', row: { name: 'm', organization_id: SISTER_ORG } },
    // ── single ──
    { label: 'single member names a foreign organization: no wall', posture: 'single', context: MEMBER_CTX, operation: 'insert', row: { id: 'n1', name: 'n', organization_id: FOREIGN_ORG } },
    { label: 'single session with no active organization: no wall', posture: 'single', context: ORGLESS_CTX, operation: 'insert', row: { id: 'n1', name: 'n' } },
  ];

  for (const c of CASES) {
    it(c.label, async () => {
      const { engine, plugin } = await boot(c.posture);
      const object = c.object ?? 'qa_account';

      const write = await middlewareVerdict(engine, object, c.operation, c.context, c.row);
      const [seam] = await seamVerdicts(plugin, object, c.operation, c.context, [c.row]);

      expect(asVerdict(seam!)).toEqual(write);
      // The case means what its label says: a refusal is the wall's 403, and
      // the preview files it under the value or the caller's state.
      if (c.refusedField) {
        expect(write).toMatchObject({ admitted: false, code: 'PERMISSION_DENIED' });
        expect(seam).toMatchObject({ admitted: false, field: c.refusedField });
      } else {
        expect(write.admitted, write.admitted ? '' : write.message).toBe(true);
      }
    });
  }

  it('rows are judged one by one, and the set agrees with the write: one refused row refuses the bulk insert', async () => {
    const { engine, plugin } = await boot('isolated');
    const rows = [
      { id: 'n1', name: 'n', organization_id: OWN_ORG },
      { id: 'n2', name: 'n', organization_id: FOREIGN_ORG },
    ];

    const write = await middlewareVerdict(engine, 'qa_account', 'insert', MEMBER_CTX, rows);
    const seam = await seamVerdicts(plugin, 'qa_account', 'insert', MEMBER_CTX, rows);

    expect(seam.map(asVerdict)).toEqual([{ admitted: true, judgesOrganization: true }, write]);
    expect(write).toMatchObject({ admitted: false, code: 'PERMISSION_DENIED' });
  });

  it('a system context and a context that names no user are not asked: `null`, as step 3.7 never runs for them', async () => {
    const { plugin } = await boot('isolated');

    expect(await plugin.writeWallVerdict('qa_account', 'insert', SYS_CTX, [{ organization_id: FOREIGN_ORG }])).toBeNull();
    expect(await plugin.writeWallVerdict('qa_account', 'insert', { tenantId: OWN_ORG, positions: [], permissions: [] }, [{ organization_id: FOREIGN_ORG }])).toBeNull();
  });
});
