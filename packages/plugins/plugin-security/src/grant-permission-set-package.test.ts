// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D5/D8, #32164] A grant of a permission set two packages hold,
 * and a grant that names its package in `permission_set_package`.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver, with the two
 * pieces that judge a grant's package registered on it as the plugin registers
 * them: the grant-name hook (`grant-permission-set-name.ts`, non-system
 * writers, through the security catalog) and the package stamp seam
 * (`stored-permission-set-package-stamp.ts`, every writer, through the
 * registry's holders). A stand-in registry serves both — the catalog reader is
 * built over it with `createSecurityCatalogReader` and bound to the engine —
 * because a name two packages hold cannot be registered on a real registry
 * before the narrowing (#31698 PR-2); the one-holder CONTROLs are what a real
 * environment answers today.
 *
 * Every refusal is read by its envelope (`resolveThrownHttpError`, and
 * `mapDataError` for the data door's wire body), and every refusal asserts
 * nothing was stored.
 *
 * BASE (main e40f2df2), for each moved answer — the FROM → TO is the changeset's:
 *  - two holders, no package named: 400 VALIDATION_FAILED `reference_not_found`
 *    ("There is no permission set named …") → 409 RESOURCE_CONFLICT naming both;
 *  - two holders, a holder named: the same 400 → stored with that package;
 *  - one holder, another package named: stored and re-stamped to the holder
 *    (system) or stored as sent (non-system) → 409 `not-held-by-qualifier` (F3).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindSecurityCatalogReader, createSecurityCatalogReader } from '@objectstack/core';
import { isUniqueViolationError, mapDataError, resolveThrownHttpError } from '@objectstack/types';

import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { judgeGrantSet, registerGrantPermissionSetNameHooks } from './grant-permission-set-name.js';
import { registerPermissionSetPackageStamp } from './stored-permission-set-package-stamp.js';

const ORG = 'org_a';
const SYS = { isSystem: true, tenantId: ORG } as const;
const ADMIN = { userId: 'u_admin', tenantId: ORG } as const;
const GRANTS = 'sys_user_permission_set';

const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';
const OTHER = 'com.acme.other';
/** Held by CRM alone. */
const ONE = 'crm_sales_rep';
/** Held by CRM and HR. */
const TWO = 'shared_reader';
/** Held by the environment alone. */
const ENV = 'env_auditor';

const holders: Record<string, string[]> = { [ONE]: [CRM], [TWO]: [CRM, HR] };
const itemOf = (name: string, packageId?: string) => ({ name, label: name, objects: {}, ...(packageId ? { _packageId: packageId } : {}) });

/** One stand-in serving the catalog reader's reads and the stamp seam's. */
function standInRegistry() {
  const manifests = [CRM, HR, OTHER].map((id) => ({ manifest: { id, namespace: id.split('.').pop() } }));
  return {
    // The by-name reads the catalog reader also carries.
    getItem: (type: string, name: string) =>
      type === 'permission' ? (holders[name] ? itemOf(name, holders[name][0]) : name === ENV ? itemOf(ENV) : undefined) : undefined,
    listItems: (type: string) => (type === 'permission' ? [itemOf(ONE, CRM), itemOf(TWO, CRM), itemOf(TWO, HR), itemOf(ENV)] : []),
    isPackageDisabled: () => false,
    // The package-scoped reads.
    packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' ? holders[name] ?? [] : []),
    getPackageScopedItem: (type: string, name: string, packageId: string) =>
      type === 'permission' && (holders[name] ?? []).includes(packageId) ? itemOf(name, packageId) : undefined,
    getEnvironmentScopedItem: (type: string, name: string) => (type === 'permission' && name === ENV ? itemOf(ENV) : undefined),
    getArtifactItem: () => undefined,
    getPackage: (id: string) => manifests.find((m) => m.manifest.id === id),
    getAllPackages: () => manifests,
    bareNameHoldersAreSealed: true,
  };
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(opts: { seamReads?: boolean } = {}): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.grant-permission-set-package',
    name: 'Grant permission-set package',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPermissionSet],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  const registry = standInRegistry();
  const metadata = { get: async () => undefined, list: async () => [] };
  expect(bindSecurityCatalogReader(engine, createSecurityCatalogReader({ registry: registry as never, metadata }))).toBe(true);
  expect(registerGrantPermissionSetNameHooks(engine as never)).toBe(true);
  expect(registerPermissionSetPackageStamp({
    registry: registry as never,
    getSchema: engine.getSchema.bind(engine),
    registerHook: engine.registerHook.bind(engine),
    unregisterHooksByPackage: engine.unregisterHooksByPackage.bind(engine),
    ...(opts.seamReads === false ? {} : { find: engine.find.bind(engine) }),
  })).toBe(true);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  return engine;
}

const grant = (id: string, set: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: `u_${id}`, permission_set: set, organization_id: ORG, ...extra,
});

