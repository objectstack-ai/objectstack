// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateFlowTriggerReadiness,
  FLOW_TRIGGER_UNKNOWN_OBJECT,
  FLOW_DRAFT_STATUS_AMBIGUOUS,
} from './validate-flow-trigger-readiness.js';

function recordFlow(overrides: Record<string, unknown> = {}) {
  return {
    name: 'candidate_hired',
    type: 'autolaunched',
    nodes: [
      {
        id: 'start',
        type: 'start',
        config: {
          objectName: 'app_candidate',
          triggerType: 'record-after-update',
          condition: 'stage == "hired"',
        },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...overrides,
  };
}

const candidateObject = { name: 'app_candidate', label: 'Candidate', fields: {} };

describe('validateFlowTriggerReadiness', () => {
  it('passes a correctly wired, explicitly active record flow', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [candidateObject],
      flows: [recordFlow({ status: 'active' })],
    });
    expect(findings).toEqual([]);
  });

  it('warns when the target object is not defined in the stack (the silent-miss)', () => {
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.objectName = 'candidate';
    const findings = validateFlowTriggerReadiness({
      objects: [candidateObject],
      flows: [flow],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TRIGGER_UNKNOWN_OBJECT);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain("'candidate'");
    expect(findings[0].path).toBe('flows[0].nodes[0].config.objectName');
  });

  it('does not flag sys_* platform objects as unknown', () => {
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.objectName = 'sys_user';
    const findings = validateFlowTriggerReadiness({
      objects: [candidateObject],
      flows: [flow],
    });
    expect(findings).toEqual([]);
  });

  it('warns when an auto-triggered flow has no explicit status (defaults to draft)', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [candidateObject],
      flows: [recordFlow()],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_DRAFT_STATUS_AMBIGUOUS);
    expect(findings[0].message).toContain("'draft'");
    expect(findings[0].message).toMatch(/still fire/i);
  });

  it('warns on an explicit draft too — defineFlow fills the default before lint runs', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [candidateObject],
      flows: [recordFlow({ status: 'draft' })],
    });
    expect(findings.map((f) => f.rule)).toEqual([FLOW_DRAFT_STATUS_AMBIGUOUS]);
  });

  it('stays quiet on obsolete (deliberately disabled) auto-triggered flows', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [candidateObject],
      flows: [recordFlow({ status: 'obsolete' })],
    });
    expect(findings).toEqual([]);
  });

  it('does not require a status on manual/screen flows (no arming semantics)', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [candidateObject],
      flows: [
        {
          name: 'wizard',
          type: 'screen',
          nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }],
          edges: [{ id: 'e1', source: 'start', target: 'end' }],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('flags schedule and api flows for missing status too', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [],
      flows: [
        {
          name: 'digest',
          type: 'schedule',
          nodes: [
            { id: 'start', type: 'start', config: { schedule: { type: 'interval', intervalMs: 60000 } } },
            { id: 'end', type: 'end' },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'end' }],
        },
      ],
    });
    expect(findings.map((f) => f.rule)).toEqual([FLOW_DRAFT_STATUS_AMBIGUOUS]);
  });

  it('handles map-keyed flows/objects and stacks with no flows', () => {
    expect(validateFlowTriggerReadiness({})).toEqual([]);
    const findings = validateFlowTriggerReadiness({
      objects: { app_candidate: { label: 'C', fields: {} } },
      flows: { hired: recordFlow({ name: undefined, status: 'active' }) },
    });
    expect(findings).toEqual([]);
  });
});
