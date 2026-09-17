// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17541 — the resume door's `repairable` is answered by the ENGINE on the
 * exits that stamp no `status`, instead of being read off a stamp that is not
 * there (the maintainer's ruling on this card, 2026-09-17, letter 1).
 *
 * ## The defect, as a wire reading
 *
 * `repairable` used to be the single expression `status === 'stranded'`. That
 * word is stamped on exactly one exit — the run that consumed its OWN pause
 * and then threw downstream. The subflow **delegation** exit deliberately
 * stamps nothing: a caller resumes the PARENT, `resumeInternal` forwards the
 * signal down, the child strands, and the parent frame answers
 * `{ success: false, error, durationMs }`, because nothing re-arms an ancestor
 * by resuming it and stamping `'stranded'` there would send an operator to
 * retry a recovery that cannot succeed. Since #15222 that parent's consumed
 * pause IS journalled and `restoreConsumedSuspension(parentRunId)` re-arms the
 * chain as one unit — so the wire answered `repairable: false` about a run the
 * operator verb WILL repair, and a client written exactly as the docs instruct
 * closed it as terminal.
 *
 * ## What this file pins, and what it deliberately does NOT
 *
 * This is the DOOR's shaping, with a fake service, so every arm is reachable
 * by name — including the two that a real engine will not produce on demand (a
 * host with no inspection member; a store the inspection cannot read). The
 * end-to-end fact, driven through the real engine and the HTTP route, is
 * `@objectstack/verify`'s `automation-resume-delegation-repairable.test.ts`;
 * the engine's own halves are `service-automation`'s
 * `nested-strand-chain-restore.test.ts` and
 * `consumed-suspension-inspection.test.ts`.
 *
 * ⛔ The fence #15222 was dispatched with is untouched and is not re-pinned
 * here: a cascade-failed ancestor is still never STAMPED `'stranded'`. Its
 * repairability is carried by the journal and REPORTED by the inspection,
 * which is precisely why the door has to ask instead of reading a word.
 *
 * ⛔ And the door asks a member the CONTRACT declares — `IAutomationService`
 * gained the optional read-only `inspectConsumedSuspension` for this card.
 * Reaching for an undeclared member would be the fail-open shape the route's
 * own `501` arm exists to prevent, so every way of not getting an answer here
 * is FAIL-CLOSED: no member, and a rejected read, both answer `false`.
 *
 * The sibling file `automation-resume-stranded-details.test.ts` is the CONTROL
 * for this change and is deliberately left untouched: every non-delegation
 * exit it pins — the stamped `'stranded'`, the stamped `'failed'`, the
 * status-less arm on a service with no inspection member, the regex control,
 * the trigger door's absent member — still answers exactly what it did.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { ResumeFailureDetailsSchema } from '@objectstack/spec/api';
import type { AutomationResult, IAutomationService } from '@objectstack/spec/contracts';

import { HttpDispatcher } from '../http-dispatcher.js';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;
const RESUME = '/parent_flow/runs/run_parent/resume';

/**
 * The engine's answer on the delegation exit, measured through the real
 * engine while this card was written: the parent frame carries no `status`,
 * no `errorMessage` and no `summary` — only the subflow failure text.
 */
const DELEGATION_FRAME: AutomationResult = {
    success: false,
    error: "subflow run 'run_child' (child_flow) failed: update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found",
    durationMs: 7,
};

type Inspect = NonNullable<IAutomationService['inspectConsumedSuspension']>;

function makeDispatcher(resumeResult: AutomationResult, inspect?: Inspect) {
    const spies = {
        resume: vi.fn(async () => resumeResult),
        ...(inspect ? { inspectConsumedSuspension: vi.fn(inspect) } : {}),
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

afterEach(() => { vi.restoreAllMocks(); });

describe('#17541 — the status-less resume exit asks the engine whether the run is still repairable', () => {
    it('DELEGATION — a frame with no status answers repairable: true when the engine holds the consumed suspension', async () => {
        const { dispatcher, spies } = makeDispatcher(
            DELEGATION_FRAME,
            async (runId: string) => ({ repairable: true, runId }),
        );

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        // The door asked about the run it was addressed to — the path's
        // `:runId`, which on this exit IS the run whose pause was consumed.
        expect(spies.inspectConsumedSuspension).toHaveBeenCalledWith('run_parent');
        expect(result.response?.status).toBe(400);
        const error = result.response?.body?.error;
        expect(error?.code).toBe('FLOW_FAILED');
        // ⛔ Still no `status`: the door relays the producer's stamp and the
        // producer stamped none. `repairable` is the answer, not the word.
        expect(error?.details).toEqual({ runId: 'run_parent', repairable: true });
        expect(ResumeFailureDetailsSchema.safeParse(error?.details).success).toBe(true);
        // Not prose: the message names the subflow failure, not the verdict.
        expect(error?.message).not.toMatch(/repairable/i);
    });

    it('FIRING CONTROL — the same status-less arm answers false when the engine says the suspension is gone', async () => {
        // Without this the pin above would pass over a door that simply
        // flipped the status-less arm to `true` and never asked anything.
        const { dispatcher, spies } = makeDispatcher(
            DELEGATION_FRAME,
            async (runId: string) => ({ repairable: false, runId, reason: 'NO_CONSUMED_SUSPENSION' }),
        );

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(spies.inspectConsumedSuspension).toHaveBeenCalledWith('run_parent');
        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.details).toEqual({ runId: 'run_parent', repairable: false });
    });

    it('FAIL-CLOSED — a service that declares no inspection member answers false, exactly as it did before this card', async () => {
        const { dispatcher } = makeDispatcher(DELEGATION_FRAME);

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.details).toEqual({ runId: 'run_parent', repairable: false });
    });

    it('FAIL-CLOSED — an inspection that REJECTS still answers the 400 it was asked for, with repairable false and one warning', async () => {
        // An unreadable store is UNKNOWN, not "nothing to restore" — so it is
        // said out loud once. ⛔ And it never replaces the answer: the caller
        // asked about a run that failed, and turning a store outage into a
        // 500 would withhold that in order to report a detail.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { dispatcher } = makeDispatcher(
            DELEGATION_FRAME,
            async () => { throw new Error('connection reset'); },
        );

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.code).toBe('FLOW_FAILED');
        expect(result.response?.body?.error?.details).toEqual({ runId: 'run_parent', repairable: false });
        const said = warn.mock.calls.map(c => String(c[0])).filter(l => l.includes('inspectConsumedSuspension'));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain('connection reset');
        expect(said[0]).toContain('run_parent');
    });

    it('CONTROL — a stamped `stranded` is answered by the STAMP: repairable true, and the engine is never asked', async () => {
        const { dispatcher, spies } = makeDispatcher(
            { success: false, error: 'tail blew up', durationMs: 12, status: 'stranded' },
            async (runId: string) => ({ repairable: false, runId, reason: 'NO_CONSUMED_SUSPENSION' }),
        );

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        // The inspection would have answered `false` here. It is not consulted,
        // so the stamp is demonstrably what decided — and the pre-existing
        // exits keep costing exactly one engine call.
        expect(spies.inspectConsumedSuspension).not.toHaveBeenCalled();
        expect(result.response?.body?.error?.details).toEqual({
            runId: 'run_parent', status: 'stranded', repairable: true,
        });
    });

    it('CONTROL — a stamped `failed` is answered by the STAMP: repairable false, and the engine is never asked', async () => {
        const { dispatcher, spies } = makeDispatcher(
            { success: false, error: 'rejected', durationMs: 3, status: 'failed' },
            async (runId: string) => ({ repairable: true, runId }),
        );

        const result = await dispatcher.handleAutomation(RESUME, 'POST', {}, CTX);

        // The inspection would have answered `true` here — a stamped `failed`
        // is a run that ran and was rejected, and no reading of a leftover
        // snapshot is allowed to overturn the producer's own verdict.
        expect(spies.inspectConsumedSuspension).not.toHaveBeenCalled();
        expect(result.response?.body?.error?.details).toEqual({
            runId: 'run_parent', status: 'failed', repairable: false,
        });
    });
});
