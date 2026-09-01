// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateReadonlyFlowWrites,
  FLOW_UPDATE_READONLY_FIELD,
  FLOW_UPDATE_READONLY_WHEN_FIELD,
} from './validate-readonly-flow-writes.js';

// Target object: a static-readonly field, a conditional readonlyWhen field, and
// a plain writable field. Map-shaped `fields` (the common authoring form).
const opportunityObject = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  fields: {
    approval_status: { type: 'text', readonly: true },
    amount: { type: 'currency', readonlyWhen: "record.stage == 'closed_won'" },
    notes: { type: 'text' },
  },
};

/** A flow with a single `update_record` node (nodes[1]) writing `fields`. */
function flowWith(
  fields: unknown,
  flowOverrides: Record<string, unknown> = {},
  nodeConfigOverrides: Record<string, unknown> = {},
) {
  return {
    name: 'stamp_approval',
    type: 'record_change',
    nodes: [
      { id: 'start', type: 'start', config: {} },
      {
        id: 'stamp',
        type: 'update_record',
        label: 'Stamp approval',
        config: { objectName: 'crm_opportunity', filter: { id: '{recordId}' }, fields, ...nodeConfigOverrides },
      },
      { id: 'end', type: 'end' },
    ],
    edges: [],
    ...flowOverrides,
  };
}

