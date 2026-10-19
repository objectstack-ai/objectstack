// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23630, ADR-0029 D9.9 — the PROMOTE doors ask the question the save door
 * asks: a draft of an object bound to package Q, saved before package P's
 * runtime-authored row of that object existed, is refused when it is promoted
 * after P's row exists, with the save door's refusal
 * (`OBJECT_OVERLAY_PACKAGE_MISMATCH` / 422), and nothing is written.
 *
 * ## The defect
 *
 * The save door refuses a row bound to a package that does not own the object
 * (`saveMetaItem`, D9.9 since #23416). A draft save is judged against the
 * owner of ITS moment, so Q's draft saved while no row of the object existed
 * passed, correctly. The promotion was the second way that row reached
 * `active`, and it never asked: P's row saved, then Q's draft promoted, by the
 * per-item publish (`publishMetaItem` naming Q) or by
 * `POST /api/v1/packages/Q/publish-drafts`, answered success. The store then
 * held `[P, Q]` active rows of one object while the registry kept serving P —
 * the write-through's own D9.9 refusal was swallowed into a `console.warn` —
 * which is the disagreement D9.9 exists to prevent, and an uninstall of P then
 * refused `409 RESOURCE_CONFLICT` until a row was removed by hand (#23473).
 *
 * ## The pins
 *
 *  - per door, the measured sequence is refused before anything is written:
 *    the per-item publish throws the save door's envelope (`code` + `status`,
 *    and the same message the save door answers for the same row); the batch
 *    door answers its declared per-item outcome (ADR-0067 D2, all-or-nothing):
 *    `outcome: 'refused'`, Q's draft in `failed[]` with that code and message;
 *    either way the active rows stay `[P]`, Q's draft stays stored and the
 *    registry still serves P;
 *  - CONTROL, per door: a promote with no second-package owner is unchanged —
 *    Q's draft of an object no other package holds is promoted, and so is the
 *    owner P's own draft;
 *  - CONTROL: the per-item publish naming no package still promotes a
 *    package-unbound draft INTO the owner's package (#23495's adoption): the
 *    question is asked of the package the promotion writes under;
 *  - CONTROL, per door: a CODE-packaged owner answers what it answered before.
 *    An object a code package ships is sealed managed content (ADR-0131 D6), so
 *    the save door's package door answers `NOT_OVERRIDABLE` / 403 ahead of its
 *    D9.9 check, and a promotion of a Q-bound draft stored before the package
 *    shipped the object answers that same refusal from the store — never
 *    `OBJECT_OVERLAY_PACKAGE_MISMATCH`, whose prescription ("bind to the
 *    owner") the sealed rule refuses — and nothing is written.
 *
 * ## The composition — the shipped pieces
 *
 * The `package-uninstall-shared-object.integration.test.ts` harness: a REAL
 * `ObjectQL` over a REAL `SqlDriver` (better-sqlite3, on disk); the REAL
 * `PackageServicePlugin`; the REAL `ObjectStackProtocolImplementation`; and the
 * REAL `HttpDispatcher`, whose `handlePackages` is the `publish-drafts` door.
 * The rows are read out of the store, the owner out of the registry.
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
  SysMetadataCommitObject,
  hashSpec,
} from '@objectstack/metadata-core';
import { PackageServicePlugin } from '@objectstack/service-package';
import { HttpDispatcher } from './http-dispatcher.js';

const P = 'com.probe.p';
const Q = 'com.probe.q';
/** A CODE package shipping the object (registered as `registerApp` registers it). */
const O = 'com.probe.code';
const PLATFORM_PKG = 'com.objectstack.platform';
const ENV = 'platform';
const X = 'probe_ticket';

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
  home = mkdtempSync(join(tmpdir(), 'os-23630-home-'));
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

