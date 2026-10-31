// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28117] An admin may disable a `type: 'module'` package of an installed
 * `type: 'app'` package; every other read-only package keeps answering
 * `422 WRITABLE_PACKAGE_REQUIRED` on the disable door, and the module stays
 * read-only for authoring.
 *
 * ## The ruling
 *
 * A suite (HotCRM) ships ONE artifact: its `type: 'app'` package and several
 * `type: 'module'` packages (ADR-0019 D3, ADR-0130 D2/D6). A customer who does
 * not use a module switches it off in settings (plan A, the platform-level hard
 * switch): the customer's own admin switches it, per environment, and
 * "disabled" has exactly ONE meaning — hidden, refused on the data plane, data
 * kept. Before this card the disable door asked `isWritablePackage` alone, and
 * every package of an installed or code-booted artifact is read-only to it, so
 * a suite module could never be switched off.
 *
 * ## The tie, as measured
 *
 * "Belongs to an installed app" is read off what the registry row carries, and
 * on both ways a suite arrives — booted from code (`AppPlugin` → the `manifest`
 * service, `source: 'code'`) and installed from the marketplace (the `manifest`
 * service with `source: 'marketplace'`) — the row carries the same three keys:
 * the module's `manifest.type`, its `manifest.dependencies`, and its
 * `manifest.namespace`. The artifact's own package list (`ArtifactInstallScope`)
 * is NOT carried: it exists only for the length of the registration call. So
 * the tie is the module's DIRECT declared dependency on an installed package
 * whose `manifest.type` is `'app'` (ADR-0141 D1: a dependency is what a module
 * declares about the app it extends). Both shapes are booted below and asserted
 * to answer alike.
 *
 * ## The rest of "disabled" was already in place, and is pinned here
 *
 * Once the module is disabled, the data plane answers its objects
 * `404 OBJECT_PACKAGE_DISABLED`, its navigation contributions leave the app
 * (`SchemaRegistry.applyNavContributions`, this card), and the choice is
 * written to the environment's state file and replayed at boot
 * (`package-state-store.ts`, `AppPlugin.seedPersistedDisabledPackages`).
 *
 * ## What an app hook meets (scope addendum 6523684730)
 *
 * The app package's own code may read a module's object in-process, through a
 * hook's `ctx.api.object(name)`. That read reaches the engine directly, not the
 * data plane, and is measured and pinned below exactly as it answers: this PR
 * changes no answer for any caller.
 *
 * The negative control (the module case red with the door's exemption ablated)
 * is a one-time ablation, cited in the PR, not a permanent case.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { resolveThrownHttpError } from '@objectstack/types';
import { AppPlugin } from '../app-plugin.js';
import { HttpDispatcher } from '../http-dispatcher.js';

const ENVIRONMENT_ID = 'env_suite_modules';
const ADMIN = {
    userId: 'u_admin', tenantId: 'org_qa', isSystem: false,
    positions: [], permissions: [], systemPermissions: ['manage_metadata'],
};

/** The suite's packages: the app, two of its modules, and a plugin it carries. */
const APP = 'com.qa.suite';
const MODULE = 'com.qa.suite.orders';
/** A module that depends on the suite's PLUGIN, not on its app. */
const MODULE_OF_PLUGIN = 'com.qa.suite.addon';
const PLUGIN = 'com.qa.suite.tools';
/** Registered on their own, beside the suite. */
const ORPHAN_MODULE = 'com.qa.loose';
const STRAY_MODULE = 'com.qa.stray';
const PLATFORM_MODULE = 'com.qa.platform.module';
const PLATFORM_PLUGIN = 'com.qa.platform';

const ORDER = 'qs_order';
const ACCOUNT = 'qs_account';
const APP_NAME = 'qs_app';

const textField = (label: string) => ({ name: label.toLowerCase(), type: 'text' as const, label });

/** The suite artifact, composed the way HotCRM composes its four packages. */
function suiteArtifact() {
    const app = defineStack({
        manifest: { id: APP, name: 'QA Suite', namespace: 'qs', version: '1.0.0', type: 'app' },
        objects: [{ name: ACCOUNT, label: 'Account', fields: { name: textField('Name') } }],
        apps: [{
            name: APP_NAME,
            label: 'QA Suite',
            navigation: [{
                id: 'qs_group', type: 'group', label: 'Sales',
                children: [{ id: 'nav_accounts', type: 'object', objectName: ACCOUNT, label: 'Accounts' }],
            }],
        }],
    });
    const orders = defineStack({
        manifest: {
            id: MODULE, name: 'QA Suite Orders', namespace: 'qs', version: '1.0.0', type: 'module',
            dependencies: { [APP]: '^1.0.0' },
            navigationContributions: [{
                app: APP_NAME, group: 'qs_group', priority: 50,
                items: [{ id: 'nav_orders', type: 'object', objectName: ORDER, label: 'Orders' }],
            }],
        },
        objects: [{ name: ORDER, label: 'Order', fields: { name: textField('Name') } }],
    });
    const tools = defineStack({
        manifest: {
            id: PLUGIN, name: 'QA Suite Tools', namespace: 'qs', version: '1.0.0', type: 'plugin',
            dependencies: { [APP]: '^1.0.0' },
        },
    });
    const addon = defineStack({
        manifest: {
            id: MODULE_OF_PLUGIN, name: 'QA Suite Addon', namespace: 'qs', version: '1.0.0', type: 'module',
            dependencies: { [PLUGIN]: '^1.0.0' },
        },
    });
    return composeStacks([orders, addon, tools, app], { manifest: 'preserve' });
}

/** The packages registered beside the suite, each through the `manifest` door on its own. */
const STANDALONE = [
    // A module that declares no app at all.
    { id: ORPHAN_MODULE, name: 'Loose module', namespace: 'ql', version: '1.0.0', type: 'module' },
    // A module whose declared app is not installed.
    { id: STRAY_MODULE, name: 'Stray module', namespace: 'qy', version: '1.0.0', type: 'module', dependencies: { 'com.qa.absent': '^1.0.0' } },
    // A platform-delivered module of the installed app: `system` scope keeps it the platform's.
    { id: PLATFORM_MODULE, name: 'Platform module', namespace: 'qp', version: '1.0.0', type: 'module', scope: 'system', dependencies: { [APP]: '^1.0.0' } },
    { id: PLATFORM_PLUGIN, name: 'Platform plugin', namespace: 'qz', version: '1.0.0', type: 'plugin', scope: 'system' },
];

interface ManifestDoor {
    register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> | void;
}

type InstallPath = 'code' | 'marketplace';

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
}

