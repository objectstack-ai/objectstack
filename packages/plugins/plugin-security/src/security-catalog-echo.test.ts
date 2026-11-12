// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The security catalog's echo (`security-catalog-echo.ts`), as the security
 * plugin wires it on an environment kernel.
 *
 * #23233 — the echo names the package its stored row is bound to, so a set published into a writable runtime
 * package records its `everyone` suggestion (ADR-0090 D5: "packages suggest,
 * admins confirm"), and the security catalog and the protocol's by-name read
 * name the same owner.
 *
 * ## The topology, and why it is the one under test
 *
 * A REAL `ObjectStackProtocolImplementation` (aliased to the producer's source
 * — see `vitest.config.ts`) over a fake engine, constructed with an
 * `environmentId`: an ENVIRONMENT kernel, the shape a hosted tenant runs. On
 * that topology the protocol hydrates no stored row into the engine registry
 * (`applyRegistryWriteThrough` returns before the hydrator when the kernel has
 * an environment), so the security catalog finds the set in the metadata
 * service — and the only body the metadata service holds for it is the
 * echo. (Until C3 stage 8 the permission-set projector registered it; the
 * echo now lives in its own module and writes no row.) The catalog takes its owner from `_packageId` alone
 * (`ownerOf`, `@objectstack/core`); the echo used to arrive without one, so
 * the set was served unowned and the suggestion collector skipped it.
 *
 * The publish is the real package door (`publishPackageDrafts`) over a draft
 * saved into the runtime package, with no `packageId` in the body — the input
 * the card measured on a tenant kernel. The catalog is the real
 * `createSecurityCatalogReader`, and the suggestion pass is the real
 * `syncAudienceBindingSuggestions`.
 */

import { describe, it, expect } from 'vitest';
import { bindSecurityCatalogReader, createSecurityCatalogReader } from '@objectstack/core';
import {
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  echoSecurityCatalogMutation,
  echoStoredSecurityCatalogOverlays,
  registerSecurityCatalogEcho,
} from './security-catalog-echo.js';
import { syncAudienceBindingSuggestions } from './suggested-audience-bindings.js';
import { declareEveryoneBaseline } from './builtin-positions.js';
import { classifyPackagedPermissionSet } from './packaged-permission-set-lock.js';

/** A writable runtime package — never installed as code, so nothing ships its sets. */
const RUNTIME_PKG = 'app.crm_workspace';
/** The runtime package's default set: `isDefault: true`, no `packageId` in the body. */
const RUNTIME_SET = 'workspace_member_default';
/** An installed code package, and the default set its artifact ships. */
const CODE_PKG = 'com.example.crm';
const CODE_SET = 'crm_readonly';
const SECURITY_PACKAGE = 'com.objectstack.plugin-security';
const DEFAULT_ORG = 'org_default';

type Row = Record<string, any>;

/** Does `row` satisfy `where`? Equality (null matches absent), `$in`, and `$and`/`$or`. */
function matches(row: Row, where: Record<string, any> | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, want]) => {
    if (key === '$and') return (want as any[]).every((w) => matches(row, w));
    if (key === '$or') return (want as any[]).some((w) => matches(row, w));
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      if (Array.isArray(want.$in)) return want.$in.includes(row[key]);
      if ('$ne' in want) return (row[key] ?? null) !== want.$ne;
      throw new Error(`fake engine: unsupported operator on '${key}': ${Object.keys(want).join(',')}`);
    }
    return want === null ? (row[key] ?? null) === null : row[key] === want;
  });
}

/**
 * The fake engine, which is also the `ql` the security plugin projects
 * through. Its engine registry holds the code package's artifact and the
 * positions; on an environment kernel no stored row is hydrated into it, so
 * `registered` records anything else that tries to land there.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {
    sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }],
  };
  const codeArtifacts: Row[] = [
    { name: CODE_SET, label: 'CRM read-only', isDefault: true, objects: {}, _packageId: CODE_PKG, _provenance: 'package' },
  ];
  const positions = new Map<string, Row>();
  const registered: Array<{ type: string; name: unknown }> = [];
  const registry = {
    // A registry that reads no type by package (ADR-0150): every by-name read stays
    // this double's `getItem`. Undeclared, the protocol refuses a by-name read of a
    // package-scoped type, since it cannot tell how this registry reads it.
    readsByPackage: () => false,
    registered,
    listItems: (type: string) => (type === 'permission' ? codeArtifacts : type === 'position' ? [...positions.values()] : []),
    getItem: (type: string, name: string) => registry.listItems(type).find((item) => item.name === name),
    getArtifactItem: (type: string, name: string) =>
      (type === 'permission' ? codeArtifacts.find((item) => item.name === name) : undefined),
    // [#31698] The exact qualifier's three reads, as an ObjectQL registry answers
    // them: the echo reads a set at its row's package (ADR-0150 D4), and a
    // composition with no package-scoped resolver refuses that read (D5).
    packageScopedHoldersOf: (type: string, name: string) =>
      registry.listItems(type).filter((item) => item.name === name && typeof item._packageId === 'string').map((item) => item._packageId),
    getPackageScopedItem: (type: string, name: string, packageId: string) =>
      registry.listItems(type).find((item) => item.name === name && item._packageId === packageId),
    getEnvironmentScopedItem: () => undefined,
    isPackageDisabled: () => false,
    // [#26708] The runtime package is installed: a save naming a package the
    // registry does not hold is refused.
    getPackage: (id: string) => (id === RUNTIME_PKG ? { manifest: { id, name: id, version: '1.0.0' } } : undefined),
    getAllPackages: () => [],
    registerItem: (type: string, item: Row, _key: string, packageId?: string) => {
      if (type === 'position') positions.set(String(item.name), { ...item, _packageId: packageId });
      else registered.push({ type, name: item?.name });
    },
    registerObject: () => {},
    unregisterItem: () => {},
  };
  let seq = 0;
  const table = (name: string) => (tables[name] ??= []);
  const engine = {
    tables,
    registry,
    async find(object: string, query?: { where?: Record<string, any>; limit?: number }) {
      const rows = table(object).filter((row) => matches(row, query?.where));
      return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
    },
    async findOne(object: string, query: { where?: Record<string, any> }) {
      assertEngineFindOnePredicate(object, query);
      return table(object).find((row) => matches(row, query?.where)) ?? null;
    },
    async insert(object: string, data: Row, options?: { context?: { tenantId?: string } }) {
      const row: Row = { id: data.id ?? `${object}_${++seq}`, ...data };
      // A tenant-scoped insert is stamped with the context's organization, as the driver does.
      if (object === 'sys_audience_binding_suggestion') row.organization_id = options?.context?.tenantId ?? null;
      table(object).push(row);
      return { ...row };
    },
    async update(object: string, data: Row, options?: { where?: Record<string, any>; multi?: boolean }) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const { id: _id, ...patch } = data;
      const hits = dispatch.kind === 'by-id'
        ? table(object).filter((row) => row.id === (data.id ?? options?.where?.id))
        : table(object).filter((row) => matches(row, options?.where));
      for (const row of hits) Object.assign(row, patch);
      return hits.length;
    },
    async delete(object: string, options?: { where?: Record<string, any>; multi?: boolean }) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = table(object);
      const doomed = dispatch.kind === 'by-id'
        ? rows.filter((row) => row.id === options?.where?.id)
        : rows.filter((row) => matches(row, options?.where));
      for (const row of doomed) rows.splice(rows.indexOf(row), 1);
      return doomed.length;
    },
    async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
      return cb(undefined, { owned: true });
    },
  };
  return engine;
}

/** The kernel `metadata` service as the echo and the catalog use it: registry-first, in memory, keyed by type. */
function makeMetadataService() {
  const byType = new Map<string, Map<string, Row>>();
  const of = (type: string) => byType.get(type) ?? byType.set(type, new Map()).get(type)!;
  return {
    /** The `permission` entries — what every permission-set case reads. */
    store: of('permission'),
    of,
    registerInMemory: (type: string, name: string, data: Row) => { of(type).set(name, data); },
    get: (type: string, name: string) => of(type).get(name),
    list: (type: string) => [...of(type).values()],
    unregister: (type: string, name: string) => { of(type).delete(name); },
    unregisterInMemory: (type: string, name: string) => { of(type).delete(name); },
  };
}

