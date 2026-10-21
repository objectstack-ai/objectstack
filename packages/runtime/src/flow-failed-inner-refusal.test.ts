// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24914 (ruling B′, the maintainer's 「同意」, decision batch #379 item 5) —
 * the four flow doors carry the refusal a flow's data node met, the way the
 * data door carries a record save's.
 *
 * The spec declared the carriers in #24996: `AutomationResult.userMessage` /
 * `.innerRefusal`, and ONE `error.details` shape for every door's
 * `400 FLOW_FAILED` arm — `FlowFailureDetailsSchema` (`errorMessage?`,
 * `summary?`, `innerRefusal?`). The engine emits them (pinned in
 * `service-automation`'s `flow-inner-refusal.test.ts`); this file pins the
 * DOORS, driven with a scripted engine result so each door is reached by name:
 *
 *  1. each door — trigger, resume, `/actions`, declared endpoint — answers
 *     `400 FLOW_FAILED` with `details.innerRefusal` equal to the result's,
 *     `details` parsing as `FlowFailureDetailsSchema` and the error as
 *     `ApiErrorSchema`;
 *  2. the producer-marked `userMessage` rides the envelope's TOP level
 *     (`ApiErrorSchema.userMessage`), verbatim — never a details key, never in
 *     `message`; an unmarked run carries no `userMessage` at all;
 *  3. ⛔ `message` is each door's own wording, byte for byte, unchanged;
 *  4. one engine result, four doors, ONE `innerRefusal` — compared door
 *     against door, so a door that drops or reshapes it reddens here even if
 *     its own row were edited in the same change.
 *
 * The MCP `resume_run` bridge is pinned door-against-door with the REST resume
 * door in `mcp-resume-run.test.ts`; the wire through the REAL engine in
 * `@objectstack/verify`'s `automation-flow-inner-refusal.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiEndpointSchema, ApiErrorSchema, BaseResponseSchema, FlowFailureDetailsSchema } from '@objectstack/spec/api';
import type { AutomationResult, ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { HttpDispatcher } from './http-dispatcher.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from './endpoint-executor.js';

const FLOW = 'crm_convert_lead_wizard';
const INNER_MESSAGE = "Duplicate record refused on 'crm_account': a unique constraint already holds these values. No record was written.";
const RAW_ERROR = `Node 'create_account' failed: create_record(crm_account) failed: ${INNER_MESSAGE}`;
const USER_TEXT = '该客户名称已被另一位销售代表占用，请联系主管。';
const SUMMARY = {
    selected: 0, acted: 0, skipped: 0, unmeasured: 0,
    nodes: [{ nodeId: 'create_account', nodeType: 'create_record', status: 'failure', runs: 1, failures: 1 }],
} as AutomationResult['summary'];
const INNER = { code: 'UNIQUE_VIOLATION', message: INNER_MESSAGE } as const;

/** The engine's ran-and-failed exit carrying the refusal its node met — unmarked. */
const FAILED_UNMARKED: AutomationResult = {
    success: false, status: 'failed', error: RAW_ERROR, durationMs: 9, summary: SUMMARY, innerRefusal: INNER,
};
/** The same, with the producer's end-user marking (an app hook's `userMessage`). */
const FAILED_MARKED: AutomationResult = { ...FAILED_UNMARKED, userMessage: USER_TEXT };

const flowAction = { name: 'convert_lead', label: 'Convert Lead', objectName: 'crm_lead', type: 'flow', target: FLOW };

/** One dispatcher serving trigger, resume and `/actions` from ONE scripted engine. */
function makeDispatcher(result: AutomationResult) {
    const execute = vi.fn(async () => result);
    const resume = vi.fn(async () => ({ ...result, status: 'stranded' as const }));
    const getFlow = vi.fn(async (name: string) => (name === FLOW ? { name } : null));
    const automation = { execute, resume, getFlow };
    const objectDef = { name: 'crm_lead', actions: [flowAction] };
    const ql: any = {
        executeAction: vi.fn(),
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'automation' ? automation : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel), automation };
}

const CTX: any = { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } };
const EC = { userId: 'u1', positions: [], permissions: [] } as unknown as ExecutionContext;

