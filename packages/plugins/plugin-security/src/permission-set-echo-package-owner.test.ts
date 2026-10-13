// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23233 — the permission-set projection's registry echo names the package
 * its stored row is bound to, so a set published into a writable runtime
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
 * projection's echo. The catalog takes its owner from `_packageId` alone
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
import { projectPermissionMutation, registerPermissionSetProjection } from './permission-set-projection.js';
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

/** The kernel `metadata` service as the projection and the catalog use it: registry-first, in memory. */
function makeMetadataService() {
  const store = new Map<string, Row>();
  return {
    store,
    registerInMemory: (_type: string, name: string, data: Row) => { store.set(name, data); },
    get: (_type: string, name: string) => store.get(name),
    list: (_type: string) => [...store.values()],
    unregister: (_type: string, name: string) => { store.delete(name); },
  };
}

/** One environment kernel: the protocol, the projection wired as the security plugin wires it, the catalog bound. */
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
  expect(registerPermissionSetProjection(protocol, { ql: engine, metadata, logger })).toBe(true);
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
  // The projected `sys_permission_set` row keeps `managed_by: 'admin'` and no
  // `package_id`: the owner rides on the echo the catalog reads, and nothing
  // that gates an admin's edit reads the echo's `_packageId`.
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
    expect((engine.tables.sys_permission_set ?? []).filter((row) => row.name === RUNTIME_SET)).toEqual([
      expect.objectContaining({ label: 'Edited', managed_by: 'admin' }),
    ]);
    expect(engine.tables.sys_permission_set.find((row) => row.name === RUNTIME_SET)?.package_id ?? null).toBeNull();
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
    // No overlay row, so the projection registered no echo of it at all.
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

    const out = await projectPermissionMutation(protocol, { ql: engine, metadata, logger: { warn: (m: string, meta?: any) => warnings.push({ message: m, meta }) } }, {
      type: 'permission', name: RUNTIME_SET, state: 'active',
    });

    expect(out?.seeded).toBe(1);
    const echo = metadata.store.get(RUNTIME_SET);
    expect(echo).toMatchObject({ name: RUNTIME_SET, _provenance: 'org', _envProjection: true });
    expect(echo).not.toHaveProperty('_packageId');
    expect(warnings.filter((w) => w.meta?.name === RUNTIME_SET)).toHaveLength(1);
  });
});
