// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { TimeRelativeTriggerSchema } from '@objectstack/spec/automation';
import {
  validateFlowTriggerReadiness,
  FLOW_TRIGGER_UNKNOWN_OBJECT,
  FLOW_DRAFT_STATUS_AMBIGUOUS,
  FLOW_TRIGGER_UNKNOWN_EVENT,
  FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
  FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
  FLOW_TRIGGER_UNROUTABLE,
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
      expect(f.severity).toBe('error');
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
      // descriptor SHAPE verdict applies to it. Guessing here would make this rule
      // speak for flows the engine hands somewhere else.
      //
      // #5647 answered the question this test used to leave open ("whatever that
      // flow's defect is, it is not this rule's") — it is 1e's, a different id.
      // So the assertion is now two-sided: the shape rule stays out, AND the
      // unroutable rule steps in. One-sided, it would have kept passing even if
      // the scalar had gone back to being reported by nobody at all.
      const findings = validateFlowTriggerReadiness(timeRelativeStack('daily'));
      expect(findings.some((f) => f.rule === FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID)).toBe(false);
      expect(findings.map((f) => f.rule)).toEqual([FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE]);
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

    // ── #5647 — the descriptor is not an OBJECT ─────────────────────────────
    //
    // The complement of everything above, and the case with no runtime channel
    // at all: `timeRelative: 'daily'` is not routed by the engine, so the
    // trigger never safeParses it, so there is not even the one bind-time warn
    // that the object-but-invalid case gets. Verified against `origin/main`
    // before this rule existed: `validateFlowTriggerReadiness` and
    // `lintFlowPatterns` both returned `[]`, `FlowSchema.safeParse` ACCEPTED the
    // scalar (a node `config` is an open slot, ADR-0018), and `os validate` on a
    // real example app printed byte-identical output with and without it.
    describe('config.timeRelative is not an object (#5647)', () => {
      /** A start node with nothing but the offending descriptor — the issue's flow. */
      function scalarOnlyStack(timeRelative: unknown) {
        const stack = timeRelativeStack(timeRelative);
        // `autolaunched`, so `type: 'schedule'` is not silently supplying a
        // trigger the engine would fall back to. This is the never-fires case.
        (stack.flows[0] as Record<string, unknown>).type = 'autolaunched';
        return stack;
      }

      it('flags the scalar from the issue, and names the value, the type and the consequence', () => {
        const findings = validateFlowTriggerReadiness(scalarOnlyStack('daily'));
        expect(findings).toHaveLength(1);
        const [f] = findings;
        expect(f.rule).toBe(FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE);
        expect(f.severity).toBe('error');
        expect(f.path).toBe('flows[0].nodes[0].config.timeRelative');
        expect(f.where).toBe('flow "task_due_reminder" › start node');
        // The value the author wrote AND why it is not a descriptor.
        expect(f.message).toContain('"daily"');
        expect(f.message).toContain('(a string)');
        expect(f.message).toContain('config.timeRelative');
        // The consequence chain, which is the whole reason this is not a nit:
        // never routed → sweep never installed → this flow never fires at all,
        // and no layer says so.
        expect(f.message).toMatch(/never routed/);
        expect(f.message).toMatch(/sweep is never\s+installed/);
        expect(f.message).toMatch(/binds to NOTHING and\s+never fires/);
        expect(f.message).toMatch(/zero diagnostics at any layer/);
        // Single-line, like every other finding this rule emits (the CLI prints
        // `• where: message` on one line).
        expect(f.message).not.toContain('\n');
        expect(f.hint).not.toContain('\n');
      });

      it("names the cadence-vs-descriptor confusion the scalar actually is", () => {
        // The reason `'daily'` is the specimen: the author has fused "how often
        // the sweep runs" with "which records it sweeps". The hint has to
        // separate them or it does not help — the cadence key is a SIBLING.
        const [f] = validateFlowTriggerReadiness(scalarOnlyStack('daily'));
        expect(f.hint).toContain('config.schedule');
        expect(f.hint).toMatch(/sibling/);
        expect(f.hint).toContain('dateField');
        expect(f.hint).toMatch(/withinDays \| offsetDays/);
        expect(f.hint).toContain('TimeRelativeTriggerSchema');
      });

      it('flags every non-object shape, each rendered as itself', () => {
        const cases: Array<[unknown, string]> = [
          ['daily', '"daily" (a string)'],
          ['', '"" (a string)'],
          [7, '7 (a number)'],
          [0, '0 (a number)'],
          [true, 'true (a boolean)'],
          [false, 'false (a boolean)'],
        ];
        for (const [value, rendered] of cases) {
          const findings = validateFlowTriggerReadiness(scalarOnlyStack(value));
          expect(findings.map((f) => f.rule), rendered).toEqual([
            FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
          ]);
          expect(findings[0].message, rendered).toContain(rendered);
        }
      });

      it('reports a function or symbol without claiming it is undefined', () => {
        // `JSON.stringify` returns the VALUE `undefined` for both, so a naive
        // renderer would print a message about a value being "undefined" when it
        // is very much present. Only reachable from a TS-authored stack, but a
        // diagnostic that misreports its own subject is worse than a vague one.
        for (const [value, rendered] of [
          [() => 'daily', 'a function'],
          [Symbol('daily'), 'a symbol'],
        ] as Array<[unknown, string]>) {
          const findings = validateFlowTriggerReadiness(scalarOnlyStack(value));
          expect(findings.map((f) => f.rule)).toEqual([FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE]);
          expect(findings[0].message).toContain(rendered);
          expect(findings[0].message).not.toContain('undefined');
        }
      });

      it('says the flow still binds — not that it never fires — when a sibling trigger exists', () => {
        // Truthfulness of the consequence clause. `resolveTriggerBinding` falls
        // THROUGH the time-relative branch for a scalar and keeps going, so a
        // start node that also declares a trigger the engine recognizes does bind
        // and does fire — on that trigger's terms, with the descriptor silently
        // dropped (once per firing, no record on the context). Claiming "never
        // fires" about such a flow would be a false diagnostic.
        const withSchedule = scalarOnlyStack('daily');
        (
          (withSchedule.flows[0] as Record<string, unknown>).nodes as Array<Record<string, unknown>>
        )[0].config = { timeRelative: 'daily', schedule: { type: 'cron', expression: '0 8 * * *' } };
        const [f] = validateFlowTriggerReadiness(withSchedule);
        expect(f.rule).toBe(FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE);
        expect(f.message).toContain('config.schedule');
        expect(f.message).toMatch(/silently DROPPED/);
        expect(f.message).not.toMatch(/never fires/);
        // …and the certain half is still stated.
        expect(f.message).toMatch(/never routed/);
      });

      it('names each fallback the engine would actually reach', () => {
        const fallbackOf = (config: Record<string, unknown>, flowPatch: Record<string, unknown> = {}) => {
          const stack = scalarOnlyStack('daily');
          const flow = stack.flows[0] as Record<string, unknown>;
          Object.assign(flow, flowPatch);
          (flow.nodes as Array<Record<string, unknown>>)[0].config = {
            timeRelative: 'daily',
            ...config,
          };
          return validateFlowTriggerReadiness(stack).find(
            (f) => f.rule === FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
          )!.message;
        };
        // Same order as `resolveTriggerBinding` checks them.
        expect(fallbackOf({ triggerType: 'record-after-update', objectName: 'task' }))
          .toContain('record-change trigger');
        expect(fallbackOf({ triggerType: ['record-after-create'], objectName: 'task' }))
          .toContain('record-change trigger');
        expect(fallbackOf({ schedule: { type: 'cron', expression: '0 8 * * *' } }))
          .toContain('config.schedule');
        expect(fallbackOf({}, { type: 'schedule' })).toContain('config.schedule');
        expect(fallbackOf({ triggerType: 'api' })).toContain('api trigger');
        expect(fallbackOf({}, { type: 'api' })).toContain('api trigger');
      });

      it('partitions the key with the shape rule — never both, never neither', () => {
        // The two ids split the non-null values of `config.timeRelative` along the
        // ENGINE's routing predicate, so exactly one can speak about any given
        // descriptor. This is the assertion that keeps 1e from becoming a second
        // opinion on flows 1b-ii already covers (and vice versa).
        const routed: unknown[] = [
          { object: 'task', dateField: 'due_at', withinDays: 3 }, // valid  → neither
          { object: 'task', field: 'due_at' }, // invalid object → INVALID
          [{ object: 'task' }], // array is typeof 'object' → INVALID
          new Date('2026-01-01T00:00:00Z'), // Date is typeof 'object' → INVALID
        ];
        const unrouted: unknown[] = ['daily', 7, true, ''];

        for (const v of routed) {
          const rules = validateFlowTriggerReadiness(scalarOnlyStack(v)).map((f) => f.rule);
          expect(rules, `routed: ${String(v)}`).not.toContain(
            FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
          );
        }
        for (const v of unrouted) {
          const rules = validateFlowTriggerReadiness(scalarOnlyStack(v)).map((f) => f.rule);
          expect(rules, `unrouted: ${String(v)}`).toContain(
            FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
          );
          expect(rules, `unrouted: ${String(v)}`).not.toContain(
            FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
          );
        }
      });

      it('is silent when the key is absent or null — those declare no descriptor at all', () => {
        // `null` is on the far side of the engine's `!= null` too, so it is not
        // "a descriptor of the wrong type" — it is no descriptor. A flow with no
        // trigger at all is a different (pre-existing) gap, not this rule's.
        for (const v of [null, undefined]) {
          const stack = scalarOnlyStack(v);
          expect(
            validateFlowTriggerReadiness(stack).map((f) => f.rule),
            `${String(v)} must not be treated as a descriptor`,
          ).not.toContain(FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE);
        }
        // The contrast, in the same test and on the same fixture builder. Without
        // it this case is a bare negative: it would keep passing if the criterion
        // were deleted outright and NOTHING were reported — green because nothing
        // is produced rather than because the boundary is where it should be.
        expect(validateFlowTriggerReadiness(scalarOnlyStack('')).map((f) => f.rule)).toContain(
          FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
        );
      });

      it('leaves `isTimeRelative` — and the two rules it feeds — exactly as they were', () => {
        // The boundary this PR promised not to cross. `isTimeRelative` also feeds
        // `isAutoTriggered`, so widening it to cover scalars would have changed
        // `flow-draft-status-ambiguous`'s coverage as a side effect. It is not
        // widened, so a DRAFT flow whose only trigger key is a scalar still does
        // not get the draft warning — deliberately unchanged behaviour, pinned
        // here so a later edit to `isTimeRelative` has to come past this test.
        const stack = scalarOnlyStack('daily');
        delete (stack.flows[0] as Record<string, unknown>).status;
        const rules = validateFlowTriggerReadiness(stack).map((f) => f.rule);
        expect(rules).toEqual([FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE]);
        expect(rules).not.toContain(FLOW_DRAFT_STATUS_AMBIGUOUS);

        // The object-shaped control, to show the omission above is about the
        // scalar and not about the draft rule having stopped working.
        const objectStack = timeRelativeStack({ object: 'task', dateField: 'due_at', withinDays: 3 });
        delete (objectStack.flows[0] as Record<string, unknown>).status;
        expect(validateFlowTriggerReadiness(objectStack).map((f) => f.rule)).toEqual([
          FLOW_DRAFT_STATUS_AMBIGUOUS,
        ]);
      });

      it('is reachable from the published barrel under its own value', () => {
        // The id lands in every finding's `f.rule` and therefore in
        // `os lint --json` and `suppressWarnings: ['<id>']`, so a consumer needs
        // the constant rather than the literal (#5648). The package-wide gate in
        // `rule-id-barrel-exports.test.ts` proves this for every id; this line is
        // the local statement of the same fact.
        expect(FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE).toBe(
          'flow-time-relative-descriptor-unroutable',
        );
        expect(FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE).not.toBe(
          FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
        );
      });
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
    expect(findings[0].severity).toBe('error');
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
    expect(findings[0].severity).toBe('error');
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

  // ── #6637 — a record_change flow the engine routes NOWHERE ───────────────
  //
  // The quietest member of the never-fire family. Every case below is built on
  // `unroutable()`, which differs from `recordFlow()` in exactly the two ways
  // the criterion cares about: `type: 'record_change'` (the declared intent) and
  // a start-node `triggerType` outside the `record-` prefix (the contradiction).
  //
  // The "does NOT flag" block is the load-bearing half. A criterion phrased on
  // "resolves to no binding" alone would flag every manual and screen flow in
  // the world, so each guard below is a shape the rule must stay silent about,
  // paired — per the same fixture — with the one-key mutation that makes it
  // speak. A guard whose green could also be produced by a rule that never runs
  // is not a guard.
  describe('record_change flow with an unroutable triggerType (#6637)', () => {
    /** A `type: 'record_change'` flow whose start node carries `config`. */
    const unroutable = (config: Record<string, unknown>, flowOverrides: Record<string, unknown> = {}) => ({
      objects: [candidateObject],
      flows: [
        {
          name: 'candidate_hired',
          type: 'record_change',
          status: 'active',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'app_candidate', ...config } },
            { id: 'end', type: 'end' },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'end' }],
          ...flowOverrides,
        },
      ],
    });

    it("flags the issue's specimen — triggerType 'onCreate' on a record_change flow", () => {
      const findings = validateFlowTriggerReadiness(unroutable({ triggerType: 'onCreate' }));
      expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNROUTABLE]);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain("'onCreate'");
      expect(findings[0].path).toBe('flows[0].nodes[0].config.triggerType');
    });

    it('describes the MEASURED failure, not just "never fires"', () => {
      // The three engine facts the message is built on — a message that only
      // said "never fires" would be indistinguishable from `…-unknown-event`,
      // whose flow DOES bind and DOES get a bind-time warn. The distinguishing
      // claim is that nothing names this one, and the rule has to make it.
      const [f] = validateFlowTriggerReadiness(unroutable({ triggerType: 'onCreate' }));
      expect(f.message).toMatch(/record_change/);
      expect(f.message).toMatch(/never fires/i);
      expect(f.message).toMatch(/audit/i);
      // …and it must NOT overclaim: the flow count line does move, so the
      // message says "nothing NAMES it" rather than "no signal anywhere".
      expect(f.message).toMatch(/count/i);
      expect(f.hint).toMatch(/record-\{before,after\}/);
      expect(f.hint).toMatch(/autolaunched/);
    });

    it('flags the other unroutable spellings an author reaches for', () => {
      for (const tt of ['on_create', 'onUpdate', 'create', 'record_change', 'after_insert', '']) {
        const findings = validateFlowTriggerReadiness(unroutable({ triggerType: tt }));
        expect(findings.map((f) => f.rule), `triggerType ${JSON.stringify(tt)}`).toEqual([
          FLOW_TRIGGER_UNROUTABLE,
        ]);
      }
    });

    it('flags a non-record ARRAY on a record_change flow — 1d deliberately does not claim it', () => {
      // `['onCreate']` has no `record-` element, so `flow-trigger-unknown-event`
      // (1d) stays silent by design and pins that silence in its own test. On an
      // `autolaunched` flow that silence is correct; on a `record_change` flow it
      // left the loudest possible contradiction unreported. The token is rendered
      // as JSON so the author sees the shape they wrote.
      const findings = validateFlowTriggerReadiness(unroutable({ triggerType: ['onCreate'] }));
      expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNROUTABLE]);
      expect(findings[0].message).toContain('["onCreate"]');
      expect(findings.some((f) => f.rule === FLOW_TRIGGER_UNKNOWN_EVENT)).toBe(false);
    });

    // ── #7215 — the omission shape ────────────────────────────────────────
    //
    // Widened from the original #6637 contradiction-only criterion (`triggerType`
    // present but off-grammar) to also cover `triggerType` ABSENT entirely. Both
    // fall through `AutomationEngine.resolveTriggerBinding` to `undefined` by the
    // exact same chain, so both are equally dead at runtime — two spellings of
    // one defect, not a new one.
    //
    // At #6637 time the omission shape had a live instance in `examples/app-todo`
    // (`TaskCompletionFlow`, #6882) whose repair was a judgement about that app's
    // semantics rather than a lint decision, so covering it then would have gated
    // a shipped example app on a guess — the criterion required the key to be
    // PRESENT and the omission was tracked separately (#7041 item 2, carried by
    // the now-deleted `an ABSENT triggerType` pin this block replaces). #7039
    // repaired that instance and #7215 (maintainer-ruled, disposition 1) widened
    // the criterion now that the corpus is green for it (verified at branch time:
    // zero omission instances in-tree).
    it('flags a record_change flow with triggerType entirely absent (the omission shape)', () => {
      const findings = validateFlowTriggerReadiness(unroutable({}));
      expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNROUTABLE]);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].path).toBe('flows[0].nodes[0].config.triggerType');
      expect(findings[0].message).toMatch(/no triggerType at all/i);
      // The message must not misreport the absent value as the literal word
      // "undefined" (the `renderNonObject`/`renderTriggerToken` lesson applied
      // to this new branch too).
      expect(findings[0].message).not.toContain('undefined');
    });

    it('reports the same rule, severity and path whether the token is wrong or missing', () => {
      // "Same rule, same severity: two spellings of one defect" is the issue's
      // own framing — assert it directly rather than trusting two separate
      // tests to agree by construction.
      const present = validateFlowTriggerReadiness(unroutable({ triggerType: 'onCreate' }))[0];
      const absent = validateFlowTriggerReadiness(unroutable({}))[0];
      expect(absent.rule).toBe(present.rule);
      expect(absent.severity).toBe(present.severity);
      expect(absent.path).toBe(present.path);
      // Both still carry the measured audit claim from 1f's comment.
      expect(absent.message).toMatch(/record_change/);
      expect(absent.message).toMatch(/never fires/i);
      expect(absent.message).toMatch(/audit/i);
      expect(absent.message).toMatch(/count/i);
    });

    describe('does NOT flag (each paired with the mutation that makes it fire)', () => {
      it('a canonical record-* token — the whole point of declaring record_change', () => {
        expect(validateFlowTriggerReadiness(unroutable({ triggerType: 'record-after-update' }))).toEqual([]);
        // Planted bad value on the SAME fixture: the green above is the rule
        // judging a good token, not the rule failing to run.
        expect(
          validateFlowTriggerReadiness(unroutable({ triggerType: 'record_after_update' })).map((f) => f.rule),
        ).toEqual([FLOW_TRIGGER_UNROUTABLE]);
      });

      it('an off-grammar record-* token — that is 1c\'s finding, and only 1c\'s', () => {
        // The two ids partition the dead tokens on whether the engine routes the
        // value, so exactly one of them can ever speak about a given token.
        const findings = validateFlowTriggerReadiness(unroutable({ triggerType: 'record-after-updated' }));
        expect(findings.map((f) => f.rule)).toEqual([FLOW_TRIGGER_UNKNOWN_EVENT]);
        expect(findings.some((f) => f.rule === FLOW_TRIGGER_UNROUTABLE)).toBe(false);
      });

      it('a genuinely manual flow — autolaunched/screen, the types this rule cannot reach', () => {
        // The recorded counter-argument to the whole rule (#6637): the
        // fall-through to "no binding" is ALSO how a flow legitimately is
        // manual. Declaring `record_change` is what separates the two, so these
        // must stay silent no matter how unroutable the token is.
        for (const type of ['autolaunched', 'screen']) {
          expect(
            validateFlowTriggerReadiness(unroutable({ triggerType: 'onCreate' }, { type })).map((f) => f.rule),
            type,
          ).not.toContain(FLOW_TRIGGER_UNROUTABLE);
        }
        // Same fixture, one key changed back: `record_change` and it fires.
        expect(
          validateFlowTriggerReadiness(unroutable({ triggerType: 'onCreate' }, { type: 'record_change' })).map(
            (f) => f.rule,
          ),
        ).toContain(FLOW_TRIGGER_UNROUTABLE);
      });

      it('a record_change flow that ALSO declares a trigger the engine DOES route', () => {
        // These bind and fire — on the wrong trigger's terms. A real defect, a
        // different one, and not this rule's to name (see 1f). Pinned so the
        // criterion is not quietly widened into a second verdict.
        for (const extra of [
          { schedule: { type: 'interval', intervalMs: 60000 } },
          { timeRelative: { object: 'app_candidate', dateField: 'due_at', withinDays: 7 } },
        ]) {
          expect(
            validateFlowTriggerReadiness(unroutable({ triggerType: 'onCreate', ...extra })).map((f) => f.rule),
            JSON.stringify(extra),
          ).not.toContain(FLOW_TRIGGER_UNROUTABLE);
        }
        // `triggerType: 'api'` routes on its own — the engine tests the token
        // itself, so there is nothing to add to the fixture.
        expect(
          validateFlowTriggerReadiness(unroutable({ triggerType: 'api' })).map((f) => f.rule),
        ).not.toContain(FLOW_TRIGGER_UNROUTABLE);
        // Drop the routed sibling and the same flow is dead again.
        expect(
          validateFlowTriggerReadiness(unroutable({ triggerType: 'onCreate' })).map((f) => f.rule),
        ).toEqual([FLOW_TRIGGER_UNROUTABLE]);
      });

      it('an omission with a sibling key the engine DOES route — same exclusion, absent token', () => {
        // The omission counterpart of the test above (#7215). `triggerType` is
        // missing outright, but something else on the start node routes — the
        // same `routesToSomeTrigger` chain that excludes the present-but-routed
        // case excludes this one too, character for character.
        for (const extra of [
          { schedule: { type: 'interval', intervalMs: 60000 } },
          { timeRelative: { object: 'app_candidate', dateField: 'due_at', withinDays: 7 } },
        ]) {
          expect(
            validateFlowTriggerReadiness(unroutable({ ...extra })).map((f) => f.rule),
            JSON.stringify(extra),
          ).not.toContain(FLOW_TRIGGER_UNROUTABLE);
        }
        // Drop the routed sibling and the same (still keyless) flow is dead.
        expect(
          validateFlowTriggerReadiness(unroutable({})).map((f) => f.rule),
        ).toEqual([FLOW_TRIGGER_UNROUTABLE]);
      });

      it('a genuinely manual flow with no triggerType at all — autolaunched/screen stay silent (#7215)', () => {
        // The omission widening still only speaks for `record_change`: 1f's
        // guard is `flow.type === 'record_change'`, so a flow that is
        // legitimately manual (`autolaunched`/`screen`, which have no
        // triggerType to be missing) must not start getting flagged just
        // because the key happens to be absent. Mirrors the present-token
        // scope-boundary test above, one key over.
        for (const type of ['autolaunched', 'screen']) {
          expect(
            validateFlowTriggerReadiness(unroutable({}, { type })).map((f) => f.rule),
            type,
          ).not.toContain(FLOW_TRIGGER_UNROUTABLE);
        }
        // Same fixture, type flipped back to record_change: now it fires.
        expect(
          validateFlowTriggerReadiness(unroutable({}, { type: 'record_change' })).map((f) => f.rule),
        ).toContain(FLOW_TRIGGER_UNROUTABLE);
      });

      it('every non-record_change flow type stays silent with triggerType absent — flow.type is read literally', () => {
        // Enumerated from the code rather than guessed: 1f's guard is
        // `flow.type === 'record_change'`, an exact string match against
        // `Flow.type`'s enum. Every other declared type — plus a flow with no
        // `type` at all — never reaches this criterion, omission or not.
        for (const type of ['autolaunched', 'screen', 'schedule', 'api', undefined]) {
          const findings = validateFlowTriggerReadiness(unroutable({}, { type }));
          expect(findings.map((f) => f.rule), String(type)).not.toContain(FLOW_TRIGGER_UNROUTABLE);
        }
      });

      it('a flow with no start node at all', () => {
        expect(
          validateFlowTriggerReadiness({
            objects: [candidateObject],
            flows: [{ name: 'no_start', type: 'record_change', status: 'active', nodes: [{ id: 'end', type: 'end' }] }],
          }),
        ).toEqual([]);
      });
    });

    it('co-fires with the timeRelative scalar rule — two keys, two facts', () => {
      // `{ triggerType: 'onCreate', timeRelative: 'daily' }` is wrong twice over,
      // at two different paths. The file's stated doctrine is two facts rather
      // than one fact twice, so both are reported — and 1e's own consequence
      // clause stays true, because nothing on this start node routes either.
      const findings = validateFlowTriggerReadiness(
        unroutable({ triggerType: 'onCreate', timeRelative: 'daily' }),
      );
      expect(findings.map((f) => f.rule).sort()).toEqual(
        [FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE, FLOW_TRIGGER_UNROUTABLE].sort(),
      );
      expect(new Set(findings.map((f) => f.path)).size).toBe(2);
      expect(
        findings.find((f) => f.rule === FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE)!.message,
      ).toMatch(/binds to NOTHING/);
    });

    it('the id is the published slug and is distinct from the routed-token id', () => {
      expect(FLOW_TRIGGER_UNROUTABLE).toBe('flow-trigger-unroutable');
      expect(FLOW_TRIGGER_UNROUTABLE).not.toBe(FLOW_TRIGGER_UNKNOWN_EVENT);
      expect(FLOW_TRIGGER_UNROUTABLE).not.toBe(FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE);
    });
  });

  // ── #5762 — the family's severity map ────────────────────────────────────
  //
  // The rules in this file were reviewed as ONE family and split on a single
  // question: is this stack enough to know the flow is dead? Three rules answer
  // yes and gate; two hedge and advise. The split is the contract, so it is
  // pinned as a map rather than as five scattered `severity` lines — a later
  // rule added to this file has to decide which side it is on, and a later edit
  // that quietly demotes one of the three has to come past this test.
  //
  // Every entry is provoked through a real stack, so an id whose criterion stops
  // firing fails here instead of passing vacuously (the empty-verdict trap: an
  // assertion about findings that are never produced is green for the wrong
  // reason).
  describe('severity (#5762)', () => {
    /** Minimal stacks, one per rule id, each provoking exactly that finding. */
    const provoke: Array<[string, 'error' | 'warning', Record<string, unknown>]> = [
      [
        FLOW_TIME_RELATIVE_DESCRIPTOR_INVALID,
        'error',
        {
          objects: [{ name: 'task', label: 'Task', fields: {} }],
          flows: [
            {
              name: 'bad_shape',
              type: 'schedule',
              status: 'active',
              nodes: [
                {
                  id: 'start',
                  type: 'start',
                  config: { timeRelative: { object: 'task', field: 'due_at', offsetDays: -1 } },
                },
              ],
            },
          ],
        },
      ],
      [
        FLOW_TIME_RELATIVE_DESCRIPTOR_UNROUTABLE,
        'error',
        {
          objects: [{ name: 'task', label: 'Task', fields: {} }],
          flows: [
            {
              name: 'scalar_descriptor',
              type: 'autolaunched',
              status: 'active',
              nodes: [{ id: 'start', type: 'start', config: { timeRelative: 'daily' } }],
            },
          ],
        },
      ],
      [
        FLOW_TRIGGER_UNKNOWN_EVENT,
        'error',
        {
          objects: [candidateObject],
          flows: [
            {
              name: 'typo_token',
              type: 'autolaunched',
              status: 'active',
              nodes: [
                {
                  id: 'start',
                  type: 'start',
                  config: { objectName: 'app_candidate', triggerType: 'record-after-updated' },
                },
              ],
            },
          ],
        },
      ],
      [
        FLOW_TRIGGER_UNROUTABLE,
        'error',
        {
          objects: [candidateObject],
          flows: [
            {
              name: 'declared_dead',
              type: 'record_change',
              status: 'active',
              nodes: [
                {
                  id: 'start',
                  type: 'start',
                  config: { objectName: 'app_candidate', triggerType: 'onCreate' },
                },
              ],
            },
          ],
        },
      ],
      // ── The controls. Both are hedged, and the hedge is the whole reason the
      //    promotion above is not "everything in this file is an error now".
      [
        FLOW_TRIGGER_UNKNOWN_OBJECT,
        'warning',
        {
          objects: [candidateObject],
          flows: [
            {
              name: 'other_package_object',
              type: 'autolaunched',
              status: 'active',
              nodes: [
                {
                  id: 'start',
                  type: 'start',
                  config: { objectName: 'billing_invoice', triggerType: 'record-after-update' },
                },
              ],
            },
          ],
        },
      ],
      [
        FLOW_DRAFT_STATUS_AMBIGUOUS,
        'warning',
        {
          objects: [candidateObject],
          flows: [recordFlow()],
        },
      ],
    ];

    for (const [rule, severity, stack] of provoke) {
      it(`${rule} is ${severity}`, () => {
        const matching = validateFlowTriggerReadiness(stack).filter((f) => f.rule === rule);
        // Non-vacuous first: the fixture really does provoke this id.
        expect(matching.length, `${rule} was not provoked by its own fixture`).toBeGreaterThan(0);
        for (const f of matching) expect(f.severity).toBe(severity);
      });
    }

    it('the hedged rules say so in their own hint, and the gating ones do not', () => {
      // The severity claim and the prose have to agree. A rule that gates while
      // telling the author the finding "can be ignored" is the contradiction that
      // makes a gate read as a bug — and the cross-package sentence is exactly
      // what earns `flow-trigger-unknown-object` its warning.
      for (const [rule, severity, stack] of provoke) {
        for (const f of validateFlowTriggerReadiness(stack).filter((x) => x.rule === rule)) {
          if (severity === 'warning' && rule === FLOW_TRIGGER_UNKNOWN_OBJECT) {
            expect(f.hint, rule).toMatch(/another installed package/);
          }
          if (severity === 'error') {
            expect(f.hint, rule).not.toMatch(/can be ignored/i);
            expect(f.hint, rule).not.toMatch(/another installed package/);
          }
        }
      }
    });

    it('a clean stack produces no finding of any severity', () => {
      // The floor the promotion must not move: promoting a rule must not make a
      // correct flow fail. Without this, "everything is an error" would pass
      // every assertion above.
      expect(
        validateFlowTriggerReadiness({
          objects: [candidateObject, { name: 'task', label: 'Task', fields: {} }],
          flows: [
            recordFlow({ status: 'active' }),
            {
              name: 'renewal',
              type: 'schedule',
              status: 'active',
              nodes: [
                {
                  id: 'start',
                  type: 'start',
                  config: { timeRelative: { object: 'task', dateField: 'due_at', withinDays: 30 } },
                },
              ],
            },
          ],
        }),
      ).toEqual([]);
    });
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
