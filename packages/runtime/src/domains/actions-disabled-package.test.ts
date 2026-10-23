// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25296] `POST /api/v1/actions/:object/:action` refuses an action on an
 * object whose owning package is disabled `404 OBJECT_PACKAGE_DISABLED`, the
 * data plane's answer for that object, before any gate reads the action's
 * declaration and before any handler runs.
 *
 * ## The defect
 *
 * The `/actions` door resolved the declaration (`resolveRouteActionDeclaration`,
 * which reads the engine's schema registry, where a disabled package's objects
 * stay registered) and dispatched without asking whether the object is served.
 * Measured on this rig at the base tree (`5801a4f2c9`), with the package below
 * registered during the boot and then disabled, on both kernel shapes: the
 * script action `ping` answered `200 { pong: true }` (its handler ran), the
 * declarative update was refused only at the record load, and an action gated
 * by `requiredPermissions` answered the caller `403`, while the data plane
 * refused the object `404 OBJECT_PACKAGE_DISABLED`, `GET /meta/object` omitted
 * it and the MCP `run_action` tool answered "not found".
 *
 * ## The fix, and where these pins sit
 *
 * The door asks the protocol's by-name object read (`refuseDisabledPackageObject`
 * in `../action-execution.ts`, over the read the data verbs' exposure gate
 * makes), and that read throws the protocol's one refusal for such an object.
 * ⛔ Not a second copy of the package predicate or of the refusal. The pins
 * drive the real runtime dispatcher (`dispatch()`), the one owner of the route,
 * over real kernels in both shapes, with an ENABLED package as the control and
 * the same package re-enabled as the proof that nothing recorded the verdict.
 *
 * The negative control (red with the fix ablated) is a one-time ablation,
 * cited in the PR, not a permanent case.
 *
 * ## [#25308] The package's OBJECT-LESS action
 *
 * An action that names no object has no object to refuse, so the gate above
 * never asks about it: the package's top-level action with no `objectName`
 * kept running on `POST /actions/global/NAME` and `POST /actions//NAME` after
 * the disable (measured on the base tree `258f4e6aa`, both shapes: `200` with
 * its handler's result), while the protocol's by-name read withheld it
 * (`GET /meta/action/NAME` answers `404`) and the MCP `run_action` tool
 * answered "not found". The declaration resolution now reads a standalone
 * action through that same by-name protocol read (ruling 6353801421 on the
 * card), so a withheld item is no declaration: the door answers the "no
 * declaration" `404` a name nothing declares gets, byte for byte but the name,
 * and discloses nothing the by-name read withholds. The pins hold it on both
 * spellings and shapes, on an enabled object's route too (a route the
 * resolution lets an object-less action answer on), for the package's action
 * bound to an enabled package's object, against an environment-authored
 * object-less action that keeps running through the disable, and through a
 * re-enable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { GLOBAL_ACTION_OBJECT_KEY, ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';

const CALLER = { userId: 'u_actions', tenantId: 'org_qa', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

/** The refusal the data plane answers an object of a disabled package (`@objectstack/metadata-protocol`). */
const PACKAGE_DISABLED = { status: 404, code: 'OBJECT_PACKAGE_DISABLED' } as const;

/** The `manifest` service door a package registers through (`ObjectQLPlugin`'s `register`). */
interface ManifestDoor {
    register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> | void;
}

/**
 * A package of one object carrying a script action, a declarative update, a
 * script action gated by `requiredPermissions`, and a top-level action bound
 * to the object.
 */
function actionPackageOf(prefix: string, bindTo?: string) {
    const object = `${prefix}_obj`;
    return {
        id: `com.qa.${prefix}`,
        object,
        artifact: () => ({
            id: `com.qa.${prefix}`,
            name: `${prefix} package`,
            version: '1.0.0',
            type: 'app',
            objects: [{
                name: object,
                label: 'Object',
                fields: { name: { name: 'name', type: 'text', label: 'Name' } },
                actions: [
                    { name: 'ping', label: 'Ping', type: 'script', target: 'qa_ping' },
                    { name: 'mark_done', label: 'Mark done', type: 'script', operation: 'update', patch: { name: 'done' } },
                    { name: 'admin_ping', label: 'Admin ping', type: 'script', target: 'qa_ping', requiredPermissions: ['manage_metadata'] },
                ],
            }],
            actions: [
                { name: 'bound_done', label: 'Bound done', type: 'script', operation: 'update', patch: { name: 'done' }, objectName: object },
                { name: `${prefix}_gping`, label: 'Global ping', type: 'script', target: `${prefix}_ghandler` },
                ...(bindTo ? [{ name: `${prefix}_xping`, label: 'Bound elsewhere', type: 'script', target: `${prefix}_ghandler`, objectName: bindTo }] : []),
            ],
        }),
        /** [#25308] The package's top-level action that names no object, and its handler. */
        globalAction: `${prefix}_gping`,
        globalHandler: `${prefix}_ghandler`,
        /** [#25308] With `bindTo`: the package's top-level action bound to that (another package's) object. */
        boundElsewhere: `${prefix}_xping`,
    };
}

/** [#25308] An object-less action the environment authored through the metadata door, and its handler. */
const AUTHORED = { name: 'qa_authored_gping', handler: 'qa_authored_ghandler' } as const;

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    root: string;
    /** The `qa_ping` handler's invocations. */
    pings: ReturnType<typeof vi.fn>;
    /** [#25308] The package's object-less action's handler's invocations. */
    globalPings: ReturnType<typeof vi.fn>;
    /** [#25308] The environment-authored object-less action's handler's invocations. */
    authoredPings: ReturnType<typeof vi.fn>;
}

/**
 * One kernel in the shape under test (the `environmentId` one with its options
 * verbatim from `createStandaloneStack`), with `pkg` registered through the
 * `manifest` service during the boot and `qa_ping`'s handler registered after it.
 * `others` are registered beside it and stay enabled. [#25308] The package's
 * object-less handler is registered under `global`, and the environment
 * authors {@link AUTHORED} through the protocol's save door.
 */
async function bootKernel(
    environmentId: string | undefined,
    pkg: ReturnType<typeof actionPackageOf>,
    others: ReadonlyArray<ReturnType<typeof actionPackageOf>> = [],
): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-actions-disabled-package-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }) as any, true);
    if (environmentId === undefined) {
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
    } else {
        const artifact = join(root, 'objectstack.json');
        writeFileSync(artifact, JSON.stringify({
            manifest: { id: 'com.qa.empty', name: 'empty', version: '0.0.0', type: 'app' },
            objects: [], views: [], apps: [], flows: [], requires: [],
        }));
        await kernel.use(new MetadataPlugin({
            watch: false, artifactWatch: false, environmentId,
            artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
        } as any));
        await kernel.use(new ObjectQLPlugin({ ql: engine, environmentId, hydrateMetadataFromDb: true }));
    }
    const host: Plugin = {
        name: 'qa.package-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            for (const each of [pkg, ...others]) await ctx.getService<ManifestDoor>('manifest').register(each.artifact());
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    const pings = vi.fn(async () => ({ pong: true }));
    engine.registerAction(pkg.object, 'qa_ping', pings);
    const globalPings = vi.fn(async () => ({ pong: 'package' }));
    engine.registerAction(GLOBAL_ACTION_OBJECT_KEY, pkg.globalHandler, globalPings);
    const authoredPings = vi.fn(async () => ({ pong: 'authored' }));
    engine.registerAction(GLOBAL_ACTION_OBJECT_KEY, AUTHORED.handler, authoredPings);
    await (kernel.getService('protocol') as any).saveMetaItem({
        type: 'action',
        name: AUTHORED.name,
        item: { name: AUTHORED.name, label: 'Authored global ping', type: 'script', target: AUTHORED.handler },
    });
    return { kernel, engine, root, pings, globalPings, authoredPings };
}

