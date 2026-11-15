// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DELETE /api/v1/marketplace/install-local/:manifestId` withdraws the
 * package's executable handlers from the running engine, not only its
 * registry entry.
 *
 * ## What was wrong
 *
 * The door withdrew the package from the registry (`uninstallPackage`) and
 * left every handler its install bound on the engine under `app:<manifestId>`
 * (`bindAppArtifactHandlers`): the engine's per-package action slots are not
 * the registry. Two installed packages each holding a script action `escalate`
 * on one object, a call that names no package is refused `409
 * RESOURCE_CONFLICT` naming both — correct. After one of them was uninstalled
 * the same call kept answering that `409`, naming the uninstalled package as
 * one of the two owners, until a restart; the restart answered `200` with the
 * remaining package's result. Its body hooks kept firing the same way.
 *
 * The withdrawal had a second half in the engine: the unqualified slot a bare
 * call runs held the LAST registration under the key — the uninstalled
 * package's — and removing a package's handlers emptied that slot rather than
 * handing it back to the owner still holding the key, so the bare call would
 * have answered "not found" where the restart runs the remaining handler.
 *
 * ## What is real here
 *
 * An `ObjectKernel` with `ObjectQLPlugin` — the real engine, whose action
 * slots and bare-call ambiguity rule (`executeAction` with no `packageId`) are
 * the thing under test, the real `SchemaRegistry` and the real protocol — and
 * the runtime's `AppPlugin`, as a booted server composes them. The handlers
 * are bound by the REAL runtime binder (`bindAppArtifactHandlers`, the one the
 * door's install calls, with the door's own options) through the same engine
 * object the door is handed; the packages are registered and ledgered the way
 * an install leaves them. The only stand-in is the door's `find`, which
 * answers the installer's grants (`withInstallerGrants`).
 *
 * ## What these cases pin
 *
 *   - the card's shape: two packages, uninstall one, and the bare call is
 *     served by the remaining one — and the uninstalled package's body hook
 *     left the engine with its actions;
 *   - CONTROL: the remaining package's handler and hook are still registered,
 *     and its package-qualified call still runs;
 *   - CONTROL: a re-install binds the handler again, and the bare call is
 *     refused as ambiguous again — two holders, as before the uninstall;
 *   - a withdrawal the registry refuses leaves the package's handlers bound;
 *   - a second unbind of the same package is a no-op;
 *   - host code and the environment's authored-action handler under the same
 *     key survive the unbind.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import { AppPlugin, bindAppArtifactHandlers, unbindAppArtifactHandlers } from '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { INSTALLER_USER_ID, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
/** The package owning the object; it embeds a script action `escalate` on it. */
const A = 'com.qa.addr-a';
/** The package under uninstall: a standalone script action `escalate` on A's object, and a body hook on it. */
const B = 'com.qa.addr-b';
const OBJECT = 'qa_a_ticket';
const ACTION = 'escalate';
const RECORD = { id: 'rid_1', name: 'First' };

/** A script action `escalate` on the ticket object whose body answers which package ran. */
const escalate = (by: string) => ({
    name: ACTION,
    label: 'Escalate',
    objectName: OBJECT,
    type: 'script',
    body: { language: 'js', source: `return { by: '${by}' };` },
});
/** A body hook on the ticket object. */
const stamp = (by: string) => ({
    name: `qa_stamp_${by}`,
    object: OBJECT,
    events: ['beforeInsert'],
    body: { language: 'js', source: `ctx.input.stamped_by = '${by}';` },
});

/** The install route's flattened ledger manifest of each package, as the binder reads it. */
function bundleOf(id: string) {
    const by = id === A ? 'a' : 'b';
    return {
        id,
        name: id,
        version: '1.0.0',
        type: 'app',
        ...(id === A
            ? { objects: [{ name: OBJECT, label: 'Ticket', fields: { name: { type: 'text', label: 'Name' } }, actions: [escalate(by)] }] }
            : { actions: [escalate(by)] }),
        hooks: [stamp(by)],
    };
}

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-uninstall-handlers-')); });
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
        manifest: bundleOf(manifestId),
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: INSTALLER_USER_ID,
        withSampleData: false,
    });
}

