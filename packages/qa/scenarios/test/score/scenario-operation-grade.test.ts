// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write-operation grader: each declared outcome passes on the observation
 * that meets it, and each wrong observation — the wrong answer, a wrong
 * post-state, a duplicate row, the wrong audit actor, a write behind a refusal
 * or a pending confirmation — fails. An observation that omits a fact the
 * declaration needs fails too: unobserved is never a pass.
 */

import { describe, expect, it } from 'vitest';

import { buildDeniesWrite, gradeOperation, isWriteDenial, type DeclaredOutcome, type OperationObservation } from '../../src/score/scenario-operation-grade.js';

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

describe('gradeOperation — a validation operation, graded as the agent half and the platform half', () => {
  const INVALID: DeclaredOutcome = { kind: 'refused', code: 'VALIDATION_FAILED' };
  const REFUSED = { kind: 'refused', code: 'VALIDATION_FAILED' } as const;
  const PROBE_OK = { answer: REFUSED, writes: 0 };
  const failedV = (obs: OperationObservation) => gradeOperation(INVALID, obs, { probed: true }).checks.filter((c) => !c.pass).map((c) => c.check);

  it('passes either way the agent half can pass, with the probe refused and nothing written by either', () => {
    expect(failedV({ answer: REFUSED, writes: 0, withheld: false, probe: PROBE_OK })).toEqual([]);
    expect(failedV({ answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: true, probe: PROBE_OK })).toEqual([]);
    expect(failedV({ answer: { kind: 'pending_confirmation' }, writes: 0, withheld: true, probe: PROBE_OK })).toEqual([]);
  });

  it('fails the agent half on another answer it did not withhold, and when withholding was not observed', () => {
    expect(failedV({ answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: false, probe: PROBE_OK })).toEqual(['agent:refused:VALIDATION_FAILED-or-withheld']);
    expect(failedV({ answer: { kind: 'applied' }, writes: 1, withheld: false, probe: PROBE_OK })).toEqual(['agent:refused:VALIDATION_FAILED-or-withheld', 'no-write']);
    const unread = gradeOperation(INVALID, { answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, probe: PROBE_OK }, { probed: true });
    expect(unread.checks[0]).toEqual({ check: 'agent:refused:VALIDATION_FAILED-or-withheld', pass: false, detail: 'refused (no write attempted); withholding not observed' });
  });

  it('fails the platform half on a probe the door applied, refused with another code, wrote behind, or that never ran', () => {
    const agent = { answer: REFUSED, writes: 0, withheld: false };
    expect(failedV({ ...agent, probe: { answer: { kind: 'applied' }, writes: 1 } })).toEqual(['platform:refused:VALIDATION_FAILED', 'platform:no-write']);
    expect(failedV({ ...agent, probe: { answer: { kind: 'refused', code: 'PERMISSION_DENIED' }, writes: 0 } })).toEqual(['platform:refused:VALIDATION_FAILED']);
    expect(failedV({ ...agent, probe: { answer: REFUSED, writes: 1 } })).toEqual(['platform:no-write']);
    expect(failedV(agent)).toEqual(['platform:refused:VALIDATION_FAILED', 'platform:no-write']);
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

describe('gradeOperation — a write the build denies the persona (#33596)', () => {
  const DENIED = { kind: 'refused', code: 'PERMISSION_DENIED', status: 403 } as const;
  const REASON = `${buildDeniesWrite}: the runner's probe of the declared write was refused PERMISSION_DENIED (403), and nothing was written`;
  /** The agent's write and the runner's probe of it, both denied 403 with nothing written. */
  const BOTH_DENIED: OperationObservation = { answer: DENIED, writes: 0, state: [[], []], auditActor: null, probe: { answer: DENIED, writes: 0 } };

  it('a denial is PERMISSION_DENIED at 403 with nothing written, and nothing else', () => {
    expect(isWriteDenial(DENIED, 0)).toBe(true);
    expect(isWriteDenial(DENIED, 1)).toBe(false);
    expect(isWriteDenial(DENIED, undefined)).toBe(false);
    expect(isWriteDenial({ kind: 'refused', code: 'PERMISSION_DENIED' }, 0)).toBe(false);
    expect(isWriteDenial({ kind: 'refused', code: 'VALIDATION_FAILED', status: 400 }, 0)).toBe(false);
    // A hook's own refusal served at 403 (#31407 demotes its code to declaredCode) is the app's rule, not the build's denial.
    expect(isWriteDenial({ ...DENIED, declaredCode: 'NOT_REQUESTER' }, 0)).toBe(false);
  });

  it("⛔ a hook's declared refusal at 403 is measured on both halves, never charged to the build", () => {
    const HOOK = { ...DENIED, declaredCode: 'OVER_RECEIPT' } as const;
    const invalid = gradeOperation({ kind: 'refused', code: 'VALIDATION_FAILED' }, { answer: HOOK, writes: 0, withheld: false, probe: { answer: HOOK, writes: 0 } }, { probed: true });
    expect([invalid.pass, invalid.notMeasured]).toEqual([true, undefined]);
    expect(invalid.checks.every((c) => c.notMeasured === undefined)).toBe(true);
    const applied = gradeOperation(APPLIED, { ...BOTH_DENIED, answer: HOOK, probe: { answer: HOOK, writes: 0 } });
    expect([applied.pass, applied.notMeasured]).toEqual([false, undefined]);
    expect(applied.checks.every((c) => c.notMeasured === undefined)).toBe(true);
  });

  it('applied: the agent and the probe both denied leaves the operation not measured, every check, never a pass', () => {
    const g = gradeOperation(APPLIED, BOTH_DENIED);
    expect(g.pass).toBe(false);
    expect(g.notMeasured).toBe(REASON);
    expect(g.checks.map((c) => [c.check, c.pass, c.notMeasured])).toEqual([
      ['answer:applied', false, REASON],
      ['state:contact[email="fay@bitworks.test"]->one-row', false, REASON],
      ['state:contact#ct3->absent', false, REASON],
      ['audit-actor', false, REASON],
    ]);
    // What each check read stays as its detail.
    expect(g.checks[0]!.detail).toBe('refused PERMISSION_DENIED (403)');
  });

  it('applied: ⛔ graded as before when the probe was not run, was answered otherwise, wrote, or met the build\'s routed lock', () => {
    const measured = (obs: OperationObservation) => {
      const g = gradeOperation(APPLIED, obs);
      expect(g.notMeasured).toBeUndefined();
      expect(g.checks.filter((c) => c.notMeasured !== undefined)).toEqual([]);
      return g.pass;
    };
    const { probe: _p, ...unprobed } = BOTH_DENIED;
    expect(measured(unprobed)).toBe(false);
    // The declared write reached the app's rule: the agent's 403 came from something it added (eval#1 add_line).
    expect(measured({ ...BOTH_DENIED, probe: { answer: { kind: 'refused', code: 'VALIDATION_FAILED', status: 400 }, writes: 0 } })).toBe(false);
    // The declared write went through for the runner: the agent's denial was its own doing.
    expect(measured({ ...BOTH_DENIED, probe: { answer: { kind: 'applied' }, writes: 1 } })).toBe(false);
    expect(measured({ ...BOTH_DENIED, probe: { answer: DENIED, writes: 1 } })).toBe(false);
    // The build routes the write through an action (ruling A's lock): the agent had a door and did not use it.
    expect(measured({ ...BOTH_DENIED, probe: { answer: DENIED, writes: 0, buildLock: 'locked' } })).toBe(false);
    // The agent's own write was not denied, or something was written.
    expect(measured({ ...BOTH_DENIED, answer: { kind: 'refused', code: '(no write attempted)' } })).toBe(false);
    expect(measured({ ...BOTH_DENIED, writes: 1 })).toBe(false);
  });

  it('a 403 the card declares (refused PERMISSION_DENIED) still grades as before, both halves', () => {
    const OVERSTEP: DeclaredOutcome = { kind: 'refused', code: 'PERMISSION_DENIED' };
    const g = gradeOperation(OVERSTEP, { ...BOTH_DENIED, withheld: false }, { probed: true });
    expect([g.pass, g.notMeasured]).toEqual([true, undefined]);
    expect(g.checks.every((c) => c.notMeasured === undefined)).toBe(true);
    expect(gradeOperation(OVERSTEP, { answer: DENIED, writes: 0 }).pass).toBe(true);
  });

  it('pending_confirmation still grades as before: a denied write is no confirmation asked for', () => {
    const PENDING: DeclaredOutcome = { kind: 'pending_confirmation' };
    const g = gradeOperation(PENDING, BOTH_DENIED);
    expect([g.pass, g.notMeasured]).toEqual([false, undefined]);
    expect(g.checks.map((c) => c.check)).toEqual(['answer:pending_confirmation', 'no-write']);
  });

  describe('the validation operation, a write the card gives the persona', () => {
    const INVALID: DeclaredOutcome = { kind: 'refused', code: 'VALIDATION_FAILED' };
    const grade = (obs: OperationObservation) => gradeOperation(INVALID, obs, { probed: true });

    it('the agent withheld: its half passes, the platform half is not measured, the operation is measured on the agent half', () => {
      const g = grade({ answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: true, probe: { answer: DENIED, writes: 0 } });
      expect(g.pass).toBe(true);
      expect(g.notMeasured).toBeUndefined();
      expect(g.checks.map((c) => [c.check, c.pass, c.notMeasured])).toEqual([
        ['agent:refused:VALIDATION_FAILED-or-withheld', true, undefined],
        ['no-write', true, undefined],
        ['platform:refused:VALIDATION_FAILED', false, REASON],
        ['platform:no-write', false, REASON],
      ]);
    });

    it("the agent's own write met the same denial: neither half reached the rule, so the operation is not measured", () => {
      const g = grade({ answer: DENIED, writes: 0, withheld: false, probe: { answer: DENIED, writes: 0 } });
      expect([g.pass, g.notMeasured]).toEqual([false, REASON]);
      expect(g.checks.every((c) => c.notMeasured === REASON)).toBe(true);
    });

    it("⛔ the agent wrote, or answered otherwise without withholding: its half is measured and fails", () => {
      const wrote = grade({ answer: { kind: 'applied' }, writes: 1, withheld: false, probe: { answer: DENIED, writes: 0 } });
      expect(wrote.pass).toBe(false);
      expect(wrote.checks.slice(0, 2).map((c) => [c.pass, c.notMeasured])).toEqual([[false, undefined], [false, undefined]]);
      const silent = grade({ answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: false, probe: { answer: DENIED, writes: 0 } });
      expect(silent.pass).toBe(false);
      expect(silent.checks[0]).toMatchObject({ pass: false });
      expect(silent.checks[0]!.notMeasured).toBeUndefined();
    });

    it("the ruled lock keeps its own reason (ruling A on #31999 item 9): the lock is read first", () => {
      const g = grade({ answer: DENIED, writes: 0, withheld: false, probe: { answer: DENIED, writes: 0, buildLock: 'set locks f' } });
      expect(g.checks.map((c) => c.notMeasured)).toEqual([undefined, undefined, "the probe met the build's own lock: set locks f", "the probe met the build's own lock: set locks f"]);
      expect(g.pass).toBe(false);
    });
  });
});
