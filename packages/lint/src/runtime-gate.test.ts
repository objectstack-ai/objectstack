// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Behaviour of the runtime publish gate (#4463).
//
// The wiring guard (`authoring-rule-wiring.test.ts`) proves the gate READS the
// shared registry. This file proves it FINDS things — the distinction #4449
// was filed about, where a rule was registered, exported, unit-tested and
// produced output on no real stack.

import { describe, it, expect } from 'vitest';
import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';

/** The issue's measured example: an approval flow whose expression approver is broken CEL. */
const brokenApprovalFlow = {
  name: 'leave_approval',
  label: 'Leave approval',
  trigger: { type: 'record_change', object: 'leave_request', events: ['create'] },
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'approve',
      type: 'approval',
      config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
    },
  ],
};

/** The same flow with an approver expression that parses and uses a legal root. */
const cleanApprovalFlow = {
  ...brokenApprovalFlow,
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'approve',
      type: 'approval',
      config: {
        approvers: [{ type: 'expression', value: 'current.owner' }],
        emptyApproverPolicy: 'reject',
      },
    },
  ],
};

const objects = [
  { name: 'leave_request', fields: { owner: { type: 'text' }, status: { type: 'text' } } },
];

describe('runtime publish gate (#4463)', () => {
  it('rejects the issue\'s worked example with a located, fixable finding', () => {
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: brokenApprovalFlow,
      context: { objects },
    });

    const finding = result.errors.find((f) => f.rule === 'approval-expression-invalid');
    expect(
      finding,
      `the broken CEL approver must be REFUSED at the runtime publish gate — this exact body is what ` +
        `#4409 taught the three CLI commands to reject, and what a Studio tenant could still save.`,
    ).toBeDefined();

    // D3: the four keys the 422 envelope carries. A gate that says "no" without
    // saying WHERE and HOW TO FIX is a gate an author routes around.
    expect(finding!.path).toBe('flows[0].nodes[1].config.approvers[0].value');
    expect(finding!.where).toContain('leave_approval');
    expect(finding!.message).toMatch(/does not parse as CEL/);
    expect(finding!.hint.length).toBeGreaterThan(10);
    expect(finding!.severity).toBe('error');
  });

  it('passes the same flow once the expression is valid', () => {
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: cleanApprovalFlow,
      context: { objects },
    });
    expect(result.errors, `a valid flow must publish: ${JSON.stringify(result.errors)}`).toEqual([]);
    // The rules still RAN — "clean" and "nothing ran" must be distinguishable.
    expect(result.rulesRun.length).toBeGreaterThan(0);
  });

  it('runs the four rule families #4463 P1 wired, from the shared table', () => {
    const { rulesRun } = runRuntimeAuthoringRules({
      type: 'flow',
      item: cleanApprovalFlow,
      context: { objects },
    });
    expect(rulesRun).toEqual(runtimeAuthoringRulesFor('flow').map((r) => r.name));
    expect(rulesRun).toContain('validateStackExpressions'); // expression
    expect(rulesRun).toContain('validateApprovalApprovers'); // approval
    expect(rulesRun).toContain('validateFlowTriggerReadiness'); // flow
    expect(rulesRun).toContain('lintFlowPatterns'); // flow
    expect(rulesRun).toContain('validateReferenceIntegrity'); // reference
  });

  it('a rule that gates only `error` leaves warnings out of the blocking set', () => {
    // The empty-approver-policy advisory rides along on both flows above. It
    // must never be a reason to refuse a publish (P1 gates on `error`; P2 puts
    // advisories on the response).
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: brokenApprovalFlow,
      context: { objects },
    });
    expect(result.advisories.every((f) => f.severity !== 'error')).toBe(true);
    expect(result.errors.every((f) => f.severity === 'error')).toBe(true);
  });

  // ── D4: only this write is judged ────────────────────────────────────

  it('does not blame a write for a PRE-EXISTING violation in the context', () => {
    // A tenant's stored object carries a validation rule with broken CEL —
    // written before the gate existed, and legal to keep reading (ADR-0087's
    // asymmetry). Publishing an unrelated flow must not 422 because of it.
    const brokenContext = [
      {
        name: 'leave_request',
        fields: { owner: { type: 'text' } },
        validationRules: [{ name: 'bad', expression: 'record.owner ==', message: 'x' }],
      },
    ];

    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: cleanApprovalFlow,
      context: { objects: brokenContext },
    });

    expect(
      result.errors,
      `the gate blocks NEW writes only (#4463 D4). A stored row's pre-existing violation showing up ` +
        `as an error on somebody else's publish would make the tenant's metadata un-editable, which ` +
        `is a worse outcome than the hole this gate closes.`,
    ).toEqual([]);
  });

  it('still catches the write when the context is ALSO broken', () => {
    // The subtraction must not swallow a real finding just because the context
    // is noisy: the fingerprints differ, so the flow's own error survives.
    const brokenContext = [
      {
        name: 'leave_request',
        fields: { owner: { type: 'text' } },
        validationRules: [{ name: 'bad', expression: 'record.owner ==', message: 'x' }],
      },
    ];
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: brokenApprovalFlow,
      context: { objects: brokenContext },
    });
    expect(result.errors.map((f) => f.rule)).toContain('approval-expression-invalid');
  });

  // ── Dispatch ─────────────────────────────────────────────────────────

  it('runs nothing for a metadata type no rule gates', () => {
    const result = runRuntimeAuthoringRules({ type: 'translation', item: { name: 'x' } });
    expect(result.rulesRun).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('tolerates a body that is not an object', () => {
    for (const item of [null, undefined, 'a string', 42]) {
      expect(runRuntimeAuthoringRules({ type: 'flow', item }).errors).toEqual([]);
    }
  });

  it('works with no object context at all', () => {
    // A host without a registry (a metadata-only store, a test double) still
    // gets the rules that need no object universe, and must not throw.
    const result = runRuntimeAuthoringRules({ type: 'flow', item: brokenApprovalFlow });
    expect(result.errors.map((f) => f.rule)).toContain('approval-expression-invalid');
  });

  it('exposes its dispatch table as data', () => {
    expect(runtimeGatedTypes()).toContain('flow');
    expect(stackKeyForType('flow')).toBe('flows');
    expect(stackKeyForType('no_such_type')).toBeNull();
  });

  it('a rule that throws degrades to a warning instead of failing the write', () => {
    // A gate whose internal error blocks a publish is worse than the hole it
    // closes: the author gets a refusal they cannot act on. Proven through the
    // real dispatch path with a body shaped to break a walk.
    const cyclic: Record<string, unknown> = { name: 'loop', nodes: [] };
    cyclic.self = cyclic;
    expect(() =>
      runRuntimeAuthoringRules({ type: 'flow', item: cyclic, context: { objects } }),
    ).not.toThrow();
  });
});