async function viaTrigger(result: AutomationResult) {
    const { dispatcher } = makeDispatcher(result);
    const res: any = await dispatcher.handleAutomation(`/${FLOW}/trigger`, 'POST', {}, CTX);
    return { status: res.response.status as number, body: res.response.body };
}
async function viaResume(result: AutomationResult) {
    const { dispatcher } = makeDispatcher(result);
    const res: any = await dispatcher.handleAutomation(`/${FLOW}/runs/run_1/resume`, 'POST', {}, CTX);
    return { status: res.response.status as number, body: res.response.body };
}
async function viaAction(result: AutomationResult) {
    const { dispatcher } = makeDispatcher(result);
    const res: any = await dispatcher.handleActions('/crm_lead/convert_lead', 'POST', {}, CTX);
    return { status: res.response.status as number, body: res.response.body };
}
async function viaEndpoint(result: AutomationResult) {
    const { automation } = makeDispatcher(result);
    const endpoint = ApiEndpointSchema.parse({
        name: 'convert', path: '/api/v1/apps/crm/convert', method: 'POST', type: 'flow', target: FLOW,
    });
    const match: ApiEndpointMatch = { endpoint, params: {} };
    const ctx = buildEndpointExecutionContext({
        request: { method: 'POST', path: '/api/v1/apps/crm/convert', query: {}, headers: {}, body: {} },
        match,
        executionContext: EC,
        environmentId: 'env-1',
    });
    const answer = await executeEndpointTarget(ctx, { callData: vi.fn(), automationService: automation });
    return { status: answer.status, body: answer.body as any };
}

const DOORS: Array<[string, (r: AutomationResult) => Promise<{ status: number; body: any }>, string]> = [
    ['trigger', viaTrigger, RAW_ERROR],
    ['resume', viaResume, RAW_ERROR],
    // `/actions` keeps its own wording since #3962: it names the flow.
    ['/actions', viaAction, `Flow '${FLOW}' failed: ${RAW_ERROR}`],
    ['endpoint', viaEndpoint, RAW_ERROR],
];

describe('#24914 — every flow door carries the inner refusal in its 400 FLOW_FAILED', () => {
    for (const [door, via, wording] of DOORS) {
        it(`${door}: details.innerRefusal is the result's, the declared shape; message unchanged`, async () => {
            const { status, body } = await via(FAILED_UNMARKED);

            expect(status).toBe(400);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('FLOW_FAILED');
            expect(body.error.httpStatus).toBe(400);
            expect(body.error.details.innerRefusal).toEqual(INNER);
            // The declared shape, parsed by the spec's own schemas.
            const parsed = FlowFailureDetailsSchema.safeParse(body.error.details);
            expect(parsed.success).toBe(true);
            expect(parsed.success && parsed.data.innerRefusal).toEqual(INNER);
            expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
            expect(BaseResponseSchema.safeParse(body).success).toBe(true);
            // The diagnostic channel does not move.
            expect(body.error.message).toBe(wording);
            // Unmarked: no top-level userMessage at all (absent, not empty).
            expect('userMessage' in body.error).toBe(false);
        });

        it(`${door}: a producer-marked userMessage rides the envelope's TOP level, verbatim`, async () => {
            const { status, body } = await via(FAILED_MARKED);

            expect(status).toBe(400);
            expect(body.error.code).toBe('FLOW_FAILED');
            expect(body.error.userMessage).toBe(USER_TEXT);
            // Beside `message`, never instead of it or inside it…
            expect(body.error.message).toBe(wording);
            expect(body.error.message).not.toContain(USER_TEXT);
            // …and never a details key: the details ceiling is the three
            // declared keys (plus the resume door's verdict).
            expect(body.error.details.userMessage).toBeUndefined();
            expect(body.error.details.innerRefusal).toEqual(INNER);
            expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
        });
    }

    it('one engine result, four doors, ONE innerRefusal and ONE userMessage — the drift pin', async () => {
        const answers = await Promise.all(DOORS.map(([, via]) => via(FAILED_MARKED)));

        const inner = answers.map((a) => a.body.error.details.innerRefusal);
        const marked = answers.map((a) => a.body.error.userMessage);
        for (const value of inner) expect(value).toEqual(inner[0]);
        for (const value of marked) expect(value).toBe(marked[0]);
        // Anchored once, so four doors agreeing on `undefined` cannot pass.
        expect(inner[0]).toEqual(INNER);
        expect(marked[0]).toBe(USER_TEXT);
    });

    it('a failed run that met no refusal gets no invented member at any door', async () => {
        const plain: AutomationResult = { success: false, status: 'failed', error: "Node 'n' failed: downstream 503", durationMs: 2 };

        for (const [, via] of DOORS) {
            const { status, body } = await via(plain);
            expect(status).toBe(400);
            expect(body.error.code).toBe('FLOW_FAILED');
            expect(body.error.details?.innerRefusal).toBeUndefined();
            expect('userMessage' in body.error).toBe(false);
        }
    });
});
