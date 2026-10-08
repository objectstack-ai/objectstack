// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine door pins for #22113 — `POST /packages/:id/publish` and
// `POST /packages/:id/revert` on a read-only (code or installed) package, and
// the package membership the metadata service reads for a writable one.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MetadataManager } from '@objectstack/metadata';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
  SysMetadataCommitObject,
} from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { applyProtection } from '@objectstack/spec/shared';
import { HttpDispatcher } from './http-dispatcher.js';

/**
 * ## The defect, measured at the door
 *
 * On a `objectstack dev` boot of `examples/app-showcase` at the base of this
 * change, the two package-wide doors answered a read-only package three ways,
 * none of them ADR-0070 D2's:
 *
 *  - `com.objectstack.setup` (its items live only in ObjectQL's SchemaRegistry)
 *    and eighteen platform packages that ship objects: revert 404 "No metadata
 *    items found", publish 200 `success: false` with the same sentence;
 *  - `com.example.showcase` (booted from its artifact): revert 409 "has never
 *    been published", and publish 200 `success: true` — two capabilities
 *    snapshotted and re-registered as published, a write into a read-only
 *    package.
 *
 * Both doors now refuse a non-writable package with the door's existing
 * `422 WRITABLE_PACKAGE_REQUIRED` (the predicate `disable` and `delete` ask).
 * Revert asks it only AFTER the protocol's stored-row answer, so a stored row
 * bound to a code package (an organization overlay draft) keeps its answer.
 *
 * The metadata service's member lookup now also reads the private `_packageId`
 * stamp. Its two producers are used here as in production: the ObjectQL object
 * bridge (`getAllObjects()` → `register`) and the artifact loader's
 * `applyProtection`.
 *
 * ## Why a REAL engine, a REAL protocol and a REAL metadata service
 *
 * The writability predicate reads the engine's manifests and package registry,
 * the revert door asks the protocol's stored rows first, and the membership is
 * the metadata service's own registry; a double of any of them would pin the
 * double. The sibling suite `package-revert-stored-members.integration.test.ts`
 * holds the Studio-package half.
 */

/** A platform package that ships objects: installed with `scope: 'system'`, its objects bridged. */
const OBJECTS_PKG = 'com.example.code_objects';
/** A platform package whose items the metadata service never holds (the `com.objectstack.setup` shape). */
const REGISTRY_ONLY_PKG = 'com.example.registry_only';
/** A package booted from its artifact (the `com.example.showcase` shape): in the engine's manifests. */
const BOOTED_PKG = 'com.example.booted';
/** A writable base whose metadata-service members carry only the stamp. */
const STAMPED_BASE = 'com.example.stamped_base';
/** A writable package whose items carry an authored `packageId` (the control). */
const AUTHORED_PKG = 'com.example.authored';
/** An id nothing in the process carries. */
const UNKNOWN_PKG = 'com.example.no_such_package';

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

/** REAL ObjectQL over on-disk better-sqlite3, the REAL protocol, the REAL metadata service, one door. */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-22113-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const sysObjects = [
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    SysMetadataCommitObject,
  ] as any[];
  await driver.initObjects(sysObjects);

  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  cleanup.push(() => { void engine.destroy(); });

  // A platform package that ships objects, as a platform plugin's manifest
  // installs it: `scope: 'system'`, and the four `sys_metadata*` objects
  // registered under it stand in for its objects.
  engine.registry.installPackage({ id: OBJECTS_PKG, name: OBJECTS_PKG, version: '1.0.0', scope: 'system' } as any);
  for (const o of sysObjects) engine.registry.registerObject(o, OBJECTS_PKG);
  // A platform package that ships no objects — nothing of it reaches the
  // metadata service.
  engine.registry.installPackage({ id: REGISTRY_ONLY_PKG, name: REGISTRY_ONLY_PKG, version: '1.0.0', scope: 'system' } as any);
  // A writable base: project-scoped, not booted.
  engine.registry.installPackage({ id: STAMPED_BASE, name: STAMPED_BASE, version: '1.0.0', scope: 'project' } as any);

  const protocol = new ObjectStackProtocolImplementation(
    engine as any, undefined, undefined, 'package-author',
  );

  const metadata = new MetadataManager({ formats: ['json'] });
  metadata.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);

  const services: Record<string, unknown> = { protocol, objectql: engine, metadata };
  const get = (name: string) => services[name] ?? null;
  const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
  const dispatcher = new HttpDispatcher(kernel);

  /** `POST /packages/:id/<verb>`, as a caller holding `manage_metadata`. */
  const call = async (packageId: string, verb: 'revert' | 'publish') => {
    const context = {
      request: {},
      executionContext: { userId: 'u_pkg_admin', systemPermissions: ['manage_metadata', 'studio.access'] },
    } as any;
    const result = await dispatcher.handlePackages(`/${encodeURIComponent(packageId)}/${verb}`, 'POST', {}, {}, context);
    expect(result.handled).toBe(true);
    return { status: result.response?.status, body: result.response?.body };
  };

  return { engine, protocol: protocol as any, metadata, revert: (id: string) => call(id, 'revert'), publish: (id: string) => call(id, 'publish') };
}