/** One environment kernel: the protocol, the echo wired as the security plugin wires it, the catalog bound. */
function boot() {
  const engine = makeEngine();
  const metadata = makeMetadataService();
  const warnings: Array<{ message: string; meta?: Record<string, any> }> = [];
  const logger = { warn: (message: string, meta?: Record<string, any>) => { warnings.push({ message, meta }); } };
  const protocol = new ObjectStackProtocolImplementation(
    engine as never,
    () => new Map<string, unknown>([['metadata', metadata]]),
    'env_tenant', // an ENVIRONMENT kernel — see the module doc
  ) as any;
  expect(registerSecurityCatalogEcho(protocol, { ql: engine, metadata, logger })).toBe(true);
  const catalog = createSecurityCatalogReader({ registry: engine.registry, metadata });
  bindSecurityCatalogReader(engine, catalog);
  declareEveryoneBaseline(engine.registry, SECURITY_PACKAGE, ['member_default']);
  return { engine, metadata, protocol, catalog, warnings };
}

/** Publish `body` into `packageId` through the package door: a draft, then the batch publish. */
async function publishThroughPackageDoor(protocol: any, packageId: string, body: Row) {
  await protocol.saveMetaItem({ type: 'permission', name: body.name, item: body, packageId, mode: 'draft' });
  const published = await protocol.publishPackageDrafts({ packageId, actor: 'system' });
  expect(published, JSON.stringify(published)).toMatchObject({ outcome: 'published', failed: [] });
}

const suggestionRows = (engine: ReturnType<typeof makeEngine>, set: string) =>
  (engine.tables.sys_audience_binding_suggestion ?? []).filter((row) => row.permission_set_name === set);

/** The layered read's `code` layer: the metadata service's view, i.e. the echo. */
const metadataEcho = (layered: any) => layered?.code;

const runtimeDefault = () => ({ name: RUNTIME_SET, label: 'Workspace member', isDefault: true, objects: {} });

describe('#23233 — a runtime package\'s isDefault set, published without a body packageId', () => {
  it('records ONE pending everyone suggestion, under the package the publish door bound it to', async () => {
    const { engine, protocol } = boot();
    const body = runtimeDefault();
    expect(body, 'precondition: the body names no package').not.toHaveProperty('packageId');

    await publishThroughPackageDoor(protocol, RUNTIME_PKG, body);
    // Anti-vacuity: the topology under test — the engine registry holds no
    // stored row, so the catalog can only find the set in the metadata service.
    expect(engine.registry.getItem('permission', RUNTIME_SET)).toBeUndefined();
    expect(engine.registry.registered.filter((r) => r.name === RUNTIME_SET)).toEqual([]);

    await syncAudienceBindingSuggestions(engine);

    expect(suggestionRows(engine, RUNTIME_SET)).toEqual([
      expect.objectContaining({
        package_id: RUNTIME_PKG, anchor: 'everyone', status: 'pending', deployment_decision: false,
        organization_id: DEFAULT_ORG,
      }),
    ]);
  });

  it('the security catalog and the protocol\'s by-name read name the same owner', async () => {
    const { protocol, catalog } = boot();
    await publishThroughPackageDoor(protocol, RUNTIME_PKG, runtimeDefault());

    const served = await protocol.getMetaItem({ type: 'permission', name: RUNTIME_SET });
    const resolved = await catalog.resolve('permission', RUNTIME_SET);
    const listed = (await catalog.list('permission')).find((entry) => entry.name === RUNTIME_SET);

    expect(served.item._packageId).toBe(RUNTIME_PKG);
    // The catalog read the echo (anti-vacuity), and the echo names the owner.
    expect(resolved).toMatchObject({ source: 'metadata', packageId: RUNTIME_PKG });
    expect(listed).toMatchObject({ source: 'metadata', packageId: RUNTIME_PKG });
    expect(resolved?.definition).toMatchObject({ _provenance: 'org', isDefault: true });
  });
});

