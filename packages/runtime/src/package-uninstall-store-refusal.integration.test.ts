// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21276 — `DELETE /api/v1/packages/:id` when the store refuses the
 * `sys_packages` delete.
 *
 * ## The defect, as measured at this door
 *
 * On SQLite, with a trigger refusing `DELETE` on `sys_packages`, the door
 * answered `200` with `success: true`, the same process then answered `404`, and
 * after a restart the package was back. With `deletePackage` refusing first,
 * the door answered `500` but the same process still answered `404`. A
 * package disabled beforehand also came back ENABLED after the restart. The
 * door had already run `registry.uninstallPackage(id)` and
 * `setPackageDisabled(environmentId, id, false)` before it asked the store.
 *
 * ## The contract pinned here (triage's ruling: refuse before withdrawing)
 *
 *  1. A refused store delete answers the failure, and the same process still
 *     serves the package, still disabled, with its metadata.
 *  2. After a restart, the package is still there and still disabled.
 *  3. CONTROL: an ordinary delete removes it — `404` in the same process, `404`
 *     after a restart (no resurrection) — and clears its disable record.
 *  4. The registry's own uninstall refusal — another package extends an object
 *     this one owns (ADR-0029) — is decided BEFORE the store delete
 *     (`SchemaRegistry.assertPackageUninstallable`, asked by `deletePackage`):
 *     the door answers `500` and nothing changes — the stored rows, the
 *     registry entry and the disable record are all intact, in the same
 *     process and after a restart. That is the envelope the door gave when it
 *     withdrew the package itself first.
 *
 * ## The composition — the shipped pieces, booted twice over one database file
 *
 * A REAL `ObjectQL` over a REAL `SqlDriver` (better-sqlite3, on disk); the REAL
 * `PackageServicePlugin`, whose `start()` creates `sys_packages`, registers the
 * `package` service and hydrates the stored rows into the registry; the REAL
 * `ObjectStackProtocolImplementation`; and the REAL `HttpDispatcher`. Before
 * the plugin starts, each boot plants the persisted disabled ids the way
 * `AppPlugin.seedPersistedDisabledPackages` does
 * (`loadDisabledPackageIds` → `setInitialDisabledPackageIds`). A second `boot`
 * over the same directory, after the first engine is destroyed, IS the
 * restart. `OS_HOME` is a temp directory, so the disable record is a real file
 * that only this file writes.
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
} from '@objectstack/metadata-core';
import { PackageServicePlugin } from '@objectstack/service-package';
import { HttpDispatcher } from './http-dispatcher.js';
import { loadDisabledPackageIds } from './package-state-store.js';

const PKG = 'com.acme.leave';
const OTHER_PKG = 'com.acme.addon';
const PLATFORM_PKG = 'com.objectstack.platform';
const ENV = 'platform';
const ORG = 'org_acme';

/** A signed-in admin acting in an organization — the caller the dev-server measurement used. */
const CALLER: any = {
  request: {},
  environmentId: ENV,
  executionContext: {
    userId: 'u_admin',
    isSystem: false,
    systemPermissions: ['manage_metadata', 'studio.access'],
    tenantId: ORG,
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
  home = mkdtempSync(join(tmpdir(), 'os-21276-home-'));
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

/** One process over the database in `dir`. */
async function boot(dir: string) {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
  await driver.initObjects(objects);

  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
  // The boot seed, planted before any package row is installed.
  engine.registry.setInitialDisabledPackageIds(loadDisabledPackageIds(ENV));

  const services = new Map<string, unknown>([['objectql', engine]]);
  const ctx: any = {
    logger: quiet,
    getService: (name: string) => services.get(name),
    registerService: (name: string, service: unknown) => { services.set(name, service); },
  };
  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);

  const protocol = new ObjectStackProtocolImplementation(engine as any, () => services as any, undefined, 'package-author');
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
    async call(method: string, path: string) {
      const res = await dispatcher.handlePackages(path, method, undefined, {}, CALLER);
      const body = JSON.parse(JSON.stringify(res.response?.body ?? null));
      return { status: res.response?.status ?? 0, code: body?.error?.code as string | undefined, body };
    },
    async metadataRows() {
      const rows = (await engine.find('sys_metadata', { where: { package_id: PKG } })) as any[];
      return rows.map((r) => `${r.type}/${r.name}`).sort();
    },
  };
}

type Process = Awaited<ReturnType<typeof boot>>;

/** Install the package, give it one stored view, and disable it through the door. */
async function seed(p: Process) {
  await p.protocol.installPackage({ manifest: { id: PKG, name: 'Leave', version: '1.0.0', type: 'app' } } as any);
  await (p.protocol as any).saveMetaItem({
    type: 'view',
    name: 'leave_list',
    item: {
      name: 'leave_list',
      label: 'Leave',
      type: 'grid',
      object: 'anything',
      viewKind: 'list',
      data: { provider: 'object', object: 'anything' },
      columns: ['id'],
    },
    packageId: PKG,
  });
  const disabled = await p.call('PATCH', `/${PKG}/disable`);
  expect(disabled.status, 'precondition: the package is disabled through the door').toBe(200);
  expect(loadDisabledPackageIds(ENV).has(PKG), 'precondition: the disable record is on disk').toBe(true);
}