/**
 * One kernel, the suite arriving by `path`:
 *  - `code`: the suite is the `AppPlugin`'s bundle, registered through the
 *    `manifest` service as a `defineStack()` host boots it;
 *  - `marketplace`: the `AppPlugin` carries no payload (an empty environment)
 *    and the suite is registered through the `manifest` service with
 *    `source: 'marketplace'`, as the install-local door registers it.
 * The `AppPlugin` is there on both, with the environment's id, because it is
 * what replays the state file at boot.
 */
async function bootKernel(path: InstallPath, root: string): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    await kernel.use(new AppPlugin(path === 'code' ? suiteArtifact() : {}, { environmentId: ENVIRONMENT_ID, organizationId: 'org_qa' }));
    const host: Plugin = {
        name: 'qa.suite-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            const door = ctx.getService<ManifestDoor>('manifest');
            if (path === 'marketplace') await door.register(suiteArtifact(), { source: 'marketplace' });
            for (const manifest of STANDALONE) await door.register(manifest);
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    return { kernel, engine };
}

async function shutdown(booted: Booted | undefined): Promise<void> {
    if (booted && booted.kernel.getState() === 'running') await booted.kernel.shutdown();
}

const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);

/** What the runtime dispatcher answers the admin on `method path`, through `dispatch()` and the host's exit for a throw. */
async function dispatchAs(kernel: ObjectKernel, method: string, path: string, body: Record<string, unknown> = {}) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...ADMIN });
    const raw = new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    try {
        const out: any = await dispatcher.dispatch(method, path, body, {}, { request: raw, environmentId: ENVIRONMENT_ID } as any, '/api/v1');
        const answer = out.response?.body;
        return { status: out.response?.status as number | undefined, code: codeOf(answer), data: answer?.data };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status as number | undefined, code: thrown.code as unknown, data: undefined };
    }
}

const PACKAGE_DISABLED = { status: 404, code: 'OBJECT_PACKAGE_DISABLED' } as const;
const READ_ONLY = { status: 422, code: 'WRITABLE_PACKAGE_REQUIRED' } as const;

/** The navigation ids of the app's `qs_group`, as `GET /meta/app/qs_app` serves it. */
async function servedGroupIds(kernel: ObjectKernel): Promise<string[]> {
    const read = await dispatchAs(kernel, 'GET', `/meta/app/${APP_NAME}`);
    expect(read.status, 'precondition: the app reads').toBe(200);
    const app = read.data?.item ?? read.data;
    const group = (app?.navigation ?? []).find((n: any) => n.id === 'qs_group');
    return (group?.children ?? []).map((c: any) => c.id);
}

