// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The rule: an action whose dispatch reaches a handler that a DIFFERENT
// declared action owns also answers with that owner's gates — its
// `requiredPermissions` (ADR-0066 D4, 403) and its activation-ledger switch
// (ADR-0126 §8 item 2, 409) — on top of its own. The two sets are unioned, so
// the rule only ever narrows who may run a handler.
//
// "Owns" is read at the handler ENTRY dispatch actually reaches (object key +
// handler key, as the engine's registry holds it): a declared action owns the
// entry its own dispatch would reach. A declaration is one identity — its
// owning object key and its name — so the same declaration reaching the
// population twice (object-embedded and as a standalone copy) is not a second
// owner, and two objects that each declare a same-named action are not coupled
// while each has its own entry.
//
// Organised per door, as `action-activation-dispatch.test.ts` is: the REST
// `/actions` route and the MCP `run_action` bridge share the gate, not the call
// path, so each door is pinned on its own. Every refusal asserts the ADR-0112
// envelope (`status` + `code`) AND that the owner's handler never ran.

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { invokeBusinessAction } from '../action-execution.js';

const OBJECT = 'crm_lead';
const OTHER_OBJECT = 'crm_account';

/** A capability-gated action bound by `target` to a code-registered handler. */
const TARGET_OWNER = {
    name: 'purge_lead', label: 'Purge Lead', objectName: OBJECT, type: 'script',
    target: 'purge_lead_impl', requiredPermissions: ['manage_data'],
};
/** A capability-gated action whose handler is registered under its NAME (a body action). */
const NAME_OWNER = {
    name: 'wipe_lead', label: 'Wipe Lead', objectName: OBJECT, type: 'script',
    body: { language: 'js', source: 'return 1;' }, requiredPermissions: ['manage_data'],
};
/** A newly declared action whose `target` names the target-bound owner's handler key. */
const VIA_TARGET = {
    name: 'quick_purge', label: 'Quick Purge', objectName: OBJECT, type: 'script',
    target: 'purge_lead_impl', ai: { exposed: true, description: 'Purge a lead.' },
};
/** A newly declared action whose `target` names the body owner's handler key. */
const VIA_NAME = {
    name: 'quick_wipe', label: 'Quick Wipe', objectName: OBJECT, type: 'script',
    target: 'wipe_lead', ai: { exposed: true, description: 'Wipe a lead.' },
};
/** An ungated, legitimate action with its own handler. */
const PLAIN = {
    name: 'convert_lead', label: 'Convert Lead', objectName: OBJECT, type: 'script',
    target: 'convert_lead_impl', ai: { exposed: true, description: 'Convert a lead.' },
};
/** A gated action on the routed object whose handler only exists object-less. */
const VIA_GLOBAL = {
    name: 'quick_archive', label: 'Quick Archive', objectName: OBJECT, type: 'script',
    target: 'archive_everything', ai: { exposed: true, description: 'Archive.' },
};
/** An object-LESS, capability-gated action owning the `global` handler entry. */
const GLOBAL_OWNER = {
    name: 'archive_everything', label: 'Archive Everything', type: 'script',
    target: 'archive_everything', requiredPermissions: ['manage_data'],
};
/** One declaration carried both object-embedded and as a standalone copy. */
const CARRIED_TWICE = {
    name: 'touch_lead', label: 'Touch Lead', objectName: OBJECT, type: 'script',
    target: 'touch_lead_impl', requiredPermissions: ['touch_leads'],
    ai: { exposed: true, description: 'Touch a lead.' },
};
/** Same-named body actions on two objects, each with its own handler entry. */
const SAME_NAME_HERE = {
    name: 'log_touch', label: 'Log Touch', objectName: OBJECT, type: 'script',
    body: { language: 'js', source: 'return 1;' },
};
const SAME_NAME_THERE = {
    name: 'log_touch', label: 'Log Touch', objectName: OTHER_OBJECT, type: 'script',
    body: { language: 'js', source: 'return 1;' }, requiredPermissions: ['manage_accounts'],
};
/**
 * A gated body action declared ONLY on the metadata plane; its handler is the
 * one the engine plugin's authored-action resync registers for it (under its
 * owner key and name, package `metadata-service`).
 */
