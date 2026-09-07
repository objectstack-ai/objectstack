// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15221 — the resume door's `400 FLOW_FAILED` details carry the engine's
 * verdict: `status: 'stranded'` and `repairable`, so a client can branch
 * without a message regex (the #16472 family ruling, maintainer 2026-09-07,
 * option A).
 *
 * The defect, measured on the door before this change: the arm copied
 * `errorMessage` and `summary` off the engine result and dropped `status`, so
 * `AutomationResult.status: 'stranded'` (#14384 — terminally failed BUT
 * repairable by an operator verb) reached the wire as the same `400
 * FLOW_FAILED` a plain terminal failure does. An HTTP-only caller could not
 * tell "beyond reach" from "repair waiting", and the console — which treats
 * `400 FLOW_FAILED` as terminal (#8684) — closed on both.
 *
 * What is pinned, and why each pin is its own case:
 *
 *  1. **The stranded arm carries the structure** — `runId`, `status:
 *     'stranded'`, `repairable: true` — beside the two artefacts that were
 *     already there, and the whole `details` parses under the spec's
 *     `ResumeFailureDetailsSchema`: the discriminator is reachable AND typed,
 *     never prose.
 *  2. **The plain terminal arm is present-and-false, not absent.** The engine
 *     stamps no `status` on its other exit (a subflow child that failed
 *     terminally), so that arm carries `repairable: false` and NO `status` —
 *     the door never synthesises a `'failed'` the producer did not say.
 *  3. **CONTROL against the regex the ruling forbids**: a message that SAYS
 *     "stranded" with no engine verdict answers `repairable: false`. The
 *     door reads the producer's discriminator, never the text.
 *  4. **A stamped `'failed'` is forwarded verbatim** — the door relays, it
 *     does not filter.
 *  5. **The coded refusals are untouched**: every arm that leaves the
 *     suspension intact answers exactly what it did, with no details.
 *  6. **The 200 arms are untouched**: paused and completed relay the result.
 *  7. **The trigger door is untouched** — its `400 FLOW_FAILED` details stay
 *     `{ errorMessage?, summary? }` with no `repairable` at all. Absent there
 *     means "not a resume", never "not repairable"; the discriminator belongs
 *     to the one door where a pause can be consumed.
 *
 * The producer side (`AutomationEngine` stamping `'stranded'` on exactly one
 * exit) is pinned in `service-automation`'s `stranded-run-status.test.ts`; the
 * wire, driven through the real engine, in `@objectstack/verify`'s
 * `automation-resume-stranded-details.test.ts`. This file pins the DOOR's
 * shaping with a fake engine, so each arm can be reached by name.
 */

import { describe, it, expect, vi } from 'vitest';

import { ResumeFailureDetailsSchema } from '@objectstack/spec/api';
import type { AutomationResult } from '@objectstack/spec/contracts';

import { HttpDispatcher } from '../http-dispatcher.js';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;
const RESUME = '/flow_a/runs/run_1/resume';
const TRIGGER = '/flow_a/trigger';

const SUMMARY = {
    nodes: [{ id: 'tail', type: 'tail', status: 'failure', error: 'tail blew up' }],
} as unknown as NonNullable<AutomationResult['summary']>;

function makeDispatcher(resumeResult: AutomationResult, executeResult?: AutomationResult) {
    const spies = {
        resume: vi.fn(async () => resumeResult),
        execute: vi.fn(async () => executeResult ?? { success: true, output: {}, durationMs: 1 }),
    };
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), spies };
}