/** The same ids, as the registry's own helper folds them. */
const registryGroupIds = (engine: ObjectQL): string[] =>
    ((engine as any).registry.getApp(APP_NAME)?.navigation ?? [])
        .find((n: any) => n.id === 'qs_group')?.children?.map((c: any) => c.id) ?? [];

const enabledOf = (engine: ObjectQL, id: string): unknown => (engine as any).registry.getPackage(id)?.enabled;

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-suite-modules-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

for (const path of ['code', 'marketplace'] as const) {
    describe(`[#28117] disabling a module of an installed app — the suite installed by ${path}`, () => {
        let root: string;
        let booted: Booted | undefined;

        beforeAll(async () => {
            root = mkdtempSync(join(tmpdir(), `os-suite-${path}-`));
            // Each install path keeps its own state file, so one describe's disable never seeds the other's boot.
            writeFileSync(join(root, '.keep'), '');
            process.env.OS_HOME = mkdtempSync(join(home, `${path}-`));
            booted = await bootKernel(path, root);
        }, 60_000);
        afterAll(async () => {
            await shutdown(booted);
            rmSync(root, { recursive: true, force: true });
        }, 60_000);

        it('measures the tie the registry row carries: type, dependencies and namespace, on this install path', () => {
            const row = (booted!.engine as any).registry.getPackage(MODULE);
            expect(row?.source).toBe(path);
            expect({ type: row?.manifest?.type, dependencies: row?.manifest?.dependencies, namespace: row?.manifest?.namespace })
                .toEqual({ type: 'module', dependencies: { [APP]: '^1.0.0' }, namespace: 'qs' });
            expect((booted!.engine as any).registry.getPackage(APP)?.manifest?.type).toBe('app');
            // Read-only for authoring on both paths: booted into `engine.manifests`.
            expect((booted!.engine as any).manifests.has(MODULE)).toBe(true);
        });

        it('serves the module while it is enabled (the control)', async () => {
            const created = await dispatchAs(booted!.kernel, 'POST', `/data/${ORDER}`, { name: 'kept' });
            expect(created.status, 'precondition: a record of the module object is written').toBe(201);
            expect((await dispatchAs(booted!.kernel, 'GET', `/data/${ORDER}`)).status).toBe(200);
            expect(await servedGroupIds(booted!.kernel)).toEqual(['nav_accounts', 'nav_orders']);
            expect(registryGroupIds(booted!.engine)).toEqual(['nav_accounts', 'nav_orders']);
        });

        it('disables the module (200): its objects answer 404 OBJECT_PACKAGE_DISABLED and its nav items leave the app', async () => {
            const disabled = await dispatchAs(booted!.kernel, 'PATCH', `/packages/${MODULE}/disable`);
            expect(disabled.status).toBe(200);
            expect(disabled.data?.enabled).toBe(false);
            expect(enabledOf(booted!.engine, MODULE)).toBe(false);

            const read = await dispatchAs(booted!.kernel, 'GET', `/data/${ORDER}`);
            expect({ status: read.status, code: read.code }).toEqual(PACKAGE_DISABLED);
            expect(await servedGroupIds(booted!.kernel)).toEqual(['nav_accounts']);
            expect(registryGroupIds(booted!.engine)).toEqual(['nav_accounts']);
            // The app itself is untouched.
            expect((await dispatchAs(booted!.kernel, 'GET', `/data/${ACCOUNT}`)).status).toBe(200);
        });

        it('keeps the module read-only for authoring while it may be disabled: edit, publish and delete still 422', async () => {
            const edit = await dispatchAs(booted!.kernel, 'PATCH', `/packages/${MODULE}`, { name: 'Renamed' });
            expect({ status: edit.status, code: edit.code }).toEqual(READ_ONLY);
            const publish = await dispatchAs(booted!.kernel, 'POST', `/packages/${MODULE}/publish`);
            expect({ status: publish.status, code: publish.code }).toEqual(READ_ONLY);
            const del = await dispatchAs(booted!.kernel, 'DELETE', `/packages/${MODULE}`);
            expect({ status: del.status, code: del.code }).toEqual(READ_ONLY);
            expect((booted!.engine as any).registry.getPackage(MODULE)?.manifest?.name).toBe('QA Suite Orders');
        });

        it('re-enables the module (200): its objects and its nav items come back, with the kept record', async () => {
            const enabled = await dispatchAs(booted!.kernel, 'PATCH', `/packages/${MODULE}/enable`);
            expect(enabled.status).toBe(200);
            const read = await dispatchAs(booted!.kernel, 'GET', `/data/${ORDER}`);
            expect(read.status).toBe(200);
            expect(JSON.stringify(read.data)).toContain('kept');
            expect(await servedGroupIds(booted!.kernel)).toEqual(['nav_accounts', 'nav_orders']);
            expect(registryGroupIds(booted!.engine)).toEqual(['nav_accounts', 'nav_orders']);
        });

        const REFUSED: ReadonlyArray<{ label: string; id: string }> = [
            { label: 'the app package itself', id: APP },
            { label: 'a plugin the suite carries', id: PLUGIN },
            { label: 'a module that depends on a plugin, not on an app', id: MODULE_OF_PLUGIN },
            { label: 'an orphan module that declares no app', id: ORPHAN_MODULE },
            { label: 'a module whose declared app is not installed', id: STRAY_MODULE },
            { label: 'a platform (system-scoped) module of the installed app', id: PLATFORM_MODULE },
            { label: 'a platform (system-scoped) plugin', id: PLATFORM_PLUGIN },
        ];
        for (const { label, id } of REFUSED) {
            it(`still refuses to disable ${label}: 422 WRITABLE_PACKAGE_REQUIRED, and it stays enabled`, async () => {
                expect((booted!.engine as any).registry.getPackage(id), `precondition: ${id} is registered`).toBeDefined();
                const answer = await dispatchAs(booted!.kernel, 'PATCH', `/packages/${id}/disable`);
                expect({ status: answer.status, code: answer.code }).toEqual(READ_ONLY);
                expect(enabledOf(booted!.engine, id)).toBe(true);
            });
        }
    });
}

