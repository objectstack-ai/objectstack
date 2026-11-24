// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21321 — an installed package's script-action bodies and body hooks are
 * BOUND, on the install route and on the `kernel:ready` rehydrate, through the
 * same runtime function `AppPlugin.start` uses for a boot artifact.
 *
 * The defect: `os package install <artifact>` registered the package's metadata
 * and nothing executable. Every door refused the installed `type: 'script'`
 * action (REST 404, MCP `run_action` "No handler registered") before and after
 * a restart, and its body hooks never fired — while `os start --artifact` of the
 * same file dispatched normally, because `AppPlugin.start` was the only binder.
 *
 * What this file pins, against the engine-level outcome rather than a call:
 *
 *   - install: the action handler is registered under `app:<manifestId>` and
 *     the body hook is handed to `bindHooks` under the same owner;
 *   - rehydrate: a ledger entry written by an earlier process binds the same
 *     way when a fresh plugin reaches `kernel:ready`;
 *   - reinstall: still exactly one handler per action and one binding per hook;
 *   - reinstall of a version that DROPPED its action and its hook: neither
 *     stays bound — the owner's previous set is torn down first.
 *
 * The binder is the REAL `@objectstack/runtime` export (resolved through its
 * `exports`, i.e. its built `dist/`, like the plugin's own lazy import); the
 * engine is a recording double that models only what the binder touches —
 * including `bindHooksToEngine`'s own rule of unregistering a package's hooks
 * only when handed a NON-empty list, which is what the dropped-hook case reads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (the clocked-window rule, `scripts/check-test-source-alias.mjs`):
// the plugin reaches the same module through a dynamic `import()`.
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { mapDataError } from '@objectstack/types';

const APP_ID = 'com.example.tasksapp';
const OWNER = `app:${APP_ID}`;

const ACTION = {
    name: 'complete_task',
    label: 'Complete Task',
    objectName: 'tasks_app_task',
    type: 'script',
    body: { language: 'js', capabilities: ['api.write'], source: 'return { ok: true };' },
    ai: { exposed: true, description: 'Mark a task as complete.' },
};
const HOOK = {
    name: 'tasks_app_stamp_status',
    object: 'tasks_app_task',
    events: ['beforeInsert'],
    body: { language: 'js', source: "ctx.input.status = 'stamped';" },
};

/** The compiled-artifact shape `os build` writes and `os package install` sends. */
function artifact(version: string, opts: { withHandlers: boolean }) {
    return {
        manifest: { id: APP_ID, namespace: 'tasks_app', version, type: 'app', name: 'Tasks App' },
        objects: [{
            name: 'tasks_app_task',
            label: 'Task',
            fields: { name: { type: 'text', label: 'Name' } },
            ...(opts.withHandlers ? { actions: [ACTION] } : {}),
        }],
        ...(opts.withHandlers ? { actions: [ACTION], hooks: [HOOK] } : {}),
    };
}

/** The install route's normalization of a compiled bundle, as it lands in the ledger. */
function flattened(bundle: ReturnType<typeof artifact>) {
    const { manifest: meta, ...sections } = bundle;
    return { ...meta, ...sections };
}

/**
 * The engine surface the binder writes to, as state: an action Map keyed
 * `<object>:<name>` (the engine's own key) and one hook list.
 */
function recordingEngine() {
    const actions = new Map<string, { handler: unknown; package?: string }>();
    let hooks: Array<{ name: string; packageId?: string; def?: unknown; bodyRunner?: unknown }> = [];
    const unregisterHooksByPackage = (packageId: string): number => {
        const before = hooks.length;
        hooks = hooks.filter((h) => h.packageId !== packageId);
        return before - hooks.length;
    };
    return {
        actions,
        hooksFor: (packageId: string) => hooks.filter((h) => h.packageId === packageId),
        engine: {
            syncSchemas: async () => undefined,
            registerAction: (object: string, name: string, handler: unknown, pkg?: string) => {
                actions.set(`${object}:${name}`, { handler, package: pkg });
            },
            removeActionsByPackage: (pkg: string) => {
                for (const [key, entry] of actions) if (entry.package === pkg) actions.delete(key);
            },
            listRegisteredActions: () =>
                [...actions].map(([key, entry]) => ({
                    objectName: key.slice(0, key.indexOf(':')),
                    actionName: key.slice(key.indexOf(':') + 1),
                    ...(entry.package ? { package: entry.package } : {}),
                })),
            unregisterHooksByPackage,
            // `bindHooksToEngine`'s own teardown fires only for a NON-empty list.
            bindHooks: (list: Array<{ name: string }> | undefined, opts?: { packageId?: string; bodyRunner?: unknown }) => {
                if (!Array.isArray(list) || list.length === 0) return;
                if (opts?.packageId) unregisterHooksByPackage(opts.packageId);
                expect(typeof opts?.bodyRunner, 'a body hook needs the sandbox runner').toBe('function');
                for (const h of list) hooks.push({ name: h.name, packageId: opts?.packageId, def: h, bodyRunner: opts?.bodyRunner });
            },
        },
    };
}

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeCtx(rawApp: any, services: Record<string, any>) {
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return {
        logger,
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            logger,
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-handlers-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function bootPlugin(engine: Record<string, unknown>, extraServices: Record<string, unknown> = {}) {
    const rawApp = makeRawApp();
    const { ctx, fire, logger } = makeCtx(rawApp, {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants(engine),
        ...extraServices,
    });
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await fire();
    const install = async (body: unknown) => {
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest: body }));
        expect(res.payload?.success, JSON.stringify(res.payload)).toBe(true);
        return res;
    };
    return { install, logger };
}

