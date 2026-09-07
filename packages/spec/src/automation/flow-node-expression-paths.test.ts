// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FLOW_NODE_EXPRESSION_PATHS` — the `value` role and the `assignment` entry
 * (#14149, maintainer ruling 2026-09-02: option A, the rendering half).
 *
 * The ledger's two consumers (`service-automation`'s `registerFlow` pass and
 * `@objectstack/lint`) and its reconciliation ratchet live outside this
 * package; what THIS file pins is the contract they read: the entry exists
 * with the ruled role, the `*` wildcard resolves each authored variable's
 * value, only the envelope form is emitted for the `value` role, and every
 * entry that existed before resolves byte-identically (the fixtures under
 * "unchanged" are the ratchet's own cases, restated here so a resolver edit
 * that moves them fails where the edit is made).
 */

import { describe, expect, it } from 'vitest';

import {
  FLOW_NODE_EXPRESSION_PATHS,
  isExpressionEnvelopeShaped,
  resolveFlowNodeExpressions,
  predicateSlotRefusal,
  PREDICATE_SLOT_STRING_REFUSAL,
  structuralConditionRefusal,
  STRUCTURAL_CONDITION_SHAPE_REFUSAL,
  type FlowNodeExpressionPath,
  type FlowNodeExpressionRole,
} from './flow-node-expression-paths.js';

/** The ruling's example — the declared stdlib, reachable from metadata. */
const DIGEST_SOURCE = 'joinNonEmpty(overdue_tasks.map(t, t.subject), "\\n")';
const DIGEST_ENVELOPE = { dialect: 'cel', source: DIGEST_SOURCE };

/** A two-variable assignment: one `{token}` interpolation, one CEL value envelope. */
const TWO_VARIABLE_ASSIGNMENT = {
  assignments: {
    owner_name: '{manager.name}',
    digest: DIGEST_ENVELOPE,
  },
};

describe('FLOW_NODE_EXPRESSION_PATHS — the assignment value entry (#14149)', () => {
  const entry = FLOW_NODE_EXPRESSION_PATHS.find((e) => e.nodeType === 'assignment');

  it('declares exactly one slot for `assignment`: `assignments.*`, role `value`', () => {
    expect(entry, 'the ruled entry: an assignment value may be a CEL envelope').toBeDefined();
    expect(entry!.path).toBe('assignments.*');
    expect(entry!.role).toBe('value');
    expect(entry!.label).toBe('assignment value');
    expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === 'assignment')).toHaveLength(1);
  });

  it('the role union carries `value` beside `predicate` and `flow-template`', () => {
    // A type-level pin: the union is what downstream consumers switch on.
    const roles: FlowNodeExpressionRole[] = ['predicate', 'flow-template', 'value'];
    expect(new Set(FLOW_NODE_EXPRESSION_PATHS.map((e) => e.role))).toEqual(new Set(roles));
  });

  it('resolves the envelope value of a two-variable assignment, and only it', () => {
    const found = resolveFlowNodeExpressions('assignment', TWO_VARIABLE_ASSIGNMENT);
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe('assignments.digest');
    expect(found[0]!.entry).toBe(entry);
    expect(found[0]!.entry.role).toBe('value');
    // The value is handed over verbatim — the envelope, not its source — so a
    // consumer can pass it straight to `validateExpression('value', envelope)`.
    expect(found[0]!.value).toBe(DIGEST_ENVELOPE);
    expect((found[0]!.value as { source: string }).source).toContain('joinNonEmpty(');
  });

  it('a `{token}` string in a value slot is interpolation, not an expression — skipped', () => {
    expect(resolveFlowNodeExpressions('assignment', { assignments: { owner_name: '{manager.name}' } })).toEqual([]);
    // Bare CEL as a STRING is not CEL here either: a plain string has always
    // meant flow interpolation in this slot, and the envelope is the only CEL
    // spelling — so `'a + b'` is the literal text `a + b`, and not resolved.
    expect(resolveFlowNodeExpressions('assignment', { assignments: { sum: 'a + b' } })).toEqual([]);
  });

  it('literals that are not envelope-shaped are data, not expressions', () => {
    expect(resolveFlowNodeExpressions('assignment', {
      assignments: { n: 1, ok: true, nothing: null, list: [1, 2], obj: { source: 'x' } },
    })).toEqual([]);
  });

  it('a MALFORMED envelope is still resolved — so the validator refuses it instead of the store keeping it', () => {
    const found = resolveFlowNodeExpressions('assignment', { assignments: { digest: { dialect: 'cel' } } });
    expect(found.map((f) => f.path)).toEqual(['assignments.digest']);
    expect(found[0]!.value).toEqual({ dialect: 'cel' });
  });

  it('resolves every authored key of the map, in authoring order, with concrete paths', () => {
    const found = resolveFlowNodeExpressions('assignment', {
      assignments: {
        a: { dialect: 'cel', source: '1' },
        b: '{x}',
        c: { dialect: 'cel', source: '2' },
      },
    });
    expect(found.map((f) => f.path)).toEqual(['assignments.a', 'assignments.c']);
  });

  it('the legacy shapes are not declared: bare config keys and the array form resolve nothing', () => {
    // Bare `{ <variable>: <value> }` — envelope-shaped or not, these are the
    // literal values they always were; the ledger declares the canonical map.
    expect(resolveFlowNodeExpressions('assignment', { digest: DIGEST_ENVELOPE })).toEqual([]);
    // `assignments: [{ variable, value }]` — `*` over an array is not a map of
    // authored keys and must not invent index paths.
    expect(resolveFlowNodeExpressions('assignment', {
      assignments: [{ variable: 'digest', value: DIGEST_ENVELOPE }],
    })).toEqual([]);
    // The ratchet's own pin, kept true: `config.condition` is structural.
    expect(resolveFlowNodeExpressions('assignment', { condition: 'a == b' })).toEqual([]);
  });

  it('a wildcard against a non-object resolves nothing rather than throwing', () => {
    expect(resolveFlowNodeExpressions('assignment', {})).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', { assignments: 'nope' })).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', { assignments: null })).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', { assignments: 42 })).toEqual([]);
    expect(resolveFlowNodeExpressions('assignment', null)).toEqual([]);
  });
});

