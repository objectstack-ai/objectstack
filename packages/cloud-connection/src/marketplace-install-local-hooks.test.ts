// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21585 — install-local REFUSES a package carrying a hook with no `body`, and
 * WITHHOLDS such a hook when it rehydrates an entry an older build installed.
 *
 * A hook in the deprecated function-name `handler` form names code that
 * travels only in an artifact's runtime module, never in the package JSON this
 * door installs. Before this, such a package installed with a 200 and its hook
 * either never fired (the name resolved nowhere) or bound by name to a function
 * the package does not ship — with only a server warn, if anything, to say so.
 *
 * What this file pins, against the door's answer and the engine's bindings:
 *
 *   - install: a hook with no `body` answers `422 VALIDATION_ERROR` naming the
 *     hook, its handler and both remedies, and the runtime is left exactly as it
 *     was found — nothing registered, persisted or bound;
 *   - one answer names everything the door cannot run — hooks and jobs alike;
 *   - the body-hook control installs and is bound, and a hook carrying both a
 *     `body` and a `handler` installs (its body wins);
 *   - rehydrate: a ledger entry written by an earlier build binds its body hook
 *     and NOT its hook with no `body`, which is warned by name.
 *
 * The judgement and the binder are the REAL `@objectstack/runtime` exports
 * (resolved through its `exports`, i.e. its built `dist/`, like the plugin's own
 * lazy import); the engine is a recording double of what the binder touches.
 * That the withheld hook can no longer reach another app's function is pinned on
 * a real engine where the binder lives (`app-artifact-handlers.test.ts` in
 * `@objectstack/runtime`) and at the public door
 * (`packages/cli/test/package-install-local-hooks.integration.test.ts`).
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

const APP_ID = 'com.example.hooksapp';
const OWNER = `app:${APP_ID}`;
const OBJECT = 'hooks_app_task';

const BODY_HOOK = {
    name: 'hooks_app_stamp_body',
    object: OBJECT,
    events: ['beforeInsert'],
    body: { language: 'js', source: "ctx.input.status = 'stamped';" },
};
const HANDLER_HOOK = { name: 'hooks_app_stamp_handler', object: OBJECT, events: ['beforeInsert'], handler: 'stamp_fn' };
const HANDLER_JOB = { name: 'hooks_app_tick_handler', schedule: { type: 'interval', intervalMs: 1000 }, handler: 'tick' };

/** The compiled-artifact shape `os build` writes and `os package install` sends. */
function artifact(hooks: unknown[], extra: Record<string, unknown> = {}) {
    return {
        manifest: { id: APP_ID, namespace: 'hooks_app', version: '0.1.0', type: 'app', name: 'Hooks App' },
        objects: [{ name: OBJECT, label: 'Task', fields: { name: { type: 'text', label: 'Name' } } }],
        hooks,
        ...extra,
    };
}

/** The engine surface the binder writes to, as state: the hooks handed to `bindHooks`, by owner. */
function recordingEngine() {
    let hooks: Array<{ name: string; packageId?: string }> = [];
    const unregisterHooksByPackage = (packageId: string): number => {
        const before = hooks.length;
        hooks = hooks.filter((h) => h.packageId !== packageId);
        return before - hooks.length;
    };
    const bindHooks = vi.fn((list: Array<{ name: string }> | undefined, opts?: { packageId?: string }) => {
        if (!Array.isArray(list) || list.length === 0) return;
        if (opts?.packageId) unregisterHooksByPackage(opts.packageId);
        for (const h of list) hooks.push({ name: h.name, packageId: opts?.packageId });
    });
    return {
        bindHooks,
        hooksFor: (packageId: string) => hooks.filter((h) => h.packageId === packageId).map((h) => h.name),
        engine: {
            syncSchemas: async () => undefined,
            registerAction: () => undefined,
            removeActionsByPackage: () => undefined,
            unregisterHooksByPackage,
            bindHooks,
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

/** The package ids handed to `manifest.register` — not the plugin's own Setup nav bundle. */
const registered = (register: ReturnType<typeof vi.fn>) =>
    register.mock.calls.map(([m]) => (m as { id?: string })?.id).filter((id) => id === APP_ID);

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-hooks-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function bootPlugin() {
    const rec = recordingEngine();
    const register = vi.fn();
    const rawApp = makeRawApp();
    const kernelHooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, unknown> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants(rec.engine),
    };
    const ctx = {
        hook: (e: string, h: any) => kernelHooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await kernelHooks.get('kernel:ready')?.();
    const install = async (bundle: unknown) =>
        rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest: bundle }));
    const warned = () => logger.warn.mock.calls.map((c) => String(c[0]));
    return { install, rec, register, warned };
}