/** The real engine, both packages registered, bound and ledgered; the door started over the same engine. */
async function boot() {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AppPlugin({}));
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';

    // The engine object the door is handed — ONE object for the bind and the
    // uninstall, as `ctx.getService('objectql')` is in a server. Every member is
    // the real engine's, called on it, but `find`, which answers the installer's
    // grants, and the registry view those grants read the organization from.
    const granted = withInstallerGrants({ registry: ql.registry, find: ql.find.bind(ql), syncSchemas: async () => undefined });
    const doorQl = new Proxy(ql, {
        get: (target, prop) => {
            if (prop === 'find' || prop === 'registry' || prop === 'syncSchemas') return (granted as any)[prop];
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    /** What the install route leaves for one package: registered, its handlers bound, its ledger entry written. */
    const install = (id: string) => {
        ql.registry.installPackage({ id, name: id, version: '1.0.0', type: 'app' } as any, 'authored');
        if (id === A) {
            ql.registry.registerObject({ name: OBJECT, label: 'Ticket', fields: { name: { name: 'name', type: 'text', label: 'Name' } } } as any, A);
        }
        const bound = bindAppArtifactHandlers(doorQl as never, bundleOf(id), {
            appId: id,
            logger: logger as never,
            source: 'MarketplaceInstallLocal',
            withholdHooksWithoutBody: true,
        });
        expect(bound.actions, `precondition: ${id}'s action is bound`).toBe(1);
        expect(bound.hooks, `precondition: ${id}'s body hook is bound`).toBe(1);
        ledger(id);
    };
    install(A);
    install(B);

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
        protocol: kernel.getService('protocol'),
        objectql: doorQl,
    };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
        trigger: async () => undefined,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    // The `kernel:ready` rehydrate is not what is pinned: the packages are installed above.
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
    /** The engine's dispatch of `POST /actions/OBJECT/escalate/RID` — no package named, unless `packageId` is. */
    const call = (packageId?: string) => {
        const actionCtx = { params: { objectName: OBJECT, recordId: RECORD.id }, record: RECORD };
        return packageId === undefined
            ? ql.executeAction(OBJECT, ACTION, actionCtx)
            : ql.executeAction(OBJECT, ACTION, actionCtx, { packageId });
    };
    /** The packages holding a handler of their own under the action key, from the engine's package-scoped listing. */
    const holders = () => [A, B].filter((id) => ql.listRegisteredActions({ packageId: id })
        .some((row) => row.objectName === OBJECT && row.actionName === ACTION && row.coordinate === id));
    return { ql, doorQl, logger, install, uninstall, call, holders };
}

/** The refusal a bare call answers while two packages hold the key: its ADR-0112 envelope and the owners it names. */
async function refusalOf(pending: Promise<unknown>) {
    const err: any = await pending.then(() => undefined, (e) => e);
    return err === undefined ? undefined : { code: err.code, status: err.status, owners: err.owners };
}

describe('install-local uninstall withdraws the package\'s action handlers and hooks from the engine', () => {
    it('two packages hold `escalate`; after one is uninstalled, the bare call is served by the remaining one', async () => {
        const { ql, uninstall, call } = await boot();
        expect(await refusalOf(call()), 'precondition: two holders, the bare call is refused naming both').toEqual({
            code: 'RESOURCE_CONFLICT', status: 409, owners: [`app:${A}`, `app:${B}`],
        });

        const res = await uninstall(B);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(ql.registry.getPackage(B), 'the registry half withdrew it').toBeUndefined();

        await expect(call()).resolves.toEqual({ by: 'a' });
        // The uninstalled package's body hook left the engine with its actions:
        // nothing is left under its owner to unregister.
        expect(ql.unregisterHooksByPackage(`app:${B}`)).toBe(0);
    });

    it('CONTROL: the remaining package keeps its handler and its hook, and its package-qualified call runs', async () => {
        const { ql, uninstall, call, holders } = await boot();
        expect(holders(), 'precondition: both packages hold the key').toEqual([A, B]);

        expect((await uninstall(B)).status).toBe(200);

        expect(holders()).toEqual([A]);
        await expect(call(A)).resolves.toEqual({ by: 'a' });
        expect(ql.unregisterHooksByPackage(`app:${A}`), 'the remaining package\'s hook is still bound').toBe(1);
    });

    it('CONTROL: a re-install binds the handler again, and the bare call is refused as ambiguous again', async () => {
        const { install, uninstall, call } = await boot();
        expect((await uninstall(B)).status).toBe(200);
        await expect(call()).resolves.toEqual({ by: 'a' });

        install(B);

        await expect(call(B)).resolves.toEqual({ by: 'b' });
        expect(await refusalOf(call())).toEqual({
            code: 'RESOURCE_CONFLICT', status: 409, owners: [`app:${A}`, `app:${B}`],
        });
    });

    it('a withdrawal the registry refuses leaves the package\'s handlers bound: it stays loaded, so it keeps running', async () => {
        const { ql, uninstall, call, holders } = await boot();
        // Refused at the withdrawal itself, after every check asked ahead of it
        // let the uninstall through — the door's `registry.uninstallPackage` entry on `cleanups`.
        vi.spyOn(ql.registry, 'uninstallPackage').mockImplementation(() => { throw new Error('refused by the test'); });

        const res = await uninstall(B);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.cleanups).toContainEqual(expect.objectContaining({ name: 'registry.uninstallPackage', success: false }));
        expect(ql.registry.getPackage(B), 'precondition: the registry still holds it').toBeDefined();

        expect(holders()).toEqual([A, B]);
        await expect(call(B)).resolves.toEqual({ by: 'b' });
        expect(await refusalOf(call())).toEqual({
            code: 'RESOURCE_CONFLICT', status: 409, owners: [`app:${A}`, `app:${B}`],
        });
    });

    it('a second unbind of the same package is a no-op', async () => {
        const { ql, doorQl, logger, uninstall, call, holders } = await boot();
        expect((await uninstall(B)).status).toBe(200);

        const again = unbindAppArtifactHandlers(doorQl as never, B, { logger: logger as never, source: 'test' });

        expect(again.owners).toEqual([`app:${B}`]);
        expect(holders()).toEqual([A]);
        await expect(call()).resolves.toEqual({ by: 'a' });
        expect(ql.unregisterHooksByPackage(`app:${A}`), 'the remaining package\'s hook is still bound').toBe(1);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('host code and the environment\'s authored-action handler under the same key survive the unbind', async () => {
        const { ql, uninstall, call } = await boot();
        // Host code (registered with no owner) and an environment-authored
        // handler (the authored-action resync's owner) under the very key.
        ql.registerAction(OBJECT, ACTION, () => 'host');
        ql.registerAction(OBJECT, ACTION, () => 'environment', 'metadata-service');

        expect((await uninstall(B)).status).toBe(200);

        // B holds nothing of its own now, so a call naming it falls back to the
        // ONE shared handler under the key: host code's.
        await expect(call(B)).resolves.toBe('host');
        // The environment's own slot (coordinate '') keeps its handler.
        await expect(call('')).resolves.toBe('environment');
        await expect(call(A)).resolves.toEqual({ by: 'a' });
    });
});
