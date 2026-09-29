// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AutomationResult.flowLabel` reaches THE WIRE on the doors a flow runner uses.
 *
 * The console's runner names the flow it is running in its header and its
 * completion toast, and translates that name against `flows.<flow>.label`,
 * falling back to the flow's authored label. The runner holds only the API
 * name, so the authored label has to arrive on the response it already reads:
 * `POST /api/v1/automation/:name/trigger` (the launch) and
 * `POST /api/v1/automation/:name/runs/:runId/resume` (every later step).
 *
 * It lives here because `@objectstack/verify` is the one package depending on
 * BOTH `@objectstack/runtime` (the two doors) and
 * `@objectstack/service-automation` (the engine that stamps the member). The
 * engine-side pins are `flow-label-on-result.test.ts` in that package; this
 * file asserts the sentence neither half can alone: the label is ON the
 * response body a runner parses, at `data.flowLabel`.
 *
 * **The served shape at the wire, measured:** every `200` answer carries it —
 * the paused launch, a resume that completes, a terminal launch. The
 * `400 FLOW_FAILED` answers do NOT: those doors project `error.details` from a
 * fixed set (`errorMessage`, `summary`, and on resume the stranded verdict),
 * and no runner surface names the flow on a failure — its failure toast shows
 * the error text. The last case fences that boundary so a widening of the
 * details set is a deliberate act, not a drift.
 *
 * ⚠️ This suite resolves both packages through their BUILT `dist/`. Rebuild
 * `@objectstack/service-automation` and `@objectstack/runtime` before trusting
 * a run of this file — and especially an ABLATED one, where a stale `dist`
 * would run the pre-mutation code and report green.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from '@objectstack/runtime';
import { AutomationEngine, installBuiltinNodes } from '@objectstack/service-automation';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as never;
const WIZARD_LABEL = 'Order Intake Wizard';

function createTestLogger(): never {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    return logger as never;
}

/** A screen flow (start → ask → work → end) whose `work` node passes or fails as asked. */
function boot(opts: { failsAfterScreen?: boolean; screenless?: boolean } = {}): HttpDispatcher {
    const engine = new AutomationEngine(createTestLogger());
    installBuiltinNodes(engine as never, { logger: createTestLogger(), getService: () => undefined } as never);
    engine.registerNodeExecutor({
        type: 'work',
        async execute() {
            return opts.failsAfterScreen ? { success: false, error: 'downstream 503' } : { success: true };
        },
    } as never);
    const ask = { id: 'ask', type: 'screen', label: 'Ask', config: { fields: [{ name: 'kind', label: 'Kind', type: 'text' }] } };
    const nodes = [
        { id: 'start', type: 'start', label: 'Start' },
        ...(opts.screenless ? [] : [ask]),
        { id: 'work', type: 'work', label: 'Work' },
        { id: 'end', type: 'end', label: 'End' },
    ];
    engine.registerFlow('order_intake', {
        name: 'order_intake',
        label: WIZARD_LABEL,
        type: opts.screenless ? 'autolaunched' : 'screen',
        nodes,
        edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
    } as never);

    const services: Record<string, unknown> = { automation: engine };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string): Promise<unknown> => resolve(name),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel as never);
}

const trigger = (d: HttpDispatcher) => d.handleAutomation('/order_intake/trigger', 'POST', {}, CTX);
const resume = (d: HttpDispatcher, runId: string) =>
    d.handleAutomation(`/order_intake/runs/${runId}/resume`, 'POST', { inputs: { kind: 'vip' } }, CTX);

describe('AutomationResult.flowLabel at the wire — the doors a flow runner reads', () => {
    it('200 paused launch: data.flowLabel is the authored label — the runner header\'s source', async () => {
        const res = await trigger(boot());

        expect(res.response?.status).toBe(200);
        expect(res.response?.body?.data?.status).toBe('paused');
        expect(res.response?.body?.data?.screen?.nodeId).toBe('ask');
        expect(res.response?.body?.data?.flowLabel).toBe(WIZARD_LABEL);
    });

    it('200 resume that completes: data.flowLabel is still there — the completion toast\'s source', async () => {
        const dispatcher = boot();
        const paused = await trigger(dispatcher);

        const done = await resume(dispatcher, paused.response?.body?.data?.runId as string);

        expect(done.response?.status).toBe(200);
        expect(done.response?.body?.data?.success).toBe(true);
        expect(done.response?.body?.data?.status).toBeUndefined();
        expect(done.response?.body?.data?.flowLabel).toBe(WIZARD_LABEL);
    });

    it('200 terminal launch of a screenless flow: data.flowLabel, never the API name', async () => {
        const res = await trigger(boot({ screenless: true }));

        expect(res.response?.status).toBe(200);
        expect(res.response?.body?.data?.flowLabel).toBe(WIZARD_LABEL);
        expect(res.response?.body?.data?.flowLabel).not.toBe('order_intake');
    });

    it('400 FLOW_FAILED on resume: the details set is unchanged — no flowLabel (the fenced boundary)', async () => {
        const dispatcher = boot({ failsAfterScreen: true });
        const paused = await trigger(dispatcher);
        expect(paused.response?.body?.data?.flowLabel).toBe(WIZARD_LABEL);

        const failed = await resume(dispatcher, paused.response?.body?.data?.runId as string);

        expect(failed.response?.status).toBe(400);
        expect(failed.response?.body?.error?.code).toBe('FLOW_FAILED');
        expect(failed.response?.body?.error?.details?.status).toBe('stranded');
        expect(failed.response?.body?.error?.details).not.toHaveProperty('flowLabel');
        expect(failed.response?.body?.data).toBeUndefined();
    });
});
