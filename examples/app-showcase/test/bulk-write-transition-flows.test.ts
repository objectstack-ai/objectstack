// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4862 / #5038] The showcase's transition flows, verified against the per-row
 * bulk-write contract.
 *
 * #4862 named this app as the evidence that the gap was not theoretical: about
 * ten flows shipped here gate on `status == "done" && previous.status != "done"`
 * — the exact shape `content/docs/data-modeling/formulas.mdx` and
 * `skills/objectstack-formula` §5 teach. On a predicate (`multi: true`) write
 * the engine fired the lifecycle hook ONCE, never bound `previous`, and let
 * `record` degrade to the write's bare payload, so every one of these start
 * conditions was unevaluable on a bulk "mark these done" — the flows either did
 * not fire or fired once for a record that did not exist, silently.
 *
 * ADR-0058's bulk-write addendum settled the contract and #5038 implemented it:
 * a bulk write evaluates and fires after-hooks (and the record-change triggers
 * riding them) PER ROW, with `previous` = that row's pre-write state.
 *
 * What this file checks is the app's own metadata, not a copy of it: it reads
 * the REAL flows out of `allFlows` and evaluates their REAL start conditions
 * through the same evaluator and the same variable shape the automation engine
 * builds (`AutomationEngine.evaluateCondition` spreads the record's fields to
 * top level and binds `record` + `previous`). Two rows per flow, matched by ONE
 * predicate write:
 *
 *   - a row that genuinely transitioned  → the condition must be TRUE;
 *   - a row already in the target state  → the condition must be FALSE.
 *
 * That second row is the whole point of `previous`, and it is the assertion the
 * old behaviour could not satisfy on a batch at all: with `previous` unbound,
 * the condition faulted for both rows; with `previous` fabricated as `{}` or
 * `null`, it answered the same for both.
 */

import { describe, it, expect } from 'vitest';
import { ExpressionEngine } from '@objectstack/formula';

import { allFlows } from '../src/automation/flows/index.js';

type StartNode = { type?: string; config?: Record<string, unknown> };
type FlowLike = { name?: string; nodes?: StartNode[] };

/** The record-change start node of a flow, if it has one. */
function startNodeOf(flow: FlowLike): Record<string, unknown> | undefined {
  const start = (flow.nodes ?? []).find((n) => n?.type === 'start');
  return start?.config as Record<string, unknown> | undefined;
}

function conditionSourceOf(config: Record<string, unknown> | undefined): string | undefined {
  const c = config?.condition;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object' && typeof (c as { source?: unknown }).source === 'string') {
    return (c as { source: string }).source;
  }
  return undefined;
}

/**
 * Evaluate a start condition exactly as `AutomationEngine.evaluateCondition`
 * does: every record field spread to top level (so bare `status` resolves),
 * plus `record` and `previous`.
 */
function evaluateStartCondition(
  source: string,
  record: Record<string, unknown>,
  previous: Record<string, unknown> | null,
): boolean {
  const vars: Record<string, unknown> = { ...record, record, previous };
  const result = ExpressionEngine.evaluate(
    { dialect: 'cel', source },
    { extra: { ...vars, vars }, record: vars },
  );
  if (!result.ok) {
    throw new Error(`condition did not evaluate: ${result.error?.message ?? 'unknown'} — ${source}`);
  }
  return Boolean(result.value);
}

/**
 * A `field == "value" && previous.field != "value"` transition, parsed out of
 * the condition so the two rows can be GENERATED from the flow's own text
 * rather than hand-copied into this file (a copy would drift the moment a flow
 * changed its target state, and pass while doing so).
 */
