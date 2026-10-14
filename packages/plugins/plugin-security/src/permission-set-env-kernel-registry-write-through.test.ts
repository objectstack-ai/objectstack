// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23298 and #23233 — a permission set published through the metadata door is
 * in the security catalog at once, under the package it is bound to, on a host
 * kernel and on an environment kernel that hydrates its own `sys_metadata`. The
 * engine registry holds it, the catalog resolves it with its owner, and an
 * `isDefault` set records its one `everyone` suggestion. No list read and no
 * rebuild happen in between.
 *
 * ## Why this lives here
 *
 * The suggestion collector (`syncAudienceBindingSuggestions`) is this
 * package's. The writes that feed it are `metadata-protocol`'s (aliased to
 * source in `vitest.config.ts`), so the suite runs the protocol in this
 * checkout. The engine is the real `ObjectQL` (aliased to source too) with its
 * real `SchemaRegistry`, over an in-memory driver.
 *
 * ## The two halves of the write
 *
 *  - **#23298, the body.** The registry write-through skipped every type but
 *    `object` on any kernel with an `environmentId`, so on an environment
 *    kernel a set published after boot was in no reader at all (the plugin's
 *    permission-set echo is no longer registered). It now registers wherever
 *    the registry takes the kernel's stored rows: an unscoped kernel, or an
 *    environment kernel that hydrated its own store (`loadMetaFromDb`, which
 *    `ObjectQLPlugin.start()` calls under `hydrateMetadataFromDb`).
 *  - **#23233, the owner.** The hydrator the boot and the write-through share
 *    registered the body without the row's package binding, so the catalog
 *    served a runtime package's set unowned (on a host kernel until a list
 *    read stamped it), and the suggestion collector, which reads the owner
 *    from the catalog entry alone, skipped it. The hydrator now stamps the
 *    binding as `_packageId`. The bodies below name no `packageId` of their
 *    own: the owner comes from the binding only.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindSecurityCatalogReader, createSecurityCatalogReader } from '@objectstack/core';