describe('validateReadonlyFlowWrites', () => {
  // ── static readonly → ERROR ──────────────────────────────────────────
  it('errors when a runAs:user update_record writes a static-readonly field', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'user' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
    expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.approval_status');
    expect(findings[0].message).toContain('approval_status');
    expect(findings[0].message).toContain('crm_opportunity');
    expect(findings[0].message).toContain('#2948');
    expect(findings[0].where).toBe('flow "stamp_approval" › node "Stamp approval"');
  });

  it('errors when runAs is unauthored (defaults to user)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved' })], // no runAs
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('resolves the target object via the `object` alias', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'user' }, { objectName: undefined, object: 'crm_opportunity' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
  });

  it('flags each readonly field written in one node', () => {
    const twoReadonly = {
      name: 'crm_case',
      fields: {
        is_sla_violated: { type: 'boolean', readonly: true },
        closed_at: { type: 'datetime', readonly: true },
        subject: { type: 'text' },
      },
    };
    const flow = {
      name: 'close_case',
      type: 'record_change',
      runAs: 'user',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        {
          id: 'u',
          type: 'update_record',
          label: 'Close',
          config: { objectName: 'crm_case', fields: { is_sla_violated: true, closed_at: '{now}', subject: 'x' } },
        },
      ],
      edges: [],
    };
    const findings = validateReadonlyFlowWrites({ objects: [twoReadonly], flows: [flow] });
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
    expect(findings.map((f) => f.path)).toEqual([
      'flows[0].nodes[1].config.fields.is_sla_violated',
      'flows[0].nodes[1].config.fields.closed_at',
    ]);
  });

  it('handles array-shaped object.fields', () => {
    const arrObject = {
      name: 'crm_lead',
      fields: [
        { name: 'converted_account', type: 'lookup', readonly: true },
        { name: 'company', type: 'text' },
      ],
    };
    const flow = {
      name: 'convert',
      type: 'record_change',
      runAs: 'user',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'u', type: 'update_record', label: 'Convert', config: { objectName: 'crm_lead', fields: { converted_account: '{acct}' } } },
      ],
      edges: [],
    };
    const findings = validateReadonlyFlowWrites({ objects: [arrObject], flows: [flow] });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
  });

  // ── readonlyWhen → WARNING ───────────────────────────────────────────
  it('warns (not errors) when writing a readonlyWhen field', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ amount: 5000 }, { runAs: 'user' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_WHEN_FIELD);
    expect(findings[0].message).toContain('#3042');
  });

  // The hint is the WHOLE product of an advisory rule - the finding blocks
  // nothing, so the sentence is all the author acts on. This one used to read
  // "run the flow runAs:'system'", which is advice to widen a write's
  // privileges for NO behaviour change: the conditional strip has no `isSystem`
  // guard at all, so the elevated run drops the field on a locked record
  // exactly as the user run does.
  it('does NOT offer elevation as the remedy — runAs:system does not waive the conditional lock', () => {
    const [finding] = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ amount: 5000 }, { runAs: 'user' })],
    });

    // The refusal, and the reason that makes it checkable rather than a slogan.
    // Pinned against "LOCK 2 - isSystem does NOT exempt a caller-supplied value"
    // in `engine-readonly-when-derived-writes.test.ts`, and the strict-mode
    // sibling's "covers readonlyWhen too - the arm a trusted (isSystem) caller
    // can still hit".
    expect(finding.hint).toContain('Elevation is not a workaround here');
    expect(finding.hint).toContain('NOT waived by a system context');
    expect(finding.hint).not.toMatch(/run the flow runAs:'system'/);

    // The two remedies that DO work, both named — the same pair the action and
    // hook siblings offer. (2) is #9107: the strip judges the CALLER's entry
    // payload, so a hook-derived value lands even on a locked record ("THE
    // REPORT: a hook-derived value on a TRUE readonlyWhen field now LANDS").
    expect(finding.hint).toContain('readonlyWhen predicate is FALSE');
    expect(finding.hint).toContain('beforeUpdate hook');
    expect(finding.hint).toContain('does land, even on a locked record');

    // The static-`readonly` sibling hint keeps recommending runAs:'system',
    // because for THAT strip elevation really is the intended channel. The two
    // disagree for a reason; pinned here so a future sweep cannot flatten them.
    const staticFinding = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'user' })],
    })[0];
    expect(staticFinding.rule).toBe(FLOW_UPDATE_READONLY_FIELD);
    expect(staticFinding.hint).toContain("runAs:'system'");
  });

  it('separates readonly (error) + readonlyWhen (warning) + plain (clean) in one node', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved', amount: 1, notes: 'hi' }, { runAs: 'user' })],
    });
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.severity === 'error')?.path).toBe('flows[0].nodes[1].config.fields.approval_status');
    expect(findings.find((f) => f.severity === 'warning')?.path).toBe('flows[0].nodes[1].config.fields.amount');
  });

  // ── clean: runAs:system is the intended maintenance channel ───────────
  it('does NOT flag a runAs:system flow (elevated writer bypasses the strip)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'system' })],
    });
    expect(findings).toEqual([]);
  });

  // ── clean: create_record is engine-exempt from the readonly strip ─────
  it('does NOT flag create_record writing a readonly field', () => {
    const flow = {
      name: 'seed_opp',
      type: 'record_change',
      runAs: 'user',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'c', type: 'create_record', label: 'Create', config: { objectName: 'crm_opportunity', fields: { approval_status: 'approved' } } },
      ],
      edges: [],
    };
    const findings = validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [flow] });
    expect(findings).toEqual([]);
  });

  // ── clean: plain writable field ──────────────────────────────────────
  it('does NOT flag writes to a plain writable field', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ notes: 'updated' }, { runAs: 'user' })],
    });
    expect(findings).toEqual([]);
  });

  // ── clean: not statically knowable ───────────────────────────────────
  it('skips a templated objectName (dynamic target)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'user' }, { objectName: '{targetObject}' })],
    });
    expect(findings).toEqual([]);
  });

  it('skips a non-literal fields map (dynamic write payload)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith('{allFields}', { runAs: 'user' })],
    });
    expect(findings).toEqual([]);
  });

  it('skips an object not defined in this stack (another package)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [], // crm_opportunity not present
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'user' })],
    });
    expect(findings).toEqual([]);
  });

  // Unknown fields belong to `flow-node-write-unknown-field`
  // (validate-flow-node-writes.ts). Pinned here so the two rules cannot start
  // double-reporting the same key.
  it('does NOT flag an unknown field (the flow-node write rule owns that)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ nonexistent_field: 'x' }, { runAs: 'user' })],
    });
    expect(findings).toEqual([]);
  });

  // ── shape robustness ─────────────────────────────────────────────────
  it('returns [] for a stack with no flows', () => {
    expect(validateReadonlyFlowWrites({ objects: [opportunityObject] })).toEqual([]);
    expect(validateReadonlyFlowWrites({})).toEqual([]);
  });

  it('falls back to node id then index for the location label', () => {
    const flow = {
      name: 'f',
      runAs: 'user',
      nodes: [{ id: 'my_node', type: 'update_record', config: { objectName: 'crm_opportunity', fields: { approval_status: 'x' } } }],
      edges: [],
    };
    const findings = validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [flow] });
    expect(findings[0].where).toBe('flow "f" › node "my_node"');
    expect(findings[0].path).toBe('flows[0].nodes[0].config.fields.approval_status');
  });

  // ── nested regions (#4380) ───────────────────────────────────────────
  // A readonly write inside a `catch` branch is the same certain no-op as one
  // at the top level, and this rule gates on it.
  it('reaches an update_record nested in a try_catch catch branch', () => {
    const flow = {
      name: 'sync',
      runAs: 'user',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        {
          id: 'guard',
          type: 'try_catch',
          label: 'Guard',
          config: {
            try: { nodes: [], edges: [] },
            catch: {
              nodes: [
                {
                  id: 'flag',
                  type: 'update_record',
                  label: 'Flag',
                  config: { objectName: 'crm_opportunity', fields: { approval_status: 'x' } },
                },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    };
    const findings = validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [flow] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.catch.nodes[0].config.fields.approval_status');
    expect(findings[0].where).toBe('flow "sync" › try_catch "Guard" › catch › node "Flag"');
  });

  it('reaches an update_record nested in a loop body', () => {
    const flow = {
      name: 'sweep',
      runAs: 'user',
      nodes: [
        {
          id: 'each',
          type: 'loop',
          label: 'Each',
          config: {
            collection: '{items}',
            body: {
              nodes: [
                { id: 'u', type: 'update_record', label: 'U', config: { objectName: 'crm_opportunity', fields: { amount: 1 } } },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    };
    const findings = validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [flow] });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning'); // readonlyWhen field
    expect(findings[0].path).toBe('flows[0].nodes[0].config.body.nodes[0].config.fields.amount');
  });
});
