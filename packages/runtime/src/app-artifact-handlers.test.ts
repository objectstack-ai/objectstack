// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21321 — `bindAppArtifactHandlers`, the ONE binder of an app artifact's
 * script-action bodies and body hooks, on a REAL `ObjectQL` engine and the
 * real QuickJS sandbox.
 *
 * Its two callers (`AppPlugin.start`, and the install-local plugin's install
 * and rehydrate) are pinned where they live; this file pins the contract they
 * share:
 *
 *   - a body action becomes an `executeAction` handler under `app:<appId>`,
 *     and running it runs the body;
 *   - a body hook fires through the engine's own `triggerHooks`;
 *   - re-binding the same artifact leaves exactly one handler per action and
 *     one binding per hook (a reinstall);
 *   - re-binding an artifact that DROPPED its action and its hook unbinds both
 *     — including the hook, which `bindHooksToEngine` alone would keep firing
 *     because it unregisters only when handed a non-empty list;
 *   - another owner's handlers are never touched.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { bindAppArtifactHandlers, appArtifactHandlerOwner, collectHooksWithoutBody } from './app-artifact-handlers.js';

const APP_ID = 'com.example.tasksapp';
const OWNER = appArtifactHandlerOwner(APP_ID);

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

const ACTION = {
    name: 'complete_task',
    objectName: 'tasks_app_task',
    type: 'script',
    body: { language: 'js', source: 'return { ran: true, id: ctx.recordId };' },
};
const HOOK = {
    name: 'tasks_app_stamp_status',
    object: 'tasks_app_task',
    events: ['beforeInsert'],
    // Appends, so a hook bound twice is visible on the input.
    body: { language: 'js', source: "ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + 'stamped';" },
};

/** The compiled-artifact shape: meta under `manifest`, the action both standalone and object-embedded. */
function artifact(opts: { withHandlers: boolean }) {
    return {
        manifest: { id: APP_ID, version: '0.1.0', type: 'app' },
        objects: [{ name: 'tasks_app_task', fields: {}, ...(opts.withHandlers ? { actions: [ACTION] } : {}) }],
        ...(opts.withHandlers ? { actions: [ACTION], hooks: [HOOK] } : {}),
    };
}

const owned = (ql: ObjectQL, owner = OWNER) =>
    ql.listRegisteredActions().filter((r) => r.package === owner).map((r) => `${r.objectName}:${r.actionName}`);

async function insertStatus(ql: ObjectQL): Promise<unknown> {
    const ctx: any = { object: 'tasks_app_task', event: 'beforeInsert', input: { name: 'probe' }, session: {} };
    await ql.triggerHooks('beforeInsert', ctx);
    return ctx.input.status;
}

describe('#21321: bindAppArtifactHandlers', () => {
    it('binds the body action under app:<appId> — executeAction runs the body', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        const bound = bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });

        expect(bound.owner).toBe(OWNER);
        expect(owned(ql)).toEqual(['tasks_app_task:complete_task']);
        await expect(ql.executeAction('tasks_app_task', 'complete_task', { recordId: 'r1', params: {} }))
            .resolves.toEqual({ ran: true, id: 'r1' });
    });

    it('binds the body hook — the engine’s own triggerHooks runs it', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        expect(await insertStatus(ql), 'precondition: nothing bound yet').toBeUndefined();

        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });

        expect(await insertStatus(ql)).toBe('stamped');
    });

    it('re-binding the same artifact keeps exactly one handler per action and one binding per hook', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });

        expect(owned(ql)).toEqual(['tasks_app_task:complete_task']);
        expect(await insertStatus(ql), 'stampedstamped = the hook is bound twice').toBe('stamped');
    });

    it('re-binding an artifact that dropped its action and hook unbinds both', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });
        expect(owned(ql)).toHaveLength(1);

        const bound = bindAppArtifactHandlers(ql as any, artifact({ withHandlers: false }), { appId: APP_ID, logger: quiet });

        expect(bound).toMatchObject({ hooks: 0, actions: 0 });
        expect(owned(ql), 'an action the new version dropped must stop running').toEqual([]);
        expect(await insertStatus(ql), 'a hook the new version dropped must stop firing').toBeUndefined();
    });

    it('never touches another owner’s handlers', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        ql.registerAction('tasks_app_task', 'imperative_task', () => ({ mine: true }));
        ql.registerAction('tasks_app_task', 'authored_task', () => ({ authored: true }), 'metadata-service');

        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: false }), { appId: APP_ID, logger: quiet });

        await expect(ql.executeAction('tasks_app_task', 'imperative_task', {})).resolves.toEqual({ mine: true });
        expect(owned(ql, 'metadata-service')).toEqual(['tasks_app_task:authored_task']);
    });
});

/**
 * #21585 — a hook with no `body` on a door that carries no runtime module.
 *
 * The engine resolves a hook's function-name `handler` against the bundle's
 * `functions`, then against every function already registered on the engine,
 * by bare name. A door that brings no runtime module (install-local) brings no
 * function of the package's own, so such a hook could bind only to code the
 * package does not ship. That door passes `withholdHooksWithoutBody`; a boot
 * does not, and its own handler hooks bind as they always did.
 */
