// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine door pins for #22113 — `POST /packages/:id/revert` on a
// code-shipped package answered 404 "No metadata items found" while every read
// served the package's items.

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
 * change, `POST /api/v1/packages/:id/revert` answered
 * `404 RESOURCE_NOT_FOUND "No metadata items found for package '…'"` for
 * eighteen code-shipped platform packages whose objects every read serves
 * (`com.objectstack.platform-objects`, `com.objectstack.service.job`, …).
 *
 * `MetadataManager.revertPackage` collected members by an item's own
 * `packageId` / `package` key. A code-shipped item carries only the private
 * `_packageId` stamp, written by two producers: the ObjectQL object bridge
 * copies `SchemaRegistry.getAllObjects()`'s owner tag onto every object it
 * registers in the metadata service, and the metadata plugin's artifact loader
 * stamps every artifact item through `applyProtection`. Both producers are
 * used here as they are in production, so the stamp under test is the real
 * one, not a hand-written key.
 *
 * ## Why a REAL engine, a REAL protocol and a REAL metadata service
 *
 * The door asks the protocol first (`revertStoredPackage`) and the metadata
 * service only when the package has no stored row, so the answer for a
 * code-shipped package is a composition of both; a double of either would pin
 * the double. The sibling suite `package-revert-stored-members.integration.test.ts`
 * holds the stored-row half and the authored-`packageId` control.
 */

/** The package the engine's objects are registered under, as a platform package's are. */
const CODE_PKG = 'com.example.code_objects';
/** An artifact-loaded package: its items are stamped by `applyProtection`. */
const ARTIFACT_PKG = 'com.example.artifact';
/** A package whose items carry an authored `packageId` (the control). */
const AUTHORED_PKG = 'com.example.authored';

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
  // The four `sys_metadata*` objects stand in for a code package's objects:
  // registered under CODE_PKG, they are what the SchemaRegistry hands the
  // object bridge with that package as their owner.
  for (const o of sysObjects) engine.registry.registerObject(o, CODE_PKG);
  cleanup.push(() => { void engine.destroy(); });

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

  return { engine, metadata, revert: (id: string) => call(id, 'revert'), publish: (id: string) => call(id, 'publish') };
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
async function registerArtifactItem(metadata: MetadataManager, type: string, item: Record<string, unknown>) {
  applyProtection(item, { packageId: ARTIFACT_PKG, packageVersion: '1.0.0' });
  await metadata.register(type, String(item.name), item, { notify: false });
}

describe('#22113 POST /packages/:id/revert on a code-shipped package', () => {
  it('objects the bridge registered carry only the _packageId stamp: 409 "has never been published" (was: 404)', async () => {
    const { engine, metadata, revert } = await boot();
    expect(await bridgeObjects(engine, metadata)).toContain('sys_metadata');
    // The precondition the defect needs, read off the real producer: the
    // stamp is there, the two keys the old lookup read are not.
    const sample = await metadata.get('object', 'sys_metadata') as any;
    expect({ _packageId: sample._packageId, packageId: sample.packageId, package: sample.package })
      .toEqual({ _packageId: CODE_PKG, packageId: undefined, package: undefined });

    const answer = await revert(CODE_PKG);

    expect(answer.status).toBe(409);
    expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(answer.body?.error?.message).toBe(`Package '${CODE_PKG}' has never been published`);
  });

  it('an artifact-loaded package stamped by applyProtection: 409 "has never been published" (was: 404)', async () => {
    const { metadata, revert } = await boot();
    await registerArtifactItem(metadata, 'capability', { name: 'artifact.export_data', label: 'Export', scope: 'org' });

    const answer = await revert(ARTIFACT_PKG);

    expect(answer.status).toBe(409);
    expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(answer.body?.error?.message).toBe(`Package '${ARTIFACT_PKG}' has never been published`);
  });

  it('control: a package nothing in this process carries is still 404 RESOURCE_NOT_FOUND', async () => {
    const { engine, metadata, revert } = await boot();
    await bridgeObjects(engine, metadata);

    const answer = await revert('com.example.no_such_package');

    expect(answer.status).toBe(404);
    expect(answer.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('#22113 controls — what this change leaves as it was', () => {
  it('a package with authored packageId members: publish then edit then revert restores the snapshot (200)', async () => {
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

  it('publish does not take the stamp: a code-shipped package is not published, nothing is snapshotted', async () => {
    const { engine, metadata, publish } = await boot();
    expect(await bridgeObjects(engine, metadata)).toContain('sys_metadata');

    const answer = await publish(CODE_PKG);

    expect(answer.status).toBe(200);
    expect(answer.body?.data).toMatchObject({ success: false, itemsPublished: 0 });
    const obj = await metadata.get('object', 'sys_metadata') as any;
    expect(obj.publishedDefinition).toBeUndefined();
    expect(obj.state).toBeUndefined();
  });
});
