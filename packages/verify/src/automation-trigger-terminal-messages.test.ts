// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9414 — the flow author's terminal messages reach THE WIRE on a triggered run.
 *
 * This is the end-to-end half of the repair, and it lives here because
 * `@objectstack/verify` is the one package that already depends on BOTH
 * `@objectstack/runtime` (the trigger route) and `@objectstack/service-automation`
 * (the engine that produces the result). The engine-side pins live in
 * `packages/services/service-automation/src/flow-terminal-messages.test.ts`; the
 * route-side pins, driven with a scripted `AutomationResult`, live in
 * `packages/runtime/src/domains/automation-trigger-route-status.test.ts`. Neither
 * of those, alone or together, asserts the sentence the documentation actually
 * makes — so this file drives a REAL engine through the REAL dispatcher and reads
 * the response body.
 *
 * **The documented promise is the acceptance criterion.**
 * `content/docs/automation/flows.mdx` says, in prose, of the trigger route:
 *
 *   > A `400` additionally carries the flow author's own `errorMessage` (when the
 *   > flow declares one) at `error.details.errorMessage`
 *
 * That sentence was FALSE before this change, and not by a little: the field was
 * *always* absent at the source on the trigger path, because only `resumeInternal`
 * ever produced it. The docs described the declaration; the implementation never
 * honoured it, and three published pages plus two consumers (the trigger route
 * itself, and objectui's `flowResponse.ts`) were written against the description.
 * The repair does not invalidate the documentation — it makes the documentation
 * true. So the assertions below are written against the doc's exact PATH and KEY
 * (`error.details.errorMessage` on a 400, `data.successMessage` on a 200), never
 * against the engine's internal result object: a pin that stops at
 * `AutomationResult` cannot fail when the wire mapping is the half that breaks.
 *
 * **Verbatim is contract too.** `flows.mdx` documents both fields as plain
 * author-declared strings with `{var}` explicitly NOT interpolated. Anything this
 * path did to them on the way out — templating, trimming, HTML-escaping — would
 * contradict the shipped contract, so one case drives a deliberately
 * hostile string and asserts byte identity rather than a substring match.
 *
 * ⚠️ This suite resolves both packages through their BUILT `dist/`, as every
 * dependent of theirs in this workspace does. Rebuild `@objectstack/service-automation`
 * before trusting a run of this file — and especially before trusting an ABLATED
 * one, where a stale `dist` would run the pre-mutation code and report green over
 * a mutation that never reached the artifact.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from '@objectstack/runtime';
import { AutomationEngine } from '@objectstack/service-automation';

const SUCCESS_TEXT = 'Opportunity created — the owner has been notified.';
const ERROR_TEXT = 'We could not create the opportunity — check the amount and try again.';

/** The raw node failure. Deliberately unlike ERROR_TEXT: the two must not be confusable. */
const RAW_FAILURE = 'downstream 503';

/**
 * Braces (a templating probe), padding (a trimming probe), and `&`/quotes/`>`
 * (an escaping probe) in one string. `{amount}` is supplied as a real trigger
 * param below, so an interpolating producer would visibly substitute it.
 */
const HOSTILE = '  {amount} items — "R&D" & 5 > 3, kept verbatim  ';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as never;

function createTestLogger(): never {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    return logger as never;
}

/** A one-node flow whose single `script` node passes or fails as asked. */
function bootFlow(opts: { fails: boolean; successMessage?: string; errorMessage?: string }): HttpDispatcher {
    const engine = new AutomationEngine(createTestLogger());
    engine.registerNodeExecutor({
        type: 'script',
        async execute() {
            return opts.fails ? { success: false, error: RAW_FAILURE } : { success: true, output: { ok: true } };
        },
    } as never);
    engine.registerFlow('notify_owner', {
        name: 'notify_owner',
        label: 'notify_owner',
        type: 'autolaunched',
        ...(opts.successMessage !== undefined ? { successMessage: opts.successMessage } : {}),
        ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'work', type: 'script', label: 'Work' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'work' },
            { id: 'e1', source: 'work', target: 'end' },
        ],
    });

    const services: Record<string, unknown> = { automation: engine };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string): Promise<unknown> => resolve(name),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel as never);
}

