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
  resolveFlowNodeValueSlots,
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

describe('FLOW_NODE_EXPRESSION_PATHS — the assignment value entry', () => {
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

/**
 * #19938 (the contract half of #11182 ruling D) — `create_record` /
 * `update_record` `fields.*` is a `value` slot, the same shape and dialect
 * rules as `assignments.*`: only an envelope-shaped TOP-LEVEL field value is
 * an expression, a `{token}` string keeps its 17.x meaning and is not
 * resolved, and every other literal is data.
 */
describe('FLOW_NODE_EXPRESSION_PATHS — the CRUD `fields.*` value entries', () => {
  const PRICE_ENVELOPE = { dialect: 'cel', source: 'round(price * 100) / 100.0' };

  it.each(['create_record', 'update_record'] as const)('declares exactly one slot for `%s`: `fields.*`, role `value`', (nodeType) => {
    const entries = FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.nodeType === nodeType);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('fields.*');
    expect(entries[0]!.role).toBe('value');
    expect(entries[0]!.label).toBe(`${nodeType} field value`);
  });

  it.each(['create_record', 'update_record'] as const)('%s: resolves the envelope field value, and only it, at the author\'s field name', (nodeType) => {
    const found = resolveFlowNodeExpressions(nodeType, {
      objectName: 'quote',
      filter: { id: '{quoteId}' },
      fields: {
        subject: 'Quote for {account.name}',   // `{token}` text — interpolation, not resolved
        owner: '{$User.Id}',
        discount: 10,
        total: PRICE_ENVELOPE,
        broken: { dialect: 'cel' },             // malformed — resolved so a validator refuses it
      },
    });
    expect(found.map((f) => f.path)).toEqual(['fields.total', 'fields.broken']);
    expect(found[0]!.value).toBe(PRICE_ENVELOPE);
    expect(found.every((f) => f.entry.role === 'value' && f.entry.nodeType === nodeType)).toBe(true);
  });

  it('only the TOP-LEVEL field value is judged — an envelope nested in a JSON value, or in an array, is data', () => {
    expect(resolveFlowNodeExpressions('create_record', {
      fields: {
        payload: { nested: { dialect: 'cel', source: 'x' } },
        tags: [{ dialect: 'cel', source: 'x' }],
        decoy: { dialect: 7, source: 'x' },
      },
    })).toEqual([]);
  });

  it('`update_record.filter` is NOT a value slot — an envelope-shaped filter value resolves nothing', () => {
    expect(resolveFlowNodeExpressions('update_record', { filter: { total: PRICE_ENVELOPE } })).toEqual([]);
  });

  it('`get_record` / `delete_record` declare no value slot — their `fields` / `filter` resolve nothing', () => {
    expect(resolveFlowNodeExpressions('get_record', { fields: ['id'], filter: { total: PRICE_ENVELOPE } })).toEqual([]);
    expect(resolveFlowNodeExpressions('delete_record', { filter: { total: PRICE_ENVELOPE } })).toEqual([]);
  });

  it('a `fields` that is not a plain object resolves nothing rather than throwing', () => {
    expect(resolveFlowNodeExpressions('create_record', { fields: [PRICE_ENVELOPE] })).toEqual([]);
    expect(resolveFlowNodeExpressions('create_record', { fields: 'nope' })).toEqual([]);
    expect(resolveFlowNodeExpressions('create_record', { fields: null })).toEqual([]);
    expect(resolveFlowNodeExpressions('create_record', {})).toEqual([]);
  });
});

describe('resolveFlowNodeValueSlots — every authored value of a `value` slot, strings included', () => {
  it('hands over every non-absent value of the CRUD `fields` map and the assignment map, by the ledger\'s own walk', () => {
    const envelope = { dialect: 'cel', source: 'price * 2' };
    expect(resolveFlowNodeValueSlots('create_record', {
      objectName: 'quote',
      fields: { subject: 'Hi {name}', total: envelope, n: 3, nothing: null, gone: undefined },
    }).map((f) => [f.path, f.value, f.entry.path])).toEqual([
      ['fields.subject', 'Hi {name}', 'fields.*'],
      ['fields.total', envelope, 'fields.*'],
      ['fields.n', 3, 'fields.*'],
      ['fields.nothing', null, 'fields.*'],
    ]);
    expect(resolveFlowNodeValueSlots('assignment', { assignments: { total: '{round(x)}' } }).map((f) => f.path))
      .toEqual(['assignments.total']);
  });

  it('reaches ONLY `value` slots — a predicate or flow-template slot, an undeclared map, a legacy shape: nothing', () => {
    expect(resolveFlowNodeValueSlots('screen', { fields: [{ visibleWhen: 'a == 1' }] })).toEqual([]);
    expect(resolveFlowNodeValueSlots('loop', { collection: '{rows}' })).toEqual([]);
    expect(resolveFlowNodeValueSlots('update_record', { filter: { id: '{x}' } })).toEqual([]);
    expect(resolveFlowNodeValueSlots('assignment', { digest: '{x}' })).toEqual([]);
    expect(resolveFlowNodeValueSlots('assignment', { assignments: [{ variable: 'd', value: '{x}' }] })).toEqual([]);
    expect(resolveFlowNodeValueSlots('create_record', null)).toEqual([]);
  });

  it('agrees with `resolveFlowNodeExpressions` on the envelope subset — one walk, two views', () => {
    const config = { fields: { a: '{x}', b: { dialect: 'cel', source: '1' }, c: { dialect: 'cel' }, d: 4 } };
    const envelopes = resolveFlowNodeValueSlots('update_record', config).filter((f) => isExpressionEnvelopeShaped(f.value));
    expect(envelopes).toEqual(resolveFlowNodeExpressions('update_record', config));
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

describe('every entry older than the value role resolves byte-identically (the ratchet\'s fixtures, restated)', () => {
  const byKey = (e: FlowNodeExpressionPath) => `${e.nodeType}.${e.path} (${e.role})`;

  it('the entries that existed before are still declared exactly as they were — the CRUD `fields.*` value slots added exactly two rows', () => {
    // The census: five rows before #19938, seven after. The two new rows are
    // the CRUD write map's `value` slots and sit at the end; every row above
    // them is byte-identical to what it was.
    expect(FLOW_NODE_EXPRESSION_PATHS.map(byKey)).toEqual([
      'screen.fields[].visibleWhen (predicate)',
      'decision.conditions[].expression (predicate)',
      'loop.collection (flow-template)',
      'map.collection (flow-template)',
      'assignment.assignments.* (value)',
      'create_record.fields.* (value)',
      'update_record.fields.* (value)',
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

  it('absent values in a string-role slot are skipped; a blank one is skipped only where no refusal applies', () => {
    expect(resolveFlowNodeExpressions('screen', {})).toEqual([]);
    expect(resolveFlowNodeExpressions('screen', { fields: [] })).toEqual([]);
    // RE-JUDGED IN PLACE (#17493, ruling A 5651023407), not deleted. This line
    // pinned `[]`: a whitespace-only STRING was "not authored", on this side
    // and at the evaluator alike, and #15572 left the string rule alone on
    // that ground — consistent on both sides. The ground is still true and was
    // ruled no defence: a blank predicate is an author's rule that was never
    // written, so the resolver now EMITS it for the `predicate` role and every
    // door refuses it through `predicateSlotRefusal`.
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: '   ' }] })
      .map((f) => [f.path, f.value, f.entry.role])).toEqual([['fields[0].visibleWhen', '   ', 'predicate']]);
    expect(resolveFlowNodeExpressions('decision', { conditions: [{ label: 'x', expression: '' }] })
      .map((f) => [f.path, f.value])).toEqual([['conditions[0].expression', '']]);
    // …and ONLY for that role: a `flow-template` slot's blank is still skipped,
    // because no validator implements that dialect and the ruling did not
    // reach it.
    expect(resolveFlowNodeExpressions('loop', { collection: '   ' })).toEqual([]);
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
  it('emits a non-string in a predicate slot, so a consumer can refuse it', () => {
    const envelope = { dialect: 'cel', source: '   ' };
    const decision = resolveFlowNodeExpressions('decision', {
      conditions: [{ label: 'Yes', expression: envelope }],
    });
    expect(decision.map((f) => [f.path, f.value, f.entry.role]))
      .toEqual([['conditions[0].expression', envelope, 'predicate']]);
    // Same rule on the other predicate slot — one class, not one node type.
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: true }] })
      .map((f) => [f.path, f.value])).toEqual([['fields[0].visibleWhen', true]]);
    // `null` / absent stay "not authored" on a slot that is NOT required — a
    // refusal needs something authored. (A `required` slot is the exception,
    // #19961: see the block below.)
    expect(resolveFlowNodeExpressions('screen', { fields: [{ visibleWhen: null }] })).toEqual([]);
  });

  /**
   * [#19961] A `required` predicate slot — `decision`'s
   * `conditions[].expression`, which `DecisionConditionSchema` declares
   * `z.string()` — emits an ABSENT or `null` value on a branch that exists, for
   * every door to refuse through `predicateSlotRefusal`. It used to be skipped
   * as "not authored", and the executor then evaluated the branch as a
   * condition with no `source` and failed the run there.
   */
  describe('a required predicate slot emits its absent value', () => {
    it('the required set is exactly the decision branch predicate — the absent arm is worded for it', () => {
      // `predicateSlotRefusal`'s absent arm names a decision branch and its
      // prescription; a second `required` entry must re-word it, so its
      // arrival fails here rather than shipping a sentence about the wrong slot.
      expect(FLOW_NODE_EXPRESSION_PATHS.filter((e) => e.required).map((e) => `${e.nodeType}.${e.path} (${e.role})`))
        .toEqual(['decision.conditions[].expression (predicate)']);
    });

    it('emits `undefined` for a branch with no `expression` key, and `null` for `expression: null`', () => {
      const found = resolveFlowNodeExpressions('decision', {
        conditions: [
          { label: 'first', expression: 'record.amount > 10' },
          { label: 'absent' },
          { label: 'null', expression: null },
          { label: 'aliased', condition: 'record.amount > 5' },
        ],
      });
      expect(found.map((f) => [f.path, f.value, f.entry.role])).toEqual([
        ['conditions[0].expression', 'record.amount > 10', 'predicate'],
        ['conditions[1].expression', undefined, 'predicate'],
        ['conditions[2].expression', null, 'predicate'],
        // The edge's spelling on a branch is not `expression`: the branch has none.
        ['conditions[3].expression', undefined, 'predicate'],
      ]);
    });

    it('judges only a branch that exists — no `conditions`, or an empty list, declares no branch', () => {
      expect(resolveFlowNodeExpressions('decision', {})).toEqual([]);
      expect(resolveFlowNodeExpressions('decision', { conditions: [] })).toEqual([]);
      expect(resolveFlowNodeExpressions('decision', { conditions: 'nope' })).toEqual([]);
    });

    it('a slot that is NOT required keeps skipping its absent value — an absent `visibleWhen` shows the field', () => {
      expect(resolveFlowNodeExpressions('screen', { fields: [{ name: 'amount' }] })).toEqual([]);
      expect(resolveFlowNodeExpressions('screen', { fields: [{ name: 'amount', visibleWhen: null }] })).toEqual([]);
    });
  });

  describe('predicateSlotRefusal — a predicate slot holds bare CEL text', () => {
    it('says nothing about a non-blank string — what it SAYS is validateExpression\'s business', () => {
      expect(predicateSlotRefusal('record.rating >= 4')).toBeUndefined();
      // Including a string that is itself malformed: the shape is right, so
      // this function is done and the CEL parse issues the verdict.
      expect(predicateSlotRefusal('{record.rating} >= 4')).toBeUndefined();
    });

    it('REFUSES a string that is blank after trimming, under the same sentence', () => {
      // RE-JUDGED IN PLACE (#17493, ruling A 5651023407), not deleted: the
      // test above used to end `expect(predicateSlotRefusal('')).toBeUndefined()`
      // on #15572's ground that the blank was treated the same on both sides.
      // That ground was ruled insufficient, so the blank moved here.
      for (const blank of ['', '   ', '\t\n ']) {
        const refusal = predicateSlotRefusal(blank);
        expect(refusal?.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL), JSON.stringify(blank)).toBe(true);
        // Attributed to what the author wrote, whitespace and all.
        expect(refusal?.source).toBe(blank);
      }
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

    /**
     * [#19961] No value at all — the resolver hands one over only for a
     * `required` slot, and this is the ONE refusal every door answers it with.
     * The prescription is the blank's minus the run it kept (an absent branch
     * predicate never evaluated — the run failed at the branch), so the
     * load-bearing clauses are pinned by name.
     */
    it('REFUSES no value at all — absent and `null` — under the same sentence, with the branch prescription', () => {
      const absent = predicateSlotRefusal(undefined);
      const nulled = predicateSlotRefusal(null);
      for (const [refusal, found] of [[absent, 'Found nothing — the key is absent'], [nulled, 'Found `null`']] as const) {
        expect(refusal?.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
        expect(refusal?.message).toContain(found);
        // The prescription: write the rule; `condition` belongs in `expression`;
        // `'false'` keeps the branch and never takes it; not by dropping the
        // only branch.
        expect(refusal?.message).toContain('Write the predicate the branch was meant to test');
        expect(refusal?.message).toContain('`condition` is the edge\'s spelling — belongs in `expression`');
        expect(refusal?.message).toContain('There is no run to keep');
        expect(refusal?.message).toContain('write `expression: \'false\'`');
        expect(refusal?.message).toContain('Not by dropping a decision\'s only branch');
        // Nothing was authored, so nothing is attributed.
        expect(refusal?.source).toBe('');
      }
      // Its own detail, never the envelope's or the blank's.
      expect(absent?.message).not.toContain('Found a undefined');
      expect(absent?.message).not.toContain('envelope is the `value`-role spelling');
      expect(absent?.message).not.toContain('the value the blank evaluated to');
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
  describe('structuralConditionRefusal — a structural condition is CEL text or an expression', () => {
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
      // Still admitted — but on the SHAPE question only, and no longer because
      // the blank is correct. #15662 admitted it as "not authored on both
      // sides"; #15807 refused it at the edge door and #17322 rebound the node
      // door at `registerFlow`, so a blank structural condition IS a defect
      // today. It is refused there by the imported evaluated-slot rule sitting
      // BESIDE this one, never by this function — which is exactly what these
      // two assertions pin. See the docblock of `structuralConditionRefusal`.
      expect(structuralConditionRefusal('   ')).toBeUndefined();
      expect(structuralConditionRefusal('')).toBeUndefined();
    });

    it('admits an absent condition — "not authored" is not a malformed one', () => {
      expect(structuralConditionRefusal(undefined)).toBeUndefined();
      expect(structuralConditionRefusal(null)).toBeUndefined();
    });

    it('admits an envelope with no dialect, and an `ast` BESIDE a string `source`', () => {
      // `evaluateCondition` already treats an envelope with no dialect as CEL,
      // and reads `source` — an `ast` next to it changes nothing it evaluates.
      expect(structuralConditionRefusal({ source: 'record.rating >= 4' })).toBeUndefined();
      expect(structuralConditionRefusal({ dialect: 'cel', source: 'record.rating >= 4', ast: { kind: 'const' } })).toBeUndefined();
    });

    it('REFUSES an `ast`-only envelope — admitted at first, refused once an evaluated slot required a `source`', () => {
      // FLIPPED. This admitted `{ dialect: 'cel', ast }` because the spec still
      // admitted the shape at `edge.condition` and refusing it here would have
      // decided #15430's question from the consumer side. #15807 decided it at
      // the producer (`FlowEdgeSchema.condition` composes the evaluated input
      // form), and the engine never read `ast` — so an `ast`-only envelope in a
      // structural slot is exactly the silent-`false` population this refusal
      // exists for, on `config.condition` (still an open record) as on the edge.
      for (const value of [{ dialect: 'cel', ast: { kind: 'const', value: true } }, { ast: { kind: 'const' } }]) {
        const refusal = structuralConditionRefusal(value);
        expect(refusal?.message.startsWith(STRUCTURAL_CONDITION_SHAPE_REFUSAL)).toBe(true);
        expect(refusal?.message).toContain('Found an object carrying an `ast` but no string `source`');
        expect(refusal?.message).toContain('the engine evaluates `source`, never `ast`');
        expect(refusal?.source).toBe('');
      }
      // The sentence itself now says why, so the prescription travels with the refusal.
      expect(STRUCTURAL_CONDITION_SHAPE_REFUSAL).toContain('an envelope carrying only an `ast` is not evaluable');
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
        .toContain('Found an object carrying no string `source`');
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
