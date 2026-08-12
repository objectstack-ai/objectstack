// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7639 — the wire half of "a paused run's variables are readable on
 * run-detail": `GET /automation/:name/runs/:runId` must carry `variables`
 * through untouched, exactly as it already carries `output` and `steps`.
 *
 * The engine half (the two `status: 'paused'` `recordLog` call sites finally
 * writing the snapshot they already hold) is pinned one package over, in
 * `packages/services/service-automation/src/paused-run-variables.test.ts`. This
 * file pins the surface that serves it, and the two claims that made the change
 * dispatchable rather than a disclosure decision:
 *
 *  1. IDENTICAL ENVELOPE. `output`, `steps` and `variables` are not three
 *     policies — they are one object handed to `deps.success(run)`. There is no
 *     per-field projection, redaction or masking anywhere on this path, so a
 *     field the engine records is a field the caller reads. The test drives one
 *     entry carrying all three and asserts each survives byte-for-byte.
 *  2. IDENTICAL ACCESS CONTROL. The one gate on this read is the #5519
 *     anonymous baseline, which covers the WHOLE `/automation` domain — so
 *     whoever could already read a completed run's `output` here is exactly
 *     whoever can now read a paused run's `variables`, and an anonymous caller
 *     gets neither.
 *
 * If a future change starts shaping one of these fields, the deep-equal
 * assertions below fail — which is the point: the shaping policy for the three
 * must stay one policy.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';

/** A paused run as the engine records it since #7639 — snapshot and all. */
const PAUSED_RUN = {
    id: 'run_7',
    flowName: 'approval_flow',
    flowVersion: 3,
    status: 'paused',
    startedAt: '2026-08-12T02:00:00.000Z',
    durationMs: 42,
    trigger: { type: 'record_change', object: 'crm_order', recordId: 'ord_1', userId: 'user_1' },
    steps: [
        { nodeId: 'start', nodeType: 'start', status: 'success', startedAt: '2026-08-12T02:00:00.000Z' },
        { nodeId: 'stage1', nodeType: 'approval', status: 'success', startedAt: '2026-08-12T02:00:00.010Z' },
    ],
    variables: {
        'stage1.pending_approvers': ['user_ops', 'user_finance'],
        'stage1.decision': { route: 'dual', weights: { ops: 1, finance: 2 }, note: null },
        record: { id: 'ord_1', amount: 90_000 },
        $runId: 'run_7',
        $flowName: 'approval_flow',
    },
} as const;

/** A terminal run, whose `output` this surface has always carried. */
const COMPLETED_RUN = {
    ...PAUSED_RUN,
    id: 'run_8',
    status: 'completed',
    completedAt: '2026-08-12T02:00:01.000Z',
    output: { approved: true, decision: { route: 'dual', weights: { ops: 1, finance: 2 }, note: null } },
} as const;

function makeDispatcher(run: unknown) {
    const getRun = vi.fn(async () => run);
    const services: Record<string, unknown> = { automation: { getRun, handlerReady: true } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), getRun };
}

const CTX = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);
const ANON_CTX = () => ({ request: {}, executionContext: {} } as any);

/** Drive `GET /automation/:flow/runs/:runId` and hand back the raw response. */
async function getRunDetail(run: unknown, context = CTX()) {
    const { dispatcher, getRun } = makeDispatcher(run);
    const { response } = await dispatcher.handleAutomation(
        `approval_flow/runs/${(run as { id: string }).id}`, 'GET', undefined, context, undefined,
    );
    return { response: response as any, getRun };
}

/** The run payload out of the success envelope, whatever the envelope's shape. */
const payloadOf = (response: any) => response?.data ?? response?.body?.data ?? response;

describe('#7639 — GET /automation/:name/runs/:runId serves a paused run WITH its variable snapshot', () => {
    it('passes `variables` through untouched', async () => {
        const { response } = await getRunDetail(PAUSED_RUN);
        const run = payloadOf(response);

        expect(run.status).toBe('paused');
        // The defect this closes: the key was absent from the response entirely.
        expect(run.variables).toBeDefined();
        // Untouched — nested objects, arrays and a null all survive intact. A
        // projection or a redaction anywhere on this path breaks this line.
        expect(run.variables).toEqual(PAUSED_RUN.variables);
    });

    it('shapes `variables` exactly as it shapes `output` and `steps` — not at all', async () => {
        const paused = payloadOf((await getRunDetail(PAUSED_RUN)).response);
        const completed = payloadOf((await getRunDetail(COMPLETED_RUN)).response);

        // One policy for the three fields, which is the whole basis on which
        // adding `variables` is consistency rather than a new disclosure
        // surface: the handler answers with the log entry as recorded.
        expect(completed.output).toEqual(COMPLETED_RUN.output);
        expect(completed.steps).toEqual(COMPLETED_RUN.steps);
        expect(paused.steps).toEqual(PAUSED_RUN.steps);

        // The identical nested value reads back the same whether it arrives via
        // `output` (terminal run) or via `variables` (paused run).
        expect(paused.variables['stage1.decision']).toEqual(completed.output.decision);
    });

    it('gates the snapshot behind the same anonymous baseline as the rest of the domain (#5519)', async () => {
        const { response, getRun } = await getRunDetail(PAUSED_RUN, ANON_CTX());

        // ADR-0112: the refusal's `code` AND its `status`, never just one.
        expect(response.body?.error?.code ?? response.body?.error?.details?.code).toBe('UNAUTHENTICATED');
        expect(response.status).toBe(401);
        // The gate fires ahead of the service, so no snapshot is even read.
        expect(getRun).not.toHaveBeenCalled();
    });
});