describe('#23233 — the edit surface does not move', () => {
  // The owner rides on the echo the catalog reads, and nothing that gates an
  // admin's edit reads the echo's `_packageId`. No `sys_permission_set` row is
  // written at all: C3 stage 8 retired the row, and the echo writes none.
  it('the owner-carrying echo is still not a shipped artifact: the lock answers org, the item stays editable, and an edit lands', async () => {
    const { engine, protocol } = boot();
    await publishThroughPackageDoor(protocol, RUNTIME_PKG, runtimeDefault());

    const layered = await protocol.getMetaItemLayered({ type: 'permission', name: RUNTIME_SET });
    // Anti-vacuity: the layered read's code layer IS the echo, and it carries the owner.
    expect(layered.code).toMatchObject({ _packageId: RUNTIME_PKG, _envProjection: true });
    expect(classifyPackagedPermissionSet(RUNTIME_SET, engine, { status: 'read', envelope: layered })).toEqual({ status: 'org' });
    expect(layered).toMatchObject({ lock: 'none', editable: true, deletable: true });

    await protocol.saveMetaItem({
      type: 'permission', name: RUNTIME_SET, packageId: RUNTIME_PKG, item: { ...runtimeDefault(), label: 'Edited' },
    });
    expect((await protocol.getMetaItem({ type: 'permission', name: RUNTIME_SET })).item).toMatchObject({ label: 'Edited', _packageId: RUNTIME_PKG });
    // The edit reached the catalog through the echo, and no row was written.
    expect(metadataEcho(await protocol.getMetaItemLayered({ type: 'permission', name: RUNTIME_SET }))).toMatchObject({ label: 'Edited', _packageId: RUNTIME_PKG });
    expect(engine.tables.sys_permission_set ?? []).toEqual([]);
  });
});

describe('#23233 — controls: the owner is carried, never invented', () => {
  it('a code package\'s default set is unchanged: the catalog serves its artifact, its owner and its suggestion', async () => {
    const { engine, metadata, catalog } = boot();

    await syncAudienceBindingSuggestions(engine);

    expect(suggestionRows(engine, CODE_SET)).toEqual([
      expect.objectContaining({ package_id: CODE_PKG, status: 'pending' }),
    ]);
    expect(await catalog.resolve('permission', CODE_SET)).toMatchObject({ source: 'registry', packageId: CODE_PKG });
    // No overlay row, so no echo of it was registered at all.
    expect(metadata.store.has(CODE_SET)).toBe(false);
  });

  it('a set saved with no package stays unowned — no binding, no owner, no suggestion (ADR-0086 D3)', async () => {
    const { engine, protocol, catalog } = boot();
    await protocol.saveMetaItem({ type: 'permission', name: 'org_member_default', item: { ...runtimeDefault(), name: 'org_member_default' } });

    expect((await protocol.getMetaItem({ type: 'permission', name: 'org_member_default' })).item._packageId).toBeUndefined();
    const resolved = await catalog.resolve('permission', 'org_member_default');
    expect(resolved).toMatchObject({ source: 'metadata' });
    expect(resolved).not.toHaveProperty('packageId');

    await syncAudienceBindingSuggestions(engine);
    expect(suggestionRows(engine, 'org_member_default')).toEqual([]);
  });

  it('[#24210] a disabled package\'s set echoes owned, and stays owned after the package is re-enabled', async () => {
    // The by-name read withholds a disabled package's item and keeps its
    // envelope; the binding is a resolution read, so it reads the envelope.
    const { engine, metadata, protocol } = boot();
    await publishThroughPackageDoor(protocol, RUNTIME_PKG, runtimeDefault());
    const disabled = new Set<string>([RUNTIME_PKG]);
    engine.registry.isPackageDisabled = ((id: unknown) => typeof id === 'string' && disabled.has(id)) as never;
    // Anti-vacuity: the by-name read withholds the item now.
    expect((await protocol.getMetaItem({ type: 'permission', name: RUNTIME_SET })).item).toBeUndefined();

    metadata.store.delete(RUNTIME_SET);
    const out = await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, {
      type: 'permission', name: RUNTIME_SET, state: 'active',
    });
    expect(out).toBe('registered');
    expect(metadata.store.get(RUNTIME_SET)).toMatchObject({ name: RUNTIME_SET, _packageId: RUNTIME_PKG, _envProjection: true });

    disabled.delete(RUNTIME_PKG);
    expect(metadata.store.get(RUNTIME_SET)).toMatchObject({ _packageId: RUNTIME_PKG });
    await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: RUNTIME_SET, state: 'active' });
    expect(metadata.store.get(RUNTIME_SET)).toMatchObject({ _packageId: RUNTIME_PKG });
    expect((await protocol.getMetaItem({ type: 'permission', name: RUNTIME_SET })).item?._packageId).toBe(RUNTIME_PKG);
  });

  it('a binding read that fails leaves the echo registered and unowned, as before, and says so once', async () => {
    const { engine, metadata, warnings } = boot();
    // The layered read answers an overlay; the by-name read is refused.
    const protocol = {
      getMetaItemLayered: async () => ({ type: 'permission', name: RUNTIME_SET, code: null, overlay: runtimeDefault(), effective: runtimeDefault() }),
      getMetaItem: async () => { throw new Error('metadata store unavailable'); },
    };

    const out = await echoSecurityCatalogMutation(protocol, { ql: engine, metadata, logger: { warn: (m: string, meta?: any) => warnings.push({ message: m, meta }) } }, {
      type: 'permission', name: RUNTIME_SET, state: 'active',
    });

    expect(out).toBe('registered');
    const echo = metadata.store.get(RUNTIME_SET);
    expect(echo).toMatchObject({ name: RUNTIME_SET, _provenance: 'org', _envProjection: true });
    expect(echo).not.toHaveProperty('_packageId');
    expect(warnings.filter((w) => w.meta?.name === RUNTIME_SET)).toHaveLength(1);
  });
});