const PLANE_OWNER = {
    name: 'stamp_lead', label: 'Stamp Lead', objectName: OBJECT, type: 'script',
    body: { language: 'js', source: 'return 1;' }, requiredPermissions: ['manage_data'],
};
/** An embedded action whose `target` names the plane owner's handler key. */
const VIA_PLANE = {
    name: 'quick_stamp', label: 'Quick Stamp', objectName: OBJECT, type: 'script', target: 'stamp_lead',
};
/** An authored body action carried on the object, whose resync-registered handler is its own. */
const PLANE_SELF = {
    name: 'note_lead', label: 'Note Lead', objectName: OBJECT, type: 'script',
    body: { language: 'js', source: 'return 1;' },
};

/**
 * The engine's handler registry, as `engine-actions.ts` keeps it: one Map
 * keyed `object:key`, the engine's own miss sentence for an unregistered key,
 * and `listRegisteredActions` enumerating that same Map. Each handler is its
 * own spy so a test can say WHICH handler ran.
 */
function boot(opts: { disabled?: string[]; planeDown?: boolean } = {}) {
    const disabled = new Set(opts.disabled ?? []);
    const handlers = new Map<string, (ctx: unknown) => Promise<unknown>>();
    const packages = new Map<string, string>();
    const register = (obj: string, key: string, pkg?: string) => {
        const fn = vi.fn(async (_ctx: unknown) => ({ ran: `${obj}:${key}` }));
        handlers.set(`${obj}:${key}`, fn);
        if (pkg) packages.set(`${obj}:${key}`, pkg);
        return fn;
    };
    const ownerTargetHandler = register(OBJECT, 'purge_lead_impl');
    const ownerNameHandler = register(OBJECT, 'wipe_lead');
    const plainHandler = register(OBJECT, 'convert_lead_impl');
    const globalHandler = register('global', 'archive_everything');
    const carriedHandler = register(OBJECT, 'touch_lead_impl');
    const sameNameHereHandler = register(OBJECT, 'log_touch');
    const sameNameThereHandler = register(OTHER_OBJECT, 'log_touch');
    const planeOwnerHandler = register(OBJECT, 'stamp_lead', 'metadata-service');
    const planeSelfHandler = register(OBJECT, 'note_lead', 'metadata-service');

    const executeAction = vi.fn(async (obj: string, key: string, ctx: any) => {
        const fn = handlers.get(`${obj}:${key}`);
        if (!fn) throw new Error(`Action '${key}' on object '${obj}' not found`);
        return fn(ctx);
    });
    const listRegisteredActions = () => [...handlers.keys()].map((k) => {
        const at = k.indexOf(':');
        const pkg = packages.get(k);
        return { objectName: k.slice(0, at), actionName: k.slice(at + 1), ...(pkg ? { package: pkg } : {}) };
    });

    const objectDef = {
        name: OBJECT,
        actions: [
            TARGET_OWNER, NAME_OWNER, VIA_TARGET, VIA_NAME, PLAIN, VIA_GLOBAL, CARRIED_TWICE, SAME_NAME_HERE,
            VIA_PLANE, PLANE_SELF,
        ],
    };
    const otherDef = { name: OTHER_OBJECT, actions: [SAME_NAME_THERE] };
    const objects = [objectDef, otherDef];
    // The standalone population: the object-less owner, a separate copy of a
    // declaration the object already embeds, and the plane-only owner.
    const standalone = [GLOBAL_OWNER, { ...CARRIED_TWICE }, PLANE_OWNER];
    const planeRead = <T>(value: T) => async (): Promise<T> => {
        if (opts.planeDown) throw new Error('The metadata store could not be read.');
        return value;
    };
    const byName = (name: string) => standalone.find((a) => a.name === name) ?? null;

    const ql: any = {
        executeAction,
        listRegisteredActions,
        getSchema: (name: string) => objects.find((o) => o.name === name),
        registry: {
            getObject: (name: string) => objects.find((o) => o.name === name),
            getItem: () => undefined,
        },
        isActionEnabled: (name: string) => !disabled.has(name),
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };

    const metadata: any = {
        load: vi.fn(async (_t: string, name: string) => byName(name)),
        loadDiagnosed: vi.fn(async (_t: string, name: string) => ({ data: byName(name), degraded: false, errors: [] })),
        loadMany: vi.fn(planeRead(standalone)),
        listObjects: vi.fn(planeRead(objects)),
        getObject: vi.fn(async (name: string) => objects.find((o) => o.name === name)),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (n: string) => resolve(n),
        context: { getService: resolve },
    };
    return {
        dispatcher: new HttpDispatcher(kernel), ql, metadata, executeAction,
        ownerTargetHandler, ownerNameHandler, plainHandler, globalHandler, carriedHandler,
        sameNameHereHandler, sameNameThereHandler, planeOwnerHandler, planeSelfHandler,
    };
}