async function shutdown(booted: Booted | undefined): Promise<void> {
    if (!booted) return;
    if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
    rmSync(booted.root, { recursive: true, force: true });
}

/** The refusal's `code` in the dispatcher's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);

/** The refusal's message in the dispatcher's envelope, as {@link codeOf} reads its code. */
const messageOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.message : body?.error ?? body?.message);

/** What the runtime dispatcher answers `caller` on `method path`, through `dispatch()` and the host's exit for a throw. */
async function dispatchAs(kernel: ObjectKernel, method: string, path: string, body: Record<string, unknown>, caller: Record<string, unknown> = CALLER) {
    const { status, code, data } = await dispatchWithMessage(kernel, method, path, body, caller);
    return { status, code, data };
}

/** {@link dispatchAs}, with the answer's message beside it. */
async function dispatchWithMessage(kernel: ObjectKernel, method: string, path: string, body: Record<string, unknown>, caller: Record<string, unknown> = CALLER) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...caller });
    const raw = new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    try {
        const out: any = await dispatcher.dispatch(method, path, body, {}, { request: raw } as any, '/api/v1');
        const answer = out.response?.body;
        return { status: out.response?.status, code: codeOf(answer), data: answer?.data, message: messageOf(answer) };
    } catch (e) {
        // A throw out of `dispatch()` is rendered by the host's exit, through this one rule.
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, code: thrown.code, data: undefined, message: (e as Error)?.message };
    }
}

