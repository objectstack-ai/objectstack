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
 * **Rendered, and otherwise byte for byte (#28054).** `flows.mdx` documents both
 * fields as flow text slots: `{{ }}` holes over the run's variables, filled by the
 * engine at the terminal exit, and a single-brace `{var}` refused when the flow
 * registers. Everything else in the string is the author's: this path does no
 * trimming and no HTML-escaping on the way out. So three cases pin it on the
 * wire: a brace-free hostile string (padding, quotes, `&`, `>`) arrives byte for
 * byte; the same string with a `{{ amount }}` hole arrives with the trigger param
 * filled in and every other byte kept; and the single-brace `{amount}` spelling
 * never reaches the wire, because `registerFlow` refuses the flow on the trigger
 * path with its `{{ amount }}` spelling.
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
 * Padding (a trimming probe) and `&`/quotes/`>` (an escaping probe), with no
 * hole and no closed single-brace token: a message with nothing to fill reaches
 * the wire byte for byte.
 */
const PLAIN_HOSTILE = '  Items — "R&D" & 5 > 3, kept verbatim  ';

/**
 * A `{{ amount }}` hole (the render probe), padding (a trimming probe), and
 * `&`/quotes/`>` (an escaping probe) in one string. `amount` is a declared input
 * supplied as a real trigger param below, so the engine fills the hole with it.
 */
const HOSTILE = '  {{ amount }} items — "R&D" & 5 > 3, kept verbatim  ';
/** HOSTILE as the engine renders it with `amount = 42`: the hole filled, every other byte kept. */
const HOSTILE_RENDERED = '  42 items — "R&D" & 5 > 3, kept verbatim  ';
/** The single-brace spelling the flow text slots refuse at registration (#28054). */
const SINGLE_BRACE = '  {amount} items — "R&D" & 5 > 3, kept verbatim  ';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as never;

function createTestLogger(): never {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    return logger as never;
}

/** A one-node flow whose single `script` node passes or fails as asked. */
function bootFlow(opts: { fails: boolean; successMessage?: string; errorMessage?: string; amountInput?: boolean }): HttpDispatcher {
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
        ...(opts.amountInput ? { variables: [{ name: 'amount', type: 'number', isInput: true }] } : {}),
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'work', type: 'script', label: 'Work', config: { function: 'noop' } },
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

    it('carries a message with no hole byte for byte — no trimming, no escaping', async () => {
        // A brace-free hostile string: nothing to render, so the engine's render
        // must hand back every byte the author wrote, padding and `& " >` included.
        const failing = bootFlow({ fails: true, errorMessage: PLAIN_HOSTILE });
        const passing = bootFlow({ fails: false, successMessage: PLAIN_HOSTILE });

        const failed = await trigger(failing, { amount: 42 });
        const passed = await trigger(passing, { amount: 42 });

        expect(failed.response?.body?.error?.details?.errorMessage).toBe(PLAIN_HOSTILE);
        expect(passed.response?.body?.data?.successMessage).toBe(PLAIN_HOSTILE);
        expect(failed.response?.body?.error?.details?.errorMessage).toMatch(/^ {2}Items — "R&D" & 5 > 3/);
        expect(failed.response?.body?.error?.details?.errorMessage).toMatch(/verbatim {2}$/);
    });

    it('fills the `{{ }}` hole with the run\'s variable and keeps every other byte — no trimming, no escaping (#28054)', async () => {
        // `flows.mdx` documents these as flow text slots. `amount` is a declared
        // input supplied as a real trigger param, so the engine fills the hole
        // at the terminal exit; the padding, quotes, `&` and `>` are the author's.
        const failing = bootFlow({ fails: true, errorMessage: HOSTILE, amountInput: true });
        const passing = bootFlow({ fails: false, successMessage: HOSTILE, amountInput: true });

        const failed = await trigger(failing, { amount: 42 });
        const passed = await trigger(passing, { amount: 42 });

        expect(failed.response?.body?.error?.details?.errorMessage).toBe(HOSTILE_RENDERED);
        expect(passed.response?.body?.data?.successMessage).toBe(HOSTILE_RENDERED);
        // Spelled out, because `toBe` on a constant can be read as tautological:
        // the hole is gone, the value is there, and the padding survives.
        expect(failed.response?.body?.error?.details?.errorMessage).not.toContain('{{');
        expect(failed.response?.body?.error?.details?.errorMessage).toMatch(/^ {2}42 items/);
        expect(failed.response?.body?.error?.details?.errorMessage).toMatch(/verbatim {2}$/);
    });

    it('a single-brace `{amount}` never reaches the wire: registerFlow refuses it with its `{{ }}` spelling (#28054)', () => {
        for (const key of ['successMessage', 'errorMessage'] as const) {
            // `toThrow(string)` matches a substring: the door, the key and the judge's own lead.
            expect(() => bootFlow({ fails: false, [key]: SINGLE_BRACE, amountInput: true })).toThrow(
                `flow ${key}: A flow text slot reads`,
            );
            expect(() => bootFlow({ fails: false, [key]: SINGLE_BRACE, amountInput: true })).toThrow(/\{\{ ?amount ?\}\}/);
        }
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
