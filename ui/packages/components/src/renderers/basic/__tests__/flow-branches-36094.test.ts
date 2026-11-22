/**
 * objectstack#36094 — the pure half of the `type: flow` embed's branches:
 * which out-edges a decision routes down, and the fail-closed reader that
 * turns their CEL into text or answers `null` (the neutral marker).
 */

import { describe, it, expect } from 'vitest';
import {
  decisionBranches,
  entryGuard,
  flowSubjects,
  readCondition,
  subjectFieldOf,
  type ConditionContext,
  type ConditionField,
} from '../flow-branches';

const FIELDS: Record<string, ConditionField> = {
  amount: { label: 'Amount', type: 'currency' },
  stage: { label: 'Stage', type: 'select', options: [{ value: 'closed_won', label: 'Closed Won' }] },
  name: { label: 'Name', type: 'text' },
  is_vip: { label: 'VIP', type: 'boolean' },
};

const SUBJECTS = { object: 'deal', rowVariables: new Set(['row']) };

const ctx: ConditionContext = {
  field: (path) => {
    const name = subjectFieldOf(path, SUBJECTS);
    return name ? FIELDS[name] : undefined;
  },
  formatNumber: (value) => new Intl.NumberFormat('en').format(value),
  words: { and: 'and', or: 'or', more: 'other conditions' },
};

describe('readCondition (objectstack#36094)', () => {
  it.each([
    ['record.amount > 500000', 'Amount > 500,000'],
    ['500000 < record.amount', 'Amount > 500,000'],
    ['record.amount >= 1000 && record.amount <= 2000', 'Amount ≥ 1,000 and Amount ≤ 2,000'],
    ['has(vars.row) && has(vars.row.amount) && vars.row.amount != null && vars.row.amount > 5', 'Amount > 5'],
    ['!has(row.amount) || row.amount == null || row.amount <= 5', 'Amount ≤ 5'],
    ["record.stage == 'closed_won'", 'Stage = Closed Won'],
    ['record.name != "Acme"', 'Name ≠ “Acme”'],
    ['record.amount > 1 || (record.amount < -1 && record.stage == "closed_won")', 'Amount > 1 or (Amount < -1 and Stage = Closed Won)'],
    ['record.amount > 1 && record.owner == current_user.id', 'Amount > 1 and other conditions'],
  ])('reads %s', (source, text) => {
    expect(readCondition(source, ctx)).toBe(text);
  });

  it.each([
    ['a field compared with a field', 'record.amount > record.name'],
    ['a field the object does not declare', 'record.discount > 5'],
    ['the prior row', 'previous.amount > 5'],
    ['a variable that holds no row of the object', 'vars.manager_review.decision != "recall"'],
    ['a function call', 'size(record.name) > 3'],
    ['a boolean field', 'record.is_vip == true'],
    ['an ordering on text', 'record.name > "a"'],
    ['an option the field does not declare', 'record.stage == "lost"'],
    ['an escaped string', 'record.name == "a\\"b"'],
    ['a list membership', 'record.stage in ["closed_won"]'],
    ['a ternary', 'record.amount > 1 ? true : false'],
    ['a presence guard alone', 'has(record.amount)'],
    ['a disjunction with an unread term', 'record.amount > 1 || record.owner == current_user.id'],
    ['a conjunction where nothing reads', 'record.owner == current_user.id && previous.amount > 1'],
    ['a negated comparison', '!(record.amount > 5)'],
    ['trailing tokens', 'record.amount > 5 5'],
    ['an empty source', '   '],
  ])('answers null for %s', (_what, source) => {
    expect(readCondition(source, ctx)).toBeNull();
  });
});

describe('decisionBranches (objectstack#36094)', () => {
  it('reads a gateway decision from its out-edges, in declaration order', () => {
    const flow = {
      edges: [
        { id: 'a', source: 'd', target: 'big', condition: { dialect: 'cel', source: 'record.amount > 5' } },
        { id: 'b', source: 'd', target: 'small', condition: 'record.amount <= 5' },
        { id: 'c', source: 'd', target: 'other', condition: { dialect: 'template', source: '{x}' } },
        { id: 'e', source: 'd', target: 'fallback', isDefault: true },
        { id: 'f', source: 'x', target: 'big' },
      ],
    };
    expect(decisionBranches(flow, { id: 'd', type: 'decision' })).toEqual([
      { key: 'a', target: 'big', guard: { kind: 'cel', source: 'record.amount > 5' } },
      { key: 'b', target: 'small', guard: { kind: 'cel', source: 'record.amount <= 5' } },
      { key: 'c', target: 'other', guard: { kind: 'opaque' } },
      { key: 'e', target: 'fallback', guard: { kind: 'otherwise' } },
    ]);
  });

  it('reads a `config.conditions` decision through the out-edge labels, and leaves out an edge no branch claims', () => {
    const node = { id: 'd', type: 'decision', config: { conditions: [{ label: 'big', expression: 'record.amount > 5' }] } };
    const flow = {
      edges: [
        { id: 'a', source: 'd', target: 'x', label: 'big' },
        { id: 'b', source: 'd', target: 'y', label: 'default' },
        { id: 'c', source: 'd', target: 'z', label: 'unclaimed' },
      ],
    };
    expect(decisionBranches(flow, node)).toEqual([
      { key: 'a', target: 'x', guard: { kind: 'cel', source: 'record.amount > 5' } },
      { key: 'b', target: 'y', guard: { kind: 'otherwise' } },
    ]);
  });

  it('answers nothing for a node that is not a decision', () => {
    expect(decisionBranches({ edges: [{ source: 'a', target: 'b' }] }, { id: 'a', type: 'approval' })).toEqual([]);
  });
});

describe('flowSubjects and entryGuard (objectstack#36094)', () => {
  const flow = {
    nodes: [
      { id: 's', type: 'start', config: { objectName: 'deal', condition: { dialect: 'cel', source: 'record.amount >= 1' } } },
      { id: 'g', type: 'get_record', config: { objectName: 'deal', outputVariable: 'row' } },
      { id: 'h', type: 'get_record', config: { objectName: 'account', outputVariable: 'acct' } },
    ],
  };

  it('resolves the trigger object and the row variables that read it, not another object’s', () => {
    const subjects = flowSubjects(flow);
    expect(subjects.object).toBe('deal');
    expect([...subjects.rowVariables]).toEqual(['row']);
    expect(subjectFieldOf(['acct', 'amount'], subjects)).toBeUndefined();
    expect(subjectFieldOf(['vars', 'row', 'amount'], subjects)).toBe('amount');
  });

  it('reads the start node’s condition as the entry guard', () => {
    expect(entryGuard(flow)).toEqual({ kind: 'cel', source: 'record.amount >= 1' });
    expect(entryGuard({ nodes: [{ id: 's', type: 'start' }] })).toEqual({ kind: 'none' });
  });
});