async function stored(engine: ObjectQL): Promise<Record<string, unknown>> {
  const rows = (await engine.find(GRANTS, { where: {}, context: SYS })) as Array<Record<string, unknown>>;
  return Object.fromEntries(rows.map((r) => [r.id as string, r.permission_set_package ?? null]));
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

/** The refusal as both HTTP doors read it, and the data door's wire body. */
function conflictOf(err: any) {
  const thrown = resolveThrownHttpError(err);
  const wire = mapDataError(err, GRANTS);
  return {
    envelope: [thrown.code, thrown.status],
    wire: [wire.status, wire.body.code],
    reason: err?.refusal?.reason,
    callerPackageId: err?.refusal?.callerPackageId,
    candidates: err?.refusal?.candidates,
    message: String(err?.message ?? ''),
  };
}

describe('a set two packages hold (ADR-0150 D3)', () => {
  it('named with no package: 409 RESOURCE_CONFLICT naming both holders, at the data door and for a system writer; nothing stored', async () => {
    const engine = await boot();
    const err = conflictOf(await refusalOf(() => engine.insert(GRANTS, grant('a1', TWO), { context: ADMIN } as any)));
    expect(err).toMatchObject({
      envelope: ['RESOURCE_CONFLICT', 409],
      wire: [409, 'RESOURCE_CONFLICT'],
      reason: 'ambiguous-in-environment',
      callerPackageId: null,
      candidates: [{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }],
    });
    expect(err.message).toContain(`package "${CRM}"`);
    expect(err.message).toContain(`package "${HR}"`);
    expect(await stored(engine)).toEqual({});
  });

  it('a system writer naming no package is not judged by the name hook: the grant is stored package-less (the boot backfill reports it)', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('s1', TWO), { context: SYS } as any);
    expect(await stored(engine)).toEqual({ s1: null });
  });

  it('naming a holder in permission_set_package: stored with exactly that package — non-system and system writers alike', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('h1', TWO, { permission_set_package: HR }), { context: ADMIN } as any);
    await engine.insert(GRANTS, grant('h2', TWO, { permission_set_package: CRM }), { context: SYS } as any);
    // One user may hold both packages' sets of one name in one organization (the 4-column key).
    await engine.insert(GRANTS, grant('h3', TWO, { user_id: 'u_h1', permission_set_package: CRM }), { context: ADMIN } as any);
    expect(await stored(engine)).toEqual({ h1: HR, h2: CRM, h3: CRM });
  });

  it('naming a package that does not hold it: 409 not-held-by-qualifier naming the holders — hook and seam alike; nothing stored', async () => {
    const engine = await boot();
    for (const context of [ADMIN, SYS]) {
      const err = conflictOf(await refusalOf(() =>
        engine.insert(GRANTS, grant('x1', TWO, { permission_set_package: OTHER }), { context } as any)));
      expect(err).toMatchObject({
        envelope: ['RESOURCE_CONFLICT', 409],
        wire: [409, 'RESOURCE_CONFLICT'],
        reason: 'not-held-by-qualifier',
        callerPackageId: OTHER,
        candidates: [{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }],
      });
    }
    expect(await stored(engine)).toEqual({});
  });
});

/**
 * [#32164, red-line review E2] A second grant of one user, set and
 * organization that the key before #32164 refused is refused at the write
 * seam, and answers what the store's own unique violation answers: the same
 * envelope at both doors and the same wire body.
 */