/** `label` tells the writers apart: `probe_ticket com.probe.q`, `probe_ticket unbound`. */
const objectBody = (label: string) => ({
  name: X,
  label: `${X} ${label}`,
  // [#8310] The runtime object door requires an authored OWD.
  sharingModel: 'private',
  fields: { title: { name: 'title', type: 'text' as const, label: 'Title' } },
});

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-23630-db-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  // `sys_metadata` holds the rows under test; the other three are what the
  // real publish path writes through on its way there.
  const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject] as any[];
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

  const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => services as any, undefined, 'package-author');
  services.set('protocol', protocol);
  const get = (name: string) => services.get(name) ?? null;
  const dispatcher = new HttpDispatcher({ context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) } as any);
  const knex = (driver as any).knex;

  const bindings = async (state: 'active' | 'draft') => {
    const rows = (await knex('sys_metadata').where({ type: 'object', name: X, state }).select('package_id')) as any[];
    return rows.map((r) => (r.package_id ?? null) as string | null).sort((a, b) => String(a).localeCompare(String(b)));
  };

  return {
    engine,
    protocol,
    /** A package verb at the real door (`handlePackages`). */
    async call(method: string, path: string) {
      const res = await dispatcher.handlePackages(path, method, undefined, {}, CALLER);
      const body = JSON.parse(JSON.stringify(res.response?.body ?? null));
      return { status: res.response?.status ?? 0, body };
    },
    async install(id: string) {
      await protocol.installPackage({ manifest: { id, name: id, version: '1.0.0', type: 'app' } });
    },
    /** A draft save of the object, bound to `packageId`, or naming no package. */
    async saveDraft(packageId: string | undefined) {
      const res = await protocol.saveMetaItem({
        type: 'object', name: X, item: objectBody(packageId ?? 'unbound'), mode: 'draft',
        ...(packageId ? { packageId } : {}),
      });
      expect(res.success, 'the draft save').toBe(true);
    },
    /**
     * A draft row of the object bound to `packageId` as it exists at rest,
     * written straight into the store, never through the save door: the shape
     * a draft save stores (the body's checksum by `hashSpec`). The save door
     * refuses a draft of a code-packaged object today, so such a row is one
     * stored before the code package shipped the object.
     */
    async seedStoredDraft(packageId: string) {
      const body = objectBody(packageId);
      const now = new Date().toISOString();
      await engine.insert('sys_metadata', {
        id: `seed_draft_${packageId}_${X}`, type: 'object', name: X,
        package_id: packageId, state: 'draft', metadata: JSON.stringify(body), checksum: hashSpec(body, 'object'),
        version: 1, created_at: now, updated_at: now,
      }, { context: { isSystem: true } } as any);
    },
    /** The object as a code package ships it: contributors only, with the provenance a loader stamps. */
    registerCodeOwner(packageId: string) {
      engine.registry.registerObject({ ...objectBody(packageId), _packageId: packageId, _provenance: 'package' } as any, packageId);
      expect(engine.registry.getPackagedObjectOwner(X)?.packageId, 'precondition: a code-packaged owner').toBe(packageId);
    },
    /** A publish-mode save bound to `packageId` — the runtime-authored owner's row. */
    saveActive: (packageId: string) =>
      protocol.saveMetaItem({ type: 'object', name: X, item: objectBody(packageId), packageId }),
    /** The object's stored rows of one state, by binding — the store, not the door's word for it. */
    activeBindings: () => bindings('active'),
    draftBindings: () => bindings('draft'),
    registryOwner: () => engine.registry.getObjectOwner(X)?.packageId,
    registryLabel: () => (engine.registry.getObject(X) as { label?: string } | undefined)?.label,
  };
}

type Process = Awaited<ReturnType<typeof boot>>;

/**
 * The measured sequence: Q's draft saved while no row of the object exists
 * (nothing owns it, so the save door's D9.9 question passes), THEN P's
 * runtime-authored row saved — P owns the object.
 */
async function qDraftThenPOwner(): Promise<Process> {
  const h = await boot();
  await h.install(P);
  await h.install(Q);
  await h.saveDraft(Q);
  const saved = await h.saveActive(P);
  expect(saved.success, 'P\'s save').toBe(true);
  expect(await h.activeBindings(), 'precondition: P alone holds an active row').toEqual([P]);
  expect(await h.draftBindings(), 'precondition: Q\'s draft is stored').toEqual([Q]);
  expect(h.registryOwner(), 'precondition: the registry holds the object as P\'s').toBe(P);
  return h;
}

/**
 * A code package O ships the object; Q's draft of it was stored before O
 * shipped it (a row at rest — the save door refuses that draft today).
 */
async function qDraftThenCodeOwner(): Promise<Process> {
  const h = await boot();
  await h.install(Q);
  await h.seedStoredDraft(Q);
  h.registerCodeOwner(O);
  expect(await h.activeBindings(), 'precondition: no active row').toEqual([]);
  expect(await h.draftBindings(), 'precondition: Q\'s draft is stored').toEqual([Q]);
  return h;
}

/** Everything a refused promotion over the code-packaged owner must leave as it was. */
async function expectCodeOwnerUntouched(h: Process) {
  expect(await h.activeBindings(), 'no active row for Q').toEqual([]);
  expect(await h.draftBindings(), 'Q\'s draft stays stored').toEqual([Q]);
  expect(h.engine.registry.getPackagedObjectOwner(X)?.packageId).toBe(O);
  expect(h.registryLabel()).toBe(`${X} ${O}`);
}

/** The save door's own answer for the row the promotion would write: Q's active row. */
async function saveDoorRefusal(h: Process): Promise<any> {
  const err = await h.saveActive(Q).then(() => null, (e: any) => e);
  expect(err?.code, 'the save door refuses Q\'s row (#23416)').toBe('OBJECT_OVERLAY_PACKAGE_MISMATCH');
  return err;
}

/** Everything a refused promotion must leave as it was. */
async function expectNothingWritten(h: Process) {
  expect(await h.activeBindings(), 'no active row for Q').toEqual([P]);
  expect(await h.draftBindings(), 'Q\'s draft stays stored').toEqual([Q]);
  expect(h.registryOwner()).toBe(P);
  expect(h.registryLabel()).toBe(`${X} ${P}`);
}

