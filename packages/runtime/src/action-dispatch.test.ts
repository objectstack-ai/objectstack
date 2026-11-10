// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE admitted action sequence (`./action-dispatch.ts`), read through
 * every door that runs it: the REST `/actions` door
 * (`HttpDispatcher.handleActions`), a host's door (`dispatchAction`, the
 * published entry) and the MCP `run_action` bridge (`invokeBusinessAction`,
 * its throw read the way the MCP tool reads one: `actionsDoorAnswerOf`, with
 * a refusal's `details`).
 *
 * Four groups:
 *
 *  1. `dispatchAction` answers what the REST door answers for the same call,
 *     byte for byte — a gated action and an elevated flow, refused and
 *     admitted (the card's "Done when"), an addressed call, and the
 *     anonymous floor. The `ai` posture adds exactly the AI door's rules,
 *     and answers the type refusal with the AI door's sentence.
 *  1b. On a two-kernel host, `dispatchAction` runs a call on the kernel the
 *     REST door's scoped path is served from, through the same placement
 *     step, and a failing resolver refuses it at both doors.
 *  2. The MCP refusals that change because the bridge now runs the REST
 *     door's sequence (the PR's "Served refusal codes that change"): each
 *     was refused before and stays refused; only the code, or the detail
 *     beside it, is the REST door's now.
 *  3. The AI-door rules that do NOT change, as controls.
 *
 * Every service is scripted, so "never ran" is a fact about a spy.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';
import { describe, it, expect, vi } from 'vitest';
import { actionsDoorAnswerOf } from '@objectstack/types';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';

import { HttpDispatcher } from './http-dispatcher.js';
import { callData, invokeBusinessAction } from './action-execution.js';
import { dispatchAction, type ActionDispatchRequest } from './action-dispatch.js';

const OBJECT = 'ad_task';
const PACKAGE = 'com.qa.ad';
const NAMESPACE = 'ad';
const MEMBER_EC = { userId: 'user_1', systemPermissions: [] as string[] };
const HOLDER_EC = { userId: 'user_2', systemPermissions: ['manage_x'] };
const SYSTEM_EC = { isSystem: true };
const EXPOSED = { exposed: true, description: 'An action the dispatch pins read through every door.' };

interface RigOptions {
    automation?: false;
    flow?: { type: string; runAs?: string };
    flowFails?: boolean;
    /** The action names the installation switched off (ADR-0126 §8). */
    disabledActions?: string[];
    /** The object's package is disabled: the protocol refuses it `404 OBJECT_PACKAGE_DISABLED`. */
    packageDisabled?: boolean;
    /** The metadata plane reports a degraded read, or its object listing throws. */
    metaDegraded?: 'diagnosed' | 'listThrows';
    /** What a script action answers on this kernel, so a two-kernel host can tell which kernel ran it. */
    ranOn?: string;
    /** Services this kernel registers beside the rig's own (`kernel-resolver`, `auth`). */
    services?: Record<string, unknown>;
}

function makeRig(actions: any[], opts: RigOptions = {}) {
    const execute = vi.fn(async (_name: string, _ctx?: unknown) => (opts.flowFails
        ? { success: false, status: 'failed', error: 'the author says no', errorMessage: 'the author says no', output: {} }
        : { success: true, output: { ok: 1 } }));
    const getFlow = vi.fn(async (name: string) => ({ name, ...(opts.flow ?? { type: 'screen' }) }));
    const automation = opts.automation === false ? null : { execute, getFlow };
    const objectDef: any = { name: OBJECT, label: 'Task', actions, _packageId: PACKAGE };
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const executeAction = vi.fn(async () => ({ ran: opts.ranOn ?? 'script' }));
    const disabled = new Set(opts.disabledActions ?? []);
    const ql: any = {
        executeAction,
        getSchema: schemaOf,
        registry: {
            getObject: schemaOf,
            getItem: () => undefined,
            getNamespaceOwners: (ns: string) => (ns === NAMESPACE ? [PACKAGE] : []),
        },
        isActionEnabled: (name: string) => !disabled.has(name),
        describeDisabledAction: (name: string) => `The action '${name}' is turned off for this deployment.`,
        listRegisteredActions: () => actions.map((a) => ({ objectName: OBJECT, actionName: a.target ?? a.name })),
        find: vi.fn(async () => []),
        findOne: vi.fn(async (object: string, query: any) => { assertEngineFindOnePredicate(object, query); return null; }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => (opts.metaDegraded === 'diagnosed'
            ? { data: null, degraded: true, errors: ['meta backend down'] }
            : { data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => {
            if (opts.metaDegraded === 'listThrows') throw new Error('meta backend down');
            return opts.packageDisabled ? [] : [objectDef];
        }),
        getObject: vi.fn(async (n: string) => {
            if (opts.metaDegraded === 'listThrows') throw new Error('meta backend down');
            return schemaOf(n);
        }),
    };
    // A protocol only where the package is disabled: its by-name object read
    // refuses the object as `@objectstack/metadata-protocol` does, and its
    // merged listings omit it.
    const protocol: any = opts.packageDisabled
        ? {
            getMetaItem: vi.fn(async ({ type, name }: { type: string; name: string }) => {
                if (type === 'object' && name === OBJECT) {
                    throw Object.assign(new Error(`Object '${OBJECT}' belongs to a disabled package`), {
                        code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: OBJECT,
                    });
                }
                return { item: null };
            }),
            getMetaItems: vi.fn(async () => ({ items: [] })),
        }
        : null;
    const rows: any[] = [];
    const audit = { recordActionInvocation: vi.fn(async (event: any) => { rows.push(event); }) };
    const resolve = (n: string): any =>
        n === 'objectql' || n === 'data' ? ql
            : n === 'metadata' ? metadata
                : n === 'automation' ? automation
                    : n === 'protocol' ? protocol
                        : n === 'audit' ? audit
                            : opts.services?.[n] ?? null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);
    const ran = () => executeAction.mock.calls.length + execute.mock.calls.length;

    const viaRest = async (ec: unknown, action: string, opts2: { ns?: string; body?: unknown; recordId?: string } = {}) => {
        const path = `${opts2.ns ? `/${opts2.ns}` : ''}/${OBJECT}/${action}${opts2.recordId ? `/${opts2.recordId}` : ''}`;
        const res: any = await dispatcher.handleActions(path, 'POST', opts2.body ?? {}, {
            request: {}, environmentId: 'platform', executionContext: ec,
        } as any);
        return res.response as { status: number; body: any; headers?: unknown };
    };

    const viaHost = (ec: unknown, action: string, extra: Partial<ActionDispatchRequest> = {}) =>
        dispatchAction(kernel, { executionContext: ec as any, environmentId: 'platform', objectName: OBJECT, actionName: action, ...extra });

    /** MCP `run_action`, read as the tool reads it: the door's reader, plus a refusal's `details`. */
    const viaMcp = async (ec: unknown, action: string, input: Record<string, unknown> = {}) => {
        const request: any = { request: {}, environmentId: 'platform', executionContext: ec };
        const deps: any = {
            resolveService: async (_ctx: any, name: string) =>
                (name === 'automation' ? automation : name === 'protocol' ? protocol : undefined),
            getObjectQL: async () => ql,
        };
        try {
            const answer = await invokeBusinessAction(deps, request, action, { objectName: OBJECT, ...input } as any, {
                driver: undefined, envId: 'platform', ec,
                getMeta: () => metadata,
                callData: (a, p, d, s, e) => callData(deps, request, a, p, d, s, e),
            });
            return { status: 200, answer };
        } catch (err) {
            const read = actionsDoorAnswerOf(err, OBJECT);
            const details = read.status < 500 ? (err as { details?: unknown }).details : undefined;
            return { status: read.status, code: read.code, message: read.message, ...(details !== undefined ? { details } : {}) };
        }
    };

    return { viaRest, viaHost, viaMcp, ran, rows, kernel };
}

const gated = { name: 'gated_ping', label: 'Gated', type: 'script', target: 'gated_ping', requiredPermissions: ['manage_x'], ai: EXPOSED };
const flowAction = { name: 'start_flow', label: 'Start', type: 'flow', target: 'ad_flow', ai: EXPOSED };

describe('dispatchAction answers what the REST /actions door answers', () => {
    it('a gated action: refused 403 for a caller without the capability, run for its holder — the same answer at both doors', async () => {
        for (const ec of [MEMBER_EC, HOLDER_EC]) {
            const rest = makeRig([gated]);
            const host = makeRig([gated]);
            const restAnswer = await rest.viaRest(ec, 'gated_ping');
            const hostAnswer = await host.viaHost(ec, 'gated_ping');
            expect(hostAnswer).toEqual(restAnswer);
            expect(host.ran()).toBe(rest.ran());
        }
        const refused = await makeRig([gated]).viaHost(MEMBER_EC, 'gated_ping');
        expect(refused.status).toBe(403);
        expect(refused.body.error!.code).toBe('PERMISSION_DENIED');
        const admitted = await makeRig([gated]).viaHost(HOLDER_EC, 'gated_ping');
        expect(admitted).toMatchObject({ status: 200, body: { success: true, data: { ran: 'script' } } });
    });

    it('an elevated flow: a member may not start a runAs-system autolaunched flow, the system principal may — the same answer at both doors', async () => {
        const flow = { type: 'autolaunched', runAs: 'system' };
        const answers: number[] = [];
        for (const ec of [MEMBER_EC, SYSTEM_EC]) {
            const rest = makeRig([flowAction], { flow });
            const host = makeRig([flowAction], { flow });
            const restAnswer = await rest.viaRest(ec, 'start_flow');
            const hostAnswer = await host.viaHost(ec, 'start_flow');
            expect(hostAnswer).toEqual(restAnswer);
            expect(host.ran()).toBe(rest.ran());
            answers.push(hostAnswer.status);
        }
        expect(answers[0]).toBeGreaterThanOrEqual(400);
        expect(answers[1]).toBe(200);
    });

    it('an addressed call (`namespace`) answers what the addressed REST path answers; a namespace nobody installed is refused 404', async () => {
        const restAnswer = await makeRig([gated]).viaRest(HOLDER_EC, 'gated_ping', { ns: NAMESPACE });
        const hostAnswer = await makeRig([gated]).viaHost(HOLDER_EC, 'gated_ping', { namespace: NAMESPACE });
        expect(hostAnswer).toEqual(restAnswer);
        expect(hostAnswer.status).toBe(200);

        const rig = makeRig([gated]);
        const unknown = await rig.viaHost(HOLDER_EC, 'gated_ping', { namespace: 'nobody' });
        expect(unknown.status).toBe(404);
        expect(unknown.body.error!.code).toBe('RESOURCE_NOT_FOUND');
        expect(rig.ran()).toBe(0);
    });

    it('a posture that is neither rest nor ai is refused 400 VALIDATION_FAILED before anything resolves or runs', async () => {
        for (const posture of ['AI', 'mcp', '', 1]) {
            const rig = makeRig([gated]);
            const answer = await rig.viaHost(HOLDER_EC, 'gated_ping', { posture: posture as any });
            expect(answer.status).toBe(400);
            expect(answer.body.error!.code).toBe('VALIDATION_FAILED');
            expect((answer.body.error as any).details?.fields?.[0]).toMatchObject({ field: 'posture', code: 'invalid_option' });
            expect(rig.ran()).toBe(0);
            expect(rig.rows).toHaveLength(0);
        }
        // The two named postures and an absent one still run.
        for (const posture of ['rest', 'ai', undefined] as const) {
            expect((await makeRig([gated]).viaHost(HOLDER_EC, 'gated_ping', posture === undefined ? {} : { posture })).status).toBe(200);
        }
    });

    it('an anonymous caller is refused 401 before anything runs, as at the REST door', async () => {
        const rig = makeRig([gated]);
        const restAnswer = await makeRig([gated]).viaRest({}, 'gated_ping');
        const hostAnswer = await rig.viaHost({}, 'gated_ping');
        expect(hostAnswer).toEqual(restAnswer);
        expect(hostAnswer.status).toBe(401);
        expect(rig.ran()).toBe(0);
    });

    it('the record id and params travel as the REST body does: a non-object params bag is the same 400', async () => {
        const restAnswer = await makeRig([gated]).viaRest(HOLDER_EC, 'gated_ping', { body: { params: 'oops' } });
        const hostAnswer = await makeRig([gated]).viaHost(HOLDER_EC, 'gated_ping', { params: 'oops' as any });
        expect(hostAnswer).toEqual(restAnswer);
        expect(hostAnswer.status).toBe(400);
    });

    it('a host call writes one invocation row with no surface; the REST door names itself', async () => {
        const rig = makeRig([gated]);
        await rig.viaHost(HOLDER_EC, 'gated_ping');
        await rig.viaRest(HOLDER_EC, 'gated_ping');
        expect(rig.rows).toHaveLength(2);
        expect(rig.rows[0].context.surface).toBeUndefined();
        expect(rig.rows[0]).toMatchObject({ actionName: 'gated_ping', outcome: 'succeeded' });
        expect(rig.rows[1].context.surface).toBe('rest');
    });

    describe("the 'ai' posture adds exactly the AI door's rules", () => {
        const plain = { name: 'plain', label: 'Plain', type: 'script', target: 'plain' };
        const confirmed = { name: 'confirmed', label: 'Confirmed', type: 'script', target: 'confirmed', ai: { ...EXPOSED, requiresConfirmation: true } };

        it('an action its author never exposed to AI runs under rest and is refused under ai, as run_action refuses it', async () => {
            expect((await makeRig([plain]).viaHost(MEMBER_EC, 'plain')).status).toBe(200);
            const rig = makeRig([plain]);
            const ai = await rig.viaHost(MEMBER_EC, 'plain', { posture: 'ai' });
            const mcp = await makeRig([plain]).viaMcp(MEMBER_EC, 'plain');
            expect(ai.status).toBe(400);
            expect({ status: ai.status, code: ai.body.error!.code, message: ai.body.error!.message })
                .toEqual({ status: mcp.status, code: (mcp as any).code, message: (mcp as any).message });
            expect(rig.ran()).toBe(0);
        });

        it('confirmation: refused 428 without `confirm`, run with it', async () => {
            const rig = makeRig([confirmed]);
            const refused = await rig.viaHost(MEMBER_EC, 'confirmed', { posture: 'ai' });
            expect(refused.status).toBe(428);
            expect(refused.body.error!.code).toBe('ACTION_CONFIRMATION_REQUIRED');
            expect(rig.ran()).toBe(0);
            expect((await rig.viaHost(MEMBER_EC, 'confirmed', { posture: 'ai', confirm: true })).status).toBe(200);
            expect((await makeRig([confirmed]).viaHost(MEMBER_EC, 'confirmed')).status).toBe(200);
        });

        // The type refusal is the same 400 at the same point under both
        // postures; only its sentence is the door's. `rest` prescribes the
        // REST caller's next step (call the off-origin target, open the
        // client-side target); `ai` answers the AI door's own sentence, which
        // names no target, since an agent can do neither.
        it.each([
            ['a client-side (url) action', { name: 'go_url', label: 'Go', type: 'url', target: '/x/go', ai: EXPOSED }],
            ['an off-origin api action', { name: 'remote_ping', label: 'Remote', type: 'api', target: 'https://elsewhere.example/ping', method: 'POST', ai: EXPOSED }],
        ])('%s: 400 under both postures; rest names its target, ai answers the AI door\'s sentence without it', async (_label, action) => {
            const rig = makeRig([action]);
            const rest = await rig.viaHost(MEMBER_EC, action.name);
            const restDoor = await rig.viaRest(MEMBER_EC, action.name);
            const ai = await rig.viaHost(MEMBER_EC, action.name, { posture: 'ai' });

            expect({ status: rest.status, code: rest.body.error!.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
            expect(rest.body.error!.message).toBe(restDoor.body.error.message);
            expect(rest.body.error!.message).toContain(action.target);

            expect({ status: ai.status, code: ai.body.error!.code, message: ai.body.error!.message }).toEqual({
                status: 400,
                code: 'VALIDATION_ERROR',
                message: `Action '${action.name}' (type='${action.type}') cannot be invoked via MCP`,
            });
            expect(ai.body.error!.message).not.toContain(action.target);
            expect(rig.ran()).toBe(0);
        });
    });
});

/**
 * A multi-kernel host: the host's kernel registers the `kernel-resolver`
 * service, and environment A runs on its own kernel. The resolver keeps the
 * `KernelResolver` contract (`http-dispatcher.ts`): it reads the dispatcher's
 * scoped-URL hint (`urlEnvironmentId`), validates it, writes
 * `environmentId`, and answers that environment's kernel; a request it does
 * not place is served from the host kernel. Each kernel's script handler
 * answers its own name, so `data.ran` says which kernel ran the action.
 *
 * The REST door is the real `dispatch()` on a scoped path, its caller
 * admitted by the environment kernel's `auth` session; the host door is
 * `dispatchAction` on the HOST kernel, naming the environment.
 */
describe('dispatchAction on a multi-kernel host runs on the environment\'s own kernel, as the REST door does', () => {
    const plain = { name: 'plain_ping', label: 'Plain', type: 'script', target: 'plain_ping', ai: EXPOSED };
    const auth = { api: { getSession: async () => ({ user: { id: MEMBER_EC.userId } }) } };
    const ENV_A = 'env_a';

    function twoKernelHost(resolve: (ctx: any, envKernel: unknown) => unknown) {
        const env = makeRig([plain], { ranOn: ENV_A, services: { auth } });
        const seen: Array<{ door: string; routePath: unknown; urlEnvironmentId: unknown }> = [];
        let door = '';
        const resolveKernel = vi.fn(async (ctx: any) => {
            seen.push({ door, routePath: ctx.routePath, urlEnvironmentId: ctx.urlEnvironmentId });
            return resolve(ctx, env.kernel);
        });
        const host = makeRig([plain], { ranOn: 'host', services: { auth, 'kernel-resolver': { resolveKernel } } });
        const viaScopedRest = (environmentId: string) => {
            door = 'rest';
            return new HttpDispatcher(host.kernel).dispatch(
                'POST', `/environments/${environmentId}/actions/${OBJECT}/${plain.name}`, {}, {}, { request: { headers: {} } } as any,
            );
        };
        const viaHost = (environmentId: string) => {
            door = 'host';
            return dispatchAction(host.kernel, {
                executionContext: MEMBER_EC as any, environmentId, objectName: OBJECT, actionName: plain.name,
            });
        };
        return { env, host, seen, viaScopedRest, viaHost };
    }

    /** The contract's resolver: the scoped-URL hint names the environment. */
    const placesByHint = (ctx: any, envKernel: unknown) => {
        if (ctx.urlEnvironmentId !== ENV_A) return undefined;
        ctx.environmentId = ENV_A;
        return envKernel;
    };

    it('a call naming environment A runs on A\'s kernel through both doors, and the resolver is asked the same question', async () => {
        const h = twoKernelHost(placesByHint);

        const rest: any = (await h.viaScopedRest(ENV_A)).response;
        const host = await h.viaHost(ENV_A);

        expect({ status: rest.status, data: rest.body.data }).toEqual({ status: 200, data: { ran: ENV_A } });
        expect({ status: host.status, data: host.body.data }).toEqual({ status: rest.status, data: rest.body.data });
        expect(h.host.ran()).toBe(0);
        expect(h.env.ran()).toBe(2);
        // The first question each door puts to the resolver is the same one.
        const first = (door: string) => {
            const { door: _d, ...hints } = h.seen.find((s) => s.door === door)!;
            return hints;
        };
        expect(first('host')).toEqual(first('rest'));
        expect(first('rest')).toEqual({ routePath: `/environments/${ENV_A}/actions/${OBJECT}/${plain.name}`, urlEnvironmentId: ENV_A });
    });

    it('an environment the resolver does not place is served from the host kernel at both doors', async () => {
        const h = twoKernelHost(placesByHint);

        const rest: any = (await h.viaScopedRest('env_b')).response;
        const host = await h.viaHost('env_b');

        expect({ status: rest.status, data: rest.body.data }).toEqual({ status: 200, data: { ran: 'host' } });
        expect({ status: host.status, data: host.body.data }).toEqual({ status: rest.status, data: rest.body.data });
        expect(h.env.ran()).toBe(0);
    });

    it('a resolver that fails refuses the call at both doors; nothing runs on the host kernel in its place', async () => {
        const fault = () => Object.assign(new Error(`Environment '${ENV_A}' is unavailable`), { status: 503, code: 'SERVICE_UNAVAILABLE' });
        const h = twoKernelHost(() => { throw fault(); });

        await expect(h.viaScopedRest(ENV_A)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        const host = await h.viaHost(ENV_A);

        expect({ status: host.status, code: host.body.error?.code }).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(h.host.ran()).toBe(0);
        expect(h.env.ran()).toBe(0);
    });
});

describe('MCP run_action: served refusal codes that change (the REST door\'s sequence, ai posture)', () => {
    it('C3 — an undeclared name on a named object: 404 RESOURCE_NOT_FOUND with the REST sentence (was 400 VALIDATION_ERROR)', async () => {
        const rig = makeRig([{ name: 'other', type: 'script', target: 'other', ai: EXPOSED }]);
        const mcp: any = await rig.viaMcp(MEMBER_EC, 'missing');
        const rest = await makeRig([{ name: 'other', type: 'script', target: 'other', ai: EXPOSED }]).viaRest(MEMBER_EC, 'missing');
        expect({ status: mcp.status, code: mcp.code, message: mcp.message })
            .toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND', message: rest.body.error.message });
        // With no object named, the bridge has no route pair to name: the same 404.
        const bare: any = await rig.viaMcp(MEMBER_EC, 'missing', { objectName: undefined });
        expect({ status: bare.status, code: bare.code }).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        expect(rig.ran()).toBe(0);
    });

    it('C4 — a flow action with no automation service: 503 SERVICE_UNAVAILABLE (was 400)', async () => {
        const rig = makeRig([flowAction], { automation: false });
        const mcp: any = await rig.viaMcp(MEMBER_EC, 'start_flow');
        expect({ status: mcp.status, code: mcp.code }).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    });

    it('C5 — a url action whose caller lacks its capability: 403 PERMISSION_DENIED (was 400, the type check ran before D4)', async () => {
        const go = { name: 'go', type: 'url', target: '/x', requiredPermissions: ['manage_x'], ai: EXPOSED };
        const mcp: any = await makeRig([go]).viaMcp(MEMBER_EC, 'go');
        expect({ status: mcp.status, code: mcp.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });

    it('C5 family — a url action the installation switched off: 409 ACTION_DISABLED (was 400)', async () => {
        const go = { name: 'go_off', type: 'url', target: '/x', ai: EXPOSED };
        const mcp: any = await makeRig([go], { disabledActions: ['go_off'] }).viaMcp(MEMBER_EC, 'go_off');
        expect({ status: mcp.status, code: mcp.code }).toEqual({ status: 409, code: 'ACTION_DISABLED' });
    });

    it('C6 family — a client-side action its author never exposed to AI: still 400, now the exposure sentence (the ai.exposed gate runs before the type check)', async () => {
        const modal = { name: 'open_modal', type: 'modal', target: 'm' };
        const rig = makeRig([modal]);
        const mcp: any = await rig.viaMcp(MEMBER_EC, 'open_modal');
        expect({ status: mcp.status, code: mcp.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(mcp.message).toMatch(/^Action 'open_modal' on 'ad_task' is not exposed to AI/);
        expect(rig.ran()).toBe(0);
    });

    it('C6 — an entitled url action: still 400 with the AI door\'s sentence, which names no target; the REST door prescribes its target', async () => {
        const go = { name: 'go2', type: 'url', target: '/x', ai: EXPOSED };
        const rig = makeRig([go]);
        const mcp: any = await rig.viaMcp(MEMBER_EC, 'go2');
        const host = await rig.viaHost(MEMBER_EC, 'go2', { posture: 'ai' });
        const rest = await rig.viaRest(MEMBER_EC, 'go2');
        expect({ status: mcp.status, code: mcp.code, message: mcp.message })
            .toEqual({ status: 400, code: 'VALIDATION_ERROR', message: "Action 'go2' (type='url') cannot be invoked via MCP" });
        expect({ status: host.status, code: host.body.error!.code, message: host.body.error!.message })
            .toEqual({ status: mcp.status, code: mcp.code, message: mcp.message });
        expect({ status: rest.status, code: rest.body.error.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(rest.body.error.message).toMatch(/^Action 'go2' on 'ad_task' is `type: 'url'` — a client-side action/);
        expect(rig.ran()).toBe(0);
    });

    it('C7 — a flow run that failed: 400 FLOW_FAILED, now carrying the run details the REST door serves', async () => {
        const rig = makeRig([flowAction], { flowFails: true });
        const mcp: any = await rig.viaMcp(MEMBER_EC, 'start_flow');
        const rest = await makeRig([flowAction], { flowFails: true }).viaRest(MEMBER_EC, 'start_flow');
        expect({ status: mcp.status, code: mcp.code }).toEqual({ status: 400, code: 'FLOW_FAILED' });
        expect(rest.body.error.details).toBeDefined();
        expect(mcp.details).toEqual(rest.body.error.details);
    });

    it('R1 — an object whose package is disabled: 404 OBJECT_PACKAGE_DISABLED, bare and addressed (was 400 / 404 RESOURCE_NOT_FOUND)', async () => {
        const action = { name: 'ping', type: 'script', target: 'ping', ai: EXPOSED };
        const rig = makeRig([action], { packageDisabled: true });
        for (const input of [{}, { namespace: NAMESPACE }]) {
            const mcp: any = await rig.viaMcp(MEMBER_EC, 'ping', input);
            expect({ status: mcp.status, code: mcp.code }).toEqual({ status: 404, code: 'OBJECT_PACKAGE_DISABLED' });
        }
        // The REST door's addressed arm asks before it resolves too: the
        // resolver's listing omits the object, and must not answer first.
        const addressed = await rig.viaRest(MEMBER_EC, 'ping', { ns: NAMESPACE });
        expect({ status: addressed.status, code: addressed.body.error.code }).toEqual({ status: 404, code: 'OBJECT_PACKAGE_DISABLED' });
        expect(rig.ran()).toBe(0);
    });
});

/**
 * The shared sequence's body checks and its degraded arm, read at MCP
 * `run_action` (seat review S1 on #32032). Measured on base c9246279 and on
 * this head with the same probe: only an ARRAY `params` changes (the one
 * narrowing); everything else answers as it did.
 */
describe('MCP run_action: the body checks and the degraded arm (base vs head)', () => {
    const ping = { name: 'ping', label: 'Ping', type: 'script', target: 'ping', ai: EXPOSED };

    it('NARROWING — an array `params` is refused 400 VALIDATION_FAILED and nothing runs (base spread it into numeric keys and ran)', async () => {
        const rig = makeRig([ping]);
        const mcp: any = await rig.viaMcp(MEMBER_EC, 'ping', { params: ['x'] });
        expect({ status: mcp.status, code: mcp.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
        expect(mcp.message).toMatch(/`params` expected an object/);
        expect(rig.ran()).toBe(0);
    });

    it('unchanged — a string `params` is read as no params and the action runs, as on base', async () => {
        const rig = makeRig([ping]);
        const mcp: any = await rig.viaMcp(MEMBER_EC, 'ping', { params: 'oops' });
        expect(mcp.status).toBe(200);
        expect(rig.ran()).toBe(1);
    });

    it('unchanged — a non-string `recordId` (a number, an object) is read as a record-less call and runs, as on base', async () => {
        for (const recordId of [42, { id: 'r1' }]) {
            const rig = makeRig([ping]);
            const mcp: any = await rig.viaMcp(MEMBER_EC, 'ping', { recordId });
            expect(mcp).toEqual({ status: 200, answer: { ok: true, action: 'ping', objectName: OBJECT, result: { ran: 'script' } } });
            expect(rig.ran()).toBe(1);
        }
    });

    it('unchanged — no degraded 503 at MCP: a degraded metadata read still runs, and a listing that throws is refused 400 as on base', async () => {
        const diagnosed = makeRig([ping], { metaDegraded: 'diagnosed' });
        expect((await diagnosed.viaMcp(MEMBER_EC, 'ping')).status).toBe(200);
        const down = makeRig([ping], { metaDegraded: 'listThrows' });
        const mcp: any = await down.viaMcp(MEMBER_EC, 'ping');
        expect({ status: mcp.status, message: mcp.message }).toEqual({ status: 400, message: 'meta backend down' });
        expect(down.ran()).toBe(0);
    });
});

describe('MCP run_action: the AI-door rules that stay', () => {
    it('confirmation 428, ai.exposed 400 and the unbound-script 400 are unchanged, and REST runs all three', async () => {
        const confirmed = { name: 'gate', type: 'script', target: 'gate', ai: { ...EXPOSED, requiresConfirmation: true } };
        const plain = { name: 'plain', type: 'script', target: 'plain' };
        const unbound = { name: 'unbound', type: 'script', ai: EXPOSED };
        const cases: Array<[any, number, string]> = [
            [confirmed, 428, 'ACTION_CONFIRMATION_REQUIRED'],
            [plain, 400, 'VALIDATION_ERROR'],
            [unbound, 400, 'VALIDATION_ERROR'],
        ];
        for (const [action, status, code] of cases) {
            const rig = makeRig([action]);
            const mcp: any = await rig.viaMcp(MEMBER_EC, action.name);
            expect({ status: mcp.status, code: mcp.code }).toEqual({ status, code });
            expect(rig.ran()).toBe(0);
            expect((await makeRig([action]).viaRest(MEMBER_EC, action.name)).status).toBe(200);
        }
    });

    it('an admitted call answers the bridge\'s own shape', async () => {
        const ok = { name: 'ok', type: 'script', target: 'ok', ai: EXPOSED };
        const mcp: any = await makeRig([ok]).viaMcp(MEMBER_EC, 'ok');
        expect(mcp).toEqual({ status: 200, answer: { ok: true, action: 'ok', objectName: OBJECT, result: { ran: 'script' } } });
    });
});