/** Every protocol / engine call an action invocation could reach the record or a handler through. */
function dispatchSpies(kernel: ObjectKernel, engine: ObjectQL) {
    const protocol: any = kernel.getService('protocol');
    return [
        ...(['getData', 'updateData'] as const).map((m) => vi.spyOn(protocol, m)),
        vi.spyOn(engine as any, 'executeAction'),
    ];
}

/** The invocations the door serves, each on the package's object. */
const INVOCATIONS: ReadonlyArray<{ label: string; path: (object: string) => string; body: Record<string, unknown> }> = [
    { label: 'the script action', path: (o) => `/actions/${o}/ping`, body: {} },
    { label: 'the script action, its record id in the path', path: (o) => `/actions/${o}/ping/r_any`, body: {} },
    { label: 'the declarative update', path: (o) => `/actions/${o}/mark_done`, body: { recordId: 'r_any' } },
    { label: 'the top-level action bound to the object', path: (o) => `/actions/${o}/bound_done`, body: { recordId: 'r_any' } },
    { label: 'the action gated by requiredPermissions the caller lacks', path: (o) => `/actions/${o}/admin_ping`, body: {} },
    { label: 'a name the package does not declare', path: (o) => `/actions/${o}/qa_nowhere`, body: {} },
];

/** [#25308] The two spellings of an object-less invocation's object segment. */
const GLOBAL_SPELLINGS: ReadonlyArray<{ label: string; path: (action: string) => string }> = [
    { label: '`global`', path: (a) => `/actions/${GLOBAL_ACTION_OBJECT_KEY}/${a}` },
    { label: 'the empty segment', path: (a) => `/actions//${a}` },
];

const SHAPES = [
    { shape: 'environmentId env_local (createStandaloneStack)', environmentId: 'env_local' },
    { shape: 'no environmentId', environmentId: undefined },
] as const;

for (const { shape, environmentId } of SHAPES) {
    describe(`[#25296] REST /actions and an ENABLED package's actions — ${shape} (the control)`, () => {
        const pkg = actionPackageOf('qa_acton');
        let booted: Booted | undefined;

        beforeAll(async () => {
            booted = await bootKernel(environmentId, pkg);
        }, 60_000);
        afterAll(async () => {
            await shutdown(booted);
        }, 60_000);

        it('runs the script action through its handler', async () => {
            const before = booted!.pings.mock.calls.length;
            expect(await dispatchAs(booted!.kernel, 'POST', `/actions/${pkg.object}/ping`, {}))
                .toEqual({ status: 200, code: undefined, data: { pong: true } });
            expect(booted!.pings.mock.calls.length).toBe(before + 1);
        });

        it('runs the declarative update and the bound top-level action on a record of the object', async () => {
            for (const name of ['mark_done', 'bound_done']) {
                const created = await dispatchAs(booted!.kernel, 'POST', `/data/${pkg.object}`, { name: 'seed' });
                const id = created.data?.id ?? created.data?.record?.id;
                expect(typeof id, 'precondition: a record of the package object was created').toBe('string');
                const ran = await dispatchAs(booted!.kernel, 'POST', `/actions/${pkg.object}/${name}`, { recordId: id });
                expect({ name, status: ran.status, record: ran.data?.record?.name }).toEqual({ name, status: 200, record: 'done' });
            }
        });

        it('answers the action gated by requiredPermissions 403, and an undeclared name 404 with no code of a disabled package', async () => {
            expect((await dispatchAs(booted!.kernel, 'POST', `/actions/${pkg.object}/admin_ping`, {})).status).toBe(403);
            const nowhere = await dispatchAs(booted!.kernel, 'POST', `/actions/${pkg.object}/qa_nowhere`, {});
            expect(nowhere.status).toBe(404);
            expect(nowhere.code).not.toBe(PACKAGE_DISABLED.code);
        });
    });

    describe(`[#25296] REST /actions and a DISABLED package's actions — ${shape}: refused as the data plane refuses its object, before anything dispatches`, () => {
        const pkg = actionPackageOf('qa_actoff');
        let booted: Booted | undefined;

        beforeAll(async () => {
            booted = await bootKernel(environmentId, pkg);
            expect((booted.engine as any).registry.disablePackage(pkg.id), 'precondition: disabled').toBeTruthy();
        }, 60_000);
        afterAll(async () => {
            vi.restoreAllMocks();
            await shutdown(booted);
        }, 60_000);

        it('precondition: the data plane refuses the object 404 OBJECT_PACKAGE_DISABLED', async () => {
            const read = await dispatchAs(booted!.kernel, 'GET', `/data/${pkg.object}`, {});
            expect({ status: read.status, code: read.code }).toEqual(PACKAGE_DISABLED);
        });

        for (const { label, path, body } of INVOCATIONS) {
            it(`refuses ${label} 404 OBJECT_PACKAGE_DISABLED, reaching no handler and no record`, async () => {
                const spies = dispatchSpies(booted!.kernel, booted!.engine);
                const before = booted!.pings.mock.calls.length;
                try {
                    const answer = await dispatchAs(booted!.kernel, 'POST', path(pkg.object), body);
                    expect({ status: answer.status, code: answer.code }).toEqual(PACKAGE_DISABLED);
                    expect(booted!.pings.mock.calls.length, 'the handler never ran').toBe(before);
                    for (const spy of spies) expect(spy, 'nothing dispatched').not.toHaveBeenCalled();
                } finally {
                    for (const spy of spies) spy.mockRestore();
                }
            });
        }

        it('still answers an anonymous caller the anonymous baseline first', async () => {
            const answer = await dispatchAs(booted!.kernel, 'POST', `/actions/${pkg.object}/ping`, {}, { isSystem: false });
            expect(answer.status).toBe(401);
            expect(answer.code).not.toBe(PACKAGE_DISABLED.code);
        });

        it('runs the script action again once the package is re-enabled: nothing recorded the refusal', async () => {
            expect((booted!.engine as any).registry.enablePackage(pkg.id), 'precondition: re-enabled').toBeTruthy();
            const before = booted!.pings.mock.calls.length;
            expect(await dispatchAs(booted!.kernel, 'POST', `/actions/${pkg.object}/ping`, {}))
                .toEqual({ status: 200, code: undefined, data: { pong: true } });
            expect(booted!.pings.mock.calls.length).toBe(before + 1);
        });
    });
}

