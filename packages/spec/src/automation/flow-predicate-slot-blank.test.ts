// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17493 (ruling A, 5651023407) — a blank string in a ledger `predicate` slot
 * is refused at `FlowSchema.parse`, the first of the three doors.
 *
 * The two slots the expression ledger declares with the `predicate` role —
 * `decision`'s `config.conditions[].expression` and `screen`'s
 * `config.fields[].visibleWhen` — accepted `''` / `'   '` at every door until
 * this card: the resolver skipped the blank as "not authored" and the
 * evaluator answered it `false`, so a `decision` branch carrying it was never
 * taken and nothing said so. That the two sides agreed was ruled no defence.
 *
 * What this file pins is the flow-parse door's record of the refusal — the
 * issue `code`, the `path` it is anchored at, and the published sentence it
 * leads with (asserted off the spec's own export, never re-spelled) — for each
 * slot, at the top level and inside an ADR-0031 region body. The other two
 * doors are pinned in their own packages (`service-automation`'s
 * `predicate-slot-blank.test.ts`, `lint`'s `validate-expressions.test.ts`).
 *
 * The CONTROLS are the other half: the rule reaches exactly what was ruled —
 * strings, in `predicate` slots — and moves no neighbouring accept set.
 */

import { describe, expect, it } from 'vitest';

import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '../shared/expression.zod';
import { PREDICATE_SLOT_STRING_REFUSAL } from './flow-node-expression-paths';
import { FlowSchema } from './flow.zod';

const BLANKS = ['', '   ', '\t\n '] as const;

type Node = Record<string, unknown>;

/** start → <middle nodes> → end, chained by unconditional edges. */
function flowWith(...middle: Node[]) {
  const nodes: Node[] = [{ id: 'start', type: 'start', label: 'Start' }, ...middle, { id: 'end', type: 'end', label: 'End' }];
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(nodes[i].id), target: String(n.id) }));
  return { name: 'blank_probe', label: 'Blank probe', type: 'autolaunched', nodes, edges };
}

const decision = (...expressions: unknown[]): Node => ({
  id: 'branch',
  type: 'decision',
  label: 'Branch',
  config: { conditions: expressions.map((expression, i) => ({ label: `b${i}`, expression })) },
});

const screen = (visibleWhen: unknown): Node => ({
  id: 'form',
  type: 'screen',
  label: 'Form',
  config: { fields: [{ name: 'amount', label: 'Amount', type: 'number', visibleWhen }] },
});

const loopAround = (inner: Node): Node => ({
  id: 'sweep',
  type: 'loop',
  label: 'Sweep',
  config: { collection: '{items}', itemVariable: 'item', body: { nodes: [inner], edges: [] } },
});

function issuesOf(flow: unknown) {
  const result = FlowSchema.safeParse(flow);
  return result.success ? [] : result.error.issues;
}

const predicateIssues = (flow: unknown) =>
  issuesOf(flow).filter((i) => String(i.message).startsWith(PREDICATE_SLOT_STRING_REFUSAL));

describe('FlowSchema.parse refuses a blank string in a ledger predicate slot (#17493)', () => {
  describe.each(BLANKS)('the blank %j', (blank) => {
    it('decision branch `config.conditions[].expression` — code `custom`, anchored at the branch', () => {
      const issues = issuesOf(flowWith(decision(blank)));
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('custom');
      expect(issues[0].path).toEqual(['nodes', 1, 'config', 'conditions', 0, 'expression']);
      expect(issues[0].message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
    });

    it('screen field `config.fields[].visibleWhen` — code `custom`, anchored at the field', () => {
      const issues = issuesOf(flowWith(screen(blank)));
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('custom');
      expect(issues[0].path).toEqual(['nodes', 1, 'config', 'fields', 0, 'visibleWhen']);
      expect(issues[0].message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
    });
  });

  it('names WHICH branch: a blank second branch is anchored at index 1, and the valid first one is not', () => {
    const issues = issuesOf(flowWith(decision('record.amount > 10', '   ')));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 1, 'config', 'conditions', 1, 'expression']]);
  });

  it('reaches a `decision` inside an ADR-0031 region body, anchored where the author wrote it', () => {
    const issues = issuesOf(flowWith(loopAround(decision('   '))));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['nodes', 1, 'config', 'body', 'nodes', 0, 'config', 'conditions', 0, 'expression']);
    expect(issues[0].message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
  });

  describe('CONTROLS — what this rule must NOT reach', () => {
    it('a non-blank predicate parses unchanged, on both slots and in a region body', () => {
      expect(FlowSchema.safeParse(flowWith(decision('record.amount > 10', 'true'))).success).toBe(true);
      expect(FlowSchema.safeParse(flowWith(screen('amount > 0'))).success).toBe(true);
      expect(FlowSchema.safeParse(flowWith(loopAround(decision('item.done')))).success).toBe(true);
    });

    it('an absent predicate is still not a malformed one', () => {
      expect(FlowSchema.safeParse(flowWith(screen(undefined))).success).toBe(true);
      expect(FlowSchema.safeParse(flowWith({ id: 'branch', type: 'decision', label: 'B', config: {} })).success).toBe(true);
    });

    it('a NON-string in a predicate slot is not this door\'s to refuse — #15572 refuses it at the other two', () => {
      // Scoped to what was ruled: the flow parse's accept set moves for blank
      // STRINGS only. The envelope is refused at `registerFlow` and
      // `objectstack validate` by the same `predicateSlotRefusal`, unchanged.
      expect(predicateIssues(flowWith(decision({ dialect: 'cel', source: 'x > 1' })))).toEqual([]);
      expect(predicateIssues(flowWith(screen({ dialect: 'cel', source: '   ' })))).toEqual([]);
    });

    it('the EDGE slot keeps its own rule and sentence — unchanged', () => {
      const flow = flowWith(decision('true'));
      (flow.edges[1] as Record<string, unknown>).condition = '   ';
      const issues = issuesOf(flow);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.path[0] === 'edges')).toBe(true);
      expect(issues.some((i) => String(i.message).includes(EVALUATED_EXPRESSION_SOURCE_REQUIRED))).toBe(true);
      expect(predicateIssues(flow)).toEqual([]);
    });

    it('the STRUCTURAL `config.condition` is not a ledger slot — this rule does not reach it', () => {
      // Its blank is refused at `registerFlow` and `objectstack validate`
      // (#17322, #17495) by the evaluated-slot rule, not here.
      expect(predicateIssues(flowWith({ id: 'gate', type: 'decision', label: 'G', config: { condition: '   ' } }))).toEqual([]);
    });

    it('a `flow-template` slot\'s blank is untouched — no validator implements that dialect', () => {
      const loop = loopAround({ id: 'noop', type: 'assignment', label: 'N', config: { assignments: { x: '1' } } });
      (loop.config as Record<string, unknown>).collection = '   ';
      expect(predicateIssues(flowWith(loop))).toEqual([]);
    });
  });
});
