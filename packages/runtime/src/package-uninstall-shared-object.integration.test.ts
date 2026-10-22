// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23473 — `DELETE /api/v1/packages/:id` of a package that shares an object
 * with another stored row.
 *
 * ## The defect, as it stood once the metadata delete door refused the drop
 *
 * A `sys_metadata` row is keyed by its package, so one object can hold one row
 * per package (and a package-less row), all served over the ONE table its name
 * maps to. An uninstall drops each of its objects' tables by default, through
 * the per-item metadata delete with `dropStorage`, and that delete drops a
 * table only with the object's last stored row: while another row stays, it
 * is refused `409 RESOURCE_CONFLICT`. `deletePackage` met that refusal after
 * its first durable step, the `sys_packages` delete, and collected it in
 * `failed[]`: the door answered `400 PACKAGE_DELETE_PARTIAL` over a package
 * that was no longer installed while its row of the shared object stayed
 * stored and served — a half-uninstalled package.
 *
 * ## The contract pinned here (lane decision: refuse the whole uninstall)
 *
 *  1. Without `keepData`, an uninstall of a package holding an object another
 *     package's row also holds is refused `409 RESOURCE_CONFLICT` before
 *     anything durable: the `sys_packages` row, the registry entry, both rows,
 *     the table and its records all stay. The refusal names the object and the
 *     row that keeps it, and prescribes `keepData`.
 *  2. The same with the package-less row as the other holder.
 *  3. The ways out the refusal prescribes complete, with nothing in `failed[]`:
 *     `?keepData=true` removes the package and keeps the table; deleting the
 *     package's own row of the shared object first (no `dropStorage`) lets the
 *     uninstall complete, keep the shared table and still drop the tables the
 *     package alone held. Either way the running registry then serves the
 *     other package's definition of the object.
 *  4. CONTROL: an object one package holds — the uninstall drops its table.
 *
 * ## The composition — the shipped pieces
 *
 * The sibling `package-uninstall-store-refusal.integration.test.ts` harness: a
 * REAL `ObjectQL` over a REAL `SqlDriver` (better-sqlite3, on disk, so the
 * object tables are real); the REAL `PackageServicePlugin`, which owns
 * `sys_packages`; the REAL `ObjectStackProtocolImplementation`; and the REAL
 * `HttpDispatcher`, whose `handlePackages` is the uninstall door. The objects
 * are published through the protocol's own save (`saveMetaItem`, which
 * creates the table), as the metadata door's `PUT ?package=` does. The other
 * holder's row is seeded into the store as a row at rest (see
 * `twoPackageObject` for why).
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * **`dist/`** (`check-test-source-alias.mjs`, `KNOWN_UNALIASED_TEST_IMPORTS`):
 * rebuild it before reading a result here after touching `protocol.ts`.
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
  hashSpec,
} from '@objectstack/metadata-core';
import { PackageServicePlugin } from '@objectstack/service-package';
import { HttpDispatcher } from './http-dispatcher.js';

const P = 'com.probe.p';
const Q = 'com.probe.q';
const PLATFORM_PKG = 'com.objectstack.platform';
const ENV = 'platform';
const SHARED = 'probe_ticket';
const PRIVATE = 'probe_note';

/** A signed-in admin — the caller of the sibling harness. */
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
  home = mkdtempSync(join(tmpdir(), 'os-23473-home-'));
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

