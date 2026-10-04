// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21724] A refused flow resume answers the ENGINE's code, on the wire and
 * through `client.automation.resume()`'s `err.code`, never one derived from
 * the HTTP status.
 *
 * The defect, measured at the public door on the stock showcase: the four
 * refusals below answered `400 VALIDATION_ERROR` / `404 RESOURCE_NOT_FOUND`.
 * The engine named each one (`INVALID_SCREEN_INPUT`, `INVALID_SIGNAL`,
 * `RUN_NOT_FOUND`), and the 17.1.0 changelog, this SDK's own `resume()` JSDoc
 * and `flows.mdx` promise those codes, but the resume door's refusal rows
 * handed the error builder a status and no code, so the builder derived the
 * generic member for the status. A caller could not tell `INVALID_SIGNAL` from
 * `INVALID_SCREEN_INPUT`, and the only pin on the door asserted what the code
 * was NOT.
 *
 * Everything here is real end to end, on the pattern of
 * `automation-write-door-parsed-answer.test.ts`: the real `AutomationEngine`
 * with the built-in nodes, the real `HttpDispatcher`, and the real
 * `ObjectStackClient` reading the answer. Only the socket is stubbed: `fetch`
 * hands the request to the dispatcher in-process and returns the producer's
 * own body untouched. A mocked response body would assert this file's own
 * assumption, which is how the status-derived code went unnoticed.
 *
 * ⚠️ `@objectstack/runtime` and `@objectstack/spec` resolve through their
 * BUILT `dist/` here (`KNOWN_UNALIASED_TEST_IMPORTS` in
 * `scripts/check-test-source-alias.mjs`). Rebuild both before trusting a run
 * of this file, and before trusting an ablated one above all: a stale `dist`
 * runs the pre-mutation door and stays green.
 *
 * Each of the four refusals is pinned twice, as separate cases, so a
 * regression in one half cannot hide behind the other:
 *
 *  1. **the code** — read off the rejected `err` (the SDK surface) AND off the
 *     raw wire body, which must parse under the published `ApiErrorSchema`.
 *     That parse is the ledger half: `ApiErrorSchema.code` admits only the
 *     standard catalog and the ADR-0112 ledger, so a code the ledger does not
 *     register fails here by name;
 *  2. **the status and the suspension** — the same status on `err` and on
 *     the wire, the run still reads `paused` after the refusal, and, where the
 *     flow still exists, a corrected resume completes it. The statuses and the
 *     suspension were right before this card; these cases hold them right,
 *     and they stay green when only the code regresses.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
import { HttpDispatcher } from '@objectstack/runtime';
import { ApiErrorSchema } from '@objectstack/spec/api';
import { ObjectStackClient } from './index';

const BASE_URL = 'http://localhost:3000';
const FLOW = 'reassign_wizard';

/** The flow DELETE door demands `manage_metadata` (ADR-0066 D1). The run's
 *  starter is this same user, so the resume caller gate admits every call. */
const CONTEXT = (): any => ({
    request: {},
    executionContext: { userId: 'usr_1', isSystem: false, systemPermissions: ['manage_metadata'] },
});

function silentLogger(): any {
    const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child: () => logger };
    return logger;
}

/** One screen with one required field, the shape of the showcase's
 *  `showcase_reassign_wizard` the card reproduced on. */
function wizardFlow() {
    return {
        name: FLOW,
        label: 'Reassign wizard',
        type: 'screen',
        status: 'active',
        version: 1,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'pick', type: 'screen', label: 'Pick an assignee',
                config: { fields: [{ name: 'new_assignee', label: 'New assignee', type: 'text', required: true }] },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'pick', type: 'default' },
            { id: 'e2', source: 'pick', target: 'end', type: 'default' },
        ],
    };
}

function producerBackedClient() {
    const logger = silentLogger();
    const engine = new AutomationEngine(logger, new InMemorySuspendedRunStore());
    installBuiltinNodes(engine, { logger, getService: () => undefined } as never);
    engine.registerFlow(FLOW, wizardFlow() as never);

    const services: Record<string, unknown> = { automation: engine };
    const resolve = (name: string): unknown => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    const dispatcher = new HttpDispatcher(kernel);

    /** The last RAW wire body, before the SDK unwraps or throws on it. */
    const wire: { last: any } = { last: undefined };

    const fetchImpl = async (url: string, init: RequestInit = {}): Promise<any> => {
        const parsed = new URL(String(url));
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        const query = Object.fromEntries(parsed.searchParams);
        const dispatched = await dispatcher.handleAutomation(
            parsed.pathname.slice('/api/v1/automation'.length), method, body, CONTEXT(), query);
        expect(dispatched.handled, `the dispatcher must serve ${method} ${parsed.pathname}`).toBe(true);
        const status = dispatched.response?.status ?? 500;
        wire.last = dispatched.response?.body;
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: String(status),
            headers: new Headers(),
            json: async () => dispatched.response?.body,
        };
    };

    const client = new ObjectStackClient({ baseUrl: BASE_URL, fetch: fetchImpl as any });
    return { client, engine, wire };
}

