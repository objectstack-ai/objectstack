// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAssignmentRules,
  ASSIGNMENT_RULE_USER_TARGET,
  ASSIGNMENT_RULE_QUEUE_UNSTAFFED,
} from './validate-assignment-rules.js';
import { explainRule } from './rule-explanations.js';

const rule = (entries: unknown[]) => ({ name: 'case_intake', object: 'crm_case', entries });

describe('validateAssignmentRules (ADR-0142 D5)', () => {
  it('is silent on a stack with no assignment rules', () => {
    expect(validateAssignmentRules({})).toEqual([]);
    expect(validateAssignmentRules({ assignmentRules: 'nonsense' })).toEqual([]);
  });

  it('warns on a user-id target — organization data in package metadata', () => {
    const findings = validateAssignmentRules({
      assignmentRules: [rule([{ name: 'vip', assignTo: { type: 'user', value: 'usr_123' } }])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: ASSIGNMENT_RULE_USER_TARGET,
      where: 'assignment rule "case_intake" · entry "vip"',
      path: 'assignmentRules[0].entries[0].assignTo',
    });
    expect(findings[0].message).toContain("'usr_123'");
    expect(findings[0].hint).toContain("type: 'queue'");
  });

  it('reports a target queue the stack declares with no member', () => {
    const findings = validateAssignmentRules({
      queues: [{ name: 'support_intake', label: 'Support intake', members: [] }],
      assignmentRules: [rule([{ name: 'default', assignTo: { type: 'queue', value: 'support_intake' }, strategy: 'round_robin' }])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'info', rule: ASSIGNMENT_RULE_QUEUE_UNSTAFFED });
    expect(findings[0].message).toContain("queue 'support_intake'");
  });

  it('is silent on a staffed declared queue and on a queue the stack does not declare', () => {
    expect(validateAssignmentRules({
      queues: [{ name: 'support_intake', label: 'Support intake', members: [{ type: 'position', value: 'service_agent' }] }],
      assignmentRules: [rule([
        { name: 'declared', assignTo: { type: 'queue', value: 'support_intake' }, strategy: 'least_loaded', load: 'true' },
        // An organization's own queue: runtime data, not judged.
        { name: 'authored', assignTo: { type: 'queue', value: 'billing' } },
      ])],
    })).toEqual([]);
  });

  it('every rule it emits has an `os explain` entry', () => {
    for (const id of [ASSIGNMENT_RULE_USER_TARGET, ASSIGNMENT_RULE_QUEUE_UNSTAFFED]) {
      expect(explainRule(id), id).toBeTruthy();
    }
  });
});
