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
// Paid during collection, not inside a case's clock (check:test-source-alias): the binder's module reaches `import('@objectstack/metadata')`.
import '@objectstack/metadata';
import { ObjectQL, resolvePackageScopedFunction } from '@objectstack/objectql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { bindAppArtifactHandlers, appArtifactHandlerOwner, collectHooksWithoutBody } from './app-artifact-handlers.js';
import { isActionNotRegisteredError } from './action-execution.js';

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
        // `composeStacks` refuses this pair under 'preserve' (both bodies keep the
        // name), so the artifact is assembled by hand in the shape it used to
        // emit — and an artifact already on disk still carries: the reconciled
        // object at the top level beside both packages' bodies.
        const stacks = [sharedObjectStack('one', from[0]), sharedObjectStack('two', from[1])] as any[];
        const reconciled = composeStacks(stacks, { objectConflict: conflict }) as any;
        const artifact = {
            manifest: reconciled.manifest,
            objects: reconciled.objects,
            packages: stacks.map((s) => ({ manifest: { ...s.manifest, objects: s.objects } })),
        } as any;
        expect(artifact.packages, 'precondition: a preserve artifact').toHaveLength(2);
        const ql = new ObjectQL({ logger: quiet } as any);
        const bound = bind(ql, artifact);

        expect(rowsOf(ql, OBJECT, STAMP)).toEqual([bound.owner]);
        expect(bound.owner, 'precondition: the artifact\'s owner is the second package').toBe('app:com.qa.share.two');
        // A package-qualified call names the engine's package COORDINATE, the bare
        // id (`actionHandlerCoordinate`), never the `app:` owner key. The first
        // package's declaration was reconciled away, so its coordinate holds no
        // handler: the call is the engine's not-registered miss, the answer the
        // action door reads as absence. The owner's coordinate runs the
        // reconciled body. Asked before the unqualified call, so a replaced body
        // bound under its package reds here, naming the address.
        const answerAt = (packageId: string) =>
            ql.executeAction(OBJECT, STAMP, { params: {} }, { packageId }).catch((e: Error) => e);
        const atOne = await answerAt('com.qa.share.one');
        expect(isActionNotRegisteredError(atOne), `com.qa.share.one answered ${JSON.stringify(atOne)}`).toBe(true);
        expect(await answerAt('com.qa.share.two'), 'com.qa.share.two').toEqual({ from: runs });
        if (replaced) for (const packageId of ['com.qa.share.one', 'com.qa.share.two']) {
            expect(await answerAt(packageId), packageId).not.toEqual({ from: replaced });
        }
        await expect(ql.executeAction(OBJECT, STAMP, { params: {} })).resolves.toEqual({ from: runs });
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

/**
 * [ADR-0150 D3/D4, #32349] A multi-package artifact binds each body's hooks
 * and functions under the body that declares them (`app:<package id>`), as it
 * binds each body's actions (#32333), so the two readers that resolve by
 * package read the body's own: a flow `script` node's function
 * (`resolvePackageScopedFunction`, the call the automation service's function
 * bridge makes with the calling flow's package) and a hook's `handler`
 * (`bindHooksToEngine`, the hook's own package only).
 *
 * The artifact is composed the way a project composes one
 * (`composeStacks(…, { manifest: 'preserve' })`): beta first, alpha last, so
 * the artifact's own id, the owner every hook and function was bound under
 * before, is alpha's. Beta declares no dependency on alpha.
 *
 * The negative control (red with the fix ablated) is a one-time ablation,
 * cited in the PR, not a permanent case.
 */