/** `POST /api/v1/automation/notify_owner/trigger`, as the SDK and console reach it. */
function trigger(dispatcher: HttpDispatcher, body: Record<string, unknown> = {}) {
    return dispatcher.handleAutomation('/notify_owner/trigger', 'POST', body, CTX);
}

describe('#9414 — a triggered run reaches the wire with the author\'s terminal messages', () => {
    it('400: the author\'s errorMessage arrives at error.details.errorMessage — the documented path', async () => {
        const dispatcher = bootFlow({ fails: true, successMessage: SUCCESS_TEXT, errorMessage: ERROR_TEXT });

        const result = await trigger(dispatcher);

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.code).toBe('FLOW_FAILED');
        // THE documented sentence, asserted at the documented key. Before the
        // repair this was `undefined` for every non-screen flow ever triggered.
        expect(result.response?.body?.error?.details?.errorMessage).toBe(ERROR_TEXT);
        // Beside, not instead of: the raw node failure stays the envelope's
        // human-readable message, so diagnostics do not lose the real cause…
        expect(result.response?.body?.error?.message).toContain(RAW_FAILURE);
        // …and the author's text is NOT folded into it (objectui reads the two
        // from different places and shows them differently).
        expect(result.response?.body?.error?.message).not.toContain(ERROR_TEXT);
        // ADR-0112: no inner envelope for a status-blind caller to misread.
        expect(result.response?.body?.data).toBeUndefined();
    });

    it('200: the author\'s successMessage arrives on the response data', async () => {
        const dispatcher = bootFlow({ fails: false, successMessage: SUCCESS_TEXT, errorMessage: ERROR_TEXT });

        const result = await trigger(dispatcher);

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.success).toBe(true);
        expect(result.response?.body?.data?.successMessage).toBe(SUCCESS_TEXT);
    });

    it('carries both VERBATIM — no templating, no trimming, no escaping', async () => {
        // `flows.mdx` documents these as plain strings with `{var}` explicitly
        // NOT interpolated. `amount` is a real trigger param here, so an
        // interpolating producer would substitute it and this would fail loudly.
        const failing = bootFlow({ fails: true, errorMessage: HOSTILE });
        const passing = bootFlow({ fails: false, successMessage: HOSTILE });

        const failed = await trigger(failing, { amount: 42 });
        const passed = await trigger(passing, { amount: 42 });

        expect(failed.response?.body?.error?.details?.errorMessage).toBe(HOSTILE);
        expect(passed.response?.body?.data?.successMessage).toBe(HOSTILE);
        // Spelled out, because `toBe` on a constant can be read as tautological:
        // the padding survives, and the brace was never a template.
        expect(failed.response?.body?.error?.details?.errorMessage).not.toContain('42');
        expect(failed.response?.body?.error?.details?.errorMessage).toMatch(/^ {2}\{amount\}/);
        expect(failed.response?.body?.error?.details?.errorMessage).toMatch(/verbatim {2}$/);
    });

    it('a flow declaring NO messages gets no invented key — the doc\'s "when the flow declares one" half', async () => {
        // ⚠️ Green before and after the repair, deliberately: it fences the fix
        // rather than demonstrating it. The route omits the key entirely when
        // the engine has nothing to give, so a consumer can still tell "the
        // author wrote one" from "the author did not".
        const dispatcher = bootFlow({ fails: true });

        const result = await trigger(dispatcher);

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.details?.errorMessage).toBeUndefined();
        expect(result.response?.body?.error?.message).toContain(RAW_FAILURE);
    });
});