describe('#15221 — the resume door forwards the engine\'s stranded verdict in the 400 FLOW_FAILED details', () => {
    it('stranded: runId, status and repairable ride beside errorMessage and summary — typed, not prose', async () => {
        const { dispatcher, spies } = makeDispatcher({
            success: false,
            error: 'tail blew up',
            durationMs: 12,
            status: 'stranded',
            errorMessage: 'Please contact support',
            summary: SUMMARY,
        });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(spies.resume).toHaveBeenCalledWith('run_1', {});
        expect(result.response?.status).toBe(400);
        const error = result.response?.body?.error;
        // The code does NOT move: no `FLOW_STRANDED` sibling is minted under
        // the ruling — the console's terminal reading of this code stays true.
        expect(error?.code).toBe('FLOW_FAILED');
        expect(error?.message).toBe('tail blew up');
        // The verdict, by name, off a typed structure.
        expect(error?.details).toEqual({
            runId: 'run_1',
            status: 'stranded',
            repairable: true,
            errorMessage: 'Please contact support',
            summary: SUMMARY,
        });
        // `code` is promoted out of `details` into `error.code` (#3842) — the
        // structure does not smuggle a second copy.
        expect(error?.details?.code).toBeUndefined();
        // Reachable AND typed: the whole `details` object is what a client
        // hands to the spec schema, artefacts included, and gets the verdict.
        const parsed = ResumeFailureDetailsSchema.safeParse(error?.details);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data).toEqual({ runId: 'run_1', status: 'stranded', repairable: true });
        // The message is NOT the carrier: nothing in it says "stranded", and
        // the client did not need it to.
        expect(error?.message).not.toMatch(/strand/i);
        // ADR-0112: no inner envelope for a status-blind caller to misread.
        expect(result.response?.body?.data).toBeUndefined();
    });

    it('plain terminal failure (no engine status): repairable is present-and-false, status is absent — never synthesised', async () => {
        // The shape the engine emits on its OTHER exit into this arm — a
        // subflow child that failed terminally — measured on `resumeInternal`:
        // `{ success: false, error, durationMs }`, no `status`, no artefacts.
        const { dispatcher } = makeDispatcher({
            success: false,
            error: "subflow run 'child_1' (child_flow) failed: boom",
            durationMs: 3,
        });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.code).toBe('FLOW_FAILED');
        // Exactly these two: present-and-false is the contract, and the door
        // did not invent a `'failed'` the producer never stamped.
        expect(result.response?.body?.error?.details).toEqual({ runId: 'run_1', repairable: false });
        expect(ResumeFailureDetailsSchema.safeParse(result.response?.body?.error?.details).success).toBe(true);
    });

    it('CONTROL — a message that says "stranded" with no engine verdict is NOT repairable: the door reads the discriminator, never the text', async () => {
        const { dispatcher } = makeDispatcher({
            success: false,
            error: 'run is stranded — but nobody stamped it',
            durationMs: 3,
        });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.details?.repairable).toBe(false);
        expect(result.response?.body?.error?.details?.status).toBeUndefined();
    });

    it('a stamped `failed` is forwarded verbatim, with repairable false', async () => {
        const { dispatcher } = makeDispatcher({
            success: false,
            error: 'rejected',
            durationMs: 3,
            status: 'failed',
        });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.details).toEqual({ runId: 'run_1', status: 'failed', repairable: false });
    });

    it('the runId names the run this door was asked to resume — the path parameter, not a guess off the result', async () => {
        const { dispatcher, spies } = makeDispatcher({ success: false, error: 'x', durationMs: 1, status: 'stranded' });

        const result = await dispatcher.handleAutomation('/flow_a/runs/run_other_42/resume', 'POST', {}, CTX);

        expect(spies.resume).toHaveBeenCalledWith('run_other_42', {});
        expect(result.response?.body?.error?.details?.runId).toBe('run_other_42');
    });
});

describe('#15221 — every other arm of the door is untouched', () => {
    it.each([
        ['PERMISSION_DENIED', 403],
        ['INVALID_SIGNAL', 400],
        ['INVALID_SCREEN_INPUT', 400],
        ['RUN_NOT_FOUND', 404],
        ['STORE_UNAVAILABLE', 503],
        ['RESUME_IN_PROGRESS', 409],
    ] as const)('coded refusal %s → %i, no details', async (code, status) => {
        // Every coded arm left the suspension intact (or never found one) and
        // is answered BEFORE the terminal arm; none carries the structure,
        // and a `status` a producer might stamp beside a code changes nothing.
        const { dispatcher } = makeDispatcher({ success: false, code, error: `${code}: refused`, status: 'stranded' } as AutomationResult);

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(status);
        expect(result.response?.body?.error?.details).toBeUndefined();
    });

    it('a paused resume still answers 200 with the engine result relayed', async () => {
        const { dispatcher } = makeDispatcher({
            success: true,
            status: 'paused',
            runId: 'run_1',
            screen: { nodeId: 'ask', title: 'Next', fields: [] } as never,
        });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.status).toBe('paused');
        expect(result.response?.body?.data?.runId).toBe('run_1');
        expect(result.response?.body?.error).toBeUndefined();
    });

    it('a completed resume still answers 200 with the engine result relayed', async () => {
        const { dispatcher } = makeDispatcher({ success: true, output: { done: true }, durationMs: 4, summary: SUMMARY });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.output).toEqual({ done: true });
    });

    it('the trigger door\'s 400 FLOW_FAILED details stay { errorMessage?, summary? } — no repairable, because it never resumes', async () => {
        // The deliberate asymmetry, pinned: at a door that never consumes a
        // pause "repairable" has no referent, so the member is ABSENT there —
        // and absent means "not a resume", never "not repairable". Only the
        // resume door says false.
        const { dispatcher, spies } = makeDispatcher(
            { success: true },
            { success: false, error: 'boom', durationMs: 2, status: 'failed', errorMessage: 'Author text', summary: SUMMARY },
        );

        const result = await dispatcher.handleAutomation(TRIGGER, 'POST', {}, CTX);

        expect(spies.execute).toHaveBeenCalled();
        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.code).toBe('FLOW_FAILED');
        expect(result.response?.body?.error?.details).toEqual({ errorMessage: 'Author text', summary: SUMMARY });
        expect(result.response?.body?.error?.details?.repairable).toBeUndefined();
        expect(result.response?.body?.error?.details?.runId).toBeUndefined();
    });
});