/** The ObjectQL object bridge's loop body (`bridgeObjectsToMetadataService`), on the real registry. */
async function bridgeObjects(engine: ObjectQL, metadata: MetadataManager): Promise<string[]> {
  const bridged: string[] = [];
  for (const obj of engine.registry.getAllObjects()) {
    await metadata.register('object', obj.name, obj, { notify: false });
    bridged.push(obj.name);
  }
  return bridged;
}

/** The metadata plugin's artifact registration of one item: stamp, then register. */
async function registerArtifactItem(metadata: MetadataManager, packageId: string, type: string, item: Record<string, unknown>) {
  applyProtection(item, { packageId, packageVersion: '1.0.0' });
  await metadata.register(type, String(item.name), item, { notify: false });
}

/** The booted package, as the showcase is: stamped artifact items plus one authored-`packageId` capability, then its manifest booted. */
async function bootArtifactPackage(engine: ObjectQL, metadata: MetadataManager) {
  await registerArtifactItem(metadata, BOOTED_PKG, 'capability', { name: 'booted.restricted_ops', label: 'Restricted', scope: 'org' });
  await metadata.register('capability', 'booted.export_data', {
    name: 'booted.export_data', label: 'Export Booted Data', scope: 'org', packageId: BOOTED_PKG,
  }, { notify: false });
  engine.registerApp({ id: BOOTED_PKG, name: BOOTED_PKG, version: '1.0.0' });
}