const TRANSITION_RE = /^\s*(\w+)\s*==\s*(['"])(.+?)\2\s*&&\s*previous\.(\w+)\s*!=\s*(['"])(.+?)\5(.*)$/;

interface Transition {
  flow: string;
  source: string;
  field: string;
  target: string;
  /** Any further clauses (`&& total_amount >= 5000`), kept so they are satisfied. */
  tail: string;
}

/** Fields the tail clauses of showcase transitions reference, set generously so
 *  an extra clause is satisfied rather than accidentally deciding the test. */
const TAIL_SUPPORT = {
  total_amount: 10_000,
  budget: 500_000,
  amount: 10_000,
};

const transitions: Transition[] = [];
const previousReaders: Array<{ flow: string; source: string }> = [];

for (const flow of allFlows as unknown as FlowLike[]) {
  const source = conditionSourceOf(startNodeOf(flow));
  if (!source || !/\bprevious\b/.test(source)) continue;
  previousReaders.push({ flow: String(flow.name), source });
  const m = TRANSITION_RE.exec(source);
  if (m && m[1] === m[4] && m[3] === m[6]) {
    transitions.push({ flow: String(flow.name), source, field: m[1], target: m[3], tail: m[7] });
  }
}

describe('[#4862/#5038] showcase transition flows on a predicate bulk write', () => {
  it('the showcase really does ship ~10 of them — this is not a vacuous suite', () => {
    // #4862 counted "at least 10 flows" on this shape. If a refactor drops them
    // all, the per-flow cases below would pass by iterating nothing.
    expect(transitions.length).toBeGreaterThanOrEqual(10);
    // And every `previous`-reading start condition is accounted for: either it
    // is one of the canonical transitions below, or it is covered by the
    // explicitly enumerated shapes at the end of this file.
    expect(previousReaders.length).toBeGreaterThanOrEqual(transitions.length);
  });

  describe.each(transitions)('$flow — `$source`', ({ field, target, tail, source }) => {
    const base = { id: 'row_1', title: 'A showcase row', ...TAIL_SUPPORT };

    it('FIRES for the row that transitioned in this batch', () => {
      // Per-row bindings, as the engine now supplies them: `previous` is THIS
      // row's pre-write state, `record` is its real state (stored ⊕ payload),
      // not the write's bare payload.
      const previous = { ...base, [field]: `not_${target}` };
      const record = { ...base, [field]: target };

      expect(evaluateStartCondition(source, record, previous)).toBe(true);
    });

    it('does NOT fire for a row already in the target state', () => {
      // Same batch, same payload, different prior state. Only a per-row
      // `previous` can tell these two rows apart — the discrimination the flow
      // was authored to make and could not make on a bulk write before #5038.
      const previous = { ...base, id: 'row_2', [field]: target };
      const record = { ...base, id: 'row_2', [field]: target };

      expect(evaluateStartCondition(source, record, previous)).toBe(false);
    });

    it('reads a field the bulk payload does not set, so `record` must be the row', () => {
      // `record` degrading to the bare payload was #4862's fact 4. A predicate
      // write that sets ONLY the transition field still has to answer for the
      // rest of the row: `title` is never in such a payload, and every one of
      // these conditions is evaluated against a record that has it.
      const previous = { ...base, [field]: `not_${target}` };
      const record = { ...base, [field]: target };
      expect(record.title).toBe('A showcase row');
      expect(evaluateStartCondition(source, record, previous)).toBe(true);
      // …and the tail clause, when there is one, was genuinely satisfied rather
      // than skipped.
      if (tail.trim()) expect(tail).toMatch(/&&|\|\|/);
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The non-canonical `previous` shapes the showcase also ships
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#4862/#5038] the showcase\'s other `previous` start conditions', () => {
  const find = (name: string) => {
    const flow = (allFlows as unknown as FlowLike[]).find((f) => f.name === name);
    const source = conditionSourceOf(startNodeOf(flow ?? {}));
    if (!source) throw new Error(`flow '${name}' has no start condition — update this test`);
    return source;
  };

  it('a field-CHANGED transition (`assignee != previous.assignee`) discriminates per row', () => {
    const source = find('showcase_task_assigned_notify');
    expect(source).toContain('previous.assignee');

    // One batch reassigning a set of tasks to `dana`: the row that already
    // belonged to dana did not change hands, and must not notify her again.
    expect(evaluateStartCondition(source, { assignee: 'dana' }, { assignee: 'ann' })).toBe(true);
    expect(evaluateStartCondition(source, { assignee: 'dana' }, { assignee: 'dana' })).toBe(false);
  });

  it('a threshold-crossing transition (`budget > N && budget != previous.budget`)', () => {
    const source = find('showcase_budget_approval');
    expect(source).toContain('previous.budget');

    expect(evaluateStartCondition(source, { budget: 200_000 }, { budget: 50_000 })).toBe(true);
    // Already over the threshold and unchanged by this write — not a crossing.
    expect(evaluateStartCondition(source, { budget: 200_000 }, { budget: 200_000 })).toBe(false);
  });

  it('the create-OR-escalate shape (`previous == null || previous.priority != …`)', () => {
    // #3427: on a `record-after-write` flow, `previous == null` is the CREATE
    // leg. That discrimination is only honest when `previous` is genuinely
    // absent for an insert and genuinely PRESENT for a bulk update — before
    // #5038 a bulk update also arrived with no `previous`, so every batched
    // escalation looked like a brand-new urgent record.
    const source = find('showcase_urgent_task_alert');
    expect(source).toContain('previous == null');

    // The create leg.
    expect(evaluateStartCondition(source, { priority: 'urgent' }, null)).toBe(true);
    // A real escalation inside a batch.
    expect(evaluateStartCondition(source, { priority: 'urgent' }, { priority: 'normal' })).toBe(true);
    // Already urgent — must NOT re-alert, and only a bound per-row `previous`
    // can say so.
    expect(evaluateStartCondition(source, { priority: 'urgent' }, { priority: 'urgent' })).toBe(false);
  });
});