describe('#21585: install-local refuses a hook with no body', () => {
    it('answers 422 VALIDATION_ERROR naming the hook, its handler and both remedies — and changes nothing', async () => {
        const { install, rec, register } = await bootPlugin();

        const res = await install(artifact([BODY_HOOK, HANDLER_HOOK]));

        expect(res.status).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        const message: string = res.payload.error.message;
        expect(message).toContain(`Package ${APP_ID} was not installed: its hook '${HANDLER_HOOK.name}' (handler 'stamp_fn') has no \`body\``);
        expect(message).toMatch(/give the hook a `body`/i);
        expect(message).toContain('os start --artifact');
        // The runtime is left exactly as it was found.
        expect(registered(register), 'a refused package must not be registered').toEqual([]);
        expect(new LocalManifestSource(dir).read(APP_ID).entry, 'nor persisted').toBeNull();
        expect(rec.bindHooks, 'nor any of its hooks bound — not even its body hook').not.toHaveBeenCalled();
    });

    it('a hook with neither a body nor a handler is refused too, named as such', async () => {
        const { install } = await bootPlugin();

        const res = await install(artifact([{ name: 'hooks_app_neither', object: OBJECT, events: ['beforeInsert'] }]));

        expect(res.status).toBe(422);
        expect(res.payload.error.message).toContain("its hook 'hooks_app_neither' (no handler) has no `body`");
    });

    it('one answer names everything the door cannot run — every hook and every job — so the author fixes them in one pass', async () => {
        const { install } = await bootPlugin();
        const second = { ...HANDLER_HOOK, name: 'hooks_app_second', handler: 'other_fn' };

        const res = await install(artifact([HANDLER_HOOK, second], { jobs: [HANDLER_JOB] }));

        expect(res.status).toBe(422);
        const message: string = res.payload.error.message;
        expect(message).toContain(`its enabled job '${HANDLER_JOB.name}' (handler 'tick') has no \`body\``);
        expect(message).toContain(`2 of its hooks '${HANDLER_HOOK.name}' (handler 'stamp_fn'), 'hooks_app_second' (handler 'other_fn') have no \`body\``);
    });

    it('control: a package whose hooks carry a body installs, and its hook is bound under app:<manifestId>', async () => {
        const { install, rec, register } = await bootPlugin();

        const res = await install(artifact([BODY_HOOK]));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(registered(register)).toEqual([APP_ID]);
        expect(rec.hooksFor(OWNER)).toEqual([BODY_HOOK.name]);
    });

    it('a hook carrying both a body and a handler installs — its body wins, as in the binder', async () => {
        const { install, rec } = await bootPlugin();
        const both = { ...BODY_HOOK, name: 'hooks_app_both', handler: 'stamp_fn' };

        const res = await install(artifact([both]));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(rec.hooksFor(OWNER)).toEqual(['hooks_app_both']);
    });
});

describe('#21585: rehydrate withholds a hook with no body that an older build installed', () => {
    it('the body hook is bound; the hook with no body is NOT bound, and is warned by name', async () => {
        const { manifest: meta, ...sections } = artifact([BODY_HOOK, HANDLER_HOOK]);
        new LocalManifestSource(dir).write({
            packageId: APP_ID,
            versionId: 'local',
            manifestId: APP_ID,
            version: '0.1.0',
            // What the install route persists: the compiled bundle, flattened.
            manifest: { ...meta, ...sections },
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });

        const { rec, register, warned } = await bootPlugin();

        expect(registered(register), 'the older entry still rehydrates').toEqual([APP_ID]);
        expect(rec.hooksFor(OWNER)).toEqual([BODY_HOOK.name]);
        expect(warned().some((m) => m.includes(HANDLER_HOOK.name) && m.includes('NOT bound'))).toBe(true);
    });
});
