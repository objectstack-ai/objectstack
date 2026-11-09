// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE admitted action sequence (`./action-dispatch.ts`), read through
 * every door that runs it: the REST `/actions` door
 * (`HttpDispatcher.handleActions`), a host's door (`dispatchAction`, the
 * published entry) and the MCP `run_action` bridge (`invokeBusinessAction`,
 * its throw read the way the MCP tool reads one: `actionsDoorAnswerOf`, with
 * a refusal's `details`).
 *
 * Three groups:
 *
 *  1. `dispatchAction` answers what the REST door answers for the same call,
 *     byte for byte — a gated action and an elevated flow, refused and
 *     admitted (the card's "Done when"), an addressed call, and the
 *     anonymous floor. The `ai` posture adds exactly the AI door's rules.
 *  2. The MCP refusals that change because the bridge now runs the REST
 *     door's sequence (the PR's "Served refusal codes that change"): each
 *     was refused before and stays refused; only the code, or the detail
 *     beside it, is the REST door's now.
 *  3. The AI-door rules that do NOT change, as controls.
 *
 * Every service is scripted, so "never ran" is a fact about a spy.
 */

import { describe, it, expect, vi } from 'vitest';
import { actionsDoorAnswerOf } from '@objectstack/types';

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
}

function makeRig(actions: any[], opts: RigOptions = {}) {
    const execute = vi.fn(async (_name: string, _ctx?: unknown) => (opts.flowFails
        ? { success: false, status: 'failed', error: 'the author says no', errorMessage: 'the author says no', output: {} }
        : { success: true, output: { ok: 1 } }));
    const getFlow = vi.fn(async (name: string) => ({ name, ...(opts.flow ?? { type: 'screen' }) }));
    const automation = opts.automation === false ? null : { execute, getFlow };
    const objectDef: any = { name: OBJECT, label: 'Task', actions, _packageId: PACKAGE };
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
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
        findOne: vi.fn(async () => null),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => (opts.packageDisabled ? [] : [objectDef])),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
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
                            : null;
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

    return { viaRest, viaHost, viaMcp, ran, rows };
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
        expect(refused.body.error.code).toBe('PERMISSION_DENIED');
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
        expect(unknown.body.error.code).toBe('RESOURCE_NOT_FOUND');
        expect(rig.ran()).toBe(0);
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
            expect({ status: ai.status, code: ai.body.error.code, message: ai.body.error.message })
                .toEqual({ status: mcp.status, code: (mcp as any).code, message: (mcp as any).message });
            expect(rig.ran()).toBe(0);
        });

        it('confirmation: refused 428 without `confirm`, run with it', async () => {
            const rig = makeRig([confirmed]);
            const refused = await rig.viaHost(MEMBER_EC, 'confirmed', { posture: 'ai' });
            expect(refused.status).toBe(428);
            expect(refused.body.error.code).toBe('ACTION_CONFIRMATION_REQUIRED');
            expect(rig.ran()).toBe(0);
            expect((await rig.viaHost(MEMBER_EC, 'confirmed', { posture: 'ai', confirm: true })).status).toBe(200);
            expect((await makeRig([confirmed]).viaHost(MEMBER_EC, 'confirmed')).status).toBe(200);
        });
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

    it('C6 — an entitled url action: still 400, now with the REST door\'s prescription', async () => {
        const go = { name: 'go2', type: 'url', target: '/x', ai: EXPOSED };
        const mcp: any = await makeRig([go]).viaMcp(MEMBER_EC, 'go2');
        const rest = await makeRig([go]).viaRest(MEMBER_EC, 'go2');
        expect({ status: mcp.status, code: mcp.code, message: mcp.message })
            .toEqual({ status: 400, code: 'VALIDATION_ERROR', message: rest.body.error.message });
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
