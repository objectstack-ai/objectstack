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
 *     nothing changes — the stored rows, the registry entry and the disable
 *     record are all intact, in the same process and after a restart.
 *     [#23505] The door answers it as the client refusal it is: `409
 *     RESOURCE_CONFLICT`, its message opening with the way out (uninstall the
 *     extending package first) and naming the object and its extender. It
 *     answered `500 INTERNAL_ERROR` while the registry threw a bare `Error`.
 *  5. CONTROL for 4: the extending package uninstalled through the same door,
 *     the same uninstall succeeds — the prescription is a real way out.
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
// Paid during collection, not inside a case's clock: the state store's
// `standalone-stack.ts` loads it lazily.
import '@objectstack/metadata';
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

/**
 * One process over the database in `dir`. [#31186] `opts.audit` composes an
 * `audit` service slot, and `opts.protocolEnvironmentId` binds the protocol to
 * an environment, as a per-environment kernel does.
 */
async function boot(dir: string, opts: { audit?: unknown; protocolEnvironmentId?: string } = {}) {
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
  if (opts.audit !== undefined) services.set('audit', opts.audit);
  const ctx: any = {
    logger: quiet,
    getService: (name: string) => services.get(name),
    registerService: (name: string, service: unknown) => { services.set(name, service); },
  };
  const plugin = new PackageServicePlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);

  const protocol = new ObjectStackProtocolImplementation(engine as any, () => services as any, opts.protocolEnvironmentId, 'package-author');
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
    async call(method: string, path: string, caller: any = CALLER) {
      const res = await dispatcher.handlePackages(path, method, undefined, {}, caller);
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

/**
 * An object `PKG` owns, extended by `OTHER_PKG` — registered exactly as
 * `ObjectQL.registerApp` registers a manifest's `objects` and its
 * `objectExtensions`. In memory only: nothing about it is stored.
 */
function extendAnObjectOfPkg(p: Process): string {
  p.engine.registry.registerObject({ name: 'leave_request', fields: { title: { type: 'text' } } } as any, PKG, 'leave', 'own');
  const fqn = p.engine.registry.getAllObjects(PKG).map((o: any) => o.name).find((n: string) => n.endsWith('leave_request'));
  p.engine.registry.registerObject({ name: fqn, fields: { note: { type: 'text' } } } as any, OTHER_PKG, undefined, 'extend');
  return fqn;
}

describe('#21276 the registry\'s uninstall refusal (an ADR-0029 extender) is decided before the store delete', () => {
  it('[#23505] 409 RESOURCE_CONFLICT naming the way out, and nothing changes: stored rows, registry entry and disable record intact, in the same process and after a restart', async () => {
    const dir = newDir();
    const first = await boot(dir);
    await seed(first);
    // Another package extends an object this one owns, so the registry refuses
    // the uninstall.
    const fqn = extendAnObjectOfPkg(first);

    const answer = await first.call('DELETE', `/${PKG}`);

    expect({ status: answer.status, code: answer.code }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
    // The way out comes first (a 4xx message can be truncated), then what it is about.
    const message: string = answer.body?.error?.message;
    expect(message.startsWith(
      `Uninstall the package that extends an object of "${PKG}" first (${OTHER_PKG}), then uninstall "${PKG}" again`,
    ), message).toBe(true);
    expect(message).toContain(`"${fqn}"`);
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

  it('[#23505] CONTROL — the extending package uninstalled through the same door, the same uninstall succeeds', async () => {
    const dir = newDir();
    const first = await boot(dir);
    await seed(first);
    // The extender is an installed package this time, so the way out the
    // refusal names can be taken through the door.
    await first.protocol.installPackage({ manifest: { id: OTHER_PKG, name: 'Addon', version: '1.0.0', type: 'app' } } as any);
    const fqn = extendAnObjectOfPkg(first);
    expect((await first.call('DELETE', `/${PKG}`)).status, 'precondition: refused while extended').toBe(409);

    const extenderGone = await first.call('DELETE', `/${OTHER_PKG}`);
    expect(extenderGone.status).toBe(200);

    const answer = await first.call('DELETE', `/${PKG}`);

    expect(answer.status).toBe(200);
    expect(answer.body?.data).toMatchObject({ packageId: PKG, success: true, registryRemoved: true });
    expect((await first.call('GET', `/${PKG}`)).status).toBe(404);
    expect(first.engine.registry.getObject(fqn)).toBeUndefined();
    expect(await first.metadataRows()).toEqual([]);
    expect(loadDisabledPackageIds(ENV).has(PKG)).toBe(false);
    await first.destroy();

    const restarted = await boot(dir);

    expect((await restarted.call('GET', `/${PKG}`)).status).toBe(404);
  });
});

/**
 * [#31023, ADR-0146 D1] The door credits the request's authenticated user to
 * every metadata delete the uninstall verb performs: the `afterDelete` hook on
 * `sys_metadata` carries it as `provenance.attributedUserId`, the field the
 * audit writer (`@objectstack/plugin-audit`) records as `sys_audit_log.user_id`,
 * and the history tombstone records it as `recorded_by`. It used to send no
 * actor, so a Studio delete left both blank. CONTROL: a caller with no user id
 * (a system context) is credited to no one — no actor is invented.
 */
describe('[#31023] DELETE /packages/:id credits its metadata deletes to the signed-in user', () => {
  async function deleteAs(caller: any) {
    const p = await boot(newDir());
    await seed(p);
    const credited: Array<string | null> = [];
    p.engine.registerHook('afterDelete', async (ctx: any) => {
      credited.push(ctx?.provenance?.attributedUserId ?? null);
    }, { object: 'sys_metadata' });

    const answer = await p.call('DELETE', `/${PKG}`, caller);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const history = (await p.engine.find('sys_metadata_history', {
      where: { name: 'leave_list', operation_type: 'delete' },
    })) as any[];
    return { credited, recordedBy: history.map((r) => r.recorded_by ?? null) };
  }

  it('a signed-in admin\'s delete names the admin on the audited delete and on the history tombstone', async () => {
    const { credited, recordedBy } = await deleteAs(CALLER);

    expect(credited).toEqual(['u_admin']);
    expect(recordedBy).toEqual(['u_admin']);
  });

  it('CONTROL: a system caller\'s delete names no one', async () => {
    const system = { ...CALLER, executionContext: { isSystem: true, systemPermissions: [] } };

    const { credited, recordedBy } = await deleteAs(system);

    expect(credited).toEqual([null]);
    expect(recordedBy).toEqual([null]);
  });
});

/**
 * [#31186] Every uninstall leaves ONE `package_uninstall` event on the `audit`
 * slot, about the package itself — the `sys_packages` delete is raw SQL, so no
 * hook ever saw it. The event is handed over by the uninstall verb, so the
 * HTTP door and an in-process caller of the verb produce the same one; a
 * refused uninstall produces none. plugin-audit turns the event into the row
 * (`package-lifecycle-audit.test.ts` there); this pins the composed doors.
 */
describe('[#31186] an uninstall hands the audit slot one event about the package itself', () => {
  function recordingAudit() {
    const events: any[] = [];
    return { events, slot: { recordPackageLifecycleEvent: async (event: unknown) => { events.push(event); } } };
  }

  it('DELETE /packages/:id: one event naming the signed-in user, the package, its version and the environment', async () => {
    const audit = recordingAudit();
    const p = await boot(newDir(), { audit: audit.slot, protocolEnvironmentId: 'env_31186' });
    await seed(p);

    const answer = await p.call('DELETE', `/${PKG}`);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(audit.events).toEqual([{
      action: 'package_uninstall',
      packageId: PKG,
      version: '1.0.0',
      environmentId: 'env_31186',
      actor: 'u_admin',
      itemsRemoved: 1,
      itemsFailed: 0,
    }]);
  });

  it('an in-process caller of the verb: the same one event, naming the actor it passed', async () => {
    const audit = recordingAudit();
    const p = await boot(newDir(), { audit: audit.slot, protocolEnvironmentId: 'env_31186' });
    await seed(p);

    const res = await p.protocol.deletePackage({ packageId: PKG, actor: 'u_cloud_tool', keepData: true });

    expect(res).toMatchObject({ success: true });
    expect(audit.events).toEqual([expect.objectContaining({
      action: 'package_uninstall', packageId: PKG, version: '1.0.0', actor: 'u_cloud_tool', keepData: true,
    })]);
  });

  it('CONTROL: a refused uninstall (the store refuses the sys_packages delete) hands the slot nothing', async () => {
    const audit = recordingAudit();
    const p = await boot(newDir(), { audit: audit.slot });
    await seed(p);
    await refuseStoreDelete(p);

    expect((await p.call('DELETE', `/${PKG}`)).status).toBe(500);
    expect(audit.events).toEqual([]);
  });

  it('CONTROL: a package that is not installed answers 404 and hands the slot nothing', async () => {
    const audit = recordingAudit();
    const p = await boot(newDir(), { audit: audit.slot });

    expect((await p.call('DELETE', '/com.acme.absent')).status).toBe(404);
    expect(audit.events).toEqual([]);
  });
});