describe('#21321: install-local binds an installed package’s handlers', () => {
    it('install — the script action is registered and the body hook is bound, both under app:<manifestId>', async () => {
        const rec = recordingEngine();
        const { install } = await bootPlugin(rec.engine);

        await install(artifact('0.1.0', { withHandlers: true }));

        const entry = rec.actions.get('tasks_app_task:complete_task');
        expect(entry, 'the installed script action has no handler — every door refuses it').toBeDefined();
        expect(entry!.package).toBe(OWNER);
        expect(typeof entry!.handler).toBe('function');
        expect(rec.hooksFor(OWNER).map((h) => h.name)).toEqual(['tasks_app_stamp_status']);
    });

    it('rehydrate — a ledger entry from an earlier process is bound at kernel:ready', async () => {
        new LocalManifestSource(dir).write({
            packageId: APP_ID,
            versionId: 'local',
            manifestId: APP_ID,
            version: '0.1.0',
            // What the install route persists: the compiled bundle, flattened
            // (its `manifest` meta lifted to the top level beside the sections).
            manifest: flattened(artifact('0.1.0', { withHandlers: true })),
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });
        const rec = recordingEngine();
        await bootPlugin(rec.engine);

        expect(rec.actions.get('tasks_app_task:complete_task')?.package, 'a restart leaves the installed action unbound').toBe(OWNER);
        expect(rec.hooksFor(OWNER).map((h) => h.name)).toEqual(['tasks_app_stamp_status']);
    });

    it('reinstall — still exactly one handler per action and one binding per hook', async () => {
        const rec = recordingEngine();
        const { install } = await bootPlugin(rec.engine);

        await install(artifact('0.1.0', { withHandlers: true }));
        await install(artifact('0.1.0', { withHandlers: true }));

        const owned = rec.engine.listRegisteredActions().filter((r) => r.package === OWNER);
        expect(owned).toEqual([{ objectName: 'tasks_app_task', actionName: 'complete_task', package: OWNER }]);
        expect(rec.hooksFor(OWNER)).toHaveLength(1);
    });

    it('reinstall of a version that dropped its action and hook — neither stays bound', async () => {
        const rec = recordingEngine();
        const { install } = await bootPlugin(rec.engine);

        await install(artifact('0.1.0', { withHandlers: true }));
        expect(rec.actions.size, 'precondition: the first version bound its action').toBe(1);

        await install(artifact('0.2.0', { withHandlers: false }));

        expect(rec.engine.listRegisteredActions().filter((r) => r.package === OWNER)).toEqual([]);
        expect(rec.hooksFor(OWNER), 'a hook the new version dropped must stop firing').toEqual([]);
    });
});