const objectBody = (name: string, label: string) => ({
  name,
  label,
  // [#8310] The runtime object door requires an authored OWD.
  sharingModel: 'private',
  fields: { title: { name: 'title', type: 'text' as const, label: 'Title' } },
});

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-23473-db-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
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
  cleanup.push(() => engine.destroy());

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
  const knex = (driver as any).knex;

  async function seedStoredRow(name: string, packageId: string | null) {
    const body = objectBody(name, `${name} ${packageId ?? 'unbound'}`);
    const now = new Date().toISOString();
    await engine.insert('sys_metadata', {
      id: `seed_active_${packageId ?? 'unbound'}_${name}`, type: 'object', name,
      package_id: packageId, state: 'active', metadata: JSON.stringify(body), checksum: hashSpec(body, 'object'),
      version: 1, created_at: now, updated_at: now,
    }, { context: { isSystem: true } } as any);
  }

  return {
    engine,
    protocol,
    /** `DELETE /api/v1/packages/:id[?keepData=true]` and the other package verbs, at the real door. */
    async call(method: string, path: string, query: Record<string, string> = {}) {
      const res = await dispatcher.handlePackages(path, method, undefined, query, CALLER);
      const body = JSON.parse(JSON.stringify(res.response?.body ?? null));
      return { status: res.response?.status ?? 0, code: body?.error?.code as string | undefined, body };
    },
    async install(id: string) {
      await protocol.installPackage({ manifest: { id, name: id, version: '1.0.0', type: 'app' } } as any);
    },
    /** A publish of `name` bound to `packageId` — the save creates the table. */
    async publish(packageId: string, name: string) {
      await (protocol as any).saveMetaItem({ type: 'object', name, item: objectBody(name, `${name} ${packageId}`), packageId });
    },
    /**
     * A row of the object bound to `packageId` as it exists at rest, written
     * straight into the store, never through the save door: the shape a save
     * stores (the body's checksum by `hashSpec`), with no registry write.
     */
    seedStoredRow,
    /**
     * A package-less row of the object as it exists at rest — the save door
     * resolves a package-less save of an item a package already holds to that
     * package's row, so this row is seeded beside the package's, not saved.
     */
    seedUnboundRow: (name: string) => seedStoredRow(name, null),
    /** The object's stored active rows, by binding — the store, not the door's word for it. */
    async storedBindings(name: string) {
      const rows = (await knex('sys_metadata').where({ type: 'object', name, state: 'active' }).select('package_id')) as any[];
      return rows.map((r) => (r.package_id ?? null) as string | null).sort((a, b) => String(a).localeCompare(String(b)));
    },
    /** Whether `sys_packages` still holds the package — the table, not the registry. */
    async storedPackage(id: string) {
      return ((await knex('sys_packages').where({ id }).select('id')) as any[]).length > 0;
    },
    hasTable: (name: string) => knex.schema.hasTable(name) as Promise<boolean>,
    async records(name: string) {
      return ((await knex(name).select('title')) as Array<{ title: string }>).map((r) => r.title);
    },
    // Written in an organization: a fresh tenant column is NOT NULL (ADR-0131 D1).
    insertRecord: (name: string, title: string) => engine.insert(name, { title }, { context: { isSystem: true, tenantId: 'org_a' } } as any),
  };
}

type Process = Awaited<ReturnType<typeof boot>>;

/**
 * P and Q both hold `probe_ticket`; its table holds one record.
 *
 * [ADR-0029 D9.9] The save door refuses a save into a second package of an
 * object a runtime-authored row owns (`OBJECT_OVERLAY_PACKAGE_MISMATCH`), so
 * Q's row is one stored before that refusal existed: seeded, not saved, so
 * that this pin does not depend on which doors still let such a row in. Such
 * a row stays at rest in every store that holds it (the boot counts it in its
 * `errors` and leaves it stored), so an uninstall still meets it. The registry
 * holds P alone, as Q's save left it then: its write-through was refused.
 */
async function twoPackageObject(): Promise<Process> {
  const h = await boot();
  await h.install(P);
  await h.install(Q);
  await h.publish(P, SHARED);
  await h.seedStoredRow(SHARED, Q);
  await h.insertRecord(SHARED, 'kept');
  expect(await h.storedBindings(SHARED), 'precondition: both packages hold the object').toEqual([P, Q]);
  expect(await h.hasTable(SHARED)).toBe(true);
  expect(await h.records(SHARED)).toEqual(['kept']);
  return h;
}

/** Everything a refused uninstall must leave as it was. */
async function expectUntouched(h: Process, others: Array<string | null>) {
  expect(await h.storedPackage(P), 'the sys_packages row of P').toBe(true);
  expect((await h.call('GET', `/${P}`)).status, 'P is still installed in this process').toBe(200);
  expect(await h.storedBindings(SHARED)).toEqual([P, ...others].sort((a, b) => String(a).localeCompare(String(b))));
  expect(await h.hasTable(SHARED)).toBe(true);
  expect(await h.records(SHARED)).toEqual(['kept']);
  // The running registry still serves P's definition of the object.
  expect(h.engine.registry.getObject(SHARED)).toMatchObject({ label: `${SHARED} ${P}` });
}

