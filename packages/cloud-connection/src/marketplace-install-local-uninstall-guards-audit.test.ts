// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31283 — install-local's own uninstall door
 * (`DELETE /api/v1/marketplace/install-local/:manifestId`) asks the uninstall
 * verb's pre-uninstall guards before its first write, and writes the verb's
 * `package_uninstall` audit row after a completed uninstall — through the
 * protocol's public entry points, so there is one verdict and one writer.
 *
 * ## What was wrong
 *
 * The door withdraws the package itself and then runs the protocol's uninstall
 * cleanups (#21490), but never goes through `deletePackage`: it does not fit
 * this door (it answers `success: false` for a package with no stored rows and
 * drops the tables of the objects it removes). So it missed what the verb does
 * before and after the delete: the pre-uninstall guards (#31232 — the runtime's
 * dependent-rule refusal: an active validation rule of another enabled package
 * reads a field this package adds through `objectExtensions`), and the
 * package's own ledger row (#31186). Measured before the fix on this rig: the
 * uninstall answered `200`, the field left the served object, and no audit
 * event was written.
 *
 * ## What is real here
 *
 * An `ObjectKernel` with `ObjectQLPlugin` — the real `SchemaRegistry` and the
 * real `ObjectStackProtocolImplementation` it registers as `protocol` — and the
 * runtime's `AppPlugin`, whose `start()` registers the dependent-rule guard on
 * that protocol (the guard every caller of the verb meets). The `audit` slot is
 * a recorder of the events the protocol hands it (plugin-audit turns them into
 * rows, pinned there). The packages are registered the way the runtime's own
 * #30999 rig registers them; the ledger entries are written the way an install
 * writes them.
 *
 * ## What these cases pin
 *
 *   - an uninstall of a package whose extension field an active rule of another
 *     package reads: the verb's `409 PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`
 *     and its sentence, and nothing moved — the ledger entry, the registration,
 *     the served field, no cleanup run, no audit event;
 *   - CONTROL: a package whose field no rule reads uninstalls, and the protocol
 *     hands the audit slot exactly one `package_uninstall` event naming it, its
 *     version and the operator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import { AppPlugin, formatPackageDisableDependents, readPackageDisableDependents } from '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { INSTALLER_USER_ID, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
/** The package owning the object the others extend. */
const JOBS = 'com.acme.jobs';
/** The package under uninstall: it adds `acme_tier` to the jobs object. */
const TIERS = 'com.acme.tiers';
/** CONTROL: it adds `acme_note`, which no rule reads. */
const NOTES = 'com.acme.notes';
/** The package whose active validation rule reads `acme_tier`. */
const READER = 'com.acme.reader';
const JOB = 'acme_job';
const TIER = 'acme_tier';
const NOTE = 'acme_note';
const RULE = 'acme_tier_known';
const CODE = 'PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE';

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-uninstall-guards-')); });
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** A ledger entry as an install writes it. */
function ledger(manifestId: string) {
    new LocalManifestSource(dir).write({
        packageId: manifestId,
        versionId: 'v1',
        manifestId,
        version: '1.0.0',
        manifest: { id: manifestId, name: manifestId, version: '1.0.0', type: 'module' },
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: INSTALLER_USER_ID,
        withSampleData: false,
    });
}
const ledgered = (manifestId: string) => new LocalManifestSource(dir).read(manifestId).entry !== null;

/** The jobs object's served field names. */
const servedFields = (ql: ObjectQL) => Object.keys((ql.registry.getObject(JOB) as any)?.fields ?? {});

/** The real engine, protocol and dependent-rule guard; the four packages registered; TIERS and NOTES ledgered. */
async function boot() {
    const auditEvents: unknown[] = [];
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
        name: 'test.audit-slot',
        version: '1.0.0',
        init: async (ctx: any) => {
            ctx.registerService('audit', {
                recordPackageLifecycleEvent: async (event: unknown) => { auditEvents.push(event); },
            });
        },
        start: async () => undefined,
    } as never);
    // An empty app: its `start()` registers the dependent-rule guard on the protocol.
    await kernel.use(new AppPlugin({}));
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    const protocol = kernel.getService<any>('protocol');

    for (const id of [JOBS, TIERS, NOTES, READER]) {
        ql.registry.installPackage({ id, name: id, version: '1.0.0', type: 'module' } as any, 'authored');
    }
    ql.registry.registerObject({ name: JOB, label: 'Job', fields: { name: { name: 'name', type: 'text', label: 'Name' } } } as any, JOBS);
    ql.registry.registerObject({ name: JOB, fields: { [TIER]: { name: TIER, type: 'text', label: 'Tier' } } } as any, TIERS, undefined, 'extend');
    ql.registry.registerObject({ name: JOB, fields: { [NOTE]: { name: NOTE, type: 'text', label: 'Note' } } } as any, NOTES, undefined, 'extend');
    ql.registry.registerObject({
        name: JOB,
        validations: [{ name: RULE, type: 'script', severity: 'error', message: 'Unknown tier', condition: `record.${TIER} == 'unknown'` }],
    } as any, READER, undefined, 'extend');
    ledger(TIERS);
    ledger(NOTES);

    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, () => Promise<void>>();
    const services: Record<string, unknown> = {
        manifest: kernel.getService('manifest'),
        auth: installerAuthService(),
        protocol,
        objectql: withInstallerGrants({ registry: ql.registry, syncSchemas: async () => undefined }),
    };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        trigger: async () => undefined,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    // The `kernel:ready` rehydrate is not what is pinned: the packages are registered above.
    (plugin as unknown as Record<string, unknown>).rehydrate = async () => undefined;
    await plugin.start(ctx as never);
    await hooks.get('kernel:ready')?.();

    const uninstall = async (manifestId: string) => {
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return routes.get(`DELETE ${ROUTE}/:manifestId`)!({
            req: {
                url: `http://localhost:3000${ROUTE}/${manifestId}`,
                raw: new Request(`http://localhost:3000${ROUTE}/${manifestId}`, { method: 'DELETE' }),
                json: async () => ({}),
                param: (name: string) => (name === 'manifestId' ? manifestId : undefined),
            },
            json,
        });
    };
    return { ql, protocol, auditEvents, uninstall };
}