/**
 * A layered-read stub: `overlays` are the stored env-wide rows (with their
 * package binding), `declared` the artifacts. Enough for the echo's own
 * decisions, which read nothing else.
 *
 * [#31698] A read naming a package serves that package's row — the
 * `type/name@package` entry, or the `type/name` entry when it is bound to that
 * package or to none (the package-unbound row, ADR-0048 prefer-local) — as the
 * protocol's served-row resolution does; another package's row never.
 */
function stubProtocol(overlays: Record<string, { body: Row; packageId?: string }>, declared: Record<string, Row> = {}) {
  const rowAt = (type: string, name: string, packageId?: string) => {
    if (packageId === undefined) return overlays[`${type}/${name}`];
    const own = overlays[`${type}/${name}@${packageId}`];
    if (own) return { ...own, packageId };
    const plain = overlays[`${type}/${name}`];
    return plain && (plain.packageId === undefined || plain.packageId === packageId) ? plain : undefined;
  };
  /** ADR-0150 D5: a read naming no package of a name two packages' rows hold is refused, naming each. */
  const refuseAmbiguous = (type: string, name: string, packageId?: string) => {
    if (packageId !== undefined || overlays[`${type}/${name}`]) return;
    const holders = Object.keys(overlays).filter((key) => key.startsWith(`${type}/${name}@`)).map((key) => key.slice(key.indexOf('@') + 1));
    if (holders.length < 2) return;
    throw Object.assign(new Error(`${type} "${name}" is held by more than one package`), {
      code: 'RESOURCE_CONFLICT', status: 409,
      refusal: { reason: 'ambiguous-in-environment', candidates: holders.map((holder) => ({ kind: 'package', packageId: holder })) },
    });
  };
  return {
    getMetaItemLayered: async ({ type, name, packageId }: { type: string; name: string; packageId?: string }) => {
      refuseAmbiguous(type, name, packageId);
      const overlay = rowAt(type, name, packageId)?.body ?? null;
      const code = declared[`${type}/${name}`] ?? null;
      return { type, name, code, overlay, effective: overlay ?? code };
    },
    getMetaItem: async ({ type, name, packageId }: { type: string; name: string; packageId?: string }) => {
      refuseAmbiguous(type, name, packageId);
      const stored = rowAt(type, name, packageId);
      // The protection envelope states the served document's `_packageId` as
      // `packageId`, as the protocol's `servedLockState` does.
      const item = stored ? { ...stored.body, ...(stored.packageId ? { _packageId: stored.packageId } : {}) } : declared[`${type}/${name}`];
      const binding = item?._packageId;
      return { type, name, item, ...(typeof binding === 'string' ? { packageId: binding } : {}) };
    },
  };
}

/** An engine whose registry declares `artifacts` by type, and nothing else. */
const engineDeclaring = (artifacts: Record<string, Row[]> = {}) => ({
  registry: { listItems: (type: string) => artifacts[type] ?? [] },
  find: async () => [],
});

// [#21789] The echo is served by the protocol's layered read as the item's
// `code` layer, and the envelope's `provenance` is read off it — so the echo
// must say what the lock says, or the read reports a lock the doors do not
// enforce (an org's own set rendered "locked by a code package").
describe('[#21789] the echo states the lock\'s verdict as its provenance', () => {
  const body = (over: Row = {}) => ({ name: 'organization_admin', label: 'Organization Administrator', objects: {}, ...over });

  it('the echo of a set no code package ships says so: `_provenance: \'org\'`', async () => {
    // An environment kernel: the registry holds no stored row.
    const engine = engineDeclaring();
    const metadata = makeMetadataService();
    const protocol = stubProtocol({ 'permission/organization_admin': { body: body() } });

    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'organization_admin', state: 'active' })).toBe('registered');
    const entry = metadata.store.get('organization_admin');
    expect({ marker: entry?._envProjection, provenance: entry?._provenance }).toEqual({ marker: true, provenance: 'org' });
  });

  it('a set the engine registry already serves is not echoed: a host kernel\'s stored row, a declared artifact', async () => {
    const hydrated = { ...body(), _packageId: 'app.crm_workspace', _provenance: 'org' };
    const shipped = { ...body({ name: 'crm_readonly' }), _packageId: 'com.example.crm', _provenance: 'package' };
    const engine = { ...engineDeclaring({ permission: [hydrated, shipped] }) } as any;
    engine.registry.getItem = (type: string, name: string) => engine.registry.listItems(type).find((i: Row) => i.name === name);
    const metadata = makeMetadataService();
    const protocol = stubProtocol({
      'permission/organization_admin': { body: body(), packageId: 'app.crm_workspace' },
      'permission/crm_readonly': { body: body({ name: 'crm_readonly', systemPermissions: ['overlaid'] }) },
    });

    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'organization_admin', state: 'active' })).toBe('skipped');
    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'crm_readonly', state: 'active' })).toBe('skipped');
    expect(metadata.store.size).toBe(0);
  });
});