describe('#21585: hooks with no body — the judgement, and the door that withholds them', () => {
    const OTHER_APP = 'com.example.otherapp';
    const STAMP = 'shared_stamp';
    /** Another app's function, registered on the same engine under its own owner. */
    const otherApp = {
        manifest: { id: OTHER_APP, version: '0.1.0', type: 'app' },
        objects: [],
        functions: { [STAMP]: (ctx: any) => { ctx.input.status = (ctx.input.status ?? '') + 'other'; } },
    };
    const HANDLER_ONLY = { name: 'tasks_app_handler_only', object: 'tasks_app_task', events: ['beforeInsert'], handler: STAMP };
    const BOTH = { ...HOOK, name: 'tasks_app_both', handler: STAMP };
    const pkg = (hooks: unknown[], extra: Record<string, unknown> = {}) => ({
        manifest: { id: APP_ID, version: '0.1.0', type: 'app' },
        objects: [{ name: 'tasks_app_task', fields: {} }],
        hooks,
        ...extra,
    });
    const recordingLogger = () => {
        const warned: string[] = [];
        return { warned, logger: { ...quiet, warn: (m: string) => { warned.push(String(m)); } } };
    };

    it('collectHooksWithoutBody names every hook whose code is only a handler, or nothing — never one with a body', () => {
        const NEITHER = { name: 'tasks_app_neither', object: 'tasks_app_task', events: ['beforeInsert'] };
        const STRING_BODY = { ...HANDLER_ONLY, name: 'tasks_app_string_body', body: 'not a body object' };

        expect(collectHooksWithoutBody(pkg([HOOK, HANDLER_ONLY, BOTH, NEITHER, STRING_BODY]))).toEqual([
            { name: HANDLER_ONLY.name, handler: STAMP },
            { name: NEITHER.name },
            // A non-object `body` is not read as one by the engine: its handler would be resolved.
            { name: STRING_BODY.name, handler: STAMP },
        ]);
        expect(collectHooksWithoutBody(pkg([]))).toEqual([]);
        expect(collectHooksWithoutBody({ manifest: { id: APP_ID } })).toEqual([]);
    });

    it('with withholdHooksWithoutBody, a hook with no body is NOT bound and is warned — no other app’s function runs for it', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        bindAppArtifactHandlers(ql as any, otherApp, { appId: OTHER_APP, logger: quiet });
        const { warned, logger } = recordingLogger();

        const bound = bindAppArtifactHandlers(ql as any, pkg([HANDLER_ONLY, HOOK]), {
            appId: APP_ID, logger, withholdHooksWithoutBody: true,
        });

        expect(bound.withheldHooks).toEqual([HANDLER_ONLY.name]);
        expect(bound.hooks, 'the body hook beside it still binds').toBe(1);
        expect(await insertStatus(ql), 'the body hook fires; the withheld hook runs nothing').toBe('stamped');
        expect(warned.some((m) => m.includes(HANDLER_ONLY.name) && m.includes('NOT bound') && m.includes('`body`'))).toBe(true);
    });

    it('…and a hook carrying both a body and a handler binds its body under that option', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        bindAppArtifactHandlers(ql as any, otherApp, { appId: OTHER_APP, logger: quiet });

        const bound = bindAppArtifactHandlers(ql as any, pkg([BOTH]), { appId: APP_ID, logger: quiet, withholdHooksWithoutBody: true });

        expect(bound.withheldHooks).toEqual([]);
        expect(await insertStatus(ql)).toBe('stamped');
    });

    it('a boot (no option) still binds an app’s own handler hook to its own function — unchanged', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        const own = (ctx: any) => { ctx.input.status = (ctx.input.status ?? '') + 'own'; };

        const bound = bindAppArtifactHandlers(ql as any, pkg([HANDLER_ONLY], { functions: { [STAMP]: own } }), { appId: APP_ID, logger: quiet });

        expect(bound).toMatchObject({ hooks: 1, functions: 1, withheldHooks: [] });
        expect(await insertStatus(ql)).toBe('own');
    });
});

/**
 * [ADR-0150 D4, #32333 review F1/N2] A multi-package artifact (`packages[]`)
 * binds what the RECONCILED artifact carries: a key one body carries goes under
 * that body's package; a key two bodies carry stays ONE handler under the
 * artifact's owner (the answer the binder gave before it read bodies), except
 * the object-less pair `composeStacks` admits for two namespaces; and a
 * declaration the composition replaced is bound at no address. A re-bind that
 * drops a package body stops its actions.
 *
 * Read at the binder: a composition that reconciled one object two packages
 * declare does not boot (`ArtifactObjectNameConflictError`, ADR-0130 D3), so no
 * boot reaches this; the binder's install-local door reads the same bundles.
 */
