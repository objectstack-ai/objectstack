// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19961 — a `decision` branch with no `expression` is refused at
 * `FlowSchema.parse`, the first of the three doors.
 *
 * `DecisionConditionSchema` declares `expression` `z.string()`, not optional,
 * but nothing parses a node's open `config` against that schema, so
 * `conditions: [{ label: 'y' }]` passed `FlowSchema.parse`,
 * `AutomationEngine.registerFlow` and `objectstack validate` — and the
 * executor then evaluated the branch as a condition with no `source`, which
 * `evaluateCondition` refuses, failing the run at the branch.
 *
 * The refusal rides the walk the blank string already goes through (#17493):
 * the expression ledger marks the slot `required`, `resolveFlowNodeExpressions`
 * emits the absent value there, and `predicateSlotRefusal` answers it under the
 * same lead sentence. So this file is ONE table over the three values the slot
 * can hold on a branch that exists — nothing, a blank string, a real predicate
 * — and asserts the issue `code`, the `path` and the full message (read off the
 * spec's own `predicateSlotRefusal`, never re-spelled) for each. The other two
 * doors run the same table in their own packages
 * (`service-automation`'s `decision-branch-expression-absent.test.ts`,
 * `lint`'s `validate-expressions.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { PREDICATE_SLOT_STRING_REFUSAL, predicateSlotRefusal } from './flow-node-expression-paths';
import { FlowSchema } from './flow.zod';

type Node = Record<string, unknown>;

/** start → <middle nodes> → end, chained by unconditional edges. */
function flowWith(...middle: Node[]) {
  const nodes: Node[] = [{ id: 'start', type: 'start', label: 'Start' }, ...middle, { id: 'end', type: 'end', label: 'End' }];
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(nodes[i].id), target: String(n.id) }));
  return { name: 'absent_probe', label: 'Absent probe', type: 'autolaunched', nodes, edges };
}

/** A decision whose branches are written exactly as given — no key is added. */
const decision = (...branches: Node[]): Node => ({
  id: 'branch', type: 'decision', label: 'Branch', config: { conditions: branches },
});

const loopAround = (inner: Node): Node => ({
  id: 'sweep', type: 'loop', label: 'Sweep',
  config: { collection: '{items}', iteratorVariable: 'item', body: { nodes: [inner], edges: [] } },
});

function issuesOf(flow: unknown) {
  const result = FlowSchema.safeParse(flow);
  return result.success ? [] : result.error.issues;
}

const AT_BRANCH_0 = ['nodes', 1, 'config', 'conditions', 0, 'expression'];

/**
 * The table: what the branch holds → what this door answers. `refusedWith` is
 * the value handed to `predicateSlotRefusal` for the expected message, so each
 * refused row's message is the ONE judge's, byte for byte.
 */
const TABLE: Array<{ name: string; branch: Node; refused: boolean; refusedWith?: unknown }> = [
  { name: 'no `expression` key', branch: { label: 'y' }, refused: true, refusedWith: undefined },
  { name: '`expression: null`', branch: { label: 'y', expression: null }, refused: true, refusedWith: null },
  { name: 'the predicate under the edge\'s spelling `condition`', branch: { label: 'y', condition: 'true' }, refused: true, refusedWith: undefined },
  { name: 'a blank string — blanks are refused', branch: { label: 'y', expression: '   ' }, refused: true, refusedWith: '   ' },
  { name: 'a real predicate — the accept control', branch: { label: 'y', expression: 'true' }, refused: false },
];

describe('FlowSchema.parse refuses a decision branch with no `expression`', () => {
  it.each(TABLE)('$name', ({ branch, refused, refusedWith }) => {
    const issues = issuesOf(flowWith(decision(branch)));
    if (!refused) {
      expect(issues).toEqual([]);
      return;
    }
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(AT_BRANCH_0);
    expect(issues[0].message).toBe(predicateSlotRefusal(refusedWith)!.message);
    expect(issues[0].message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
  });

  it('names WHICH branch: an absent second branch is anchored at index 1, the valid first one is not', () => {
    const issues = issuesOf(flowWith(decision({ label: 'a', expression: 'record.amount > 10' }, { label: 'b' })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'config', 'conditions', 1, 'expression']]]);
  });

  it('reaches a `decision` inside an ADR-0031 region body, anchored where the author wrote it', () => {
    const issues = issuesOf(flowWith(loopAround(decision({ label: 'y' }))));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'config', 'conditions', 0, 'expression']],
    ]);
    expect(issues[0].message).toBe(predicateSlotRefusal(undefined)!.message);
  });

  describe('CONTROLS — what this rule must NOT reach', () => {
    it('a decision that declares no branch still parses — it routes by its out-edges', () => {
      expect(FlowSchema.safeParse(flowWith({ id: 'branch', type: 'decision', label: 'B', config: {} })).success).toBe(true);
      expect(FlowSchema.safeParse(flowWith({ id: 'branch', type: 'decision', label: 'B' })).success).toBe(true);
      expect(FlowSchema.safeParse(flowWith(decision())).success).toBe(true);
    });

    it('an absent `visibleWhen` on a screen field still parses — that slot is not required', () => {
      const screen = { id: 'form', type: 'screen', label: 'Form', config: { fields: [{ name: 'amount', label: 'Amount', type: 'number' }] } };
      expect(FlowSchema.safeParse(flowWith(screen)).success).toBe(true);
    });
  });
});