import {
  SysMetadataAuditObject,
  SysMetadataCommitObject,
  SysMetadataHistoryObject,
  SysMetadataObject,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { ObjectQL } from '@objectstack/objectql';
import { SysOrganization } from '@objectstack/platform-objects/identity';
import { SysAudienceBindingSuggestion } from './objects/sys-audience-binding-suggestion.object.js';
import { syncAudienceBindingSuggestions } from './suggested-audience-bindings.js';
import { declareEveryoneBaseline } from './builtin-positions.js';

const ENV = 'env_tenant';
/** A writable runtime package — never installed as code, so nothing ships its sets. */
const RUNTIME_PKG = 'app.crm_workspace';
const SET = 'workspace_member_default';
const SECURITY_PACKAGE = 'com.objectstack.plugin-security';
const DEFAULT_ORG = 'org_default';

type Stores = Map<string, Map<string, Record<string, unknown>>>;
type Row = Record<string, unknown>;

/** In-memory driver, copied from `objectql`'s `environment-overlay-email-locale-restart.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
  // driver ANDs them.
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const rowVal = row[k];
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      const a = rowVal === undefined ? null : rowVal;
      const b = expected === undefined ? null : expected;
      if (a !== b) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${randomUUID()}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

/** The kernel `metadata` service as the catalog reads it, holding nothing: no echo is registered. */
function makeMetadataService() {
  return { get: (_type: string, _name: string) => undefined, list: (_type: string) => [] };
}

/** An installed code package that ships its own default set. */
const CODE_PKG = 'com.example.crm';
const CODE_SET = 'crm_readonly';

type Kernel = 'host' | 'environment';

/**
 * One kernel: the engine with the tables this flow writes and a code package
 * installed, the protocol (an `environmentId` for an environment kernel),
 * booted as `ObjectQLPlugin.start()` boots it (`loadMetaFromDb`: a host
 * kernel always, an environment kernel under `hydrateMetadataFromDb`), the
 * catalog bound to the engine, and the built-in `everyone` position declared.
 */
async function boot(kind: Kernel) {
  const stores: Stores = new Map([
    ['sys_organization', new Map([[DEFAULT_ORG, { id: DEFAULT_ORG, slug: 'default', name: 'Default' }]])],
  ]);
  const engine = new ObjectQL();
  engine.registerDriver(makeMemoryDriver(stores), true);
  await engine.init();
  for (const o of [
    SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject,
    SysOrganization, SysAudienceBindingSuggestion,
  ]) {
    engine.registry.registerObject(o as any, 'test-package');
  }
  engine.registerApp({
    id: CODE_PKG,
    name: 'example_crm',
    version: '1.0.0',
    permissions: [{ name: CODE_SET, label: 'CRM read-only', isDefault: true, objects: {} }],
  });
  const metadata = makeMetadataService();
  const protocol = new ObjectStackProtocolImplementation(
    engine as never,
    () => new Map<string, unknown>([['metadata', metadata]]),
    kind === 'environment' ? ENV : undefined,
  );
  expect(await protocol.loadMetaFromDb()).toMatchObject({ errors: 0, storeUnavailable: false });
  const catalog = createSecurityCatalogReader({ registry: engine.registry as never, metadata });
  bindSecurityCatalogReader(engine, catalog);
  declareEveryoneBaseline(engine.registry, SECURITY_PACKAGE, ['member_default']);
  return { stores, engine, protocol, catalog };
}

const suggestionRows = (stores: Stores, set: string) =>
  Array.from(stores.get('sys_audience_binding_suggestion')?.values() ?? [])
    .filter((row) => row.permission_set_name === set);

/** A runtime package's new default set. Its body names no `packageId`: the owner is the row's binding. */
const newDefaultSet = (): Row => ({ name: SET, label: 'Workspace member', isDefault: true, objects: {} });

/** The metadata-door publish of the set, bound to the runtime package. */
async function publishIntoRuntimePackage(protocol: ObjectStackProtocolImplementation) {
  const body = newDefaultSet();
  expect(body, 'precondition: the body names no package').not.toHaveProperty('packageId');
  expect(await protocol.saveMetaItem({
    type: 'permission', name: SET, item: body, packageId: RUNTIME_PKG, mode: 'publish',
  })).toMatchObject({ success: true });
}

const savedWritable = process.env.OS_METADATA_WRITABLE;
beforeEach(() => {
  delete process.env.OS_METADATA_WRITABLE;
  ObjectStackProtocolImplementation.resetEnvWritableCache();
  resetEnvWritableMetadataTypes();
});
afterEach(() => {
  if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
  else process.env.OS_METADATA_WRITABLE = savedWritable;
  ObjectStackProtocolImplementation.resetEnvWritableCache();
  resetEnvWritableMetadataTypes();
});

describe('#23298 — a NEW permission set published on an environment kernel is in the security catalog at once', () => {
  it('the registry holds it, the catalog resolves it under its package, and its isDefault records one pending everyone suggestion', async () => {
    const { stores, engine, protocol, catalog } = await boot('environment');
    expect(await catalog.resolve('permission', SET), 'precondition: a new set').toBeUndefined();

    await publishIntoRuntimePackage(protocol);

    // No list read, no rebuild: straight to the readers.
    expect(engine.registry.getItem('permission', SET)).toMatchObject({ name: SET, isDefault: true });
    expect(await catalog.resolve('permission', SET)).toMatchObject({
      source: 'registry', packageId: RUNTIME_PKG, definition: { name: SET, isDefault: true },
    });

    await syncAudienceBindingSuggestions(engine);
    expect(suggestionRows(stores, SET)).toEqual([
      expect.objectContaining({
        package_id: RUNTIME_PKG, anchor: 'everyone', status: 'pending', deployment_decision: false,
      }),
    ]);
  });
});

describe('#23233 — on a host kernel, the set is owned from the publish onward, with no list read in between', () => {
  it('records exactly one pending everyone suggestion, under the package the set is bound to', async () => {
    const { stores, engine, protocol } = await boot('host');
    await publishIntoRuntimePackage(protocol);

    await syncAudienceBindingSuggestions(engine);
    expect(suggestionRows(stores, SET)).toEqual([
      expect.objectContaining({
        package_id: RUNTIME_PKG, anchor: 'everyone', status: 'pending', deployment_decision: false,
      }),
    ]);
  });

  it('the catalog read and the protocol read name the same owner', async () => {
    const { protocol, catalog } = await boot('host');
    await publishIntoRuntimePackage(protocol);

    // The catalog first: the protocol's by-name read is not a list read, but
    // it is read second so nothing it does can stand in for the publish.
    const resolved = await catalog.resolve('permission', SET);
    const served: any = await protocol.getMetaItem({ type: 'permission', name: SET });

    expect(resolved).toMatchObject({ source: 'registry', packageId: RUNTIME_PKG });
    expect(served?.item?._packageId).toBe(RUNTIME_PKG);
  });
});

describe('#23233 — controls: the owner is the binding, never invented', () => {
  it.each(['host', 'environment'] as const)(
    'a code package\'s default set is unchanged (%s kernel): its artifact, its owner and its suggestion',
    async (kind) => {
      const { stores, engine, catalog } = await boot(kind);

      expect(await catalog.resolve('permission', CODE_SET)).toMatchObject({ source: 'registry', packageId: CODE_PKG });
      await syncAudienceBindingSuggestions(engine);
      expect(suggestionRows(stores, CODE_SET)).toEqual([
        expect.objectContaining({ package_id: CODE_PKG, anchor: 'everyone', status: 'pending' }),
      ]);
    },
  );

  it('a set saved into no package stays unowned and records no suggestion', async () => {
    const { stores, engine, protocol, catalog } = await boot('host');
    expect(await protocol.saveMetaItem({
      type: 'permission', name: 'org_member_default', item: { ...newDefaultSet(), name: 'org_member_default' },
    })).toMatchObject({ success: true });

    const resolved = await catalog.resolve('permission', 'org_member_default');
    expect(resolved).toMatchObject({ source: 'registry' });
    expect(resolved).not.toHaveProperty('packageId');
    await syncAudienceBindingSuggestions(engine);
    expect(suggestionRows(stores, 'org_member_default')).toEqual([]);
  });
});