describe('[#23630] ADR-0029 D9.9 at the promote doors — a draft promoted after a runtime owner\'s row exists', () => {
  it('publishMetaItem naming Q: refused with the save door\'s envelope, before any write', async () => {
    const h = await qDraftThenPOwner();

    const err = await h.protocol.publishMetaItem({ type: 'object', name: X, packageId: Q }).then(() => null, (e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'OBJECT_OVERLAY_PACKAGE_MISMATCH', status: 422 });
    expect({ packageId: err.packageId, ownerPackageId: err.ownerPackageId }).toEqual({ packageId: Q, ownerPackageId: P });
    await expectNothingWritten(h);
    // One refusal, not a second dialect: the save door's answer for the same row.
    expect(err.message).toBe((await saveDoorRefusal(h)).message);
  }, 60_000);

  it('POST /packages/Q/publish-drafts: the batch is refused, Q\'s draft in failed[] with the save door\'s code, nothing written', async () => {
    const h = await qDraftThenPOwner();

    const answer = await h.call('POST', `/${Q}/publish-drafts`);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const result = answer.body?.data;
    expect(result).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, failedCount: 1, published: [] });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ type: 'object', name: X, code: 'OBJECT_OVERLAY_PACKAGE_MISMATCH' });
    await expectNothingWritten(h);
    expect(result.failed[0].error).toBe((await saveDoorRefusal(h)).message);
  }, 60_000);

  it('CONTROL: with no second-package owner, publishMetaItem naming Q promotes Q\'s draft', async () => {
    const h = await boot();
    await h.install(Q);
    await h.saveDraft(Q);

    const res = await h.protocol.publishMetaItem({ type: 'object', name: X, packageId: Q });

    expect(res.success).toBe(true);
    expect(await h.activeBindings()).toEqual([Q]);
    expect(await h.draftBindings()).toEqual([]);
    expect(h.registryOwner()).toBe(Q);
    expect(h.registryLabel()).toBe(`${X} ${Q}`);
  }, 60_000);

  it('CONTROL: with no second-package owner, POST /packages/Q/publish-drafts publishes Q\'s draft', async () => {
    const h = await boot();
    await h.install(Q);
    await h.saveDraft(Q);

    const answer = await h.call('POST', `/${Q}/publish-drafts`);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body?.data).toMatchObject({ success: true, outcome: 'published', publishedCount: 1, failed: [] });
    expect(await h.activeBindings()).toEqual([Q]);
    expect(await h.draftBindings()).toEqual([]);
    expect(h.registryOwner()).toBe(Q);
  }, 60_000);

  it('CONTROL: the owner\'s own draft — POST /packages/P/publish-drafts publishes P\'s draft over P\'s row', async () => {
    const h = await boot();
    await h.install(P);
    expect((await h.saveActive(P)).success).toBe(true);
    await h.saveDraft(P);

    const answer = await h.call('POST', `/${P}/publish-drafts`);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body?.data).toMatchObject({ success: true, outcome: 'published', publishedCount: 1, failed: [] });
    expect(await h.activeBindings()).toEqual([P]);
    expect(await h.draftBindings()).toEqual([]);
    expect(h.registryOwner()).toBe(P);
  }, 60_000);

  it('CONTROL: a code-packaged owner — publishMetaItem naming Q answers the sealed refusal NOT_OVERRIDABLE / 403, as before', async () => {
    const h = await qDraftThenCodeOwner();

    const err = await h.protocol.publishMetaItem({ type: 'object', name: X, packageId: Q }).then(() => null, (e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
    await expectCodeOwnerUntouched(h);
    // The save door's answer for the same row is that same refusal (the package
    // door ahead of D9.9), never the D9.9 mismatch.
    const saveErr = await h.saveActive(Q).then(() => null, (e: any) => e);
    expect({ code: saveErr?.code, status: saveErr?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
  }, 60_000);

  it('CONTROL: a code-packaged owner — POST /packages/Q/publish-drafts refuses the batch with NOT_OVERRIDABLE in failed[], as before', async () => {
    const h = await qDraftThenCodeOwner();

    const answer = await h.call('POST', `/${Q}/publish-drafts`);

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const result = answer.body?.data;
    expect(result).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, failedCount: 1, published: [] });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ type: 'object', name: X, code: 'NOT_OVERRIDABLE' });
    await expectCodeOwnerUntouched(h);
  }, 60_000);

  it('CONTROL: publishMetaItem naming no package promotes a package-unbound draft INTO the owner\'s package', async () => {
    const h = await boot();
    await h.install(P);
    await h.saveDraft(undefined);
    expect((await h.saveActive(P)).success).toBe(true);
    expect(await h.draftBindings(), 'precondition: the unbound draft').toEqual([null]);

    const res = await h.protocol.publishMetaItem({ type: 'object', name: X });

    expect(res.success).toBe(true);
    expect(await h.activeBindings()).toEqual([P]);
    expect(await h.draftBindings()).toEqual([]);
    expect(h.registryOwner()).toBe(P);
    expect(h.registryLabel()).toBe(`${X} unbound`);
  }, 60_000);
});