/** The forced store refusal: a trigger refusing `DELETE` on `sys_packages` for this package. */
async function refuseStoreDelete(p: Process) {
  await (p.engine as any).execute({
    sql: `CREATE TRIGGER refuse_${PKG.replace(/\./g, '_')}_delete BEFORE DELETE ON sys_packages `
      + `WHEN OLD.id = '${PKG}' BEGIN SELECT RAISE(ABORT, 'refused by the test trigger'); END`,
  });
}

function newDir() {
  const dir = mkdtempSync(join(tmpdir(), 'os-21276-db-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('#21276 DELETE /packages/:id — a refused sys_packages delete changes nothing', () => {
  it('answers 500 DATABASE_ERROR, and the same process still serves the package, disabled, with its metadata', async () => {
    const p = await boot(newDir());
    await seed(p);
    await refuseStoreDelete(p);

    const answer = await p.call('DELETE', `/${PKG}`);

    expect({ status: answer.status, code: answer.code }).toEqual({ status: 500, code: 'DATABASE_ERROR' });
    const detail = await p.call('GET', `/${PKG}`);
    expect(detail.status).toBe(200);
    expect(detail.body?.data).toMatchObject({ enabled: false, status: 'disabled' });
    expect(await p.metadataRows()).toEqual(['view/leave_list']);
  });

  it('after a restart the package is still installed, still DISABLED, and still has its metadata', async () => {
    const dir = newDir();
    const first = await boot(dir);
    await seed(first);
    await refuseStoreDelete(first);
    expect((await first.call('DELETE', `/${PKG}`)).status).toBe(500);
    await first.destroy();

    const restarted = await boot(dir);

    const detail = await restarted.call('GET', `/${PKG}`);
    expect(detail.status).toBe(200);
    expect(detail.body?.data).toMatchObject({ enabled: false, status: 'disabled' });
    expect(loadDisabledPackageIds(ENV).has(PKG)).toBe(true);
    expect(await restarted.metadataRows()).toEqual(['view/leave_list']);
  });
});

describe('#21276 CONTROL — an ordinary delete removes the package, and a restart does not bring it back', () => {
  it('200, then 404 in the same process, 404 after a restart, its metadata gone and its disable record cleared', async () => {
    const dir = newDir();
    const first = await boot(dir);
    await seed(first);

    const answer = await first.call('DELETE', `/${PKG}`);

    expect(answer.status).toBe(200);
    expect(answer.body?.data).toMatchObject({ packageId: PKG, success: true, registryRemoved: true });
    expect((await first.call('GET', `/${PKG}`)).status).toBe(404);
    expect(await first.metadataRows()).toEqual([]);
    expect(loadDisabledPackageIds(ENV).has(PKG)).toBe(false);
    await first.destroy();

    const restarted = await boot(dir);

    expect((await restarted.call('GET', `/${PKG}`)).status).toBe(404);
  });
});

describe('#21276 the registry\'s uninstall refusal (an ADR-0029 extender) is decided before the store delete', () => {
  it('500, and nothing changes: stored rows, registry entry and disable record intact, in the same process and after a restart', async () => {
    const dir = newDir();
    const first = await boot(dir);
    await seed(first);
    // Another package extends an object this one owns, so the registry refuses
    // the uninstall. Registered in memory only: nothing about it is stored.
    first.engine.registry.registerObject({ name: 'leave_request', fields: { title: { type: 'text' } } } as any, PKG, 'leave', 'own');
    const fqn = first.engine.registry.getAllObjects(PKG).map((o: any) => o.name).find((n: string) => n.endsWith('leave_request'));
    first.engine.registry.registerObject({ name: fqn, fields: { note: { type: 'text' } } } as any, OTHER_PKG, undefined, 'extend');

    const answer = await first.call('DELETE', `/${PKG}`);

    expect({ status: answer.status, code: answer.code }).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    const detail = await first.call('GET', `/${PKG}`);
    expect(detail.status).toBe(200);
    expect(detail.body?.data).toMatchObject({ enabled: false, status: 'disabled' });
    expect(first.engine.registry.getObject(fqn)).toBeDefined();
    expect(await first.metadataRows()).toEqual(['view/leave_list']);
    expect(loadDisabledPackageIds(ENV).has(PKG)).toBe(true);
    await first.destroy();

    const restarted = await boot(dir);

    const after = await restarted.call('GET', `/${PKG}`);
    expect(after.status).toBe(200);
    expect(after.body?.data).toMatchObject({ enabled: false, status: 'disabled' });
    expect(await restarted.metadataRows()).toEqual(['view/leave_list']);
  });
});
