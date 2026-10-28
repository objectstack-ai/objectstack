// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';

// No approver binding is `unsupported` today (ADR-0142 D6 implemented the
// last one, `queue`), so the `approval-approver-type-unsupported` arm is
// reachable only against a binding table that declares one. This file marks
// `team` unsupported — its own module graph, so the main suite's real table
// is untouched.
vi.mock('@objectstack/spec/automation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@objectstack/spec/automation')>();
  return {
    ...actual,
    APPROVER_VALUE_BINDINGS: { ...actual.APPROVER_VALUE_BINDINGS, team: { source: 'unsupported' } },
  };
});

const { validateApprovalApprovers, APPROVAL_APPROVER_TYPE_UNSUPPORTED } = await import(
  './validate-approval-approvers.js'
);

describe('approval-approver-type-unsupported', () => {
  const [finding] = validateApprovalApprovers({
    flows: [{
      name: 'expense_approval',
      nodes: [{ id: 'step1', type: 'approval', config: { approvers: [{ type: 'team', value: 't1' }] } }],
      edges: [],
    }],
  }).filter((f) => f.rule === APPROVAL_APPROVER_TYPE_UNSUPPORTED);

  it('states the slot and hands an empty slate to onEmptyApprovers, naming no outcome', () => {
    expect(finding.message).toBe(
      "approver type 'team' is declared but not implemented by the runtime: it was deprecated rather " +
        'than built, and is no longer offered for authoring — the slot resolves to nobody, and ' +
        'onEmptyApprovers decides an empty slate.',
    );
  });

  it('never offers an unsupported type as the route, the flagged one included', () => {
    expect(finding.hint).toBe(
      "Route to people the engine can expand: { type: 'position' | 'department' | 'queue', ... }.",
    );
  });
});
