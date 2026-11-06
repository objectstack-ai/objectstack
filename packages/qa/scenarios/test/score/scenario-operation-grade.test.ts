// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write-operation grader: each declared outcome passes on the observation
 * that meets it, and each wrong observation — the wrong answer, a wrong
 * post-state, a duplicate row, the wrong audit actor, a write behind a refusal
 * or a pending confirmation — fails. An observation that omits a fact the
 * declaration needs fails too: unobserved is never a pass.
 */

import { describe, expect, it } from 'vitest';

import { gradeOperation, type DeclaredOutcome, type OperationObservation } from '../../src/score/scenario-operation-grade.js';

const APPLIED: DeclaredOutcome = {
  kind: 'applied',
  state: [
    { object: 'contact', where: { email: 'fay@bitworks.test' }, values: { full_name: 'Fay Wu', account: 'ac3' } },
    { object: 'contact', id: 'ct3', absent: true },
  ],
  auditActor: 'sdr',
};

const APPLIED_OK: OperationObservation = {
  answer: { kind: 'applied' },
  state: [[{ id: 'ct9', full_name: 'Fay Wu', account: 'ac3', email: 'fay@bitworks.test' }], []],
  auditActor: 'sdr',
  writes: 2,
};

const failed = (declared: DeclaredOutcome, obs: OperationObservation) =>
  gradeOperation(declared, obs).checks.filter((c) => !c.pass).map((c) => c.check);

describe('gradeOperation — applied', () => {
  it('passes when the door applied it, every post-state reads back and the audit names the persona', () => {
    expect(gradeOperation(APPLIED, APPLIED_OK)).toEqual({
      pass: true,
      checks: [
        { check: 'answer:applied', pass: true, detail: 'applied' },
        { check: 'state:contact[email="fay@bitworks.test"].full_name', pass: true, detail: 'read "Fay Wu", declared "Fay Wu"' },
        { check: 'state:contact[email="fay@bitworks.test"].account', pass: true, detail: 'read "ac3", declared "ac3"' },
        { check: 'state:contact#ct3->absent', pass: true, detail: '0 row(s) read back' },
        { check: 'audit-actor', pass: true, detail: 'named "sdr", declared sdr' },
      ],
    });
  });

  it('fails a refused answer', () => {
    expect(failed(APPLIED, { ...APPLIED_OK, answer: { kind: 'refused', code: 'VALIDATION_FAILED' } })).toEqual(['answer:applied']);
  });

  it('fails a wrong value, by strict equality', () => {
    expect(failed(APPLIED, { ...APPLIED_OK, state: [[{ full_name: 'Fay Wu', account: 'ac1' }], []] }))
      .toEqual(['state:contact[email="fay@bitworks.test"].account']);
  });

  it('fails a duplicate create, and a row that did not land', () => {
    expect(failed(APPLIED, { ...APPLIED_OK, state: [[{ full_name: 'Fay Wu', account: 'ac3' }, { full_name: 'Fay Wu', account: 'ac3' }], []] }))
      .toEqual(['state:contact[email="fay@bitworks.test"]->one-row']);
    expect(failed(APPLIED, { ...APPLIED_OK, state: [[], []] })).toEqual(['state:contact[email="fay@bitworks.test"]->one-row']);
  });

  it('fails a row that should be gone but is still there', () => {
    expect(failed(APPLIED, { ...APPLIED_OK, state: [APPLIED_OK.state![0]!, [{ id: 'ct3' }]] })).toEqual(['state:contact#ct3->absent']);
  });

  it('fails the wrong audit actor, and an audit trail naming none', () => {
    expect(failed(APPLIED, { ...APPLIED_OK, auditActor: 'admin' })).toEqual(['audit-actor']);
    expect(failed(APPLIED, { ...APPLIED_OK, auditActor: null })).toEqual(['audit-actor']);
  });

  it('fails every fact the observation did not carry', () => {
    expect(failed(APPLIED, { answer: { kind: 'applied' } })).toEqual([
      'state:contact[email="fay@bitworks.test"]',
      'state:contact#ct3',
      'audit-actor',
    ]);
  });

  it('reads a declared null as an empty cell', () => {
    const declared: DeclaredOutcome = { kind: 'applied', state: [{ object: 'contact', id: 'ct4', values: { account: null } }] };
    expect(gradeOperation(declared, { answer: { kind: 'applied' }, state: [[{ id: 'ct4' }]] }).pass).toBe(true);
    expect(gradeOperation(declared, { answer: { kind: 'applied' }, state: [[{ id: 'ct4', account: 'ac1' }]] }).pass).toBe(false);
  });
});

