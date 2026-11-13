// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { RuntimeAuthoringIssueSchema } from '@objectstack/spec/api';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';

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

// The user sentence of the same arm, reachable only against this file's table.
describe('approval-approver-type-unsupported · user text', async () => {
  const { findingUserMessage, FINDING_USER_TEXT_CATALOG } = await import('./finding-user-text.js');
  const { APPROVAL_APPROVERS_USER_TEXT } = await import('./validate-approval-approvers.user-text.js');
  const { runRuntimeAuthoringRules } = await import('./runtime-gate.js');
  const flow = {
    name: 'expense_approval',
    nodes: [{ id: 'step1', type: 'approval', config: { approvers: [{ type: 'team', value: 't1' }] } }],
    edges: [],
  };
  const [finding] = validateApprovalApprovers({ flows: [flow] }).filter((f) => f.rule === APPROVAL_APPROVER_TYPE_UNSUPPORTED);

  it('carries its params, the routes derived as the hint derives them', () => {
    expect(finding!.userTextParams).toEqual({
      flow: 'expense_approval', node: 'step1', type: 'team', routes: 'position, department, queue',
    });
    expect(FINDING_USER_TEXT_CATALOG[APPROVAL_APPROVER_TYPE_UNSUPPORTED]).toBe(
      APPROVAL_APPROVERS_USER_TEXT[APPROVAL_APPROVER_TYPE_UNSUPPORTED],
    );
  });

  it('renders in every platform locale, naming the type and the routes, never the English floor', () => {
    const english = findingUserMessage(finding!, ['en'])!;
    expect(english).toContain('position, department, queue');
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const text = findingUserMessage(finding!, [tag])!;
      expect(text, tag).not.toMatch(/undefined|\$\{/);
      for (const shown of ['expense_approval', 'step1', 'team', 'position, department, queue']) {
        expect(text, `${tag} names ${shown}`).toContain(shown);
      }
      if (tag !== 'en') expect(text, tag).not.toBe(english);
    }
  });

  it('the flow write returns the advisory, and its userMessage parses as the wire field', () => {
    const advisory = runRuntimeAuthoringRules({ type: 'flow', item: flow }).advisories
      .find((f) => f.rule === APPROVAL_APPROVER_TYPE_UNSUPPORTED)!;
    expect(advisory.userTextParams).toEqual(finding!.userTextParams);
    const issue = RuntimeAuthoringIssueSchema.parse({
      rule: advisory.rule,
      path: advisory.path,
      where: advisory.where,
      message: advisory.message,
      hint: advisory.hint,
      severity: advisory.severity,
      userMessage: findingUserMessage(advisory, ['ko-KR']),
    });
    expect(issue.userMessage).toBe(findingUserMessage(advisory, ['ko']));
  });
});