describe('the echo follows the overlay: healed, dropped, skipped', () => {
  const body = (over: Row = {}) => ({ name: 'ops_reader', label: 'Ops reader', objects: {}, ...over });

  it('an echo of ours is dropped once the engine registry serves the name, and a copy leaked into the registry goes too', async () => {
    const items: Row[] = [];
    const registry = {
      listItems: (type: string) => (type === 'permission' ? items : []),
      getItem: (_type: string, name: string) => items.find((i) => i.name === name),
      unregisterItem: (_type: string, name: string) => { const i = items.findIndex((x) => x.name === name); if (i >= 0) items.splice(i, 1); },
    };
    const engine = { registry, find: async () => [] };
    const metadata = makeMetadataService();
    const overlays: Record<string, { body: Row }> = { 'permission/ops_reader': { body: body() } };
    const protocol = stubProtocol(overlays);
    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'ops_reader', state: 'active' })).toBe('registered');

    // A registry heal re-registered the metadata service's view (our echo).
    items.push({ ...metadata.store.get('ops_reader') });
    delete overlays['permission/ops_reader'];
    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'ops_reader', state: 'deleted' })).toBe('dropped');
    expect(metadata.store.has('ops_reader')).toBe(false);
    expect(items).toEqual([]);

    // A real artifact arriving later is what the registry serves. The echo
    // registered before it is left alone while the stored row exists; the
    // overlay's delete drops it, from memory only (#31698).
    metadata.registerInMemory('permission', 'ops_reader', { ...body(), _envProjection: true });
    items.push({ ...body(), _packageId: 'com.example.ops', _provenance: 'package' });
    overlays['permission/ops_reader'] = { body: body() };
    const unregistered: string[] = [];
    const unregisterInMemory = metadata.unregisterInMemory;
    metadata.unregisterInMemory = (type: string, name: string) => { unregistered.push(`${type}/${name}`); unregisterInMemory(type, name); };
    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'ops_reader', state: 'active' })).toBe('skipped');
    expect(unregistered, 'no removal while the stored row exists').toEqual([]);
    expect(items).toHaveLength(1);
    delete overlays['permission/ops_reader'];
    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'ops_reader', state: 'deleted' })).toBe('dropped');
    expect(unregistered).toEqual(['permission/ops_reader']);
    expect(items, 'the artifact stays').toHaveLength(1);
  });

  it('a delete that leaves no body drops the echo', async () => {
    const metadata = makeMetadataService();
    const overlays: Record<string, { body: Row }> = { 'permission/ops_reader': { body: body() } };
    const protocol = stubProtocol(overlays);
    await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'permission', name: 'ops_reader', state: 'active' });
    expect(metadata.store.has('ops_reader')).toBe(true);

    delete overlays['permission/ops_reader'];
    expect(await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'permission', name: 'ops_reader', state: 'deleted' })).toBe('dropped');
    expect(metadata.store.has('ops_reader')).toBe(false);
  });

  it('a delete never touches an entry that is not our echo', async () => {
    const metadata = makeMetadataService();
    metadata.registerInMemory('permission', 'ops_reader', body({ label: 'from a stack' }));
    expect(await echoSecurityCatalogMutation(stubProtocol({}), { ql: engineDeclaring(), metadata }, { type: 'permission', name: 'ops_reader', state: 'deleted' })).toBe('skipped');
    expect(metadata.store.get('ops_reader')).toMatchObject({ label: 'from a stack' });
  });

  it('skips drafts and every other type', async () => {
    const metadata = makeMetadataService();
    const protocol = stubProtocol({ 'permission/ops_reader': { body: body() }, 'object/ops_reader': { body: body() } });
    expect(await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'permission', name: 'ops_reader', state: 'draft' })).toBe('skipped');
    expect(await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'object', name: 'ops_reader', state: 'active' })).toBe('skipped');
    expect(metadata.store.size + metadata.of('object').size).toBe(0);
  });
});

describe('positions are echoed too', () => {
  const position = (over: Row = {}) => ({ name: 'field_lead', label: 'Field lead', permissionSets: ['crm_readonly'], ...over });

  it('a stored position no artifact declares is echoed tenant-authored, under the package its row is bound to', async () => {
    const metadata = makeMetadataService();
    const protocol = stubProtocol({ 'position/field_lead': { body: position(), packageId: RUNTIME_PKG } });
    expect(await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'position', name: 'field_lead', state: 'active' })).toBe('registered');
    expect(metadata.of('position').get('field_lead')).toMatchObject({
      permissionSets: ['crm_readonly'], _provenance: 'org', _packageId: RUNTIME_PKG, _envProjection: true,
    });
    expect(metadata.store.size, 'nothing lands under permission').toBe(0);
  });

  it('control: a position the engine registry declares is not echoed', async () => {
    const declared = { ...position({ permissionSets: [] }), _packageId: CODE_PKG, _provenance: 'package' };
    const metadata = makeMetadataService();
    const protocol = stubProtocol({ 'position/field_lead': { body: position(), packageId: CODE_PKG } }, { 'position/field_lead': declared });
    const engine = engineDeclaring({ position: [declared] }) as any;
    engine.registry.getItem = (type: string, name: string) => engine.registry.listItems(type).find((i: Row) => i.name === name);
    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'position', name: 'field_lead', state: 'active' })).toBe('skipped');
    expect(metadata.of('position').size).toBe(0);
  });

  it('a STACK-declared position (held by the metadata service only) is neither shadowed by an overlay of its name nor removed by its delete', async () => {
    // The way `AppPlugin` declares a stack's positions: in the metadata
    // service, not the engine registry, so the registry check cannot see it.
    const declared = position({ permissionSets: [CODE_SET] });
    const metadata = makeMetadataService();
    metadata.registerInMemory('position', 'field_lead', declared);
    const overlays: Record<string, { body: Row; packageId?: string }> = {
      'position/field_lead': { body: position({ permissionSets: ['something_else'] }) },
    };
    const protocol = stubProtocol(overlays);
    const deps = { ql: engineDeclaring(), metadata };

    expect(await echoSecurityCatalogMutation(protocol, deps, { type: 'position', name: 'field_lead', state: 'active' })).toBe('skipped');
    expect(metadata.of('position').get('field_lead')).toBe(declared);
    // The boot pass takes the same path.
    const engine = { ...engineDeclaring(), find: async () => [{ type: 'position', name: 'field_lead', state: 'active', organization_id: null }] };
    expect(await echoStoredSecurityCatalogOverlays(protocol, { ql: engine, metadata })).toBe(0);
    expect(metadata.of('position').get('field_lead')).toBe(declared);

    delete overlays['position/field_lead'];
    expect(await echoSecurityCatalogMutation(protocol, deps, { type: 'position', name: 'field_lead', state: 'deleted' })).toBe('skipped');
    expect(metadata.of('position').get('field_lead')).toBe(declared);
  });

  it('a position saved through the real environment protocol resolves in the catalog', async () => {
    const { protocol, catalog } = boot();
    await protocol.saveMetaItem({ type: 'position', name: 'field_lead', item: position({ permissionSets: [CODE_SET] }) });
    expect(await catalog.resolve('position', 'field_lead')).toMatchObject({ source: 'metadata', definition: { permissionSets: [CODE_SET] } });
  });
});

