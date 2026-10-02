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
    let hooks: Array<{ name: string; packageId?: string }> = [];
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
                for (const h of list) hooks.push({ name: h.name, packageId: opts?.packageId });
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

async function bootPlugin(engine: Record<string, unknown>) {
    const rawApp = makeRawApp();
    const { ctx, fire, logger } = makeCtx(rawApp, {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants(engine),
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
