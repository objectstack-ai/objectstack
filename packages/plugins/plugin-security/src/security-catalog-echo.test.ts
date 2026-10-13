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
import { echoSecurityCatalogMutation, echoStoredSecurityCatalogOverlays, registerSecurityCatalogEcho } from './security-catalog-echo.js';
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
    registered,
    listItems: (type: string) => (type === 'permission' ? codeArtifacts : type === 'position' ? [...positions.values()] : []),
    getItem: (type: string, name: string) => registry.listItems(type).find((item) => item.name === name),
    getArtifactItem: (type: string, name: string) =>
      (type === 'permission' ? codeArtifacts.find((item) => item.name === name) : undefined),
    isPackageDisabled: () => false,
    getPackage: () => undefined,
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
 */
function stubProtocol(overlays: Record<string, { body: Row; packageId?: string }>, declared: Record<string, Row> = {}) {
  return {
    getMetaItemLayered: async ({ type, name }: { type: string; name: string }) => {
      const overlay = overlays[`${type}/${name}`]?.body ?? null;
      const code = declared[`${type}/${name}`] ?? null;
      return { type, name, code, overlay, effective: overlay ?? code };
    },
    getMetaItem: async ({ type, name }: { type: string; name: string }) => {
      const stored = overlays[`${type}/${name}`];
      return { type, name, item: stored ? { ...stored.body, ...(stored.packageId ? { _packageId: stored.packageId } : {}) } : declared[`${type}/${name}`] };
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
    // The registry holds the stored row the way a host kernel's hydrator
    // registers it — a runtime package id stamped on, tenant provenance over it.
    const engine = engineDeclaring({ permission: [{ ...body(), _packageId: 'app.crm_workspace', _provenance: 'org' }] });
    const metadata = makeMetadataService();
    const protocol = stubProtocol({ 'permission/organization_admin': { body: body() } });

    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'organization_admin', state: 'active' })).toBe('registered');
    const entry = metadata.store.get('organization_admin');
    expect({ marker: entry?._envProjection, provenance: entry?._provenance }).toEqual({ marker: true, provenance: 'org' });
  });

  it('control: the echo of a legacy overlay of a code-shipped set does NOT claim tenant provenance, nor an owner', async () => {
    const shipped = { ...body({ systemPermissions: ['declared.only'] }), _packageId: 'com.example.crm', _provenance: 'package' };
    const engine = engineDeclaring({ permission: [shipped] });
    const metadata = makeMetadataService();
    const protocol = stubProtocol(
      { 'permission/organization_admin': { body: body({ systemPermissions: ['overlaid'] }), packageId: 'com.example.crm' } },
      { 'permission/organization_admin': shipped },
    );

    await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'organization_admin', state: 'active' });
    const entry = metadata.store.get('organization_admin');
    expect(entry?.systemPermissions, 'precondition: the overlay was echoed').toEqual(['overlaid']);
    expect({ marker: entry?._envProjection, provenance: entry?._provenance ?? null, owner: entry?._packageId ?? null })
      .toEqual({ marker: true, provenance: null, owner: null });
  });
});

describe('the echo follows the overlay: healed, dropped, skipped', () => {
  const body = (over: Row = {}) => ({ name: 'ops_reader', label: 'Ops reader', objects: {}, ...over });

  it('a delete over a DECLARED set heals the echo back to the declared body, unmarked', async () => {
    const declared = body({ systemPermissions: ['declared.only'] });
    const engine = engineDeclaring({ permission: [declared] });
    const metadata = makeMetadataService();
    const overlays: Record<string, { body: Row }> = { 'permission/ops_reader': { body: body({ systemPermissions: ['overlaid'] }) } };
    const protocol = stubProtocol(overlays, { 'permission/ops_reader': declared });
    await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'ops_reader', state: 'active' });
    expect(metadata.store.get('ops_reader')?.systemPermissions).toEqual(['overlaid']);

    delete overlays['permission/ops_reader'];
    expect(await echoSecurityCatalogMutation(protocol, { ql: engine, metadata }, { type: 'permission', name: 'ops_reader', state: 'deleted' })).toBe('healed');
    const healed = metadata.store.get('ops_reader');
    expect(healed?.systemPermissions).toEqual(['declared.only']);
    expect(healed?._envProjection).toBeUndefined();
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

  it('control: an overlay of a declared position claims no tenant provenance', async () => {
    const declared = { ...position({ permissionSets: [] }), _packageId: CODE_PKG, _provenance: 'package' };
    const metadata = makeMetadataService();
    const protocol = stubProtocol({ 'position/field_lead': { body: position(), packageId: CODE_PKG } }, { 'position/field_lead': declared });
    await echoSecurityCatalogMutation(protocol, { ql: engineDeclaring({ position: [declared] }), metadata }, { type: 'position', name: 'field_lead', state: 'active' });
    const entry = metadata.of('position').get('field_lead');
    expect(entry?.permissionSets, 'precondition: the overlay was echoed').toEqual(['crm_readonly']);
    expect({ provenance: entry?._provenance ?? null, owner: entry?._packageId ?? null }).toEqual({ provenance: null, owner: null });
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
    const engine = {
      registry: { listItems: () => [] },
      find: async (object: string, query: { where: Row; limit?: number }) => {
        const hits = object === 'sys_metadata' ? rows.filter((row) => matches(row, query.where)) : [];
        return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
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
