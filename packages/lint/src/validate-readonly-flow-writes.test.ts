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
  // …for the STATIC strip, and only for it. The engine skips
  // `stripReadonlyFields` under `if (!opCtx.context?.isSystem)`, so an elevated
  // flow maintaining a `readonly:true` column is the intended channel and stays
  // silent. Paired with the `readonlyWhen` case below, which is the OTHER half
  // of the same run identity — the two must not move together (#14201).
  it('does NOT flag a runAs:system flow writing a STATIC readonly field (elevated writer bypasses that strip)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'system' })],
    });
    expect(findings).toEqual([]);
  });

  // ── runAs:system + readonlyWhen → still a WARNING (#14201) ────────────
  // `stripReadonlyWhenFields` is called on the update path with NO `isSystem`
  // guard at all (engine.ts, the #9107 note: "`isSystem` is still NOT an
  // exemption here, unlike the static strip below"), pinned from both sides as
  // "LOCK 2 — isSystem does NOT exempt a caller-supplied value"
  // (`engine-readonly-when-derived-writes.test.ts`) and "covers readonlyWhen
  // too — the arm a trusted (isSystem) caller can still hit"
  // (`engine-readonly-strict-writes.test.ts`). So the elevated flow's write
  // vanishes on a locked record exactly as a user run's does, and the rule that
  // exists to surface that silent no-op has to say so on the very flow class
  // its own hint tells the author elevation cannot save.
  it('warns when a runAs:system flow writes a readonlyWhen field (elevation does NOT waive the conditional strip)', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ amount: 5000 }, { runAs: 'system' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_WHEN_FIELD);
    expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.amount');
    // The message states the run identity it was judged under, so a reader of
    // the finding cannot mistake it for the user-run case.
    expect(findings[0].message).toContain("runAs:'system'");
    expect(findings[0].message).toContain('#3042');
    expect(findings[0].hint).toContain('NOT waived by a system context');
  });

  it('reports ONLY the conditional half for a runAs:system node writing both kinds in one payload', () => {
    const findings = validateReadonlyFlowWrites({
      objects: [opportunityObject],
      flows: [flowWith({ approval_status: 'approved', amount: 5000, notes: 'hi' }, { runAs: 'system' })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.amount');
    expect(findings.some((f) => f.rule === FLOW_UPDATE_READONLY_FIELD)).toBe(false);
  });

  // A field declaring BOTH flags: under `runAs:'system'` the static strip is
  // skipped and the conditional one is not, so the truthful finding is the
  // warning — not silence (the old flow-level skip) and not the error (which
  // would state something false about an elevated write).
  it('falls through to the conditional branch for a field declaring readonly AND readonlyWhen under runAs:system', () => {
    const bothFlags = {
      name: 'crm_opportunity',
      fields: {
        approval_status: { type: 'text', readonly: true, readonlyWhen: "record.stage == 'closed_won'" },
      },
    };
    const systemFindings = validateReadonlyFlowWrites({
      objects: [bothFlags],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'system' })],
    });
    expect(systemFindings).toHaveLength(1);
    expect(systemFindings[0].severity).toBe('warning');
    expect(systemFindings[0].rule).toBe(FLOW_UPDATE_READONLY_WHEN_FIELD);

    // Unchanged for a user run: the static strip applies there, and the certain
    // no-op outranks the conditional one.
    const userFindings = validateReadonlyFlowWrites({
      objects: [bothFlags],
      flows: [flowWith({ approval_status: 'approved' }, { runAs: 'user' })],
    });
    expect(userFindings).toHaveLength(1);
    expect(userFindings[0].severity).toBe('error');
    expect(userFindings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
  });

  // Nesting is orthogonal to run identity: the walk reaches an elevated flow's
  // nested regions on the conditional branch too.
  it('reaches a readonlyWhen write nested in a loop body under runAs:system', () => {
    const flow = {
      name: 'sweep_system',
      runAs: 'system',
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
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('flows[0].nodes[0].config.body.nodes[0].config.fields.amount');
  });

  // create_record under elevation is clean on BOTH branches, for two different
  // reasons: the static strip is skipped by `runAs:'system'` (elevation, not
  // INSERT — see the block below), and a `readonlyWhen` predicate has no prior
  // record to evaluate on an insert.
  it('does NOT flag create_record writing a readonlyWhen field under runAs:system', () => {
    const flow = {
      name: 'seed_opp_system',
      type: 'record_change',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'c', type: 'create_record', label: 'Create', config: { objectName: 'crm_opportunity', fields: { amount: 10 } } },
      ],
      edges: [],
    };
    expect(validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [flow] })).toEqual([]);
  });

  // ── create_record: the STATIC shape is the same certain no-op (#15394) ──
  //
  // This block used to be a GREEN control justified by "create_record is
  // engine-exempt from the readonly strip", then (after #14147) a GREEN control
  // that named itself a scan gap. The maintainer ruling of 2026-09-03 (option C)
  // put `stripReadonlyFields` inside `engine.insert` for a non-system caller,
  // and a `create_record` node without `runAs:'system'` is exactly that caller:
  // the row lands WITHOUT the column and the step reports success (measured end
  // to end in service-automation's `create-record-readonly-drop.test.ts`). So
  // the case FLIPS to red here, at the severity the static shape carries on
  // `update_record` — and its conditional-shape twins below stay green, because
  // the engine still runs no `readonlyWhen` strip on INSERT.
  describe('create_record', () => {
    const createFlow = (fields: Record<string, unknown>, flowOverrides: Record<string, unknown> = {}, config: Record<string, unknown> = {}) => ({
      name: 'seed_opp',
      type: 'record_change',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'c', type: 'create_record', label: 'Create', config: { objectName: 'crm_opportunity', fields, ...config } },
      ],
      edges: [],
      ...flowOverrides,
    });

    it('errors when a runAs:user create_record writes a static-readonly field — flipped from the #15394 GREEN control', () => {
      const findings = validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [createFlow({ approval_status: 'approved' }, { runAs: 'user' })] });
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
      expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.approval_status');
      expect(findings[0].where).toBe('flow "seed_opp" › node "Create"');
      // The message states the verb it was judged on and what actually happens
      // — the row is created without the column — not the update sentence.
      expect(findings[0].message).toContain('INSERT');
      expect(findings[0].message).toContain('created WITHOUT this column');
      // No tracker id in the string an author reads (`check:doc-authoring`);
      // the ruling's id lives in the rule's comment.
      expect(findings[0].message).not.toMatch(/#\d{4,}/);
      expect(findings[0].message).not.toContain('UPDATE payload (#2948)');
      // The remedy names the create verb, the system channel and the own-object
      // beforeInsert stamp.
      expect(findings[0].hint).toContain("runAs:'system'");
      expect(findings[0].hint).toContain('create_record');
      expect(findings[0].hint).toContain('beforeInsert');
    });

    it('errors when runAs is unauthored (defaults to user) — same as update_record', () => {
      const findings = validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [createFlow({ approval_status: 'approved' })] });
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
    });

    it('resolves the create target via the `object` alias, exactly like update_record', () => {
      const findings = validateReadonlyFlowWrites({
        objects: [opportunityObject],
        flows: [createFlow({ approval_status: 'approved' }, { runAs: 'user' }, { objectName: undefined, object: 'crm_opportunity' })],
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
    });

    // The elevation exemption gates the static branch on create exactly as on
    // update: a `runAs:'system'` create legitimately SEEDS a readonly column
    // (the runtime measurement's second case: "seeding a readonly column at
    // create time is a SYSTEM act").
    it('does NOT flag a runAs:system create_record writing a static-readonly field (the intended seeding channel)', () => {
      expect(validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [createFlow({ approval_status: 'approved' }, { runAs: 'system' })] })).toEqual([]);
    });

    // ⛔ No conditional finding on a create: the engine runs no `readonlyWhen`
    // strip on INSERT ("INSERT stays exempt", engine.ts), so a warning here
    // would state something false about a write that lands. The control is the
    // same payload on an update_record, which does draw the warning.
    it('does NOT warn on a runAs:user create_record writing a readonlyWhen field — INSERT stays exempt from the conditional strip', () => {
      expect(validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [createFlow({ amount: 10 }, { runAs: 'user' })] })).toEqual([]);
      const control = validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [flowWith({ amount: 10 }, { runAs: 'user' })] });
      expect(control).toHaveLength(1);
      expect(control[0].rule).toBe(FLOW_UPDATE_READONLY_WHEN_FIELD);
    });

    it('separates readonly (error) + readonlyWhen (silent) + plain (clean) in one create_record', () => {
      const findings = validateReadonlyFlowWrites({
        objects: [opportunityObject],
        flows: [createFlow({ approval_status: 'approved', amount: 10, notes: 'hi' }, { runAs: 'user' })],
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
      expect(findings[0].path).toBe('flows[0].nodes[1].config.fields.approval_status');
    });

    // Where create and update DIFFER under elevation: a field declaring BOTH
    // flags falls through to the conditional warning on an elevated update
    // (the strip that is not waived), but is clean on an elevated create — no
    // static strip (elevation) and no conditional strip (INSERT) apply.
    it('is clean for a field declaring readonly AND readonlyWhen under runAs:system — unlike the same update_record', () => {
      const bothFlags = {
        name: 'crm_opportunity',
        fields: { approval_status: { type: 'text', readonly: true, readonlyWhen: "record.stage == 'closed_won'" } },
      };
      expect(validateReadonlyFlowWrites({ objects: [bothFlags], flows: [createFlow({ approval_status: 'approved' }, { runAs: 'system' })] })).toEqual([]);
      const updateControl = validateReadonlyFlowWrites({ objects: [bothFlags], flows: [flowWith({ approval_status: 'approved' }, { runAs: 'system' })] });
      expect(updateControl).toHaveLength(1);
      expect(updateControl[0].rule).toBe(FLOW_UPDATE_READONLY_WHEN_FIELD);
      // ...and under a user run the static error outranks, on both verbs.
      const userCreate = validateReadonlyFlowWrites({ objects: [bothFlags], flows: [createFlow({ approval_status: 'approved' }, { runAs: 'user' })] });
      expect(userCreate).toHaveLength(1);
      expect(userCreate[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
    });

    it('reaches a create_record nested in a loop body', () => {
      const flow = {
        name: 'fan_out',
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
                  { id: 'c', type: 'create_record', label: 'C', config: { objectName: 'crm_opportunity', fields: { approval_status: 'approved' } } },
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
      expect(findings[0].path).toBe('flows[0].nodes[0].config.body.nodes[0].config.fields.approval_status');
      expect(findings[0].where).toBe('flow "fan_out" › loop "Each" › body › node "C"');
    });

    // The engine's create-side strip does not judge a PLATFORM object at all
    // (`staticReadonlyInsertSubject`: `managedBy` set, or a `sys_` name — its
    // own 403 write guard governs it), so a create finding there would
    // describe a strip that never runs. The UPDATE path applies no such
    // exclusion, which the update controls pin.
    it.each([
      ['a sys_ object', { name: 'sys_audit_entry', fields: { verdict: { type: 'text', readonly: true } } }],
      ['a managedBy object', { name: 'audit_entry', managedBy: 'engine-owned', fields: { verdict: { type: 'text', readonly: true } } }],
    ])('does NOT flag a create_record into %s — outside the create-side strip; the same update_record is still flagged', (_label, platformObject) => {
      const create = {
        name: 'seed_audit',
        runAs: 'user',
        nodes: [{ id: 'c', type: 'create_record', label: 'C', config: { objectName: platformObject.name, fields: { verdict: 'ok' } } }],
        edges: [],
      };
      expect(validateReadonlyFlowWrites({ objects: [platformObject], flows: [create] })).toEqual([]);
      const update = {
        ...create,
        nodes: [{ id: 'u', type: 'update_record', label: 'U', config: { objectName: platformObject.name, filter: { id: '{id}' }, fields: { verdict: 'ok' } } }],
      };
      const control = validateReadonlyFlowWrites({ objects: [platformObject], flows: [update] });
      expect(control).toHaveLength(1);
      expect(control[0].rule).toBe(FLOW_UPDATE_READONLY_FIELD);
    });

    it('skips a templated objectName and a non-literal fields map on create, as on update', () => {
      expect(validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [createFlow({ approval_status: 'x' }, { runAs: 'user' }, { objectName: '{target}' })] })).toEqual([]);
      expect(validateReadonlyFlowWrites({ objects: [opportunityObject], flows: [createFlow('{payload}' as unknown as Record<string, unknown>, { runAs: 'user' })] })).toEqual([]);
    });
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