/** [#25308] The "no declaration" answer with the action's name taken out, so two names' answers compare. */
function undeclaredShape(answer: { status: unknown; code: unknown; message: unknown }, name: string) {
    return { status: answer.status, code: answer.code, message: String(answer.message).split(name).join('NAME') };
}

for (const { shape, environmentId } of SHAPES) {
    describe(`[#25308] REST /actions and an ENABLED package's object-less action — ${shape} (the control)`, () => {
        const pkg = actionPackageOf('qa_gon');
        let booted: Booted | undefined;

        beforeAll(async () => {
            booted = await bootKernel(environmentId, pkg);
        }, 60_000);
        afterAll(async () => {
            await shutdown(booted);
        }, 60_000);

        for (const { label, path } of GLOBAL_SPELLINGS) {
            it(`runs the package's object-less action and the environment-authored one through their handlers, spelled ${label}`, async () => {
                const before = [booted!.globalPings.mock.calls.length, booted!.authoredPings.mock.calls.length];
                expect(await dispatchAs(booted!.kernel, 'POST', path(pkg.globalAction), {}))
                    .toEqual({ status: 200, code: undefined, data: { pong: 'package' } });
                expect(await dispatchAs(booted!.kernel, 'POST', path(AUTHORED.name), {}))
                    .toEqual({ status: 200, code: undefined, data: { pong: 'authored' } });
                expect([booted!.globalPings.mock.calls.length, booted!.authoredPings.mock.calls.length])
                    .toEqual([before[0] + 1, before[1] + 1]);
            });

            it(`answers an object-less name nothing declares the "no declaration" 404, spelled ${label}`, async () => {
                const nowhere = await dispatchWithMessage(booted!.kernel, 'POST', path('qa_nowhere'), {});
                expect(nowhere.status).toBe(404);
                expect(String(nowhere.message)).toMatch(/^Action 'qa_nowhere' on '[^']*' has no declaration/);
            });
        }
    });

    describe(`[#25308] REST /actions and a DISABLED package's object-less action — ${shape}: answered as a name nothing declares, the environment-authored one still runs`, () => {
        const side = actionPackageOf('qa_gside');
        const pkg = actionPackageOf('qa_goff', side.object);
        let booted: Booted | undefined;

        beforeAll(async () => {
            booted = await bootKernel(environmentId, pkg, [side]);
            expect((booted.engine as any).registry.disablePackage(pkg.id), 'precondition: disabled').toBeTruthy();
        }, 60_000);
        afterAll(async () => {
            vi.restoreAllMocks();
            await shutdown(booted);
        }, 60_000);

        it('precondition: the protocol\'s by-name read withholds the action, and serves the environment-authored one', async () => {
            const protocol: any = booted!.kernel.getService('protocol');
            expect((await protocol.getMetaItem({ type: 'action', name: pkg.globalAction }))?.item).toBeUndefined();
            expect((await protocol.getMetaItem({ type: 'action', name: AUTHORED.name }))?.item?.name).toBe(AUTHORED.name);
        });

        for (const { label, path } of GLOBAL_SPELLINGS) {
            it(`answers the package's object-less action as a name nothing declares, spelled ${label}, reaching no handler`, async () => {
                const spies = dispatchSpies(booted!.kernel, booted!.engine);
                const before = booted!.globalPings.mock.calls.length;
                try {
                    const answer = await dispatchWithMessage(booted!.kernel, 'POST', path(pkg.globalAction), {});
                    const nowhere = await dispatchWithMessage(booted!.kernel, 'POST', path('qa_nowhere'), {});
                    expect(answer.status).toBe(404);
                    expect(undeclaredShape(answer, pkg.globalAction)).toEqual(undeclaredShape(nowhere, 'qa_nowhere'));
                    expect(booted!.globalPings.mock.calls.length, 'the handler never ran').toBe(before);
                    for (const spy of spies) expect(spy, 'nothing dispatched').not.toHaveBeenCalled();
                } finally {
                    for (const spy of spies) spy.mockRestore();
                }
            });

            it(`runs the environment-authored object-less action through the disable, spelled ${label}`, async () => {
                const before = booted!.authoredPings.mock.calls.length;
                expect(await dispatchAs(booted!.kernel, 'POST', path(AUTHORED.name), {}))
                    .toEqual({ status: 200, code: undefined, data: { pong: 'authored' } });
                expect(booted!.authoredPings.mock.calls.length).toBe(before + 1);
            });
        }

        it('answers the package\'s object-less action on an ENABLED object\'s route as a name nothing declares there', async () => {
            const before = booted!.globalPings.mock.calls.length;
            const answer = await dispatchWithMessage(booted!.kernel, 'POST', `/actions/${side.object}/${pkg.globalAction}`, {});
            const nowhere = await dispatchWithMessage(booted!.kernel, 'POST', `/actions/${side.object}/qa_nowhere`, {});
            expect(answer.status).toBe(404);
            expect(undeclaredShape(answer, pkg.globalAction)).toEqual(undeclaredShape(nowhere, 'qa_nowhere'));
            expect(booted!.globalPings.mock.calls.length, 'the handler never ran').toBe(before);
        });

        it('answers the package\'s action bound to an ENABLED package\'s object as a name nothing declares there', async () => {
            const before = booted!.globalPings.mock.calls.length;
            const answer = await dispatchWithMessage(booted!.kernel, 'POST', `/actions/${side.object}/${pkg.boundElsewhere}`, {});
            const nowhere = await dispatchWithMessage(booted!.kernel, 'POST', `/actions/${side.object}/qa_nowhere`, {});
            expect(answer.status).toBe(404);
            expect(undeclaredShape(answer, pkg.boundElsewhere)).toEqual(undeclaredShape(nowhere, 'qa_nowhere'));
            expect(booted!.globalPings.mock.calls.length, 'the handler never ran').toBe(before);
        });

        it('still answers an anonymous caller the anonymous baseline first', async () => {
            const answer = await dispatchAs(booted!.kernel, 'POST', `/actions/${GLOBAL_ACTION_OBJECT_KEY}/${pkg.globalAction}`, {}, { isSystem: false });
            expect(answer.status).toBe(401);
        });

        it('runs the package\'s object-less action again once the package is re-enabled: nothing recorded the answer', async () => {
            expect((booted!.engine as any).registry.enablePackage(pkg.id), 'precondition: re-enabled').toBeTruthy();
            const before = booted!.globalPings.mock.calls.length;
            for (const { path } of GLOBAL_SPELLINGS) {
                expect(await dispatchAs(booted!.kernel, 'POST', path(pkg.globalAction), {}))
                    .toEqual({ status: 200, code: undefined, data: { pong: 'package' } });
            }
            expect(booted!.globalPings.mock.calls.length).toBe(before + GLOBAL_SPELLINGS.length);
        });
    });
}