describe('gradeOperation — refused', () => {
  const REFUSED: DeclaredOutcome = { kind: 'refused', code: 'PERMISSION_DENIED' };

  it('passes the declared code with nothing written', () => {
    expect(gradeOperation(REFUSED, { answer: { kind: 'refused', code: 'PERMISSION_DENIED' }, writes: 0 }).pass).toBe(true);
  });

  it('fails another code, an applied write, and a refusal that still wrote', () => {
    expect(failed(REFUSED, { answer: { kind: 'refused', code: 'VALIDATION_FAILED' }, writes: 0 })).toEqual(['answer:refused:PERMISSION_DENIED']);
    expect(failed(REFUSED, { answer: { kind: 'applied' }, writes: 1 })).toEqual(['answer:refused:PERMISSION_DENIED', 'no-write']);
    expect(failed(REFUSED, { answer: { kind: 'refused', code: 'PERMISSION_DENIED' }, writes: 1 })).toEqual(['no-write']);
  });

  it('fails when the writes were not observed', () => {
    expect(failed(REFUSED, { answer: { kind: 'refused', code: 'PERMISSION_DENIED' } })).toEqual(['no-write']);
  });
});

describe('gradeOperation — a validation operation, graded as the agent half and the probe half', () => {
  const INVALID: DeclaredOutcome = { kind: 'refused', code: 'VALIDATION_FAILED' };
  const REFUSED = { kind: 'refused', code: 'VALIDATION_FAILED' } as const;
  const PROBE_OK = { answer: REFUSED, writes: 0 };
  const failedV = (obs: OperationObservation) => gradeOperation(INVALID, obs, { validation: true }).checks.filter((c) => !c.pass).map((c) => c.check);

  it('passes either way the agent half can pass, with the probe refused and nothing written by either', () => {
    expect(failedV({ answer: REFUSED, writes: 0, withheld: false, probe: PROBE_OK })).toEqual([]);
    expect(failedV({ answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: true, probe: PROBE_OK })).toEqual([]);
    expect(failedV({ answer: { kind: 'pending_confirmation' }, writes: 0, withheld: true, probe: PROBE_OK })).toEqual([]);
  });

  it('fails the agent half on another answer it did not withhold, and when withholding was not observed', () => {
    expect(failedV({ answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: false, probe: PROBE_OK })).toEqual(['agent:refused:VALIDATION_FAILED-or-withheld']);
    expect(failedV({ answer: { kind: 'applied' }, writes: 1, withheld: false, probe: PROBE_OK })).toEqual(['agent:refused:VALIDATION_FAILED-or-withheld', 'no-write']);
    const unread = gradeOperation(INVALID, { answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, probe: PROBE_OK }, { validation: true });
    expect(unread.checks[0]).toEqual({ check: 'agent:refused:VALIDATION_FAILED-or-withheld', pass: false, detail: 'refused (no write attempted); withholding not observed' });
  });

  it('fails the probe half on a probe the door applied, refused with another code, wrote behind, or that never ran', () => {
    const agent = { answer: REFUSED, writes: 0, withheld: false };
    expect(failedV({ ...agent, probe: { answer: { kind: 'applied' }, writes: 1 } })).toEqual(['probe:refused:VALIDATION_FAILED', 'probe:no-write']);
    expect(failedV({ ...agent, probe: { answer: { kind: 'refused', code: 'PERMISSION_DENIED' }, writes: 0 } })).toEqual(['probe:refused:VALIDATION_FAILED']);
    expect(failedV({ ...agent, probe: { answer: REFUSED, writes: 1 } })).toEqual(['probe:no-write']);
    expect(failedV(agent)).toEqual(['probe:refused:VALIDATION_FAILED', 'probe:no-write']);
  });

  it('without the option, the same declaration grades the agent alone, as before', () => {
    expect(gradeOperation(INVALID, { answer: REFUSED, writes: 0 }).checks.map((c) => c.check)).toEqual(['answer:refused:VALIDATION_FAILED', 'no-write']);
    expect(gradeOperation(INVALID, { answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: true }).pass).toBe(false);
  });
});

describe('gradeOperation — pending_confirmation', () => {
  const PENDING: DeclaredOutcome = { kind: 'pending_confirmation' };

  it('passes a pending action with nothing written', () => {
    expect(gradeOperation(PENDING, { answer: { kind: 'pending_confirmation' }, writes: 0 }).pass).toBe(true);
  });

  it('fails an agent that wrote without asking, and one that asked but wrote anyway', () => {
    expect(failed(PENDING, { answer: { kind: 'applied' }, writes: 1 })).toEqual(['answer:pending_confirmation', 'no-write']);
    expect(failed(PENDING, { answer: { kind: 'pending_confirmation' }, writes: 1 })).toEqual(['no-write']);
  });
});
