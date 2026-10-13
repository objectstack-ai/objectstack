// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23298 — on an environment kernel that hydrates its own `sys_metadata`, a
 * permission set published through the metadata door is in the security
 * catalog at once: the engine registry holds it, the catalog resolves it, and
 * an `isDefault` set declared by its package records its `everyone`
 * suggestion. No list read and no rebuild happen in between.
 *
 * ## Why this lives here
 *
 * The suggestion collector (`syncAudienceBindingSuggestions`) is this
 * package's. The write that feeds it is `metadata-protocol`'s registry
 * write-through (aliased to source in `vitest.config.ts`), so the suite runs
 * the protocol in this checkout. The engine is the real `ObjectQL` (aliased to
 * source too) with its real `SchemaRegistry`, over an in-memory driver.
 *
 * ## The topology
 *
 * An ENVIRONMENT kernel (`environmentId` set) booted as `ObjectQLPlugin.start()`
 * boots one with `hydrateMetadataFromDb`: the protocol's own store hydrated
 * into the engine's own registry (`loadMetaFromDb`). The catalog reads that
 * registry first, and the door's own registry write-through is what puts a
 * saved set there. Before #23298 that write-through skipped every type but
 * `object` on any kernel with an `environmentId`; with the plugin's
 * permission-set echo no longer registered, a set published after boot was
 * then in no reader at all.
 *
 * The set's body declares the spec's `packageId` (ADR-0086 D3), as the input
 * that was measured does. A set whose body names no package is served by the
 * catalog without an owner, because the registry entry carries no
 * `_packageId`: that is the open host-kernel remainder of the permission-set
 * owner card, which this suite neither pins nor changes.
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

/**
 * One environment kernel: the engine with the tables this flow writes, the
 * protocol's own store hydrated into the engine's own registry, the catalog
 * bound to the engine, and the built-in `everyone` position declared.
 */
async function bootEnvironmentKernel(stores: Stores) {
  const engine = new ObjectQL();
  engine.registerDriver(makeMemoryDriver(stores), true);
  await engine.init();
  for (const o of [
    SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject,
    SysOrganization, SysAudienceBindingSuggestion,
  ]) {
    engine.registry.registerObject(o as any, 'test-package');
  }
  const metadata = makeMetadataService();
  const protocol = new ObjectStackProtocolImplementation(
    engine as never,
    () => new Map<string, unknown>([['metadata', metadata]]),
    ENV,
  );
  // `ObjectQLPlugin.start()` on a kernel with `hydrateMetadataFromDb`.
  expect(await protocol.loadMetaFromDb()).toMatchObject({ errors: 0, storeUnavailable: false });
  const catalog = createSecurityCatalogReader({ registry: engine.registry as never, metadata });
  bindSecurityCatalogReader(engine, catalog);
  declareEveryoneBaseline(engine.registry, SECURITY_PACKAGE, ['member_default']);
  return { engine, protocol, catalog };
}

const suggestionRows = (stores: Stores, set: string) =>
  Array.from(stores.get('sys_audience_binding_suggestion')?.values() ?? [])
    .filter((row) => row.permission_set_name === set);

/** A new default set, its body declaring the package it is published into. */
const newDefaultSet = (): Row => ({
  name: SET,
  label: 'Workspace member',
  isDefault: true,
  packageId: RUNTIME_PKG,
  objects: {},
});

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
  it('the registry holds it, the catalog resolves it, and its isDefault records one pending everyone suggestion', async () => {
    const stores: Stores = new Map([
      ['sys_organization', new Map([[DEFAULT_ORG, { id: DEFAULT_ORG, slug: 'default', name: 'Default' }]])],
    ]);
    const { engine, protocol, catalog } = await bootEnvironmentKernel(stores);
    expect(await catalog.resolve('permission', SET), 'precondition: a new set').toBeUndefined();

    expect(await protocol.saveMetaItem({
      type: 'permission', name: SET, item: newDefaultSet(), packageId: RUNTIME_PKG, mode: 'publish',
    })).toMatchObject({ success: true });

    // No list read, no rebuild: straight to the readers.
    expect(engine.registry.getItem('permission', SET)).toMatchObject({ name: SET, isDefault: true });
    expect(await catalog.resolve('permission', SET)).toMatchObject({
      source: 'registry',
      definition: { name: SET, isDefault: true, packageId: RUNTIME_PKG },
    });

    await syncAudienceBindingSuggestions(engine);
    expect(suggestionRows(stores, SET)).toEqual([
      expect.objectContaining({
        package_id: RUNTIME_PKG, anchor: 'everyone', status: 'pending', deployment_decision: false,
      }),
    ]);
  });
});