describe('install-local uninstall asks the uninstall verb\'s guards and writes its audit row (#31283)', () => {
    it('a package whose extension field an active rule of another package reads is refused with the verb\'s 409; nothing moves', async () => {
        const { ql, protocol, auditEvents, uninstall } = await boot();
        const runCleanups = vi.spyOn(protocol, 'runUninstallCleanups');
        const expected = formatPackageDisableDependents(
            `Package '${TIERS}' cannot be uninstalled`,
            readPackageDisableDependents(ql.registry, TIERS),
            { operation: 'uninstall' },
        );
        expect(expected, 'precondition: the rule depends on the field').toContain(RULE);

        const res = await uninstall(TIERS);

        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe(CODE);
        expect(res.payload.error.message).toBe(expected);
        // Nothing moved.
        expect(ledgered(TIERS)).toBe(true);
        expect(ql.registry.getPackage(TIERS)).toBeDefined();
        expect(servedFields(ql)).toEqual(expect.arrayContaining([TIER, NOTE]));
        expect(runCleanups).not.toHaveBeenCalled();
        expect(auditEvents).toEqual([]);
    }, 60_000);

    it('CONTROL — a package whose field no rule reads uninstalls and the protocol records one package_uninstall event', async () => {
        const { ql, auditEvents, uninstall } = await boot();

        const res = await uninstall(NOTES);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(ledgered(NOTES)).toBe(false);
        expect(ql.registry.getPackage(NOTES)).toBeUndefined();
        expect(auditEvents).toEqual([{
            action: 'package_uninstall',
            packageId: NOTES,
            version: '1.0.0',
            actor: INSTALLER_USER_ID,
            itemsRemoved: 0,
            itemsFailed: 0,
        }]);
    }, 60_000);
});
