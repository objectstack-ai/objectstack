// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stranded-decision carrier: constructor and recogniser, pinned together
 * (#13807).
 *
 * The pair exists because the producer is `@objectstack/plugin-approvals` and
 * the consumer is the REST approvals door, and rest cannot import a plugin.
 * The risk that creates — and the only one this file is about — is the two
 * sides drifting into a stringly-typed agreement about a property name that
 * nothing checks. Keeping the constructor and the reader in ONE module removes
 * the drift; these pins remove the OTHER failure, a reader tolerant enough to
 * put a half-envelope on the wire.
 */

import { describe, it, expect } from 'vitest';
import { strandedDecisionDetails, strandedDecisionFailure } from './stranded-decision.js';

describe('strandedDecisionFailure / strandedDecisionDetails (#13807)', () => {
    const details = { finalized: true, decision: 'reject', runId: 'run_1', repairable: true } as const;

    it('round-trips the four facts and leaves the message untouched', () => {
        const err = strandedDecisionFailure('RESUME_FAILED: the reject decision was recorded', details);
        expect(err).toBeInstanceOf(Error);
        // The prose is the producer's and stays the producer's: a human reads
        // it in a log, the fields are what a machine reads on the wire, and
        // this carrier added the second without rewriting the first.
        expect(err.message).toBe('RESUME_FAILED: the reject decision was recorded');
        expect(strandedDecisionDetails(err)).toEqual(details);
    });

    it('answers undefined for anything that is not one — the predicate and the payload are one call', () => {
        expect(strandedDecisionDetails(undefined)).toBeUndefined();
        expect(strandedDecisionDetails(null)).toBeUndefined();
        expect(strandedDecisionDetails(new Error('RESUME_FAILED: prose only'))).toBeUndefined();
        expect(strandedDecisionDetails('RESUME_FAILED: a string')).toBeUndefined();
        expect(strandedDecisionDetails({ strandedDecision: 'not an object' })).toBeUndefined();
    });

    it('⛔ refuses a PARTIAL carrier rather than publishing half an envelope', () => {
        // The failure this forecloses is specific: a consumer branching on
        // `finalized === undefined` would read a missing field as "the
        // decision did not stand" — the exact misreading the whole card is
        // about, reintroduced one layer down. All-or-nothing instead.
        const partial = (over: Record<string, unknown>) =>
            strandedDecisionDetails({ strandedDecision: { ...details, ...over } });
        expect(partial({ finalized: undefined })).toBeUndefined();
        expect(partial({ finalized: false })).toBeUndefined();
        expect(partial({ decision: undefined })).toBeUndefined();
        expect(partial({ decision: '' })).toBeUndefined();
        expect(partial({ runId: undefined })).toBeUndefined();
        expect(partial({ runId: '' })).toBeUndefined();
        expect(partial({ repairable: undefined })).toBeUndefined();
        // REVERSE CONTROL for the six above: with nothing overridden the same
        // helper resolves, so the rejections are the override talking and not
        // a reader that refuses everything.
        expect(partial({})).toEqual(details);
    });

    it("carries repairable: false verbatim — ⛔ absence of the engine's signal is not repairability", () => {
        // `repairable` is derived from `AutomationResult.status === 'stranded'`
        // at the producer. A run the engine did NOT call stranded has no
        // journalled snapshot, so the repair verb would refuse it; promising a
        // verb that will refuse is worse than promising nothing.
        const err = strandedDecisionFailure('RESUME_FAILED: …', { ...details, repairable: false });
        expect(strandedDecisionDetails(err)).toEqual({ ...details, repairable: false });
    });

    it('narrows to exactly the four declared keys — a producer cannot smuggle extras onto the wire', () => {
        const err = strandedDecisionFailure('RESUME_FAILED: …', {
            ...details, requestId: 'req_1', internalNote: 'do not publish',
        } as never);
        expect(Object.keys(strandedDecisionDetails(err) ?? {}).sort())
            .toEqual(['decision', 'finalized', 'repairable', 'runId']);
    });
});

describe('the refusal that stranded the run rides the same envelope (#34579)', () => {
    const facts = { finalized: true, decision: 'approve', runId: 'run_1', repairable: true } as const;
    const innerRefusal = { code: 'VALIDATION_FAILED', message: "hook 'h' threw: Error: over_capacity" } as const;
    const userMessage = '产能已被其他订单占用。';

    it('round-trips innerRefusal and userMessage beside the four facts', () => {
        const err = strandedDecisionFailure('RESUME_FAILED: …', { ...facts, innerRefusal, userMessage });
        expect(strandedDecisionDetails(err)).toEqual({ ...facts, innerRefusal, userMessage });
    });

    it('⛔ a malformed refusal member is DROPPED, and the four facts still stand', () => {
        // The four facts are all-or-nothing; the refusal is not one of them. A
        // WHY that is not in the declared shape must not reach the wire, and
        // must not take the truthful WHAT down with it.
        const carrying = (extra: Record<string, unknown>) =>
            strandedDecisionDetails({ strandedDecision: { ...facts, ...extra } });
        expect(carrying({ innerRefusal: { code: 'NOT_A_LEDGER_CODE', message: 'x' } })).toEqual(facts);
        expect(carrying({ innerRefusal: { code: 'VALIDATION_FAILED' } })).toEqual(facts);
        expect(carrying({ innerRefusal: 'VALIDATION_FAILED: x' })).toEqual(facts);
        expect(carrying({ userMessage: '   ' })).toEqual(facts);
        expect(carrying({ userMessage: 42 })).toEqual(facts);
        // REVERSE CONTROL: the well-formed members on the same path resolve.
        expect(carrying({ innerRefusal, userMessage })).toEqual({ ...facts, innerRefusal, userMessage });
    });

    it('⛔ a refusal member never rescues a partial envelope', () => {
        expect(strandedDecisionDetails({ strandedDecision: { ...facts, runId: '', innerRefusal, userMessage } }))
            .toBeUndefined();
    });
});