describe('[ADR-0150 D4] a multi-package artifact binds each body\'s hooks and functions under that body', () => {
    const ALPHA = 'com.qa.bodies.alpha';
    const BETA = 'com.qa.bodies.beta';
    type Ns = 'alpha' | 'beta';
    /** A hook handler that appends `from` to the inserted record, so a hook bound twice, or not at all, shows. */
    const stamp = (from: string) => (ctx: any) => { ctx.input.from = `${ctx.input.from ?? ''}${from};`; };
    const packageStack = (ns: Ns, extra: { functions?: Record<string, unknown>; hooks?: unknown[]; dependencies?: Record<string, string> } = {}) => {
        const { dependencies, ...collections } = extra;
        return defineStack({
            manifest: {
                id: `com.qa.bodies.${ns}`, namespace: ns, name: `qa_bodies_${ns}`, version: '1.0.0', type: ns === 'alpha' ? 'app' : 'module',
                ...(dependencies ? { dependencies } : {}),
            },
            objects: [{ name: `${ns}_doc`, label: `${ns} doc`, sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } }],
            ...collections,
        } as never);
    };
    const hookOn = (ns: Ns, name: string, handler: string) => ({ name, object: `${ns}_doc`, events: ['beforeInsert'], handler });
    const compose = (...stacks: unknown[]) => composeStacks(stacks as never, { manifest: 'preserve' }) as any;
    const bind = (ql: ObjectQL, artifact: any, logger: any = quiet) =>
        bindAppArtifactHandlers(ql as any, artifact, { appId: artifact.manifest.id, logger });
    /** The engine, with each body installed as the boot installs it, so a caller's closure is the save door's. */
    const engineFor = (artifact: any, logger: any = quiet) => {
        const ql = new ObjectQL({ logger } as any);
        (ql.registry as any).logLevel = 'silent';
        for (const { manifest } of artifact.packages) ql.registry.installPackage(manifest, 'code' as never);
        return ql;
    };
    async function insertInto(ql: ObjectQL, ns: Ns): Promise<unknown> {
        const ctx: any = { object: `${ns}_doc`, event: 'beforeInsert', input: { name: 'probe' }, session: {} };
        await ql.triggerHooks('beforeInsert', ctx);
        return ctx.input.from;
    }
    const recordingErrors = () => {
        const errors: Array<{ message: string; meta: any }> = [];
        return { errors, logger: { ...quiet, error: (message: string, _e?: unknown, meta?: any) => { errors.push({ message: String(message), meta }); } } };
    };

    it('a body-B flow runs B\'s own function (base: bound under the artifact\'s id, refused outside-closure)', async () => {
        const artifact = compose(
            packageStack('beta', { functions: { beta_total: () => 'beta' } }),
            packageStack('alpha', { functions: { alpha_total: () => 'alpha' } }),
        );
        expect(artifact.manifest.id, 'precondition: the artifact takes the last input\'s manifest').toBe(ALPHA);
        const ql = engineFor(artifact);
        bind(ql, artifact);

        // The script node's read: the function the name means for a flow of package BETA.
        const resolved = resolvePackageScopedFunction(ql, { name: 'beta_total', callerPackageId: BETA });
        expect(resolved.status, JSON.stringify(resolved)).toBe('resolved');
        if (resolved.status !== 'resolved') return;
        expect(resolved.item.packageId).toBe(appArtifactHandlerOwner(BETA));
        expect(await (resolved.item.handler as any)({})).toBe('beta');
        // Alpha's flow keeps its own, under the artifact's id, which is alpha's.
        const alpha = resolvePackageScopedFunction(ql, { name: 'alpha_total', callerPackageId: ALPHA });
        expect(alpha.status === 'resolved' && alpha.item.packageId).toBe(appArtifactHandlerOwner(ALPHA));
    });

    it('a body-B hook binds B\'s own engine-registered function (base: refused, the hook bound under the artifact\'s id)', async () => {
        const artifact = compose(
            packageStack('beta', { hooks: [hookOn('beta', 'qa_beta_stamp', 'beta_registered')] }),
            packageStack('alpha'),
        );
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);
        // Beta's own function, registered on the engine under beta's owner (an earlier bind of beta, its own code).
        ql.registerFunction('beta_registered', stamp('beta') as never, appArtifactHandlerOwner(BETA));

        bind(ql, artifact);

        expect(errors.map((e) => e.meta?.code), 'no hook refused').toEqual([]);
        expect(await insertInto(ql, 'beta')).toBe('beta;');
    });

    it('each body\'s hook of one name binds its own body\'s bundle function, both under their own packages (base: both under the artifact\'s id)', async () => {
        const artifact = compose(
            packageStack('beta', { functions: { beta_fn: stamp('beta') }, hooks: [hookOn('beta', 'qa_stamp', 'beta_fn')] }),
            packageStack('alpha', { functions: { alpha_fn: stamp('alpha') }, hooks: [hookOn('alpha', 'qa_stamp', 'alpha_fn')] }),
        );
        const ql = engineFor(artifact);
        const bound = bind(ql, artifact);

        expect(bound).toMatchObject({ hooks: 2, functions: 2 });
        expect(await insertInto(ql, 'beta')).toBe('beta;');
        expect(await insertInto(ql, 'alpha')).toBe('alpha;');
        expect(ql.functionHoldersOf('beta_fn').packageItem(BETA)?.packageId).toBe(appArtifactHandlerOwner(BETA));
        expect(ql.functionHoldersOf('alpha_fn').packageItem(ALPHA)?.packageId).toBe(appArtifactHandlerOwner(ALPHA));
    });

    it('NARROWING — a body-B hook naming a function only body A declares is refused at bind (base: bound, every function under the artifact\'s id)', async () => {
        const artifact = compose(
            packageStack('beta', { hooks: [hookOn('beta', 'qa_beta_borrow', 'alpha_fn')] }),
            packageStack('alpha', { functions: { alpha_fn: stamp('alpha') }, hooks: [hookOn('alpha', 'qa_alpha_stamp', 'alpha_fn')] }),
        );
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);

        bind(ql, artifact);

        expect(errors.map((e) => [e.meta?.hook, e.meta?.code])).toEqual([['qa_beta_borrow', 'INVALID_REFERENCE']]);
        expect(await insertInto(ql, 'beta'), 'beta\'s hook is not bound').toBeUndefined();
        expect(await insertInto(ql, 'alpha'), 'alpha\'s own hook binds its own function').toBe('alpha;');
    });

    it('a body the new bundle drops stops running: its hooks stop firing and its functions leave the engine', async () => {
        const betaStack = packageStack('beta', { functions: { beta_fn: stamp('beta') }, hooks: [hookOn('beta', 'qa_beta_stamp', 'beta_fn')] });
        const alphaStack = packageStack('alpha', { functions: { alpha_fn: stamp('alpha') }, hooks: [hookOn('alpha', 'qa_alpha_stamp', 'alpha_fn')] });
        const both = compose(betaStack, alphaStack);
        const ql = engineFor(both);
        bind(ql, both);
        expect(await insertInto(ql, 'beta'), 'precondition').toBe('beta;');

        bind(ql, compose(alphaStack));

        expect(await insertInto(ql, 'beta'), 'a dropped body\'s hook must stop firing').toBeUndefined();
        expect(ql.functionHoldersOf('beta_fn').packageHolders, 'a dropped body\'s function must leave the engine').toEqual([]);
        expect(await insertInto(ql, 'alpha')).toBe('alpha;');
        expect(ql.functionHoldersOf('alpha_fn').packageItem(ALPHA)?.packageId).toBe(appArtifactHandlerOwner(ALPHA));
    });

    it('a function no body declares that two bodies\' hooks name stays under the artifact\'s id with those hooks: one package holder, nothing for the cold boot to warn of', async () => {
        // `os build` lowers ONE callable two bodies' hooks share to one ref the
        // runtime module serves at the top level, which no body declares.
        const body = (ns: Ns, hooks: unknown[]) => ({
            id: `com.qa.bodies.${ns}`, namespace: ns, name: `qa_bodies_${ns}`, version: '1.0.0', type: ns === 'alpha' ? 'app' : 'module',
            objects: [{ name: `${ns}_doc`, fields: {} }],
            hooks,
        });
        const artifact = {
            manifest: { id: ALPHA, namespace: 'alpha', name: 'qa_bodies_alpha', version: '1.0.0', type: 'app' },
            packages: [
                { manifest: body('beta', [hookOn('beta', 'qa_beta_shared', 'qa_shared_ref')]) },
                { manifest: body('alpha', [hookOn('alpha', 'qa_alpha_shared', 'qa_shared_ref')]) },
            ],
            functions: { qa_shared_ref: stamp('shared') },
        };
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);

        bind(ql, artifact);

        expect(errors.map((e) => e.meta?.code), 'no hook refused').toEqual([]);
        expect(await insertInto(ql, 'beta')).toBe('shared;');
        expect(await insertInto(ql, 'alpha')).toBe('shared;');
        expect(ql.functionHoldersOf('qa_shared_ref').packageHolders, 'one package holder').toEqual([ALPHA]);
        expect(ql.registry.sealBareNameHolders(), 'the cold boot finds no function held twice').toEqual([]);
    });

    it('NARROWING — a hook name body B declares and an input with no manifest declares too binds neither, never the residual\'s as B\'s; when the body is the artifact\'s own, both bind as before', async () => {
        const residual = defineStack({
            functions: { qa_res_fn: stamp('res') },
            hooks: [{ name: 'qa_twin', object: 'beta_doc', events: ['beforeInsert'], handler: 'qa_res_fn' }, hookOn('alpha', 'qa_twin_own', 'qa_res_fn')],
        } as never);
        const artifact = compose(
            packageStack('beta', { functions: { beta_fn: stamp('beta') }, hooks: [hookOn('beta', 'qa_twin', 'beta_fn')] }),
            residual,
            packageStack('alpha', { hooks: [hookOn('alpha', 'qa_twin_own', 'qa_res_fn')] }),
        );
        expect(artifact.manifest.id, 'precondition: the artifact is alpha\'s, so alpha is the residual\'s own package').toBe(ALPHA);
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);

        bind(ql, artifact, logger);

        expect(errors.map((e) => [e.meta?.hook, e.meta?.code, e.meta?.packages])).toEqual([['qa_twin', 'RESOURCE_CONFLICT', [BETA]]]);
        expect(await insertInto(ql, 'beta'), 'neither copy of the name binds').toBeUndefined();
        expect(ql.functionHoldersOf('qa_res_fn').packageItem(BETA), 'the residual\'s function is not attributed to beta').toBeUndefined();
        // The residual's twin of the artifact's own body's hook: one package, both bind under it.
        expect(await insertInto(ql, 'alpha')).toBe('res;res;');
    });

    it('a top-level hook naming a function only body B declares binds and runs it, the function and B\'s own hook of it under the artifact\'s id, as before (E1-a)', async () => {
        const residual = defineStack({
            hooks: [{ name: 'qa_res_borrow', object: 'alpha_doc', events: ['beforeInsert'], handler: 'beta_fn' }],
        } as never);
        const artifact = compose(
            packageStack('beta', { functions: { beta_fn: stamp('beta') }, hooks: [hookOn('beta', 'qa_beta_own', 'beta_fn')] }),
            residual,
            packageStack('alpha'),
        );
        expect(artifact.manifest.id, 'precondition: the artifact is alpha\'s, so beta is not its own body').toBe(ALPHA);
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);

        bind(ql, artifact, logger);

        expect(errors.map((e) => [e.meta?.hook, e.meta?.code]), 'no hook refused').toEqual([]);
        expect(await insertInto(ql, 'alpha'), 'the top-level hook runs beta\'s function').toBe('beta;');
        expect(await insertInto(ql, 'beta'), 'beta\'s own hook of it still runs').toBe('beta;');
        expect(ql.functionHoldersOf('beta_fn').packageHolders, 'one package holder, the artifact\'s').toEqual([ALPHA]);
        expect(ql.registry.sealBareNameHolders(), 'the cold boot finds no function held twice').toEqual([]);
    });

    it('a hook name two bodies of one namespace carry, naming a function only body B declares, binds as before; the install gate refuses the pair first (E1-b)', async () => {
        // Two bodies of ONE judged namespace holding one hook name are not held
        // apart (`namespaceNameConflicts`), so that name binds under the
        // artifact's owner. The boot never reaches the binder with such a pair:
        // the co-owner install refuses the second body, NAMESPACE_CONFLICT.
        const body = (ns: Ns, extra: Record<string, unknown>) => ({
            id: `com.qa.bodies.${ns}`, namespace: 'qa_crm', name: `qa_bodies_${ns}`, version: '1.0.0', type: ns === 'alpha' ? 'app' : 'module',
            objects: [{ name: `${ns}_doc`, fields: {} }],
            ...extra,
        });
        const betaFn = stamp('beta');
        const alphaFn = stamp('alpha');
        const artifact = {
            manifest: { id: ALPHA, namespace: 'qa_crm', name: 'qa_bodies_alpha', version: '1.0.0', type: 'app' },
            packages: [
                { manifest: body('beta', { hooks: [hookOn('beta', 'qa_same', 'beta_fn')], functions: { beta_fn: betaFn } }) },
                { manifest: body('alpha', { hooks: [hookOn('alpha', 'qa_same', 'alpha_fn')], functions: { alpha_fn: alphaFn } }) },
            ],
            functions: { beta_fn: betaFn, alpha_fn: alphaFn },
        };
        const scope = { packageIds: [ALPHA, BETA] };
        const gate = new ObjectQL({ logger: quiet } as any);
        (gate.registry as any).logLevel = 'silent';
        gate.registry.installPackage(artifact.packages[0].manifest as never, 'code' as never, undefined, scope as never);
        let refusal: any;
        try { gate.registry.installPackage(artifact.packages[1].manifest as never, 'code' as never, undefined, scope as never); } catch (err) { refusal = err; }
        expect(refusal?.code, 'the co-owner install refuses the second holder of the name').toBe('NAMESPACE_CONFLICT');

        const { errors, logger } = recordingErrors();
        const ql = new ObjectQL({ logger } as any);
        (ql.registry as any).logLevel = 'silent';
        bind(ql, artifact, logger);

        expect(errors.map((e) => [e.meta?.hook, e.meta?.code]), 'no hook refused').toEqual([]);
        expect(await insertInto(ql, 'beta'), 'beta\'s hook of the name runs beta\'s function').toBe('beta;');
        expect(await insertInto(ql, 'alpha')).toBe('alpha;');
        expect(ql.functionHoldersOf('beta_fn').packageHolders, 'under the artifact\'s id, with the hook').toEqual([ALPHA]);
    });

    it('NARROWING — a flow of the artifact\'s own package naming a function only body B declares resolves it through its declared closure, else is refused outside-closure (base: resolved under the artifact\'s id)', () => {
        const betaStack = packageStack('beta', { functions: { beta_total: () => 'beta' } });
        const read = (alpha: unknown) => {
            const artifact = compose(betaStack, alpha);
            const ql = engineFor(artifact);
            bind(ql, artifact);
            return resolvePackageScopedFunction(ql, { name: 'beta_total', callerPackageId: ALPHA });
        };

        const apart = read(packageStack('alpha'));
        expect(apart.status, JSON.stringify(apart)).toBe('refused');
        expect(apart.status === 'refused' && apart.reason).toBe('outside-closure');

        const depending = read(packageStack('alpha', { dependencies: { [BETA]: '^1.0.0' } }));
        expect(depending.status, JSON.stringify(depending)).toBe('resolved');
        expect(depending.status === 'resolved' && depending.item.packageId).toBe(appArtifactHandlerOwner(BETA));
    });

    it('NARROWING — a top-level function only body B\'s hooks name is registered under B: B\'s hook runs it, the artifact\'s own package no longer holds it (base: held under the artifact\'s id)', async () => {
        const residual = defineStack({ functions: { qa_res_only: stamp('res') } } as never);
        const artifact = compose(
            packageStack('beta', { hooks: [hookOn('beta', 'qa_beta_res', 'qa_res_only')] }),
            residual,
            packageStack('alpha'),
        );
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);

        bind(ql, artifact, logger);

        expect(errors.map((e) => [e.meta?.hook, e.meta?.code]), 'no hook refused').toEqual([]);
        expect(await insertInto(ql, 'beta')).toBe('res;');
        const holders = ql.functionHoldersOf('qa_res_only');
        expect(holders.packageHolders, 'one package holder, the body whose hook names it').toEqual([BETA]);
        expect(holders.packageItem(ALPHA), 'the artifact\'s own package does not hold it').toBeUndefined();
        const alphaFlow = resolvePackageScopedFunction(ql, { name: 'qa_res_only', callerPackageId: ALPHA });
        expect(alphaFlow.status === 'refused' && alphaFlow.reason, 'a flow of the artifact\'s own package reaches it only through its closure').toBe('outside-closure');
        ql.unregisterFunctionsByPackage(appArtifactHandlerOwner(ALPHA));
        expect(ql.functionHoldersOf('qa_res_only').packageItem(BETA), 'removing the artifact\'s own package leaves it').toBeDefined();
    });

    it('a function two bodies declare (a hand-written artifact) stays under the artifact\'s id with the declaring bodies\' hooks, as before', async () => {
        const shared = stamp('twice');
        const body = (ns: Ns) => ({
            id: `com.qa.bodies.${ns}`, namespace: ns, name: `qa_bodies_${ns}`, version: '1.0.0', type: ns === 'alpha' ? 'app' : 'module',
            objects: [{ name: `${ns}_doc`, fields: {} }],
            hooks: [hookOn(ns, `qa_${ns}_twice`, 'qa_twice')],
            functions: { qa_twice: shared },
        });
        const artifact = {
            manifest: { id: ALPHA, namespace: 'alpha', name: 'qa_bodies_alpha', version: '1.0.0', type: 'app' },
            packages: [{ manifest: body('beta') }, { manifest: body('alpha') }],
            functions: { qa_twice: shared },
        };
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);

        bind(ql, artifact, logger);

        expect(errors.map((e) => [e.meta?.hook, e.meta?.code]), 'no hook refused').toEqual([]);
        expect(await insertInto(ql, 'beta')).toBe('twice;');
        expect(await insertInto(ql, 'alpha')).toBe('twice;');
        expect(ql.functionHoldersOf('qa_twice').packageHolders, 'one package holder').toEqual([ALPHA]);
    });

    it('a re-bind that moves a function to another owner takes it off the owner the previous bind gave it, which keeps its other functions', async () => {
        const body = (ns: Ns, hooks: unknown[]) => ({
            id: `com.qa.bodies.${ns}`, namespace: ns, name: `qa_bodies_${ns}`, version: '1.0.0', type: ns === 'alpha' ? 'app' : 'module',
            objects: [{ name: `${ns}_doc`, fields: {} }],
            hooks,
        });
        const artifactWith = (topLevelHooks: unknown[]) => ({
            manifest: { id: ALPHA, namespace: 'alpha', name: 'qa_bodies_alpha', version: '1.0.0', type: 'app' },
            packages: [
                { manifest: body('beta', [hookOn('beta', 'qa_beta_moving', 'qa_moving'), hookOn('beta', 'qa_beta_kept', 'qa_kept')]) },
                { manifest: body('alpha', []) },
            ],
            hooks: topLevelHooks,
            functions: { qa_moving: stamp('moving'), qa_kept: stamp('kept') },
        });
        const first = artifactWith([]);
        const ql = engineFor(first);
        bind(ql, first);
        expect(ql.functionHoldersOf('qa_moving').packageHolders, 'precondition: only beta\'s hook names it').toEqual([BETA]);

        // Now the top level names it too: one function two owners' hooks name, under the artifact's id.
        bind(ql, artifactWith([hookOn('alpha', 'qa_res_moving', 'qa_moving')]));

        expect(ql.functionHoldersOf('qa_moving').packageHolders, 'held once, by the artifact\'s id').toEqual([ALPHA]);
        expect(ql.functionHoldersOf('qa_kept').packageHolders, 'beta keeps the function only its hook names').toEqual([BETA]);
        expect(String(await insertInto(ql, 'beta')).split(';').filter(Boolean).sort()).toEqual(['kept', 'moving']);
        expect(await insertInto(ql, 'alpha')).toBe('moving;');
    });

    it('CONTROL — on a built artifact a body\'s hook binds the handler ref its runtime module serves at the top level; a residual hook binds under the artifact\'s id', async () => {
        // `os build` lowers an inline hook handler it cannot extract to a ref the
        // runtime module serves; the artifact loader merges the module's callables
        // onto the top-level `functions`, which no body declares.
        const body = (ns: Ns, hooks: unknown[]) => ({
            id: `com.qa.bodies.${ns}`, namespace: ns, name: `qa_bodies_${ns}`, version: '1.0.0', type: ns === 'alpha' ? 'app' : 'module',
            objects: [{ name: `${ns}_doc`, fields: {} }],
            hooks,
        });
        const artifact = {
            manifest: { id: ALPHA, namespace: 'alpha', name: 'qa_bodies_alpha', version: '1.0.0', type: 'app' },
            packages: [
                { manifest: body('beta', [hookOn('beta', 'qa_beta_stamp', 'qa_beta_stamp')]) },
                { manifest: body('alpha', []) },
            ],
            hooks: [hookOn('alpha', 'qa_residual_stamp', 'residual_fn')],
            functions: { qa_beta_stamp: stamp('beta'), residual_fn: stamp('residual') },
        };
        const { errors, logger } = recordingErrors();
        const ql = engineFor(artifact, logger);

        bind(ql, artifact);

        expect(errors.map((e) => e.meta?.code), 'no hook refused').toEqual([]);
        expect(await insertInto(ql, 'beta')).toBe('beta;');
        expect(await insertInto(ql, 'alpha')).toBe('residual;');
    });
});