const CTX = (systemPermissions: string[] = []): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_member', systemPermissions },
} as unknown as HttpProtocolContext);

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code ?? r?.response?.body?.error?.details?.code;

describe('REST `POST /actions/:object/:action` — a handler another declared action owns answers with that owner\'s gates', () => {
    it('refuses 403 PERMISSION_DENIED when the caller lacks the requiredPermissions of the action owning the target handler, and the handler never runs', async () => {
        const h = boot();

        const res = await h.dispatcher.handleActions(`/${OBJECT}/${VIA_TARGET.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('PERMISSION_DENIED');
        expect(h.ownerTargetHandler).not.toHaveBeenCalled();
    });

    it('refuses 403 PERMISSION_DENIED when the owning action\'s handler is registered under its name, and the handler never runs', async () => {
        const h = boot();

        const res = await h.dispatcher.handleActions(`/${OBJECT}/${VIA_NAME.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('PERMISSION_DENIED');
        expect(h.ownerNameHandler).not.toHaveBeenCalled();
    });

    it('refuses 403 PERMISSION_DENIED when the owner is an object-less action whose handler lives under the global key', async () => {
        const h = boot();

        const res = await h.dispatcher.handleActions(`/${OBJECT}/${VIA_GLOBAL.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('PERMISSION_DENIED');
        expect(h.globalHandler).not.toHaveBeenCalled();
    });

    it('refuses 409 ACTION_DISABLED when the action owning the target handler is switched off, even for a caller holding its permissions', async () => {
        const h = boot({ disabled: [TARGET_OWNER.name] });

        const res = await h.dispatcher.handleActions(
            `/${OBJECT}/${VIA_TARGET.name}`, 'POST', {}, CTX(['manage_data']),
        );

        expect(statusOf(res)).toBe(409);
        expect(codeOf(res)).toBe('ACTION_DISABLED');
        expect(h.ownerTargetHandler).not.toHaveBeenCalled();
    });

    it('runs the owner\'s handler for a caller holding the owner\'s permissions while the owner is switched on', async () => {
        const h = boot();

        const res = await h.dispatcher.handleActions(
            `/${OBJECT}/${VIA_TARGET.name}`, 'POST', {}, CTX(['manage_data']),
        );

        expect(statusOf(res)).toBe(200);
        expect(h.ownerTargetHandler).toHaveBeenCalledTimes(1);
    });

    it('the owner itself still answers with its own gates (403 for a member, 200 with the permission)', async () => {
        const h = boot();

        const denied = await h.dispatcher.handleActions(`/${OBJECT}/${TARGET_OWNER.name}`, 'POST', {}, CTX());
        expect(statusOf(denied)).toBe(403);
        expect(codeOf(denied)).toBe('PERMISSION_DENIED');
        expect(h.ownerTargetHandler).not.toHaveBeenCalled();

        const allowed = await h.dispatcher.handleActions(
            `/${OBJECT}/${TARGET_OWNER.name}`, 'POST', {}, CTX(['manage_data']),
        );
        expect(statusOf(allowed)).toBe(200);
        expect(h.ownerTargetHandler).toHaveBeenCalledTimes(1);
    });

    it('a plain action with its own handler is untouched', async () => {
        const h = boot({ disabled: [TARGET_OWNER.name] });

        const res = await h.dispatcher.handleActions(`/${OBJECT}/${PLAIN.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(200);
        expect(h.plainHandler).toHaveBeenCalledTimes(1);
    });

    it('one declaration carried object-embedded and as a standalone copy is one owner, not two', async () => {
        const h = boot();

        const res = await h.dispatcher.handleActions(
            `/${OBJECT}/${CARRIED_TWICE.name}`, 'POST', {}, CTX(['touch_leads']),
        );

        expect(statusOf(res)).toBe(200);
        expect(h.carriedHandler).toHaveBeenCalledTimes(1);
    });

    it('a same-named action on another object is not an owner while each object has its own handler entry', async () => {
        const h = boot();

        const res = await h.dispatcher.handleActions(`/${OBJECT}/${SAME_NAME_HERE.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(200);
        expect(h.sameNameHereHandler).toHaveBeenCalledTimes(1);
        expect(h.sameNameThereHandler).not.toHaveBeenCalled();
    });

    it('a metadata-plane owner\'s requiredPermissions gate an action reaching the handler built for it', async () => {
        const h = boot();

        const res = await h.dispatcher.handleActions(`/${OBJECT}/${VIA_PLANE.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('PERMISSION_DENIED');
        expect(h.planeOwnerHandler).not.toHaveBeenCalled();
    });

    it('with the metadata plane unreadable, refuses 503 SERVICE_UNAVAILABLE a call reaching a handler built for another plane declaration, even for a caller holding its permissions', async () => {
        const h = boot({ planeDown: true });

        const res = await h.dispatcher.handleActions(
            `/${OBJECT}/${VIA_PLANE.name}`, 'POST', {}, CTX(['manage_data']),
        );

        expect(statusOf(res)).toBe(503);
        expect(codeOf(res)).toBe('SERVICE_UNAVAILABLE');
        expect(h.planeOwnerHandler).not.toHaveBeenCalled();
    });

    it('with the metadata plane unreadable, an action reaching its own plane-built handler still runs', async () => {
        const h = boot({ planeDown: true });

        const res = await h.dispatcher.handleActions(`/${OBJECT}/${PLANE_SELF.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(200);
        expect(h.planeSelfHandler).toHaveBeenCalledTimes(1);
    });

    it('with the metadata plane unreadable, a handler a package registered is still judged by the engine\'s own declarations', async () => {
        const h = boot({ planeDown: true });

        const plain = await h.dispatcher.handleActions(`/${OBJECT}/${PLAIN.name}`, 'POST', {}, CTX());
        expect(statusOf(plain)).toBe(200);
        expect(h.plainHandler).toHaveBeenCalledTimes(1);

        const borrowed = await h.dispatcher.handleActions(`/${OBJECT}/${VIA_TARGET.name}`, 'POST', {}, CTX());
        expect(statusOf(borrowed)).toBe(403);
        expect(codeOf(borrowed)).toBe('PERMISSION_DENIED');
        expect(h.ownerTargetHandler).not.toHaveBeenCalled();
    });
});

describe('MCP `run_action` — a handler another declared action owns answers with that owner\'s gates', () => {
    /** The bridge's own wiring, as the activation-dispatch suite drives it. */
    const runViaMcp = async (h: ReturnType<typeof boot>, name: string, systemPermissions: string[] = []) => {
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                (service === 'metadata' ? h.metadata : service === 'automation' ? null : h.ql),
            getObjectQL: async () => h.ql,
        };
        return invokeBusinessAction(
            deps, CTX() as any, name, { objectName: OBJECT },
            {
                driver: h.ql,
                ec: { userId: 'u_agent', systemPermissions },
                getMeta: () => h.metadata,
                callData: async () => ({}),
            },
        );
    };

    it('refuses with 403 PERMISSION_DENIED when the caller lacks the owning action\'s requiredPermissions, and the handler never runs', async () => {
        const h = boot();

        const thrown: any = await runViaMcp(h, VIA_TARGET.name).catch((e) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.code).toBe('PERMISSION_DENIED');
        expect(thrown.status).toBe(403);
        expect(h.ownerTargetHandler).not.toHaveBeenCalled();
    });

    it('refuses with 409 ACTION_DISABLED when the owning action is switched off, and the handler never runs', async () => {
        const h = boot({ disabled: [TARGET_OWNER.name] });

        const thrown: any = await runViaMcp(h, VIA_TARGET.name, ['manage_data']).catch((e) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.code).toBe('ACTION_DISABLED');
        expect(thrown.status).toBe(409);
        expect(h.ownerTargetHandler).not.toHaveBeenCalled();
    });

    it('runs the owner\'s handler for a caller holding the owner\'s permissions', async () => {
        const h = boot();

        const result: any = await runViaMcp(h, VIA_TARGET.name, ['manage_data']);

        expect(result?.ok).toBe(true);
        expect(h.ownerTargetHandler).toHaveBeenCalledTimes(1);
    });

    it('a plain action with its own handler still runs', async () => {
        const h = boot();

        const result: any = await runViaMcp(h, PLAIN.name);

        expect(result?.ok).toBe(true);
        expect(h.plainHandler).toHaveBeenCalledTimes(1);
    });
});