describe('the boot pass echoes every stored env-wide overlay, and only those', () => {
  it('registers active env-wide rows of both types; organization rows and drafts are left alone', async () => {
    const rows: Row[] = [
      { type: 'permission', name: 'env_set', state: 'active', organization_id: null },
      { type: 'permissions', name: 'legacy_plural_set', state: 'active', organization_id: null },
      { type: 'position', name: 'env_position', state: 'active', organization_id: null },
      { type: 'permission', name: 'org_set', state: 'active', organization_id: 'org_a' },
    ];
    rows.forEach((row, i) => { (row as Row & { id?: string }).id = `row_${i}`; });
    const engine = {
      registry: { listItems: () => [] },
      // [ADR-0131 D7] The engine shapes a read to the declared columns (no
      // `organization_id`): an organization's row is told apart through the
      // driver's physical column.
      find: async (object: string, query: { where: Row; limit?: number }) => {
        const hits = object === 'sys_metadata' ? rows.filter((row) => matches(row, query.where)) : [];
        const bounded = typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
        return bounded.map(({ organization_id: _physical, ...declared }) => declared);
      },
      getDriverForObject: (object: string) => object !== 'sys_metadata' ? undefined : {
        dialectName: 'sqlite',
        async execute(sql: string) {
          return /column_name/.test(sql)
            ? [{ column_name: 'id' }, { column_name: 'organization_id' }]
            : rows.filter((r) => r.organization_id != null && r.organization_id !== '')
              .map((r) => ({ id: (r as Row & { id?: string }).id, organization_id: r.organization_id }));
        },
      },
    };
    const overlays: Record<string, { body: Row }> = {};
    for (const row of rows) {
      const type = row.type.replace(/s$/, '');
      overlays[`${type}/${row.name}`] = { body: { name: row.name, label: row.name } };
    }
    const metadata = makeMetadataService();

    expect(await echoStoredSecurityCatalogOverlays(stubProtocol(overlays), { ql: engine, metadata })).toBe(3);
    expect([...metadata.store.keys()].sort()).toEqual(['env_set', 'legacy_plural_set']);
    expect([...metadata.of('position').keys()]).toEqual(['env_position']);
  });

  it('a metadata table it cannot read is said, not read as "no overlays"', async () => {
    const warnings: string[] = [];
    const engine = { registry: { listItems: () => [] }, find: async () => { throw new Error('no such table: sys_metadata'); } };
    const out = await echoStoredSecurityCatalogOverlays(stubProtocol({}), {
      ql: engine, metadata: makeMetadataService(), logger: { warn: (message: string) => { warnings.push(message); } },
    });
    expect(out).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('grants nothing');
  });
});


/** A slotted `permission` store: `slots` maps a package (or '' for the bare slot) to its item. */
function slottedMetadataService(NAME = 'ops_reader') {
  const slots = new Map<string, Row>();
  const removals: string[] = [];
  const storageDeletes: string[] = [];
  const holders = () => [...slots.keys()].filter((k) => k !== '');
  const refusal = () => Object.assign(new Error(`permission set "${NAME}" is held by more than one package`), {
    code: 'RESOURCE_CONFLICT', status: 409,
    refusal: { reason: 'ambiguous-in-environment', candidates: holders().map((packageId) => ({ kind: 'package', packageId })) },
  });
  const announced: string[] = [];
  const removeInMemory = (packageId: string | null | undefined, notify?: boolean) => {
    const what = packageId === undefined ? '(by name)' : packageId ?? '(package-less)';
    if (packageId === undefined) {
      if (holders().length > 1) throw refusal();
      slots.clear();
    } else slots.delete(packageId ?? '');
    removals.push(what);
    if (notify !== false) announced.push(what);
  };
  return {
    slots,
    removals,
    announced,
    storageDeletes,
    registerInMemory: (_type: string, _name: string, data: Row) => {
      const own = typeof data._packageId === 'string' ? data._packageId : undefined;
      if (own !== undefined) {
        if (holders().filter((h) => h !== own).length === 0) slots.delete('');
        slots.set(own, data);
      } else slots.set(holders().length === 1 ? holders()[0]! : '', data);
    },
    get: (_type: string, _name: string, packageId?: string) => {
      if (packageId !== undefined) return slots.get(packageId);
      if (holders().length > 1) throw refusal();
      return holders().length === 1 ? slots.get(holders()[0]!) : slots.get('');
    },
    list: () => [...slots.values()],
    unregisterInMemory: (_type: string, _name: string, options?: { packageId?: string | null; notify?: boolean }) =>
      removeInMemory(options?.packageId, options?.notify),
    unregister: async (_type: string, _name: string, options?: { packageId?: string; notify?: boolean }) => {
      storageDeletes.push(options?.packageId ?? '(by name)');
      removeInMemory(options?.packageId, options?.notify);
    },
  };
}