/** The refusal envelope both doors answer for a read-only package. */
function expectReadOnlyRefusal(answer: { status?: number; body?: any }, verb: 'publish' | 'revert', packageId: string) {
  expect(answer.status).toBe(422);
  expect(answer.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
  expect(String(answer.body?.error?.message)).toMatch(new RegExp(`^\\[writable_package_required\\] Cannot ${verb} package '${packageId.replace(/\./g, '\\.')}': it is read-only`));
}

describe('#22113 publish and revert refuse a read-only package (ADR-0070 D2)', () => {
  it('a platform package that ships objects: revert 422 (was 404, then 409) and publish 422 (was 200 success:false)', async () => {
    const { engine, metadata, revert, publish } = await boot();
    expect(await bridgeObjects(engine, metadata)).toContain('sys_metadata');
    // The precondition the membership fix needs, read off the real producer:
    // the stamp is there, the two keys the old lookup read are not.
    const sample = await metadata.get('object', 'sys_metadata') as any;
    expect({ _packageId: sample._packageId, packageId: sample.packageId, package: sample.package })
      .toEqual({ _packageId: OBJECTS_PKG, packageId: undefined, package: undefined });

    expectReadOnlyRefusal(await revert(OBJECTS_PKG), 'revert', OBJECTS_PKG);
    expectReadOnlyRefusal(await publish(OBJECTS_PKG), 'publish', OBJECTS_PKG);

    // Refused BEFORE the metadata service: nothing was snapshotted.
    const after = await metadata.get('object', 'sys_metadata') as any;
    expect({ publishedDefinition: after.publishedDefinition, state: after.state, version: after.version })
      .toEqual({ publishedDefinition: undefined, state: undefined, version: undefined });
  });

  it('a platform package the metadata service never holds (the setup shape): revert 422 (was 404) and publish 422 (was 200 success:false)', async () => {
    const { revert, publish } = await boot();

    expectReadOnlyRefusal(await revert(REGISTRY_ONLY_PKG), 'revert', REGISTRY_ONLY_PKG);
    expectReadOnlyRefusal(await publish(REGISTRY_ONLY_PKG), 'publish', REGISTRY_ONLY_PKG);
  });

  it('a package booted from its artifact (the showcase shape): revert 422 (was 409) and publish 422 (was 200 success:true)', async () => {
    const { engine, metadata, revert, publish } = await boot();
    await bootArtifactPackage(engine, metadata);

    expectReadOnlyRefusal(await publish(BOOTED_PKG), 'publish', BOOTED_PKG);
    expectReadOnlyRefusal(await revert(BOOTED_PKG), 'revert', BOOTED_PKG);

    // The base hole this closes: the authored-`packageId` capability used to be
    // snapshotted and re-registered as published. Nothing was.
    const cap = await metadata.get('capability', 'booted.export_data') as any;
    expect({ publishedDefinition: cap.publishedDefinition, state: cap.state })
      .toEqual({ publishedDefinition: undefined, state: undefined });
  });
});

describe('#22113 controls', () => {
  it('an unknown id: revert stays 404 RESOURCE_NOT_FOUND, publish stays 200 success:false', async () => {
    const { engine, metadata, revert, publish } = await boot();
    await bridgeObjects(engine, metadata);

    const reverted = await revert(UNKNOWN_PKG);
    expect(reverted.status).toBe(404);
    expect(reverted.body?.error?.code).toBe('RESOURCE_NOT_FOUND');

    const published = await publish(UNKNOWN_PKG);
    expect(published.status).toBe(200);
    expect(published.body?.data).toMatchObject({ success: false, itemsPublished: 0 });
  });

  it('a writable package with authored packageId members: publish 200, then edit, then revert 200 restores the snapshot', async () => {
    const { metadata, revert, publish } = await boot();
    await metadata.register('capability', 'authored.export_data', {
      name: 'authored.export_data', label: 'Export Authored Data', scope: 'org', packageId: AUTHORED_PKG,
    });

    const published = await publish(AUTHORED_PKG);
    expect(published.status).toBe(200);
    expect(published.body?.data).toMatchObject({ success: true, itemsPublished: 1 });
    const item = await metadata.get('capability', 'authored.export_data') as any;
    await metadata.register('capability', 'authored.export_data', {
      ...item, metadata: { ...item.publishedDefinition, label: 'Edited after publish' }, state: 'draft',
    });

    const answer = await revert(AUTHORED_PKG);

    expect(answer.status).toBe(200);
    const reverted = await metadata.get('capability', 'authored.export_data') as any;
    expect(reverted.state).toBe('active');
    expect(reverted.metadata.label).toBe('Export Authored Data');
  });

  it('a writable base whose members carry only the stamp: both doors find them — revert 409 before a publish, publish 200, revert 200 after', async () => {
    const { metadata, revert, publish } = await boot();
    await registerArtifactItem(metadata, STAMPED_BASE, 'capability', { name: 'base.export_data', label: 'Export Base Data', scope: 'org' });

    const early = await revert(STAMPED_BASE);
    expect(early.status).toBe(409);
    expect(early.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(early.body?.error?.message).toBe(`Package '${STAMPED_BASE}' has never been published`);

    const published = await publish(STAMPED_BASE);
    expect(published.status).toBe(200);
    expect(published.body?.data).toMatchObject({ success: true, itemsPublished: 1 });

    const answer = await revert(STAMPED_BASE);
    expect(answer.status).toBe(200);
    const reverted = await metadata.get('capability', 'base.export_data') as any;
    expect(reverted.state).toBe('active');
  });

  it('a stored row bound to a read-only package keeps the protocol’s answer: the refusal sits after it', async () => {
    const { engine, metadata, protocol, revert } = await boot();
    // The #22090 contract-review shape: a draft row in `sys_metadata` bound to
    // a code package. Written while the id is not yet booted — the authoring
    // gate refuses a new item into a booted package — then the package boots.
    await protocol.saveMetaItem({
      type: 'view',
      name: 'booted_board',
      item: {
        name: 'booted_board', label: 'Overlay draft', type: 'grid', object: 'anything', viewKind: 'list',
        data: { provider: 'object', object: 'anything' }, columns: ['id'],
      },
      packageId: BOOTED_PKG,
      mode: 'draft',
    });
    await bootArtifactPackage(engine, metadata);

    const answer = await revert(BOOTED_PKG);

    // The protocol's stored-row answer (#22090), not the door's 422.
    expect(answer.status).toBe(409);
    expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(String(answer.body?.error?.message)).toMatch(/^Package 'com\.example\.booted' has never been published/);
  });
});