describe('isExpressionEnvelopeShaped — the recognizer a value slot discriminates on', () => {
  it('is a plain object with a string `dialect`, and nothing else', () => {
    expect(isExpressionEnvelopeShaped({ dialect: 'cel', source: '1' })).toBe(true);
    expect(isExpressionEnvelopeShaped({ dialect: 'cel' })).toBe(true); // malformed, but envelope-SHAPED
    expect(isExpressionEnvelopeShaped({ dialect: 'nope', source: '1' })).toBe(true); // the validator's call
    expect(isExpressionEnvelopeShaped({ dialect: 1, source: '1' })).toBe(false);
    expect(isExpressionEnvelopeShaped({ source: '1' })).toBe(false);
    expect(isExpressionEnvelopeShaped('{ dialect: cel }')).toBe(false);
    expect(isExpressionEnvelopeShaped(['dialect'])).toBe(false);
    expect(isExpressionEnvelopeShaped(null)).toBe(false);
    expect(isExpressionEnvelopeShaped(undefined)).toBe(false);
  });
});

describe('every pre-#14149 entry resolves byte-identically (the ratchet\'s fixtures, restated)', () => {
  const byKey = (e: FlowNodeExpressionPath) => `${e.nodeType}.${e.path} (${e.role})`;

  it('the four entries that existed before are still declared exactly as they were', () => {
    expect(FLOW_NODE_EXPRESSION_PATHS.map(byKey)).toEqual([
      'screen.fields[].visibleWhen (predicate)',
      'decision.conditions[].expression (predicate)',
      'loop.collection (flow-template)',
      'map.collection (flow-template)',
      'assignment.assignments.* (value)',
    ]);
  });

  it('screen: each element of a field repeater, with its index', () => {
    const found = resolveFlowNodeExpressions('screen', {
      fields: [
        { name: 'createOpportunity', type: 'boolean' },
        { name: 'opportunityName', visibleWhen: 'createOpportunity == true' },
        { name: 'opportunityAmount', visibleWhen: 'createOpportunity == true' },
      ],
    });
    expect(found.map((f) => [f.path, f.value])).toEqual([
      ['fields[1].visibleWhen', 'createOpportunity == true'],
      ['fields[2].visibleWhen', 'createOpportunity == true'],
    ]);
    expect(found.every((f) => f.entry.role === 'predicate')).toBe(true);
  });

  it('loop / map: the top-level flow-template slot, still a string', () => {
    const loop = resolveFlowNodeExpressions('loop', { collection: '{tasks}' });
    expect(loop.map((f) => [f.path, f.value, f.entry.role])).toEqual([['collection', '{tasks}', 'flow-template']]);
    const map = resolveFlowNodeExpressions('map', { collection: '{tasks}' });
    expect(map.map((f) => [f.path, f.value, f.entry.role])).toEqual([['collection', '{tasks}', 'flow-template']]);
  });

  it('decision: each branch predicate, with its index', () => {
    const found = resolveFlowNodeExpressions('decision', {
      conditions: [
        { label: 'Yes', expression: "lead.status == 'converted'" },
        { label: 'No', expression: 'true' },
      ],
    });
    expect(found.map((f) => f.path)).toEqual(['conditions[0].expression', 'conditions[1].expression']);
    expect(found.every((f) => f.entry.role === 'predicate')).toBe(true);
  });

  it('absent and empty values in a string-role slot are skipped', () => {
    expect(resolveFlowNodeExpressions('screen', {})).toEqual([]);
    expect(resolveFlowNodeExpressions('screen', { fields: [] })).toEqual([]);
    // A whitespace-only STRING is "not authored", on this side and at the
    // evaluator alike — consistent on both sides, and deliberately left alone
    // (#15572 changed the non-string rule, never the string one).
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: '   ' }] })).toEqual([]);
    expect(resolveFlowNodeExpressions('screen', { fields: 'nope' })).toEqual([]);
    // A `flow-template` slot keeps the old rule: no validator implements that
    // dialect, so emitting a non-string there would hand every consumer a
    // finding none of them can judge.
    expect(resolveFlowNodeExpressions('loop', { collection: { dialect: 'cel', source: 'x' } })).toEqual([]);
    expect(resolveFlowNodeExpressions('decision', { condition: 'a == b' })).toEqual([]);
  });

  /**
   * [#15572] A NON-string in a `predicate` slot is emitted, so a consumer can
   * refuse it. It used to be skipped as "a type violation for the schema pass
   * to report" — and for `decision`, a schemaless node type whose config is
   * never parsed against any Zod schema, there is no schema pass, so the value
   * reached the evaluator with no validator having ever seen it.
   */
  it('emits a non-string in a predicate slot, so a consumer can refuse it (#15572)', () => {
    const envelope = { dialect: 'cel', source: '   ' };
    const decision = resolveFlowNodeExpressions('decision', {
      conditions: [{ label: 'Yes', expression: envelope }],
    });
    expect(decision.map((f) => [f.path, f.value, f.entry.role]))
      .toEqual([['conditions[0].expression', envelope, 'predicate']]);
    // Same rule on the other predicate slot — one class, not one node type.
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: true }] })
      .map((f) => [f.path, f.value])).toEqual([['fields[0].visibleWhen', true]]);
    // `null` / absent stay "not authored" — a refusal needs something authored.
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: null }] })).toEqual([]);
  });

  describe('predicateSlotRefusal (#15572)', () => {
    it('says nothing about a string — what it SAYS is validateExpression\'s business', () => {
      expect(predicateSlotRefusal('record.rating >= 4')).toBeUndefined();
      // Including a string that is itself malformed: the shape is right, so
      // this function is done and the CEL parse issues the verdict.
      expect(predicateSlotRefusal('{record.rating} >= 4')).toBeUndefined();
      expect(predicateSlotRefusal('')).toBeUndefined();
    });

    it('refuses an envelope and attributes it to the envelope\'s own source', () => {
      const refusal = predicateSlotRefusal({ dialect: 'cel', source: 'rows.map(r,' });
      expect(refusal?.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
      expect(refusal?.message).toContain('an expression envelope');
      expect(refusal?.source).toBe('rows.map(r,');
    });

    it('refuses every other non-string, naming what it found', () => {
      expect(predicateSlotRefusal(42)?.message).toContain('a number');
      expect(predicateSlotRefusal(true)?.message).toContain('a boolean');
      expect(predicateSlotRefusal(['a'])?.message).toContain('an array');
      expect(predicateSlotRefusal({ source: 'x' })?.message).toContain('an object');
      // No `dialect` ⇒ not envelope-shaped, so no source is claimed from it.
      expect(predicateSlotRefusal({ source: 'x' })?.source).toBe('x');
      expect(predicateSlotRefusal(42)?.source).toBe('');
    });
  });
  /**
   * [#15662] The STRUCTURAL condition arm — `config.condition` on any node and
   * `edge.condition`.
   *
   * The whole point of a second refusal is that it is NOT the ledger arm's
   * rule, so the first test here is the one that would fail if somebody
   * "unified" them: an expression envelope is legitimate on this arm and must
   * be admitted, while `predicateSlotRefusal` refuses it.
   */
  describe('structuralConditionRefusal (#15662)', () => {
    it('is NOT predicateSlotRefusal — an envelope is legitimate here and refused there', () => {
      const envelope = { dialect: 'cel', source: 'record.rating >= 4' };
      // The measured reason: `FlowEdgeSchema.condition` is
      // `ExpressionInputSchema`, whose string arm transforms into exactly this
      // shape, so after `FlowSchema.parse` every authored edge condition IS an
      // envelope. The ledger rule here would refuse every conditional edge.
      expect(structuralConditionRefusal(envelope)).toBeUndefined();
      expect(predicateSlotRefusal(envelope)).toBeDefined();
    });

    it('admits every string — what it SAYS is validateExpression\'s business', () => {
      expect(structuralConditionRefusal('record.rating >= 4')).toBeUndefined();
      expect(structuralConditionRefusal('{record.rating} >= 4')).toBeUndefined();
      // Ruled correct, not a defect: a whitespace-only STRING means "not
      // authored" on both sides and stays so.
      expect(structuralConditionRefusal('   ')).toBeUndefined();
      expect(structuralConditionRefusal('')).toBeUndefined();
    });

    it('admits an absent condition — "not authored" is not a malformed one', () => {
      expect(structuralConditionRefusal(undefined)).toBeUndefined();
      expect(structuralConditionRefusal(null)).toBeUndefined();
    });

    it('admits an envelope with no dialect, and an ast-only one', () => {
      // `evaluateCondition` already treats an envelope with no dialect as CEL,
      // and `ExpressionSchema`'s own refine is `source` OR `ast` — read here,
      // not re-derived.
      expect(structuralConditionRefusal({ source: 'record.rating >= 4' })).toBeUndefined();
      expect(structuralConditionRefusal({ dialect: 'cel', ast: { kind: 'const' } })).toBeUndefined();
    });

    it('refuses the values measured to register clean and answer a silent false', () => {
      for (const [value, found] of [[42, 'a number'], [true, 'a boolean'], [['a'], 'an array']] as const) {
        const refusal = structuralConditionRefusal(value);
        expect(refusal?.message.startsWith(STRUCTURAL_CONDITION_SHAPE_REFUSAL)).toBe(true);
        expect(refusal?.message).toContain(`Found ${found}`);
        expect(refusal?.source).toBe('');
      }
    });

    it('refuses an object that is neither text nor an expression', () => {
      // `{ source: 1 }` is the one that did not even reach the silent `false`:
      // it threw a bare `TypeError: exprStr.trim is not a function`.
      expect(structuralConditionRefusal({ source: 1 })?.message)
        .toContain('neither a string `source` nor an `ast`');
      // An envelope carrying neither — `ExpressionSchema`'s refine rejects it
      // too, and the evaluator reads it as an empty condition.
      expect(structuralConditionRefusal({ dialect: 'cel' })).toBeDefined();
      expect(structuralConditionRefusal({})).toBeDefined();
      // A non-string `source` is exactly what is refused, so it is never the
      // attribution.
      expect(structuralConditionRefusal({ source: 1 })?.source).toBe('');
    });
  });
});