/**
 * [#32162, ADR-0150 D4] `permission` is stored per `(package, name)` in the
 * metadata service, and our echo carries its owner as `_packageId`, so it
 * fills the owner's slot. When the stored row's binding moves (a namespace
 * rename, a stamp, a re-bind), the next echo fills the NEW owner's slot — the
 * write never replaces another package's — and the old owner's slot, whose own
 * row is gone, is dropped by its package. Left in place, two slots of the name
 * refused every later read naming no package, and the projector's own bare
 * read threw `409`, failing the save that triggered it.
 *
 * The double answers as `@objectstack/metadata`'s slotted store does (its
 * write, read and removal rules are pinned there): a package's item in its own
 * slot, a read naming no package refused across two package slots, a removal
 * naming a package taking that slot only. [#31698] `unregisterInMemory` is the
 * manager's in-memory removal, announced unless `notify: false`
 * (`announced`); `unregister` is the item's removal, which deletes the slot's
 * stored row first (`storageDeletes`) — the echo must never call it. The real
 * manager's two removals are pinned in `@objectstack/metadata`
 * (`metadata-manager-cluster.test.ts`, the #31698 pins).
 */
describe('[#32162] a re-bound set\'s echo leaves one slot, never two', () => {
  const NAME = 'ops_reader';
  const P = 'com.acme.alpha';
  const Q = 'com.acme.beta';
  const body = () => ({ name: NAME, label: 'Ops reader', objects: {} });

  it('the owner moves from alpha to beta: alpha\'s stale echo slot is dropped by package, beta\'s registered (BASE: two slots, then 409)', async () => {
    const metadata = slottedMetadataService();
    const overlays: Record<string, { body: Row; packageId?: string }> = { [`permission/${NAME}`]: { body: body(), packageId: P } };
    const protocol = stubProtocol(overlays);
    const echo = (state: string) => echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'permission', name: NAME, state });

    expect(await echo('active')).toBe('registered');
    expect([...metadata.slots.keys()]).toEqual([P]);

    overlays[`permission/${NAME}`] = { body: body(), packageId: Q };
    expect(await echo('active')).toBe('registered');
    expect([...metadata.slots.keys()], 'one slot, the new owner\'s').toEqual([Q]);
    expect(metadata.removals, 'the stale slot went by its package, never by name').toEqual([P]);
    expect(metadata.announced, '[#31698] announced by its package: each peer drops that slot alone').toEqual([P]);
    expect(metadata.get('permission', NAME)).toMatchObject({ _packageId: Q, _envProjection: true });

    // The next save of the name echoes again, and the delete drops the one echo.
    expect(await echo('active')).toBe('registered');
    delete overlays[`permission/${NAME}`];
    expect(await echo('deleted')).toBe('dropped');
    expect(metadata.slots.size).toBe(0);
    expect(metadata.removals).toEqual([P, Q]);
    expect(metadata.announced, 'the overlay\'s delete still announces its drop').toEqual([P, Q]);
    expect(metadata.storageDeletes, '[#31698] an echo removal never deletes a stored row').toEqual([]);
  });

  it('a binding read that fails is not a moved binding: the owner\'s slot stays, and its package\'s address keeps serving the set (epic N1)', async () => {
    const metadata = slottedMetadataService();
    const overlays: Record<string, { body: Row; packageId?: string }> = { [`permission/${NAME}`]: { body: body(), packageId: P } };
    const protocol: any = stubProtocol(overlays);
    const echo = () => echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'permission', name: NAME, state: 'active' });
    expect(await echo()).toBe('registered');
    expect([...metadata.slots.keys()]).toEqual([P]);

    protocol.getMetaItem = async () => { throw new Error('binding read down'); };
    expect(await echo()).toBe('registered');
    expect(metadata.removals, 'nothing dropped on an unread binding').toEqual([]);
    expect([...metadata.slots.keys()], 'the owner\'s slot holds the re-echo').toEqual([P]);
    // [#31698] …stamped with the package that slot names, never unowned.
    expect(metadata.get('permission', NAME, P)).toMatchObject({ name: NAME, _envProjection: true, _packageId: P });

    // [#31698] …so a re-bind after it still finds alpha's echo by its package and drops it (BASE: the
    // unstamped re-echo hid alpha's slot from the drop, and beta's echo made two slots of the name).
    protocol.getMetaItem = stubProtocol(overlays).getMetaItem;
    overlays[`permission/${NAME}`] = { body: body(), packageId: Q };
    expect(await echo()).toBe('registered');
    expect([...metadata.slots.keys()]).toEqual([Q]);
    expect(metadata.removals).toEqual([P]);
    expect(metadata.storageDeletes).toEqual([]);
  });

  it('two echo slots already present (an echo before this change): the delete drops each by its package', async () => {
    const metadata = slottedMetadataService();
    metadata.registerInMemory('permission', NAME, { ...body(), _packageId: P, _envProjection: true });
    metadata.registerInMemory('permission', NAME, { ...body(), _packageId: Q, _envProjection: true });
    expect(await echoSecurityCatalogMutation(stubProtocol({}), { ql: engineDeclaring(), metadata }, { type: 'permission', name: NAME, state: 'deleted' })).toBe('dropped');
    expect(metadata.slots.size).toBe(0);
    expect(metadata.removals).toEqual([P, Q]);
  });

  it('a declaration another package holds beside our echo is never removed, and never echoed over', async () => {
    const metadata = slottedMetadataService();
    metadata.registerInMemory('permission', NAME, { ...body(), _packageId: P, label: 'from a stack' });
    metadata.registerInMemory('permission', NAME, { ...body(), _packageId: Q, _envProjection: true });
    const overlays: Record<string, { body: Row; packageId?: string }> = { [`permission/${NAME}`]: { body: body(), packageId: Q } };
    // [#31698] The echo fills its owner's slot only (ADR-0150 D4), so beta's
    // row is echoed beside alpha's declaration, which it does not touch.
    expect(await echoSecurityCatalogMutation(stubProtocol(overlays), { ql: engineDeclaring(), metadata }, { type: 'permission', name: NAME, state: 'active' })).toBe('registered');
    expect(metadata.slots.get(P)).toMatchObject({ label: 'from a stack' });
    delete overlays[`permission/${NAME}`];
    expect(await echoSecurityCatalogMutation(stubProtocol(overlays), { ql: engineDeclaring(), metadata }, { type: 'permission', name: NAME, state: 'deleted' })).toBe('dropped');
    expect([...metadata.slots.keys()]).toEqual([P]);
    expect(metadata.slots.get(P)).toMatchObject({ label: 'from a stack' });
    expect(metadata.removals).toEqual([Q]);
  });

  it('CONTROL the owner stays put: one slot, no removal', async () => {
    const metadata = slottedMetadataService();
    const overlays: Record<string, { body: Row; packageId?: string }> = { [`permission/${NAME}`]: { body: body(), packageId: P } };
    const protocol = stubProtocol(overlays);
    await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'permission', name: NAME, state: 'active' });
    await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, { type: 'permission', name: NAME, state: 'active' });
    expect([...metadata.slots.keys()]).toEqual([P]);
    expect(metadata.removals).toEqual([]);
  });
});


