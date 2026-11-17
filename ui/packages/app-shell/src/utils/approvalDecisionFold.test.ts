// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * approvalDecisionFold (objectstack#34361) — the three readings the approver
 * band makes off metadata and the served request row.
 */

import { describe, it, expect } from 'vitest';
import { currentStepNumber, isActingApprover, isLeadDecision } from './approvalDecisionFold';

describe('isLeadDecision (objectstack#34361)', () => {
  it('keeps a primary or danger action out of the fold', () => {
    expect(isLeadDecision({ name: 'approval_approve', variant: 'primary' })).toBe(true);
    expect(isLeadDecision({ name: 'approval_reject', variant: 'danger' })).toBe(true);
  });

  it('folds an action that declares no variant, or any other variant', () => {
    expect(isLeadDecision({ name: 'approval_reassign' })).toBe(false);
    expect(isLeadDecision({ name: 'approval_comment', variant: 'secondary' })).toBe(false);
    expect(isLeadDecision({ name: 'x', variant: 'ghost' })).toBe(false);
    expect(isLeadDecision(null)).toBe(false);
  });

  it('reads the variant, not the name', () => {
    // A name the shipped set uses for a decision, without the variant, folds.
    expect(isLeadDecision({ name: 'approval_approve' })).toBe(false);
    // A metadata-only action an author marks primary stays a button.
    expect(isLeadDecision({ name: 'approval_escalate', variant: 'primary' })).toBe(true);
  });
});

describe('isActingApprover (objectstack#34361)', () => {
  it('is true only for an explicit can_act: true', () => {
    expect(isActingApprover({ viewer: { can_act: true, is_submitter: true } })).toBe(true);
    expect(isActingApprover({ viewer: { can_act: false, can_override: true } })).toBe(false);
    expect(isActingApprover({ viewer: { can_act: false, is_submitter: true } })).toBe(false);
  });

  it('cannot tell without a viewer block, and reads that as no', () => {
    expect(isActingApprover({})).toBe(false);
    expect(isActingApprover({ viewer: {} })).toBe(false);
    expect(isActingApprover({ viewer: { can_act: 'true' } })).toBe(false);
    expect(isActingApprover(null)).toBe(false);
  });
});

describe('currentStepNumber (objectstack#34361)', () => {
  it('numbers the current step on the served route from 1', () => {
    const route = {
      steps: [
        { id: 'a', label: 'Manager', state: 'done' },
        { id: 'b', label: 'Finance', state: 'current' },
        { id: 'c', label: 'CFO', state: 'upcoming' },
      ],
      ahead: 'end',
    };
    expect(currentStepNumber({ flow_route: route })).toBe(2);
  });

  it('says nothing when the route is absent or names no current step', () => {
    expect(currentStepNumber({})).toBeUndefined();
    expect(currentStepNumber({ flow_route: { steps: [{ id: 'a', state: 'done' }] } })).toBeUndefined();
    expect(currentStepNumber({ flow_route: { steps: 'nope' } })).toBeUndefined();
    expect(currentStepNumber(undefined)).toBeUndefined();
  });
});