describe('[E2] a second grant of a set to one user in one organization', () => {
  const asWire = (err: any) => {
    const thrown = resolveThrownHttpError(err);
    const wire = mapDataError(err, GRANTS);
    return { envelope: [thrown.code, thrown.status], wire: [wire.status, wire.body.code, wire.body.error] };
  };

  it('reads as the store\'s own unique violation: the seam\'s refusal and the declared key\'s, envelope and wire alike', async () => {
    // The declared key's own refusal: the same package's set twice, measured
    // with the seam's reads off so the store answers.
    const bare = await boot({ seamReads: false });
    await bare.insert(GRANTS, grant('k1', TWO, { permission_set_package: HR }), { context: SYS } as any);
    const store = await refusalOf(() =>
      bare.insert(GRANTS, grant('k2', TWO, { user_id: 'u_k1', permission_set_package: HR }), { context: SYS } as any));
    expect(store?.name).toBe('DuplicateRecordError');

    const engine = await boot();
    await engine.insert(GRANTS, grant('k1', TWO, { permission_set_package: HR }), { context: SYS } as any);
    const seam = await refusalOf(() =>
      engine.insert(GRANTS, grant('k2', TWO, { user_id: 'u_k1', permission_set_package: HR }), { context: SYS } as any));
    expect(asWire(seam)).toEqual(asWire(store));
    expect(asWire(seam)).toEqual({
      envelope: ['DUPLICATE_RECORD', 409],
      wire: [409, 'UNIQUE_VIOLATION', 'A record with this value already exists'],
    });
    // The in-process reading: the same class name, code, status, object and sentence.
    expect({ name: seam.name, code: seam.code, status: seam.status, object: seam.object, message: seam.message })
      .toEqual({ name: store.name, code: store.code, status: store.status, object: store.object, message: store.message });
    expect(isUniqueViolationError(seam)).toBe(true);
    expect(await stored(engine)).toEqual({ k1: HR });
  });

  it('at the data door: beside a grant that names no package, a stamped second grant of a one-holder set is refused 409 UNIQUE_VIOLATION; nothing stored', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('m1', ONE, { permission_set_package: null }), { context: SYS } as any);
    await (engine as any).getDriver(GRANTS).knex(GRANTS).where({ id: 'm1' }).update({ permission_set_package: null });
    const err = await refusalOf(() => engine.insert(GRANTS, grant('m2', ONE, { user_id: 'u_m1' }), { context: ADMIN } as any));
    expect(asWire(err)).toEqual({
      envelope: ['DUPLICATE_RECORD', 409],
      wire: [409, 'UNIQUE_VIOLATION', 'A record with this value already exists'],
    });
    expect(await stored(engine)).toEqual({ m1: null });
  });

  it('CONTROL: a row repeating a stored id is left to the store\'s own refusal, not the second-grant check', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('r1', ONE), { context: SYS } as any);
    const err = await refusalOf(() => engine.insert(GRANTS, grant('r1', ONE), { context: SYS } as any));
    expect({ name: err?.name, code: err?.code }).toEqual({ name: 'DuplicateRecordError', code: 'DUPLICATE_RECORD' });
    // The driver's own refusal on `cause` (the seam's own carries no driver code).
    expect(String(err?.cause?.code)).toMatch(/^SQLITE_CONSTRAINT/);
    expect(await stored(engine)).toEqual({ r1: CRM });
  });

  it('CONTROL: the two holders\' sets once each, for one user in one organization, are both stored', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('p1', TWO, { permission_set_package: CRM }), { context: ADMIN } as any);
    await engine.insert(GRANTS, grant('p2', TWO, { user_id: 'u_p1', permission_set_package: HR }), { context: ADMIN } as any);
    expect(await stored(engine)).toEqual({ p1: CRM, p2: HR });
  });
});

describe('a set one package holds — CONTROL, every answer as before', () => {
  it('naming no package: stored, stamped with the holder (non-system and system)', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('c1', ONE), { context: ADMIN } as any);
    await engine.insert(GRANTS, grant('c2', ONE), { context: SYS } as any);
    expect(await stored(engine)).toEqual({ c1: CRM, c2: CRM });
  });

  it('naming the holder itself: stored with it', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('c3', ONE, { permission_set_package: CRM }), { context: ADMIN } as any);
    await engine.insert(GRANTS, grant('c4', ONE, { permission_set_package: ` ${CRM} ` }), { context: SYS } as any);
    expect(await stored(engine)).toEqual({ c3: CRM, c4: CRM });
  });

  it('a name nothing holds: still the 400 reference_not_found, whatever package is named', async () => {
    const engine = await boot();
    for (const extra of [{}, { permission_set_package: CRM }]) {
      const thrown = resolveThrownHttpError(await refusalOf(() =>
        engine.insert(GRANTS, grant('n1', 'no_such_set', extra), { context: ADMIN } as any)));
      expect([thrown.code, thrown.status]).toEqual(['VALIDATION_FAILED', 400]);
      expect((thrown.details?.fields as any[])?.[0]).toMatchObject({ field: 'permission_set', code: 'reference_not_found' });
    }
    expect(await stored(engine)).toEqual({});
  });
});