/**
 * [ADR-0150 D4, #31698] The echo is kept per `(package, name)`.
 *
 * Two packages each store a set of one name (a cross-namespace pair, ADR-0150
 * D9). Each row's echo fills its own package's slot: a save names the package
 * its row landed in, the echo reads that row at that address, and every other
 * echo slot of the name is judged by its own row. BASE: the event named no
 * package and the echo read the name with no package — refused across the two
 * holders, the save's projector failed; answered with no row, every echo of the
 * name was dropped through the metadata service's ITEM removal, which deleted
 * each package's stored row with it.
 */
describe('[#31698] one package\'s save never moves, drops or deletes another package\'s echo', () => {
  const NAME = 'ops_reader';
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  const rows = (): Record<string, { body: Row; packageId?: string }> => ({
    [`permission/${NAME}@${A}`]: { body: { name: NAME, label: 'alpha reader', objects: {} } },
    [`permission/${NAME}@${B}`]: { body: { name: NAME, label: 'beta reader', objects: {} } },
  });
  const echo = (protocol: unknown, metadata: unknown, packageId: string | null | undefined, state = 'active') =>
    echoSecurityCatalogMutation(protocol, { ql: engineDeclaring(), metadata }, {
      type: 'permission', name: NAME, state, ...(packageId !== undefined ? { packageId } : {}),
    });

  it('saving beta\'s set leaves alpha\'s echo and alpha\'s address untouched (BASE: every echo dropped, every row deleted)', async () => {
    const metadata = slottedMetadataService(NAME);
    const overlays = rows();
    const protocol = stubProtocol(overlays);
    expect(await echo(protocol, metadata, A)).toBe('registered');
    expect(await echo(protocol, metadata, B)).toBe('registered');
    const alpha = metadata.get('permission', NAME, A);
    expect(alpha).toMatchObject({ label: 'alpha reader', _packageId: A });

    overlays[`permission/${NAME}@${B}`] = { body: { name: NAME, label: 'beta reader v2', objects: {} } };
    expect(await echo(protocol, metadata, B)).toBe('registered');

    expect(metadata.get('permission', NAME, A), 'alpha\'s echo is the same item').toBe(alpha);
    expect(metadata.get('permission', NAME, B)).toMatchObject({ label: 'beta reader v2', _packageId: B });
    expect(metadata.removals).toEqual([]);
    expect(metadata.storageDeletes, 'no stored row is ever deleted by the echo').toEqual([]);
  });

  it('deleting beta\'s row drops beta\'s echo alone, from memory, announced by its package', async () => {
    const metadata = slottedMetadataService(NAME);
    const overlays = rows();
    const protocol = stubProtocol(overlays);
    await echo(protocol, metadata, A);
    await echo(protocol, metadata, B);

    delete overlays[`permission/${NAME}@${B}`];
    expect(await echo(protocol, metadata, B, 'deleted')).toBe('dropped');

    expect([...metadata.slots.keys()]).toEqual([A]);
    expect(metadata.removals).toEqual([B]);
    expect(metadata.announced).toEqual([B]);
    expect(metadata.storageDeletes).toEqual([]);
  });

  it('an event naming no package (an emitter that predates the field) echoes each holder\'s row by its package', async () => {
    const metadata = slottedMetadataService(NAME);
    expect(await echo(stubProtocol(rows()), metadata, undefined)).toBe('registered');
    expect([...metadata.slots.keys()].sort()).toEqual([A, B]);
    expect(metadata.get('permission', NAME, B)).toMatchObject({ label: 'beta reader', _packageId: B });
    expect(metadata.storageDeletes).toEqual([]);
  });

  it('the doors name the package a set\'s row lands in: publish into a package, delete there, save naming none', async () => {
    const { protocol } = boot();
    const events: Array<{ state?: string; packageId?: unknown }> = [];
    protocol.registerMutationProjector('permission', async (evt: any) => { events.push({ state: evt.state, packageId: evt.packageId }); });

    await publishThroughPackageDoor(protocol, RUNTIME_PKG, runtimeDefault());
    await protocol.deleteMetaItem({ type: 'permission', name: RUNTIME_SET, packageId: RUNTIME_PKG });
    await protocol.saveMetaItem({ type: 'permission', name: 'org_member_default', item: { ...runtimeDefault(), name: 'org_member_default' } });

    expect(events.filter((evt) => evt.state !== 'draft')).toEqual([
      { state: 'active', packageId: RUNTIME_PKG },
      { state: 'deleted', packageId: RUNTIME_PKG },
      { state: 'active', packageId: null },
    ]);
  });

  it('the boot pass echoes each stored row by its package', async () => {
    const stored = [A, B].map((packageId, i) => ({ id: `row_${i}`, type: 'permission', name: NAME, state: 'active', package_id: packageId }));
    const engine = { ...engineDeclaring(), find: async (object: string, query: { where: Row }) =>
      (object === 'sys_metadata' ? stored.filter((row) => matches(row, query.where)) : []) };
    const metadata = slottedMetadataService(NAME);
    expect(await echoStoredSecurityCatalogOverlays(stubProtocol(rows()), { ql: engine, metadata })).toBe(2);
    expect([...metadata.slots.keys()].sort()).toEqual([A, B]);
  });
});