describe('[ADR-0150 D4] bindAppArtifactHandlers on a multi-package artifact', () => {
    const NS = 'qashare';
    const OBJECT = 'qashare_doc';
    const STAMP = 'qa_stamp';
    const scriptFrom = (from: string) => ({ language: 'js', source: `return { from: '${from}' };` });
    const sharedObjectStack = (suffix: 'one' | 'two', from: string) => defineStack({
        manifest: { id: `com.qa.share.${suffix}`, namespace: NS, name: `qa_share_${suffix}`, version: '1.0.0', type: suffix === 'one' ? 'app' : 'module' },
        objects: [{
            name: OBJECT, label: 'Shared doc', sharingModel: 'public_read_write',
            fields: { name: { type: 'text', label: 'Name' } },
            actions: [{ name: STAMP, label: 'Stamp', type: 'script', body: scriptFrom(from) }],
        }],
    } as never);
    const rowsOf = (ql: ObjectQL, objectName: string, actionName: string) =>
        ql.listRegisteredActions().filter((r) => r.objectName === objectName && r.actionName === actionName).map((r) => r.package);
    const bind = (ql: ObjectQL, bundle: any) =>
        bindAppArtifactHandlers(ql as any, bundle, { appId: bundle.manifest?.id ?? bundle.id, logger: quiet });

    it.each([
        { conflict: 'override', from: ['one', 'two'], runs: 'two', replaced: 'one' },
        { conflict: 'merge', from: ['same', 'same'], runs: 'same', replaced: undefined },
    ] as const)('objectConflict $conflict: the reconciled object\'s action is bound once, under the artifact\'s owner, and the replaced one at no address', async ({ conflict, from, runs, replaced }) => {
        const artifact = composeStacks([sharedObjectStack('one', from[0]), sharedObjectStack('two', from[1])], { manifest: 'preserve', objectConflict: conflict }) as any;
        expect(artifact.packages, 'precondition: a preserve artifact').toHaveLength(2);
        const ql = new ObjectQL({ logger: quiet } as any);
        const bound = bind(ql, artifact);

        expect(rowsOf(ql, OBJECT, STAMP)).toEqual([bound.owner]);
        await expect(ql.executeAction(OBJECT, STAMP, { params: {} })).resolves.toEqual({ from: runs });
        for (const packageId of ['app:com.qa.share.one', 'app:com.qa.share.two']) {
            const answer = await ql.executeAction(OBJECT, STAMP, { params: {} }, { packageId }).catch((e: Error) => e);
            if (replaced) expect(answer, packageId).not.toEqual({ from: replaced });
        }
    });

    it('a hand-built artifact whose two bodies of ONE namespace carry one object-less key binds it once, under the artifact\'s owner', async () => {
        const body = (id: string, from: string) => ({
            id, namespace: NS, name: id.replace(/\./g, '_'), version: '1.0.0', type: 'module',
            actions: [{ name: 'qa_note', label: 'Note', type: 'script', body: scriptFrom(from) }],
        });
        const artifact = {
            manifest: { id: 'com.qa.share.two', namespace: NS, name: 'qa_share_two', version: '1.0.0', type: 'app' },
            packages: [{ manifest: body('com.qa.share.one', 'one') }, { manifest: body('com.qa.share.two', 'two') }],
        };
        const ql = new ObjectQL({ logger: quiet } as any);
        const bound = bind(ql, artifact);

        expect(rowsOf(ql, 'global', 'qa_note')).toEqual([bound.owner]);
        // The declaration `resolveArtifactCollections` keeps for the name, as the binder bound it before it read bodies.
        await expect(ql.executeAction('global', 'qa_note', { params: {} })).resolves.toEqual({ from: 'two' });
    });

    it('a re-bind that drops a package body stops that body\'s actions', async () => {
        const body = (ns: string, action: string) => ({
            id: `com.qa.rebind.${ns}`, namespace: ns, name: `qa_rebind_${ns}`, version: '1.0.0', type: 'module',
            actions: [{ name: action, label: action, type: 'script', body: scriptFrom(ns) }],
        });
        const artifact = (...bodies: Array<ReturnType<typeof body>>) => ({
            manifest: { id: 'com.qa.rebind', name: 'qa_rebind', version: '1.0.0', type: 'app' },
            packages: bodies.map((manifest) => ({ manifest })),
        });
        const ql = new ObjectQL({ logger: quiet } as any);
        bind(ql, artifact(body('alpha', 'qa_alpha_note'), body('beta', 'qa_beta_note')));
        expect(rowsOf(ql, 'global', 'qa_beta_note')).toEqual(['app:com.qa.rebind.beta']);

        bind(ql, artifact(body('alpha', 'qa_alpha_note')));

        expect(rowsOf(ql, 'global', 'qa_beta_note'), 'a package body the new bundle dropped must stop running').toEqual([]);
        expect(rowsOf(ql, 'global', 'qa_alpha_note')).toEqual(['app:com.qa.rebind.alpha']);
    });
});