describe('[#28117] a disabled module stays disabled across a restart (the environment\'s state file)', () => {
    let root: string;

    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-restart-'));
        process.env.OS_HOME = mkdtempSync(join(home, 'restart-'));
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('boots the module disabled after a disable through the door, and enabled again after an enable', async () => {
        const first = await bootKernel('code', root);
        try {
            expect((await dispatchAs(first.kernel, 'PATCH', `/packages/${MODULE}/disable`)).status).toBe(200);
        } finally {
            await shutdown(first);
        }

        const second = await bootKernel('code', root);
        try {
            expect(enabledOf(second.engine, MODULE)).toBe(false);
            const read = await dispatchAs(second.kernel, 'GET', `/data/${ORDER}`);
            expect({ status: read.status, code: read.code }).toEqual(PACKAGE_DISABLED);
            expect(registryGroupIds(second.engine)).toEqual(['nav_accounts']);
            expect((await dispatchAs(second.kernel, 'PATCH', `/packages/${MODULE}/enable`)).status).toBe(200);
        } finally {
            await shutdown(second);
        }

        const third = await bootKernel('code', root);
        try {
            expect(enabledOf(third.engine, MODULE)).toBe(true);
            expect(registryGroupIds(third.engine)).toEqual(['nav_accounts', 'nav_orders']);
        } finally {
            await shutdown(third);
        }
    }, 120_000);
});

describe('[#28117 addendum 6523684730] what an app hook meets reading a disabled module\'s object through ctx.api.object()', () => {
    let root: string;
    let booted: Booted | undefined;

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-hook-'));
        process.env.OS_HOME = mkdtempSync(join(home, 'hook-'));
        booted = await bootKernel('code', root);
    }, 60_000);
    afterAll(async () => {
        await shutdown(booted);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('measures the in-process read: the engine serves it, the data plane refuses the same object', async () => {
        expect((await dispatchAs(booted!.kernel, 'POST', `/data/${ORDER}`, { name: 'kept' })).status).toBe(201);
        expect((await dispatchAs(booted!.kernel, 'PATCH', `/packages/${MODULE}/disable`)).status).toBe(200);

        // The app package's hook, on the app's own object, reading the module's object.
        const seen: Array<{ rows?: number; error?: { code?: unknown; status?: unknown; name?: unknown } }> = [];
        booted!.engine.registerHook('afterInsert', async (ctx: any) => {
            try {
                const rows = await ctx.api.object(ORDER).find({});
                seen.push({ rows: Array.isArray(rows) ? rows.length : -1 });
            } catch (e) {
                const err = e as { code?: unknown; status?: unknown; name?: unknown };
                seen.push({ error: { code: err.code, status: err.status, name: err.name } });
            }
        }, { object: ACCOUNT, packageId: APP });

        expect((await dispatchAs(booted!.kernel, 'POST', `/data/${ACCOUNT}`, { name: 'acme' })).status).toBe(201);
        expect(seen).toEqual([{ rows: 1 }]);

        // The same object, on the data plane, in the same disabled window.
        const read = await dispatchAs(booted!.kernel, 'GET', `/data/${ORDER}`);
        expect({ status: read.status, code: read.code }).toEqual(PACKAGE_DISABLED);
    });
});
