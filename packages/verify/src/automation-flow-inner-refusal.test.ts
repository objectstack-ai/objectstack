// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24914 (ruling B′, the maintainer's 「同意」, decision batch #379 item 5) —
 * a screen flow whose write node is refused reaches THE WIRE with the refusal
 * structured, the way a record save of the same write does.
 *
 * The card's measured case: HotCRM's lead conversion, a `create_record` on
 * `crm_account` behind a screen, refused by the per-organization unique name.
 * The end user read the engine's node text — `Node 'create_account' failed:
 * create_record(crm_account) failed: …` — because the refusal was flattened
 * into that one string before it left the engine. The spec now declares the
 * carriers (#24996) and the engine and the doors emit them (this card); this
 * file drives a REAL `AutomationEngine` with the REAL CRUD executors through
 * the REAL `HttpDispatcher`, with a data layer throwing the REAL error classes
 * the platform throws, and reads the response body:
 *
 *  - a unique, a validation and a permission refusal each reach the trigger
 *    door — and, behind a pause, the resume door (the screen-flow leg) — as
 *    `400 FLOW_FAILED` with `details.innerRefusal = { code, message }`;
 *  - ⭐ the inner `code` is the one the DATA door answers for the very same
 *    thrown value (`errorFromThrown`, the record save's exit): parity is
 *    compared door against door, never against a literal alone;
 *  - a producer-marked `userMessage` (an app hook's refusal) arrives verbatim
 *    at the envelope's top level; an unmarked refusal carries none;
 *  - `message` is the run's diagnostic, unchanged.
 *
 * ⚠️ Resolves `@objectstack/runtime` and `@objectstack/service-automation`
 * through their BUILT `dist/`: rebuild both before trusting a run — and above
 * all before trusting an ablated one.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from '@objectstack/runtime';
import { AutomationEngine, InMemorySuspendedRunStore, registerCrudNodes } from '@objectstack/service-automation';
import { DuplicateRecordError, ValidationError } from '@objectstack/objectql';
import { PermissionDeniedError } from '@objectstack/plugin-security';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { ApiErrorSchema, FlowFailureDetailsSchema } from '@objectstack/spec/api';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as never;

function createTestLogger(): never {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    return logger as never;
}

const HOOK_USER_TEXT = '该客户名称已被另一位销售代表占用，请联系主管。';

/** The refusals a `create_record` on `crm_account` meets in production. */
const REFUSALS: Array<{ label: string; make: () => Error; code: string; marked?: string }> = [
    {
        label: 'unique (the card\'s measured case)',
        make: () => new DuplicateRecordError('crm_account', new Error('driver: unique violation'), 'name'),
        code: 'UNIQUE_VIOLATION',
    },
    {
        label: 'validation rule',
        make: () => new ValidationError([{ field: 'name', code: 'rule_violation', message: 'Account name is required' } as never]),
        code: 'VALIDATION_FAILED',
    },
    {
        label: 'permission',
        make: () => new PermissionDeniedError("[Security] Access denied: operation 'insert' on object 'crm_account' is not permitted"),
        code: 'PERMISSION_DENIED',
    },
    {
        label: 'an app hook\'s marked refusal',
        make: () => Object.assign(new Error('crm_account.beforeInsert refused: name is reserved'), {
            status: 409, code: 'CRM_ACCOUNT_NAME_RESERVED', userMessage: HOOK_USER_TEXT,
        }),
        code: 'RESOURCE_CONFLICT',
        marked: HOOK_USER_TEXT,
    },
];

const holdDescriptor = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'hold', supportsPause: true, resumeAuthority: 'any',
});

/**
 * start → [hold →] create_account → end, over a data layer whose insert throws
 * `err` — the card's lead-conversion shape (`behindPause`: the write runs after
 * the screen, through the resume door).
 */
function boot(err: Error, behindPause: boolean): HttpDispatcher {
    const engine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
    const data = { insert: async () => { throw err; } };
    registerCrudNodes(engine, { logger: createTestLogger(), getService: (n: string) => (n === 'data' ? data : undefined) } as never);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: holdDescriptor,
        async execute() { return { success: true, suspend: true }; },
    } as never);
    const write = {
        id: 'create_account', type: 'create_record', label: 'Create account',
        config: { objectName: 'crm_account', fields: { name: 'Acme' } },
    };
    engine.registerFlow('lead_conversion', {
        name: 'lead_conversion', label: 'Convert Lead', type: 'autolaunched',
        nodes: behindPause
            ? [{ id: 'start', type: 'start', label: 'Start' }, { id: 'hold', type: 'hold', label: 'Screen' }, write, { id: 'end', type: 'end', label: 'End' }]
            : [{ id: 'start', type: 'start', label: 'Start' }, write, { id: 'end', type: 'end', label: 'End' }],
        edges: behindPause
            ? [
                { id: 'e1', source: 'start', target: 'hold' },
                { id: 'e2', source: 'hold', target: 'create_account' },
                { id: 'e3', source: 'create_account', target: 'end' },
            ]
            : [
                { id: 'e1', source: 'start', target: 'create_account' },
                { id: 'e2', source: 'create_account', target: 'end' },
            ],
    } as never);
    const services: Record<string, unknown> = { automation: engine };
    const resolve = (name: string): unknown => services[name];
    return new HttpDispatcher({
        getService: resolve,
        getServiceAsync: async (name: string): Promise<unknown> => resolve(name),
        context: { getService: resolve },
    } as never);
}

/** The code the DATA door's thrown-error exit answers for `err` — the record save's `error.code`. */
function dataDoorCode(dispatcher: HttpDispatcher, err: Error): string {
    return (dispatcher as any).domainDeps.errorFromThrown(err).body.error.code;
}

describe('#24914 — a refused write inside a flow reaches the wire structured, at the trigger and resume doors', () => {
    for (const r of REFUSALS) {
        it(`trigger door — ${r.label}: 400 FLOW_FAILED, details.innerRefusal { code: ${r.code} }, message unchanged`, async () => {
            const err = r.make();
            const dispatcher = boot(err, false);

            const res = await dispatcher.handleAutomation('/lead_conversion/trigger', 'POST', {}, CTX);

            expect(res.response?.status).toBe(400);
            const error = res.response?.body?.error;
            expect(error?.code).toBe('FLOW_FAILED');
            expect(error?.details?.innerRefusal).toEqual({ code: r.code, message: err.message });
            // ⭐ The record save's code for the SAME throw — door against door.
            expect(error?.details?.innerRefusal?.code).toBe(dataDoorCode(dispatcher, err));
            expect(FlowFailureDetailsSchema.safeParse(error?.details).success).toBe(true);
            expect(ApiErrorSchema.safeParse(error).success).toBe(true);
            // The diagnostic channel: the run's text, byte for byte.
            expect(error?.message).toBe(`Node 'create_account' failed: create_record(crm_account) failed: ${err.message}`);
            if (r.marked !== undefined) {
                expect(error?.userMessage).toBe(r.marked);
                expect(error?.message).not.toContain(r.marked);
            } else {
                expect(error && 'userMessage' in error).toBe(false);
            }
        });

        it(`resume door (a write behind a screen) — ${r.label}: the same structure on the stranded 400`, async () => {
            const err = r.make();
            const dispatcher = boot(err, true);
            const started = await dispatcher.handleAutomation('/lead_conversion/trigger', 'POST', {}, CTX);
            expect(started.response?.status).toBe(200);
            const runId = started.response?.body?.data?.runId as string;

            const res = await dispatcher.handleAutomation(`/lead_conversion/runs/${runId}/resume`, 'POST', {}, CTX);

            expect(res.response?.status).toBe(400);
            const error = res.response?.body?.error;
            expect(error?.code).toBe('FLOW_FAILED');
            expect(error?.details).toMatchObject({ runId, status: 'stranded', repairable: true });
            expect(error?.details?.innerRefusal).toEqual({ code: r.code, message: err.message });
            expect(error?.details?.innerRefusal?.code).toBe(dataDoorCode(dispatcher, err));
            expect(error?.message).toBe(`Node 'create_account' failed: create_record(crm_account) failed: ${err.message}`);
            if (r.marked !== undefined) expect(error?.userMessage).toBe(r.marked);
            else expect(error && 'userMessage' in error).toBe(false);
        });
    }

    it('a write that met a FAULT, not a refusal, carries no inner refusal and no userMessage', async () => {
        const dispatcher = boot(new Error('ECONNREFUSED: could not reach the store'), false);

        const res = await dispatcher.handleAutomation('/lead_conversion/trigger', 'POST', {}, CTX);

        expect(res.response?.status).toBe(400);
        expect(res.response?.body?.error?.code).toBe('FLOW_FAILED');
        expect(res.response?.body?.error?.details?.innerRefusal).toBeUndefined();
        expect('userMessage' in (res.response?.body?.error ?? {})).toBe(false);
    });
});