describe('F3 — a named non-holder is refused at any holder count (the one declared narrowing)', () => {
  it('one holder, another package named: 409 not-held-by-qualifier — never stored as sent, never re-stamped', async () => {
    const engine = await boot();
    for (const context of [ADMIN, SYS]) {
      const err = conflictOf(await refusalOf(() =>
        engine.insert(GRANTS, grant('f1', ONE, { permission_set_package: HR }), { context } as any)));
      expect(err).toMatchObject({
        envelope: ['RESOURCE_CONFLICT', 409],
        reason: 'not-held-by-qualifier',
        callerPackageId: HR,
        candidates: [{ kind: 'package', packageId: CRM }],
      });
    }
    expect(await stored(engine)).toEqual({});
  });

  it('an environment-only set, a package named: 409 naming the environment', async () => {
    const engine = await boot();
    for (const context of [ADMIN, SYS]) {
      const err = conflictOf(await refusalOf(() =>
        engine.insert(GRANTS, grant('e1', ENV, { permission_set_package: CRM }), { context } as any)));
      expect(err).toMatchObject({ reason: 'not-held-by-qualifier', callerPackageId: CRM, candidates: [{ kind: 'environment' }] });
    }
    await engine.insert(GRANTS, grant('e2', ENV), { context: ADMIN } as any);
    expect(await stored(engine)).toEqual({ e2: null });
  });

  it('a column-only bind (a system update sending the package alone): a holder binds, a non-holder is refused and the row is untouched', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('b1', TWO), { context: SYS } as any);
    await engine.insert(GRANTS, grant('b2', ONE), { context: SYS } as any);

    await engine.update(GRANTS, { id: 'b1', permission_set_package: HR }, { context: SYS } as any);
    const err = conflictOf(await refusalOf(() =>
      engine.update(GRANTS, { id: 'b2', permission_set_package: HR }, { context: SYS } as any)));
    expect(err).toMatchObject({ reason: 'not-held-by-qualifier', callerPackageId: HR, candidates: [{ kind: 'package', packageId: CRM }] });
    expect(await stored(engine)).toEqual({ b1: HR, b2: CRM });
  });
});

describe('what an update keeps', () => {
  it('an echo of the stored package chooses nothing: an unrelated edit lands and the package stays', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('u1', TWO, { permission_set_package: HR }), { context: SYS } as any);
    await engine.update(GRANTS, { id: 'u1', permission_set_package: HR, reason: 'renewed' }, { context: SYS } as any);
    await engine.update(GRANTS, { id: 'u1', permission_set_package: HR, reason: 'again' }, { context: ADMIN } as any);
    expect(await stored(engine)).toEqual({ u1: HR });
  });

  it('a non-system update\'s package value is never stored or judged: the readonly column keeps its value', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('u2', ONE), { context: SYS } as any);
    await engine.update(GRANTS, { id: 'u2', permission_set_package: OTHER, reason: 'edited' }, { context: ADMIN } as any);
    expect(await stored(engine)).toEqual({ u2: CRM });
  });

  it('a rename to a two-holder name re-stamps package-less (CONTROL: as before)', async () => {
    const engine = await boot();
    await engine.insert(GRANTS, grant('u3', ONE), { context: SYS } as any);
    await engine.update(GRANTS, { id: 'u3', permission_set: TWO }, { context: SYS } as any);
    expect(await stored(engine)).toEqual({ u3: null });
  });
});

describe('[SF7] the overlay provenance sentinel is no package', () => {
  /** A set whose catalog entry carries `sys_metadata` as its package: an overlay row's provenance, not a holder. */
  const OVERLAID = 'overlaid_auditor';
  const SENTINEL = 'sys_metadata';
  const overlayCatalog = () => createSecurityCatalogReader({
    registry: {
      getItem: (type: string, name: string) => (type === 'permission' && name === OVERLAID ? itemOf(OVERLAID, SENTINEL) : undefined),
      listItems: (type: string) => (type === 'permission' ? [itemOf(OVERLAID, SENTINEL)] : []),
      isPackageDisabled: () => false,
      getPackage: () => undefined,
      getAllPackages: () => [],
    } as never,
    metadata: { get: async () => undefined, list: async () => [] },
  });

  it('a grant naming the sentinel holds nothing: refused not-held-by-qualifier, the holder named as the environment', async () => {
    const answer = await judgeGrantSet(overlayCatalog(), OVERLAID, SENTINEL);
    expect(answer).toMatchObject({
      status: 'refused',
      refusal: { reason: 'not-held-by-qualifier', candidates: [{ kind: 'environment' }] },
    });
    // The caller's own qualifier is echoed; the holder it lists is the environment.
    const message = answer.status === 'refused' ? answer.refusal.message : '';
    expect(message).toContain('the environment');
    expect(message.split(`package "${SENTINEL}"`)).toHaveLength(2);
  });

  it('a refusal for another package names the environment, never the sentinel; CONTROL: the bare name resolves', async () => {
    const other = await judgeGrantSet(overlayCatalog(), OVERLAID, OTHER);
    expect(other).toMatchObject({ status: 'refused', refusal: { candidates: [{ kind: 'environment' }] } });
    expect(await judgeGrantSet(overlayCatalog(), OVERLAID)).toMatchObject({ status: 'resolved', entry: { name: OVERLAID } });
  });
});
