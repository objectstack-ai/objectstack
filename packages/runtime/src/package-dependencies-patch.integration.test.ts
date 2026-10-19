// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24670] `PATCH /api/v1/packages/:id` applies the manifest's `dependencies`
 * row on the protocol branch, durably, and that edit is the remedy the save
 * door's closure refusal prescribes.
 *
 * ## The defect
 *
 * The door built its patch from `name`, `description` and `version` only, and
 * `SchemaRegistry.updatePackageManifest` copied only those three, so
 * `manifest.dependencies` could be set at create and never again. The save
 * door judges a write into a package against that package's closure — its
 * declared `dependencies` among it (ruling #9612) — and refuses a binding
 * outside it with the remedy "declare a dependency on the package that
 * defines X in the `dependencies` of P's manifest". For a package that already
 * existed, no door applied that remedy.
 *
 * ## The pins
 *
 *  (a) the row is persisted: `GET /packages/:id` serves it, the `sys_packages`
 *      row stores it, and after a restart (the stored rows hydrated into a new
 *      registry) the door serves it again;
 *  (b) a malformed row is refused `400 VALIDATION_ERROR` and neither the
 *      registry nor the `sys_packages` row moves;
 *  (d) end to end: a list view saved into P bound to an object of a package P
 *      never declared is refused `422 INVALID_METADATA`
 *      (`list-view-object-outside-closure`), and after the PATCH declares that
 *      package the same save is admitted.
 *
 * (c), the three existing keys, is pinned at the door in
 * `domains/packages-patch-dependencies.test.ts`.
 *
 * ## The composition — the shipped pieces, booted twice over one database file
 *
 * The `package-uninstall-store-refusal.integration.test.ts` harness: a REAL
 * `ObjectQL` over a REAL `SqlDriver` (better-sqlite3, on disk); the REAL
 * `PackageServicePlugin`, whose `start()` creates `sys_packages`, registers the
 * `package` service and hydrates the stored rows into the registry; the REAL
 * `ObjectStackProtocolImplementation`; and the REAL `HttpDispatcher`. One
 * difference, on purpose: the protocol is built on the DEFAULT authoring
 * channel (`'environment'`), the one whose saves the runtime authoring gate
 * judges — the `'package-author'` channel that harness uses skips the gate,
 * and with it the closure verdict (d) is about.
 *
 * ⚠️ `@objectstack/objectql` and `@objectstack/metadata-protocol` resolve
 * through `exports` to their **`dist/`** (`check-test-source-alias.mjs`,
 * `KNOWN_UNALIASED_TEST_IMPORTS`): rebuild them before reading a result here
 * after touching `registry.ts` or `protocol.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
  SysMetadataCommitObject,
} from '@objectstack/metadata-core';
import { PackageServicePlugin } from '@objectstack/service-package';
import { HttpDispatcher } from './http-dispatcher.js';

/** The package written into; namespace `own`. */
const OWN = 'com.probe.own';
/** The package that defines the bound object; namespace `depcore`. */
const DEP = 'com.probe.depcore';
const OBJ = 'depcore_thing';
const VIEW = `${OBJ}.own_list`;
const PLATFORM_PKG = 'com.objectstack.platform';
const ENV = 'platform';
const OUTSIDE = 'list-view-object-outside-closure';

/** A signed-in admin acting in an organization. */
const CALLER: any = {
  request: {},
  environmentId: ENV,
  executionContext: {
    userId: 'u_admin',
    isSystem: false,
    systemPermissions: ['manage_metadata', 'studio.access'],
    tenantId: 'org_acme',
  },
};

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'os-24670-home-'));
  process.env.OS_HOME = home;
});
afterAll(() => {
  if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
  else process.env.OS_HOME = envSnapshot.OS_HOME;
  rmSync(home, { recursive: true, force: true });
});

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

function newDir() {
  const dir = mkdtempSync(join(tmpdir(), 'os-24670-db-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** One process over the database in `dir`. */
async function boot(dir: string) {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject] as any[];
  await driver.initObjects(objects);

  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);

  const services = new Map<string, unknown>([['objectql', engine]]);
  const ctx: any = {
    logger: quiet,
    getService: (name: string) => services.get(name),
    registerService: (name: string, service: unknown) => { services.set(name, service); },
  };
  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);

  // The DEFAULT authoring channel — see the header.
  const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => services as any);
  services.set('protocol', protocol);
  const get = (name: string) => services.get(name) ?? null;
  const dispatcher = new HttpDispatcher({ context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) } as any);

  let destroyed = false;
  const destroy = async () => {
    if (destroyed) return;
    destroyed = true;
    await engine.destroy();
  };
  cleanup.push(destroy);

  return {
    engine,
    protocol,
    destroy,
    async call(method: string, path: string, body?: unknown) {
      const res = await dispatcher.handlePackages(path, method, body, {}, CALLER);
      const json = JSON.parse(JSON.stringify(res.response?.body ?? null));
      return { status: res.response?.status ?? 0, code: json?.error?.code as string | undefined, body: json };
    },
    async install(id: string) {
      await protocol.installPackage({ manifest: { id, name: id, version: '1.0.0', type: 'app' } });
    },
    /** The `sys_packages` row's manifest, read from the store — not the registry. */
    async storedManifest(id: string) {
      const record = await (services.get('package') as any).get(id);
      return record?.manifest;
    },
    /** The registry's manifest, as a plain value. */
    registryManifest: (id: string) => JSON.parse(JSON.stringify(engine.registry.getPackage(id)?.manifest ?? null)),
    /** A publish-mode save of DEP's object. */
    saveDepObject: () => protocol.saveMetaItem({
      type: 'object',
      name: OBJ,
      packageId: DEP,
      item: { name: OBJ, label: 'Thing', sharingModel: 'private', fields: { title: { name: 'title', type: 'text', label: 'Title' } } },
    }),
    /** A publish-mode save of a list view written into OWN, bound to DEP's object. */
    saveView: () => protocol.saveMetaItem({
      type: 'view',
      name: VIEW,
      packageId: OWN,
      item: {
        name: VIEW,
        object: OBJ,
        viewKind: 'list',
        label: 'Things',
        type: 'grid',
        data: { provider: 'object', object: OBJ },
        columns: [{ field: 'title' }],
      },
    }),
    /** The active stored views of OWN, by name — the store, not the door's word for it. */
    async activeViews() {
      const rows = (await engine.find('sys_metadata', { where: { type: 'view', package_id: OWN, state: 'active' } })) as any[];
      return rows.map((r) => r.name as string).sort();
    },
  };
}

describe('[#24670] PATCH /packages/:id — `dependencies` on the protocol branch', () => {
  it('(a) the row is persisted: GET serves it, sys_packages stores it, and a restart serves it again', async () => {
    const dir = newDir();
    const first = await boot(dir);
    await first.install(OWN);
    const row = { [DEP]: '^1.0.0' };

    const patched = await first.call('PATCH', `/${OWN}`, { dependencies: row });

    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await first.call('GET', `/${OWN}`)).body?.data?.manifest?.dependencies).toEqual(row);
    expect((await first.storedManifest(OWN))?.dependencies, 'the sys_packages row').toEqual(row);

    await first.destroy();
    const restarted = await boot(dir);

    const read = await restarted.call('GET', `/${OWN}`);
    expect(read.status).toBe(200);
    expect(read.body?.data?.manifest?.dependencies, 'served after a restart').toEqual(row);
  }, 60_000);

  it('(b) a malformed row is refused 400 VALIDATION_ERROR, and neither the registry nor sys_packages moves', async () => {
    const p = await boot(newDir());
    await p.install(OWN);
    const declared = { [DEP]: '^1.0.0' };
    expect((await p.call('PATCH', `/${OWN}`, { dependencies: declared })).status, 'precondition').toBe(200);
    const registryBefore = p.registryManifest(OWN);
    const storedBefore = await p.storedManifest(OWN);

    const answer = await p.call('PATCH', `/${OWN}`, { dependencies: { [DEP]: 1 } });

    expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    expect(p.registryManifest(OWN)).toEqual(registryBefore);
    expect(await p.storedManifest(OWN)).toEqual(storedBefore);
  }, 60_000);

  it('(d) the remedy end to end: a save refused for an undeclared package is admitted once the PATCH declares it', async () => {
    const p = await boot(newDir());
    await p.install(OWN);
    await p.install(DEP);
    expect((await p.saveDepObject()).success, 'precondition: DEP defines the object').toBe(true);

    const refused = await p.saveView().then(() => null, (e: any) => e);
    expect(refused, 'the save resolved — the closure verdict did not run').toBeInstanceOf(Error);
    expect({ code: refused.code, status: refused.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
    expect((refused.issues ?? []).map((i: any) => i.rule)).toEqual([OUTSIDE]);
    expect(await p.activeViews(), 'a refused save stores nothing').toEqual([]);

    const patched = await p.call('PATCH', `/${OWN}`, { dependencies: { [DEP]: '^1.0.0' } });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    const admitted = await p.saveView();
    expect(admitted.success).toBe(true);
    expect(await p.activeViews()).toEqual([VIEW]);
  }, 60_000);
});