type Harness = ReturnType<typeof producerBackedClient>;

/** Trigger the wizard through the real trigger door and return its paused run id. */
async function startPaused(h: Harness): Promise<string> {
    const started: any = await h.client.automation.execute(FLOW, {});
    expect(started.status).toBe('paused');
    expect(typeof started.runId).toBe('string');
    return started.runId;
}


async function rejectionOf(p: Promise<unknown>): Promise<any> {
    return p.then(() => { throw new Error('expected the resume to reject'); }, (e) => e);
}

/** What is left of the suspension after the refusal, per row. */
type Afterwards = 'no run' | 'paused' | 'paused, and a corrected resume completes it';

interface Refusal {
    name: string;
    code: string;
    status: number;
    afterwards: Afterwards;
    /** Drive the refused resume through the client; answer the rejection and the run it addressed. */
    act: (h: Harness) => Promise<{ err: any; runId?: string }>;
}

/** The card's four refusals, driven exactly as it reproduced them. */
const REFUSALS: Refusal[] = [
    {
        name: 'an incomplete screen input',
        code: 'INVALID_SCREEN_INPUT',
        status: 400,
        afterwards: 'paused, and a corrected resume completes it',
        act: async (h) => {
            const runId = await startPaused(h);
            return { runId, err: await rejectionOf(h.client.automation.resume(FLOW, runId, { inputs: {} })) };
        },
    },
    {
        name: 'a signal writing an engine-reserved name',
        code: 'INVALID_SIGNAL',
        status: 400,
        afterwards: 'paused, and a corrected resume completes it',
        act: async (h) => {
            const runId = await startPaused(h);
            const err = await rejectionOf(h.client.automation.resume(FLOW, runId, {
                inputs: { new_assignee: 'x' },
                output: { $User: {} },
            }));
            return { runId, err };
        },
    },
    {
        name: 'an unknown run',
        code: 'RUN_NOT_FOUND',
        status: 404,
        afterwards: 'no run',
        act: async (h) => ({
            err: await rejectionOf(h.client.automation.resume(FLOW, 'run_nope', { inputs: { new_assignee: 'x' } })),
        }),
    },
    {
        name: 'a run whose flow was deleted',
        code: 'RUN_NOT_FOUND',
        status: 404,
        afterwards: 'paused',
        act: async (h) => {
            const runId = await startPaused(h);
            await h.client.automation.delete(FLOW);
            return { runId, err: await rejectionOf(h.client.automation.resume(FLOW, runId, { inputs: { new_assignee: 'x' } })) };
        },
    },
];

describe('#21724 — the code: every refused resume answers the engine\'s own code', () => {
    it.each(REFUSALS)('$name → $code, on err.code and on the wire, and the ledger registers it', async ({ code, act }) => {
        const h = producerBackedClient();

        const { err } = await act(h);

        expect(err.code).toBe(code);
        expect(h.wire.last?.error?.code).toBe(code);
        const parsed = ApiErrorSchema.safeParse(h.wire.last?.error);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
});

describe('#21724 — the status and the suspension are unchanged', () => {
    it.each(REFUSALS)('$name → $status; afterwards: $afterwards', async ({ status, afterwards, act }) => {
        const h = producerBackedClient();

        const { err, runId } = await act(h);

        expect(err.httpStatus).toBe(status);
        expect(h.wire.last?.success).toBe(false);
        expect(h.wire.last?.error?.httpStatus).toBe(status);
        if (afterwards === 'no run') {
            expect(runId).toBeUndefined();
            return;
        }
        expect((await h.engine.getRun(runId!))?.status).toBe('paused');
        if (afterwards === 'paused, and a corrected resume completes it') {
            const done: any = await h.client.automation.resume(FLOW, runId!, { inputs: { new_assignee: 'ada' } });
            expect(done.success).toBe(true);
            expect((await h.engine.getRun(runId!))?.status).toBe('completed');
        }
    });
});
