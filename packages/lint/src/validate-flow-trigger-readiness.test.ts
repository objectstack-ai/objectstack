// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { TimeRelativeTriggerSchema } from '@objectstack/spec/automation';
import {
  validateFlowTriggerReadiness,
  FLOW_TRIGGER_UNKNOWN_OBJECT,
  FLOW_DRAFT_STATUS_AMBIGUOUS,
  FLOW_TRIGGER_UNKNOWN_EVENT,
  FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
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

  it('treats a time-relative flow (config.timeRelative) as auto-triggered — flags missing status', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [{ name: 'contracts', label: 'Contracts', fields: {} }],
      flows: [
        {
          name: 'renewal_alert',
          type: 'schedule',
          nodes: [
            {
              id: 'start',
              type: 'start',
              config: {
                timeRelative: { object: 'contracts', dateField: 'end_date', offsetDays: [60, 30, 7] },
              },
            },
            { id: 'end', type: 'end' },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'end' }],
        },
      ],
    });
    expect(findings.map((f) => f.rule)).toEqual([FLOW_DRAFT_STATUS_AMBIGUOUS]);
  });

  it('warns when a time-relative flow sweeps an object the stack does not define', () => {
    const findings = validateFlowTriggerReadiness({
      objects: [{ name: 'contracts', label: 'Contracts', fields: {} }],
      flows: [
        {
          name: 'renewal_alert',
          type: 'schedule',
          status: 'active',
          nodes: [
            {
              id: 'start',
              type: 'start',
              config: {
                timeRelative: { object: 'contract', dateField: 'end_date', withinDays: 60 },
              },
            },
            { id: 'end', type: 'end' },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'end' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TRIGGER_UNKNOWN_OBJECT);
    expect(findings[0].message).toContain("'contract'");
    expect(findings[0].path).toBe('flows[0].nodes[0].config.timeRelative.object');
    // The SHAPE is canonical, so the descriptor rule stays out of it — the two
    // halves of 1b decide different facts and must not both fire on one.
    expect(TimeRelativeTriggerSchema.safeParse({
      object: 'contract', dateField: 'end_date', withinDays: 60,
    }).success).toBe(true);
    expect(findings.some((f) => f.rule === FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID)).toBe(false);
  });

  // ── #5496 — the descriptor's SHAPE ────────────────────────────────────────
  //
  // `TimeRelativeTriggerSchema` is the only thing that can judge a
  // `config.timeRelative` descriptor (the node `config` slot is open by design,
  // ADR-0018, so no outer flow gate sees inside it), and until this rule the only
  // place it ran was BIND time — one warn in a server log, nothing in
  // `os validate`. These tests pin the forwarding, not a second copy of the
  // shape: where a message is asserted it is asserted against what the schema
  // itself produces, so the rule cannot drift from the contract it speaks for.
  describe('config.timeRelative descriptor shape (#5496)', () => {
    /** The stack from the issue: `task` EXISTS, flow is active and runs as system. */
    function timeRelativeStack(timeRelative: unknown, objectName = 'task') {
      return {
        objects: [{ name: objectName, label: 'Task', fields: {} }],
        flows: [
          {
            name: 'task_due_reminder',
            type: 'schedule',
            status: 'active',
            runAs: 'system',
            nodes: [
              { id: 'start', type: 'start', config: { timeRelative } },
              { id: 'end', type: 'end' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
          },
        ],
      };
    }

    /** The exact descriptor #5496 was filed for — three separate zod issues. */
    const badDescriptor = { object: 'task', field: 'due_at', offsetDays: -1 };

    it('flags the descriptor from #5496 and names every key zod named', () => {
      const findings = validateFlowTriggerReadiness(timeRelativeStack(badDescriptor));
      expect(findings).toHaveLength(1);
      const [f] = findings;
      expect(f.rule).toBe(FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID);
      expect(f.severity).toBe('warning');
      // Criterion 1: the finding NAMES config.timeRelative, in both channels the
      // CLI prints (`• where: message` then `at path`).
      expect(f.path).toBe('flows[0].nodes[0].config.timeRelative');
      expect(f.message).toContain('config.timeRelative');
      expect(f.where).toBe('flow "task_due_reminder" › start node');
      // …and carries zod's own key names: the missing `dateField`, the scalar
      // `offsetDays`, and the unrecognized `field` with the schema's suggestion.
      expect(f.message).toContain('dateField: Invalid input: expected string, received undefined');
      expect(f.message).toContain('offsetDays: Invalid input: expected array, received number');
      expect(f.message).toContain('Unrecognized key(s)');
      expect(f.message).toContain('`field`');
      expect(f.message).toContain('Did you mean `field` → `dateField`?');
      // The consequence, which is the whole reason this is not just a log line.
      expect(f.message).toMatch(/never runs/);
      expect(f.hint).toContain('TimeRelativeTriggerSchema');
    });

    it('forwards the schema verbatim rather than restating it (anti-drift pin)', () => {
      // Every problem segment is `TimeRelativeTriggerSchema`'s own text, rendered
      // the way `TimeRelativeTrigger.start()` renders the identical issue list at
      // bind time. Derived from the schema HERE too, so this assertion tracks the
      // contract instead of freezing today's wording: if the schema's message for
      // a rejected descriptor changes, the rule's output changes with it and this
      // test keeps passing — but a hand-written copy in the rule would not.
      const parsed = TimeRelativeTriggerSchema.safeParse(badDescriptor);
      expect(parsed.success).toBe(false);
      const expected = parsed.error!.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message.replace(/\s+/g, ' ').trim()}`)
        .join('; ');
      const [f] = validateFlowTriggerReadiness(timeRelativeStack(badDescriptor));
      expect(f.message).toContain(expected);
      // Single-line, so the CLI's bulleted list stays aligned (the schema's
      // guidance bullets arrive with newlines in them).
      expect(f.message).not.toContain('\n');
      expect(f.hint).not.toContain('\n');
    });

    it('stays silent on the canonical descriptors — including the ones shipped in the repo', () => {
      // Criterion 2. Each is pinned against the schema as well as against the
      // rule, so a fixture cannot rot into an unbindable descriptor and keep this
      // test green for the wrong reason (#4966's lesson, one layer down).
      const canonical: Array<[string, Record<string, unknown>]> = [
        ['#5496 acceptance shape', { object: 'task', dateField: 'due_at', offsetDays: [-1] }],
        // examples/app-showcase `Task Due Reminder` (#1874) — the showcase flow
        // criterion 2 names by hand.
        ['showcase Task Due Reminder', {
          object: 'task',
          dateField: 'due_date',
          offsetDays: [3, 1],
          filter: { status: { $ne: 'done' } },
        }],
        // content/docs/references/automation/time-relative-trigger.mdx, all three
        // examples, and content/docs/automation/flows.mdx's `renewalReminder`.
        ['docs T-minus example', {
          object: 'task', dateField: 'end_date', offsetDays: [60, 30, 7], filter: { status: 'active' },
        }],
        ['docs expiring-soon example', { object: 'task', dateField: 'expires_on', withinDays: 30 }],
        ['docs overdue example', {
          object: 'task', dateField: 'due_date', withinDays: -14, filter: { status: 'open' },
        }],
        ['with maxRecords', { object: 'task', dateField: 'due_at', withinDays: 7, maxRecords: 50 }],
      ];
      for (const [label, descriptor] of canonical) {
        expect(TimeRelativeTriggerSchema.safeParse(descriptor).success, `${label} must be spec-valid`).toBe(true);
        expect(validateFlowTriggerReadiness(timeRelativeStack(descriptor)), label).toEqual([]);
      }
    });

    it('reports a wrong object name and a wrong shape as two facts, not one twice', () => {
      // Criterion 3. `contract` is not in the stack AND the descriptor does not
      // parse. The two findings are distinguishable by rule id and by path, and
      // neither restates the other's fact: the unknown-object warning says nothing
      // about the shape, and the schema — which has no stack knowledge — cannot
      // say anything about the name.
      const findings = validateFlowTriggerReadiness(
        timeRelativeStack({ object: 'contract', field: 'end_date', withinDays: 60 }),
      );
      expect(findings).toHaveLength(2);
      expect(findings.map((f) => f.rule)).toEqual([
        FLOW_TRIGGER_UNKNOWN_OBJECT,
        FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
      ]);
      expect(findings.map((f) => f.path)).toEqual([
        'flows[0].nodes[0].config.timeRelative.object',
        'flows[0].nodes[0].config.timeRelative',
      ]);
      // The name warning talks only about the name…
      expect(findings[0].message).toContain("'contract'");
      expect(findings[0].message).not.toContain('dateField');
      // …and the shape warning only about the shape (it never echoes the name).
      expect(findings[1].message).toContain('dateField');
      expect(findings[1].message).not.toContain("'contract'");
    });

    it('forwards the exactly-one-window rule (both modes, and neither)', () => {
      for (const descriptor of [
        { object: 'task', dateField: 'due_at', withinDays: 3, offsetDays: [1] },
        { object: 'task', dateField: 'due_at' },
      ]) {
        const findings = validateFlowTriggerReadiness(timeRelativeStack(descriptor));
        expect(findings.map((f) => f.rule)).toEqual([FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID]);
        expect(findings[0].message).toContain('exactly one of `withinDays`');
      }
    });

    it("forwards the schema's wrong-layer guidance for a `schedule` written INSIDE the descriptor", () => {
      // The cadence knob is a SIBLING of `timeRelative` on the same config. The
      // schema carries that prescription; the value of forwarding is that the
      // author reads it from `os validate` instead of from a server log.
      const findings = validateFlowTriggerReadiness(
        timeRelativeStack({
          object: 'task',
          dateField: 'due_at',
          withinDays: 3,
          schedule: { type: 'cron', expression: '0 8 * * *' },
        }),
      );
      expect(findings.map((f) => f.rule)).toEqual([FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID]);
      expect(findings[0].message).toContain('`schedule` is a sibling of `timeRelative`');
    });

    it('flags an array descriptor — the engine routes it, so the trigger refuses it', () => {
      const findings = validateFlowTriggerReadiness(timeRelativeStack([{ object: 'task' }]));
      expect(findings.map((f) => f.rule)).toEqual([FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID]);
      expect(findings[0].message).toContain('expected object, received array');
    });

    it('says nothing about a non-object timeRelative — the engine does not route it here', () => {
      // `AutomationEngine`'s trigger resolution requires `typeof … === 'object'`,
      // so `timeRelative: 'daily'` never reaches the time-relative trigger and no
      // descriptor verdict applies to it. Whatever that flow's defect is, it is
      // not this rule's, and guessing here would make the rule speak for flows
      // the engine hands somewhere else.
      const findings = validateFlowTriggerReadiness(timeRelativeStack('daily'));
      expect(findings.some((f) => f.rule === FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID)).toBe(false);
    });

    it('is inert on flows that declare no timeRelative at all', () => {
      const findings = validateFlowTriggerReadiness({
        objects: [candidateObject],
        flows: [recordFlow({ status: 'active' })],
      });
      expect(findings).toEqual([]);
    });

    it('still flags the draft-status ambiguity alongside a bad descriptor', () => {
      const stack = timeRelativeStack(badDescriptor);
      delete (stack.flows[0] as Record<string, unknown>).status;
      const findings = validateFlowTriggerReadiness(stack);
      expect(findings.map((f) => f.rule)).toEqual([
        FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
        FLOW_DRAFT_STATUS_AMBIGUOUS,
      ]);
    });
  });

  it('passes the record-after-write (create-OR-update) token (#3427)', () => {
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = 'record-after-write';
    const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    expect(findings).toEqual([]);
  });

  it('flags a record-lifecycle-shaped token with a typo op that never fires', () => {
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = 'record-after-updated';
    const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_TRIGGER_UNKNOWN_EVENT);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain("'record-after-updated'");
    expect(findings[0].message).toMatch(/never fires/i);
    expect(findings[0].path).toBe('flows[0].nodes[0].config.triggerType');
  });

  it('flags any invalid op on either phase (before/after)', () => {
    const mk = (tt: string) => {
      const flow = recordFlow({ status: 'active' });
      (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = tt;
      return validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    };
    expect(mk('record-before-frobnicate').map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNKNOWN_EVENT]);
    expect(mk('record-after-writes').map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNKNOWN_EVENT]);
  });

  it('does not flag the canonical firing tokens (incl. insert synonym)', () => {
    for (const tt of [
      'record-after-create',
      'record-after-insert',
      'record-after-update',
      'record-before-update',
      'record-after-delete',
      'record-after-write',
      'record-before-write',
    ]) {
      const flow = recordFlow({ status: 'active' });
      (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = tt;
      const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
      expect(findings, `${tt} should not be flagged`).toEqual([]);
    }
  });

  it('flags the phase-less `record-change` bare noun — it never fires', () => {
    // `record-change` (once offered by the Studio picker as "Record changed
    // (any)") has no before/after phase, so it maps to no hook and never fires.
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = 'record-change';
    const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNKNOWN_EVENT]);
    expect(findings[0].message).toContain("'record-change'");
  });

  it('flags a bad-phase token (record-during-update)', () => {
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = 'record-during-update';
    const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNKNOWN_EVENT]);
  });

  it('does not flag non-record triggerTypes (schedule/api/manual)', () => {
    for (const tt of ['schedule', 'api', 'manual']) {
      const flow = recordFlow({ status: 'active' });
      (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = tt;
      const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
      expect(findings.some((f) => f.rule === FLOW_TRIGGER_UNKNOWN_EVENT)).toBe(false);
    }
  });

  it('flags an array-form triggerType — an unsupported multi-event shape that never fires (#3481)', () => {
    // A non-string triggerType folds to "no trigger" at the runtime, so the flow
    // is misclassified as manual and passes every gate silently. Catch it here.
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = [
      'record-after-create',
      'record-after-delete',
    ];
    const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNKNOWN_EVENT]);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/array/i);
    expect(findings[0].message).toMatch(/never fires/i);
    expect(findings[0].path).toBe('flows[0].nodes[0].config.triggerType');
    // The hint steers to the supported alternatives.
    expect(findings[0].hint).toMatch(/record-after-write/);
    expect(findings[0].hint).toMatch(/#3457/);
  });

  it('flags an array even when its elements are individually valid tokens', () => {
    // ['record-after-create','record-after-update'] is exactly what record-after-write
    // exists for — the array form is still unsupported, so still flagged.
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = [
      'record-after-create',
      'record-after-update',
    ];
    const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNKNOWN_EVENT]);
  });

  it('does not flag a non-record array (not the record-trigger silent-miss)', () => {
    // An array with no record-* element is not the #3481 defect — leave it alone.
    const flow = recordFlow({ status: 'active' });
    (flow.nodes[0] as { config: Record<string, unknown> }).config.triggerType = ['schedule', 'manual'];
    const findings = validateFlowTriggerReadiness({ objects: [candidateObject], flows: [flow] });
    expect(findings.some((f) => f.rule === FLOW_TRIGGER_UNKNOWN_EVENT)).toBe(false);
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
