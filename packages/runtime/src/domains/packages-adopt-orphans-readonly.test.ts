// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /packages/:id/adopt-orphans` — the ADR-0070 D2 read-only rule at the
 * orphan-adoption door (#24813).
 *
 * ## The defect
 *
 * The arm asked `requireManageMetadata` and the walled refusal, and then called
 * `protocol.reassignOrphanedMetadata({ targetPackageId: id })`, which asks no
 * writability question of its own: it rebinds every package-less
 * `sys_metadata` row to whatever id it is handed. So a `manage_metadata`
 * holder could bind the environment's loose items INTO a package the
 * deployment ships — booted by code, installed from the marketplace, or a
 * stored row whose manifest `scope` is `system` / `cloud` — and the door
 * answered `200` with the rows it moved. Every other state-changing arm on the
 * domain (install-overwrite, disable, publish, revert, the manifest PATCH and
 * delete) refuses that same id `422 WRITABLE_PACKAGE_REQUIRED`.
 *
 * ## What is asserted, and why it is not the status alone
 *
 * The harm is the rebinding, so every refusal reads the rows back: the
 * orphans the real producer minted (a package-less `saveMetaItem`, which still
 * lands `package_id = NULL` today) are still package-less after the refusal,
 * and the protocol's `reassignOrphanedMetadata` was never called. The store is
 * REAL — better-sqlite3 `:memory:`, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` over a real `ObjectQL` — so the rows are
 * the store's, not a double's. The code-booted and marketplace ids are booted
 * through the engine's own `registerApp`; the two scope-only ids are installed
 * the way `sys_packages` hydration installs a stored row (`source:
 * 'authored'`, no booted manifest), so their refusal can only come from the
 * scope signal.
 *
 * ## Order
 *
 * The gate sits where its siblings put it: after the capability gate and the
 * walled refusal (both `403`, both still answer first on a read-only id), and
 * before the protocol is resolved, so a read-only id answers `422` even on a
 * deployment whose protocol cannot adopt (`501` for a writable id there).
 *
 * ## The gate is not an outage
 *
 * CONTROL: a writable package still adopts (`200`, and the rows really move),
 * and an id nothing installed is writable by the predicate's own rule, so it
 * still reaches the protocol, which binds the orphans to it exactly as before.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { HttpDispatcher } from '../http-dispatcher.js';

/** Booted by the deployment's code: `registerApp`, default source `'code'`. */
const CODE_BOOTED = 'com.acme.codepkg';
/** Installed from the marketplace: `registerApp(…, 'marketplace')`. */
const MARKETPLACE = 'com.acme.marketpkg';
/** A stored row whose manifest declares `scope: 'system'`; nothing booted it. */
const SYSTEM_SCOPED = 'com.acme.systempkg';
/** A stored row whose manifest declares `scope: 'cloud'`; nothing booted it. */
const CLOUD_SCOPED = 'com.acme.cloudpkg';
/** An org's own base. */
const AUTHORED = 'com.acme.authoredpkg';
/** An id nothing has installed. */
const UNKNOWN = 'com.acme.nopkg';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';

/** The loose items the real producer leaves behind. */
const ORPHANS = ['loose_grid', 'loose_board'] as const;

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    version: '1.0.0',
    type: 'app',
    ...extra,
});

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const view = (name: string) => ({
    name,
    label: name,
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
});

const silentLogger: any = {
    debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {},
    child() { return silentLogger; },
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

interface BootOptions {
    /** Compose a protocol that cannot adopt (no `reassignOrphanedMetadata`). */
    protocolWithoutAdoption?: boolean;
    /** Compose a `tenancy` service answering this posture. */
    posture?: 'isolated' | 'group';
}

/** The composed door over a real store, with the orphans already minted. */
async function boot(options: BootOptions = {}) {
    const engine = new ObjectQL({ logger: silentLogger });
    liveEngines.push(engine);
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(TASK as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    engine.registerApp(manifest(CODE_BOOTED));
    engine.registerApp(manifest(MARKETPLACE), undefined, 'marketplace');
    engine.registry.installPackage(manifest(SYSTEM_SCOPED, { scope: 'system' }) as any, 'authored');
    engine.registry.installPackage(manifest(CLOUD_SCOPED, { scope: 'cloud' }) as any, 'authored');
    engine.registry.installPackage(manifest(AUTHORED, { scope: 'project' }) as any, 'authored');

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    // The real producer of an orphan: a save naming no package.
    for (const name of ORPHANS) {
        await protocol.saveMetaItem({ type: 'view', name, item: view(name), mode: 'publish' });
    }
    const adopt = vi.spyOn(protocol, 'reassignOrphanedMetadata');

    const served = options.protocolWithoutAdoption
        ? { saveMetaItem: protocol.saveMetaItem.bind(protocol) }
        : protocol;
    const services: Record<string, unknown> = { protocol: served, objectql: engine };
    if (options.posture) services.tenancy = { posture: options.posture };
    const get = (name: string) => services[name] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);

    /** Each loose item's binding, read off the store. */
    const bindings = async (): Promise<Record<string, unknown>> => {
        const rows = (await engine.find('sys_metadata', { where: { type: 'view' } })) as any[];
        return Object.fromEntries(
            rows.filter((r) => (ORPHANS as readonly string[]).includes(r.name)).map((r) => [r.name, r.package_id ?? null]),
        );
    };

    return { engine, dispatcher, adopt, bindings };
}

type Caller = Record<string, unknown>;
/** Holds `manage_metadata`; the operator rung, so no wall refuses it. */
const ADMIN: Caller = { userId: 'u_pkg_admin', systemPermissions: ['manage_metadata', 'studio.access'], posture: 'PLATFORM_ADMIN' };
/** Signed in, without `manage_metadata`. */
const NO_CAPABILITY: Caller = { userId: 'u_reader', systemPermissions: ['studio.access'] };
/** An organization's `manage_metadata` holder below the operator rung. */
const TENANT_AUTHOR: Caller = { userId: 'u_tenant', tenantId: 'org_a', systemPermissions: ['manage_metadata'], posture: 'TENANT_ADMIN' };

type Door = Awaited<ReturnType<typeof boot>>;
const adoptInto = async (d: Door, id: string, caller: Caller = ADMIN) => {
    const r = await d.dispatcher.handlePackages(
        `/${encodeURIComponent(id)}/adopt-orphans`, 'POST', {}, {},
        { request: {}, environmentId: 'pkg-adopt-orphans-readonly-test', executionContext: caller } as any,
    );
    expect(r.handled).toBe(true);
    return { status: r.response?.status, body: r.response?.body as any };
};

const UNBOUND = Object.fromEntries(ORPHANS.map((n) => [n, null]));
const boundTo = (id: string) => Object.fromEntries(ORPHANS.map((n) => [n, id]));

// ══════════════════════════════════════════════════════════════════════════════
// 1. REFUSED: adopting into a read-only package binds nothing
// ══════════════════════════════════════════════════════════════════════════════

const READ_ONLY: Array<{ label: string; id: string; booted: boolean }> = [
    { label: 'code-booted (registerApp)', id: CODE_BOOTED, booted: true },
    { label: 'marketplace-installed (registerApp, marketplace)', id: MARKETPLACE, booted: true },
    { label: 'system-scoped stored row (scope signal only)', id: SYSTEM_SCOPED, booted: false },
    { label: 'cloud-scoped stored row (scope signal only)', id: CLOUD_SCOPED, booted: false },
];

describe('POST /packages/:id/adopt-orphans on a read-only package is refused', () => {
    for (const pkg of READ_ONLY) {
        it(`422s the ${pkg.label} package and binds nothing`, async () => {
            const d = await boot();
            expect(await d.bindings(), 'precondition: the producer left orphans').toEqual(UNBOUND);
            expect((d.engine as unknown as { manifests: Map<string, unknown> }).manifests.has(pkg.id),
                'precondition: the boot signal').toBe(pkg.booted);

            const r = await adoptInto(d, pkg.id);

            expect(r.status).toBe(422);
            expect(r.body?.success).toBe(false);
            expect(r.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
            expect(r.body?.error?.httpStatus).toBe(422);
            expect(r.body?.error?.details?.packageId).toBe(pkg.id);
            expect(r.body?.error?.details?.docs).toBe('docs/adr/0070-package-first-authoring.md');
            // Nothing was rebound: the protocol was never asked, and the rows say so.
            expect(d.adopt).not.toHaveBeenCalled();
            expect(await d.bindings()).toEqual(UNBOUND);
        }, 30_000);
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. ORDER: which refusal answers when more than one applies to a read-only id
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /packages/:id/adopt-orphans — the gate\'s place among the refusals', () => {
    it('a caller without manage_metadata is refused 403 by the capability gate first', async () => {
        const d = await boot();

        const r = await adoptInto(d, CODE_BOOTED, NO_CAPABILITY);

        expect(r.status).toBe(403);
        expect(r.body?.error?.code).not.toBe('WRITABLE_PACKAGE_REQUIRED');
        expect(String(r.body?.error?.message)).toContain('manage_metadata');
        expect(d.adopt).not.toHaveBeenCalled();
        expect(await d.bindings()).toEqual(UNBOUND);
    }, 30_000);

    it('under a wall, a tenant holder is refused 403 PERMISSION_DENIED by the walled refusal first', async () => {
        const d = await boot({ posture: 'isolated' });

        const r = await adoptInto(d, CODE_BOOTED, TENANT_AUTHOR);

        expect(r.status).toBe(403);
        expect(r.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(String(r.body?.error?.message)).toContain('tenancy posture');
        expect(d.adopt).not.toHaveBeenCalled();
        expect(await d.bindings()).toEqual(UNBOUND);
    }, 30_000);

    it('the gate precedes the protocol: a read-only id answers 422 where a writable id answers 501', async () => {
        const d = await boot({ protocolWithoutAdoption: true });

        const readOnly = await adoptInto(d, CODE_BOOTED);
        expect(readOnly.status).toBe(422);
        expect(readOnly.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');

        const writable = await adoptInto(d, AUTHORED);
        expect(writable.status).toBe(501);
        expect(writable.body?.error?.code).not.toBe('WRITABLE_PACKAGE_REQUIRED');
        expect(await d.bindings()).toEqual(UNBOUND);
    }, 30_000);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. CONTROL: the gate is not an outage
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /packages/:id/adopt-orphans still adopts into what an org owns', () => {
    it('a writable package adopts: 200, and every orphan is really bound to it', async () => {
        const d = await boot();

        const r = await adoptInto(d, AUTHORED);

        expect(r.status).toBe(200);
        expect(r.body?.data).toMatchObject({ success: true, reassignedCount: ORPHANS.length, targetPackageId: AUTHORED });
        expect(d.adopt).toHaveBeenCalledTimes(1);
        expect(await d.bindings()).toEqual(boundTo(AUTHORED));
    }, 30_000);

    it('an id nothing installed is writable by the predicate\'s own rule, so it still reaches the protocol, as before', async () => {
        const d = await boot();
        expect(d.engine.registry.getPackage(UNKNOWN), 'precondition: nothing installed it').toBeUndefined();

        const r = await adoptInto(d, UNKNOWN);

        expect(r.status).toBe(200);
        expect(r.body?.error?.code).toBeUndefined();
        expect(d.adopt).toHaveBeenCalledTimes(1);
        expect(await d.bindings()).toEqual(boundTo(UNKNOWN));
    }, 30_000);
});