/** After P's row of the shared object is gone, the running registry serves Q's. */
const expectServedByQ = (h: Process) =>
  expect(h.engine.registry.getObject(SHARED)).toMatchObject({ label: `${SHARED} ${Q}` });

describe('[#23473] DELETE /packages/:id of a package whose object another stored row also holds', () => {
  it('without keepData: refused 409 RESOURCE_CONFLICT before anything durable — the package, both rows, the table and its record stay', async () => {
    const h = await twoPackageObject();

    const answer = await h.call('DELETE', `/${P}`);

    expect({ status: answer.status, code: answer.code }, JSON.stringify(answer.body)).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
    const message = String(answer.body?.error?.message);
    // Located: the shared object and the row that keeps it; the way out.
    expect(message).toContain(`'${SHARED}'`);
    expect(message).toContain(Q);
    expect(message).toContain('keepData');
    await expectUntouched(h, [Q]);
  }, 60_000);

  it('a package-less row of the object counts as another holder', async () => {
    const h = await boot();
    await h.install(P);
    await h.publish(P, SHARED);
    await h.seedUnboundRow(SHARED);
    await h.insertRecord(SHARED, 'kept');
    expect(await h.storedBindings(SHARED)).toEqual([P, null]);

    const answer = await h.call('DELETE', `/${P}`);

    expect({ status: answer.status, code: answer.code }, JSON.stringify(answer.body)).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
    await expectUntouched(h, [null]);
  }, 60_000);

  it('the way out, keepData: the uninstall completes with nothing failed, and the shared table, Q\'s row and the record stay', async () => {
    const h = await twoPackageObject();

    const answer = await h.call('DELETE', `/${P}`, { keepData: 'true' });

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body?.data?.persisted).toMatchObject({ success: true, failedCount: 0, failed: [] });
    expect(await h.storedPackage(P)).toBe(false);
    expect((await h.call('GET', `/${P}`)).status).toBe(404);
    expect(await h.storedBindings(SHARED)).toEqual([Q]);
    expect(await h.hasTable(SHARED)).toBe(true);
    expect(await h.records(SHARED)).toEqual(['kept']);
    expectServedByQ(h);
  }, 60_000);

  it('the way out, P\'s own row first: the uninstall completes, keeps the shared table and still drops the table P alone held', async () => {
    const h = await twoPackageObject();
    await h.publish(P, PRIVATE);
    expect(await h.hasTable(PRIVATE)).toBe(true);
    // The metadata door's delete of P's row, without dropStorage: the table
    // stays for Q's row.
    await (h.protocol as any).deleteMetaItem({ type: 'object', name: SHARED, packageId: P });
    expect(await h.storedBindings(SHARED)).toEqual([Q]);

    const answer = await h.call('DELETE', `/${P}`);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body?.data?.persisted).toMatchObject({ success: true, failedCount: 0, failed: [] });
    expect(await h.storedPackage(P)).toBe(false);
    expect(await h.storedBindings(SHARED)).toEqual([Q]);
    expect(await h.hasTable(SHARED)).toBe(true);
    expect(await h.records(SHARED)).toEqual(['kept']);
    expectServedByQ(h);
    expect(await h.hasTable(PRIVATE)).toBe(false);
  }, 60_000);

  it('CONTROL: an object one package holds — the uninstall removes its row and drops its table', async () => {
    const h = await boot();
    await h.install(P);
    await h.publish(P, SHARED);
    await h.insertRecord(SHARED, 'gone');

    const answer = await h.call('DELETE', `/${P}`);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body?.data?.persisted).toMatchObject({ success: true, failedCount: 0 });
    expect(await h.storedPackage(P)).toBe(false);
    expect(await h.storedBindings(SHARED)).toEqual([]);
    expect(await h.hasTable(SHARED)).toBe(false);
  }, 60_000);
});