// An installed package's declared refusals answer in the caller's language.
//
// The defect: the install route and the `kernel:ready` rehydrate bound an
// installed package's body hooks and script actions WITHOUT the `i18n` service
// (and without the kernel's service lookup) that `AppPlugin.start` hands the
// same binder for a boot artifact. A refusal the catalogue answers then always
// took its declared sentence, so every user of an installed package read hook
// and action refusals in the authored language, whatever pack the package
// shipped, while the same package booted as an artifact answered in theirs.
// Every door that runs a hook (`/batch`, a record update, an action that
// writes) reaches it through this one binding, so it is pinned here, at the
// seam they all share.
describe('install-local: an installed package answers its declared refusals in the caller\'s language', () => {
    const ORDER_OBJECT = 'tasks_app_order';
    const GATE_HOOK = 'tasks_app_order_gate';
    const CONFIRM_ACTION = 'confirm_order';
    const GATE_DECLARED = 'The order cannot be confirmed: {{ count }} line(s) have no delivery date.';
    const GATE_ZH = '订单不能确认：有 {{ count }} 行明细没有填交期。';
    const CONFIRM_DECLARED = 'Only a draft order can be confirmed.';
    const CONFIRM_ZH = '只有草稿订单可以确认。';

    const GATE = {
        name: GATE_HOOK,
        object: ORDER_OBJECT,
        events: ['beforeUpdate'],
        body: {
            language: 'js',
            source: "throw { code: 'ORDER_NOT_READY', reason: 'missing_delivery', params: { count: 1 }, message: 'internal' };",
        },
        refusals: {
            ORDER_NOT_READY: {
                message: 'The order cannot be confirmed.',
                params: ['count'],
                reasons: { missing_delivery: { message: GATE_DECLARED } },
            },
        },
    };
    const CONFIRM = {
        name: CONFIRM_ACTION,
        label: 'Confirm',
        objectName: ORDER_OBJECT,
        type: 'script',
        body: { language: 'js', capabilities: [], source: "throw Object.assign(new Error('internal'), { code: 'NOT_DRAFT' });" },
        refusals: { NOT_DRAFT: { message: CONFIRM_DECLARED, status: 409 } },
    };

    /** The package's zh-CN pack, at the keys the refusal catalogues read. */
    const ZH_PACK = {
        hooks: {
            [GATE_HOOK]: {
                refusals: { ORDER_NOT_READY: { reasons: { missing_delivery: { message: GATE_ZH } } } },
            },
        },
        objects: {
            [ORDER_OBJECT]: {
                _actions: { [CONFIRM_ACTION]: { refusals: { NOT_DRAFT: { message: CONFIRM_ZH } } } },
            },
        },
    };

    function orderArtifact() {
        return {
            manifest: { id: APP_ID, namespace: 'tasks_app', version: '0.1.0', type: 'app', name: 'Tasks App' },
            objects: [{
                name: ORDER_OBJECT,
                label: 'Order',
                fields: { name: { type: 'text', label: 'Name' } },
                actions: [CONFIRM],
            }],
            actions: [CONFIRM],
            hooks: [GATE],
            translations: [{ 'zh-CN': ZH_PACK }],
        };
    }

    /**
     * The i18n service as the production one (`FileI18nAdapter`,
     * service-i18n) answers: `t()` looks a key up in EXACTLY the locale it is
     * handed and echoes the key on a miss — it negotiates nothing — and
     * `getLocales()` reports the loaded locales. So a `zh-Hans` caller reaches
     * the `zh-CN` pack only through the catalogue's own negotiation.
     */
    function i18nService() {
        const loaded = new Map<string, Record<string, unknown>>();
        const lookup = (bag: unknown, key: string): unknown =>
            key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as any)[part] : undefined), bag);
        return {
            loadTranslations: (locale: string, data: Record<string, unknown>) => { loaded.set(locale, data); },
            getLocales: () => ['en', ...[...loaded.keys()].filter((l) => l !== 'en')],
            getTranslations: (locale: string) => loaded.get(locale) ?? {},
            t: (key: string, locale: string) => {
                const value = lookup(loaded.get(locale), key);
                return typeof value === 'string' ? value : key;
            },
        };
    }

    async function hookRefusal(rec: ReturnType<typeof recordingEngine>, locale: string) {
        const [bound] = rec.hooksFor(OWNER).filter((h) => h.name === GATE_HOOK);
        expect(bound, 'the installed body hook was not bound').toBeDefined();
        const handler = (bound!.bodyRunner as (hook: unknown) => ((c: unknown) => Promise<void>) | undefined)(bound!.def);
        expect(handler, 'the installed body hook has no sandboxed handler').toBeTypeOf('function');
        const err = await handler!({
            object: ORDER_OBJECT,
            event: 'beforeUpdate',
            input: {},
            session: { userId: 'u1', locale },
        }).then(() => null, (e: unknown) => e);
        expect(err, 'the gate hook must refuse').not.toBeNull();
        return mapDataError(err, ORDER_OBJECT);
    }

    async function actionRefusal(rec: ReturnType<typeof recordingEngine>, locale: string) {
        const entry = rec.actions.get(`${ORDER_OBJECT}:${CONFIRM_ACTION}`);
        expect(entry, 'the installed script action was not bound').toBeDefined();
        const err = await (entry!.handler as (c: unknown) => Promise<unknown>)({
            input: {},
            executionContext: { userId: 'u1', locale },
        }).then(() => null, (e: unknown) => e);
        expect(err, 'the action must refuse').not.toBeNull();
        return mapDataError(err, ORDER_OBJECT);
    }

    it('install — a zh-Hans caller reads the hook refusal from the package\'s zh-CN pack, its code and status unchanged', async () => {
        const rec = recordingEngine();
        const { install } = await bootPlugin(rec.engine, { i18n: i18nService() });
        await install(orderArtifact());

        const wire = await hookRefusal(rec, 'zh-Hans');
        expect(wire.status).toBe(400);
        expect(wire.body.code).toBe('VALIDATION_ERROR');
        expect(wire.body.declaredCode).toBe('ORDER_NOT_READY');
        expect(wire.body.userMessage).toBe('订单不能确认：有 1 行明细没有填交期。');
        // CONTROL: the same binding answers an English caller with the declared sentence.
        expect((await hookRefusal(rec, 'en')).body.userMessage)
            .toBe('The order cannot be confirmed: 1 line(s) have no delivery date.');
    });

    it('install — a zh-Hans caller reads the action refusal from the package\'s zh-CN pack, its code and status unchanged', async () => {
        const rec = recordingEngine();
        const { install } = await bootPlugin(rec.engine, { i18n: i18nService() });
        await install(orderArtifact());

        const wire = await actionRefusal(rec, 'zh-Hans');
        expect(wire.status).toBe(409);
        expect(wire.body.declaredCode).toBe('NOT_DRAFT');
        expect(wire.body.userMessage).toBe(CONFIRM_ZH);
        expect((await actionRefusal(rec, 'en')).body.userMessage).toBe(CONFIRM_DECLARED);
    });

    it('rehydrate — a package installed by an earlier process answers in the caller\'s language too', async () => {
        const i18n = i18nService();
        // The rehydrate loads the pack the way the install does; seeded here
        // because this double stands in for the kernel's i18n service.
        i18n.loadTranslations('zh-CN', ZH_PACK);
        new LocalManifestSource(dir).write({
            packageId: APP_ID,
            versionId: 'local',
            manifestId: APP_ID,
            version: '0.1.0',
            manifest: flattened(orderArtifact() as any),
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });
        const rec = recordingEngine();
        await bootPlugin(rec.engine, { i18n });

        expect((await hookRefusal(rec, 'zh-Hans')).body.userMessage).toBe('订单不能确认：有 1 行明细没有填交期。');
        expect((await actionRefusal(rec, 'zh-Hans')).body.userMessage).toBe(CONFIRM_ZH);
    });
});
