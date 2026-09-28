// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The refusal codes this file's two refusal producers — `predicateSlotRefusal`
 * and `structuralConditionRefusal` — carry beside their English message.
 *
 * A localized designer keys its own catalogue row to the `code` and fills it
 * from the `params`; API callers, `registerFlow` and `objectstack validate`
 * keep reading the English `message`. Two kinds of pin:
 *
 *  - **One test per code** — the code, its params exactly, and the message
 *    exactly. The message pins are the control for adding the code: it rides
 *    beside the sentence every door already shows, and must not change a byte
 *    of it.
 *  - **The closed set** — every code has a pin and nothing else does; every
 *    refusal a sweep of slot values provokes, from either producer, carries a
 *    code from that producer's share of the set; and at the type level a
 *    refusal without a code does not compile.
 */

import { describe, expect, it } from 'vitest';

import {
  FLOW_SLOT_REFUSAL_CODES,
  PREDICATE_SLOT_STRING_REFUSAL,
  STRUCTURAL_CONDITION_SHAPE_REFUSAL,
  predicateSlotRefusal,
  structuralConditionRefusal,
  type FlowSlotRefusalCode,
  type FlowSlotRefusalParams,
  type PredicateSlotRefusal,
  type PredicateSlotRefusalCode,
  type StructuralConditionRefusal,
  type StructuralConditionRefusalCode,
} from './flow-node-expression-paths.js';
import * as automation from './index.js';

/** What one refusal says, whichever producer said it. */
interface Said {
  readonly code: string;
  readonly params: unknown;
  readonly message: string;
  readonly source: string;
}

interface Pin<C extends FlowSlotRefusalCode> {
  readonly produce: () => Said | undefined;
  readonly params: FlowSlotRefusalParams[C];
  readonly message: string;
  readonly source: string;
}

const slot = (value: unknown) => (): Said | undefined => predicateSlotRefusal(value);
const structural = (value: unknown) => (): Said | undefined => structuralConditionRefusal(value);

const MISSING_TAIL =
  ' where the slot is required: a decision branch is `{ label, expression }` and its `expression` is not optional, '
  + 'so a branch without one states no rule. Write the predicate the branch was meant to test (e.g. '
  + '`record.rating >= 4`); a predicate written under another key — `condition` is the edge\'s spelling — belongs '
  + 'in `expression`. There is no run to keep: the executor evaluates every branch it reaches, and a branch with no '
  + '`expression` failed the run there. To keep the branch and its label but never take it, write '
  + '`expression: \'false\'`. Not by dropping a decision\'s only branch: the node then routes by its out-edges '
  + 'alone, and the out-edge that branch labelled is no longer held back.';

const BLANK_MESSAGE =
  `${PREDICATE_SLOT_STRING_REFUSAL} Found a string that is blank after trimming, which states no rule. Write the `
  + 'predicate the branch or field was meant to test (e.g. `record.rating >= 4`), or keep what the blank did: on a '
  + 'screen field, drop the `visibleWhen` key; on a decision branch, write `expression: \'false\'`, the value the '
  + 'blank evaluated to. Not by dropping a decision\'s only branch: the node then routes by its out-edges alone, and '
  + 'the out-edge that branch labelled is no longer held back.';

const notText = (found: string): string =>
  `${PREDICATE_SLOT_STRING_REFUSAL} Found ${found}. Write the predicate as bare CEL text (e.g. `
  + '`record.rating >= 4`); the `{ dialect, source }` envelope is the `value`-role spelling (the `assignment` '
  + 'node\'s `assignments` map, a `create_record` / `update_record` node\'s `fields` map), and in a predicate slot '
  + 'it is read by the evaluator but by neither validator.';

/** The structural refusal, spelled out in full: its lead sentence is part of what is pinned. */
const STRUCTURAL_LEAD =
  'A structural condition (`config.condition` on a node, `edge.condition`) holds either BARE CEL TEXT or an '
  + 'expression envelope carrying a string `source`. No other shape is authorable there: the engine evaluates '
  + '`source`, so an envelope carrying only an `ast` is not evaluable.';

const shape = (found: string): string =>
  `${STRUCTURAL_LEAD} Found ${found}. Write the condition as bare CEL text (e.g. \`record.rating >= 4\`), or as an `
  + 'expression envelope (`{ dialect: \'cel\', source: \'…\' }`). A value that is neither is read by the evaluator '
  + 'as an EMPTY condition, which answers `false` without saying anything — and on a start node that is the '
  + 'trigger gate.';

/**
 * Every code, its primary case first. The mapped type makes a code without a
 * pin a type error in this file; the first closed-set test makes it a red run.
 */
const PINS: { readonly [C in FlowSlotRefusalCode]: readonly [Pin<C>, ...Pin<C>[]] } = {
  'predicate-slot-missing': [
    {
      produce: slot(undefined),
      params: { found: 'absent' },
      message: `${PREDICATE_SLOT_STRING_REFUSAL} Found nothing — the key is absent${MISSING_TAIL}`,
      source: '',
    },
    {
      produce: slot(null),
      params: { found: 'null' },
      message: `${PREDICATE_SLOT_STRING_REFUSAL} Found \`null\`${MISSING_TAIL}`,
      source: '',
    },
  ],
  'predicate-slot-blank': [
    { produce: slot(''), params: {}, message: BLANK_MESSAGE, source: '' },
    { produce: slot('  \t\n'), params: {}, message: BLANK_MESSAGE, source: '  \t\n' },
  ],
  'predicate-slot-not-text': [
    {
      produce: slot({ dialect: 'cel', source: 'record.x > 1' }),
      params: { found: 'envelope' },
      message: notText('an expression envelope (an object naming a `dialect`)'),
      source: 'record.x > 1',
    },
    {
      produce: slot({ dialect: 'cel' }),
      params: { found: 'envelope' },
      message: notText('an expression envelope (an object naming a `dialect`)'),
      source: '',
    },
    { produce: slot(['a']), params: { found: 'array' }, message: notText('an array'), source: '' },
    { produce: slot({ a: 1 }), params: { found: 'object' }, message: notText('an object'), source: '' },
    { produce: slot(42), params: { found: 'number' }, message: notText('a number'), source: '' },
    { produce: slot(true), params: { found: 'boolean' }, message: notText('a boolean'), source: '' },
    { produce: slot(10n), params: { found: 'bigint' }, message: notText('a bigint'), source: '' },
    { produce: slot(Symbol('s')), params: { found: 'symbol' }, message: notText('a symbol'), source: '' },
    { produce: slot(() => 1), params: { found: 'function' }, message: notText('a function'), source: '' },
  ],
  'structural-condition-shape': [
    {
      produce: structural({ dialect: 'cel', ast: { kind: 'const', value: true } }),
      params: { found: 'ast-without-source' },
      message: shape('an object carrying an `ast` but no string `source` — the engine evaluates `source`, never `ast`'),
      source: '',
    },
    {
      produce: structural({ ast: { kind: 'const' }, source: 2 }),
      params: { found: 'ast-without-source' },
      message: shape('an object carrying an `ast` but no string `source` — the engine evaluates `source`, never `ast`'),
      source: '',
    },
    {
      produce: structural({ dialect: 'cel', source: 1 }),
      params: { found: 'object-without-source' },
      message: shape('an object carrying no string `source`'),
      source: '',
    },
    { produce: structural({}), params: { found: 'object-without-source' }, message: shape('an object carrying no string `source`'), source: '' },
    { produce: structural(['a']), params: { found: 'array' }, message: shape('an array'), source: '' },
    { produce: structural(42), params: { found: 'number' }, message: shape('a number'), source: '' },
    { produce: structural(false), params: { found: 'boolean' }, message: shape('a boolean'), source: '' },
    { produce: structural(10n), params: { found: 'bigint' }, message: shape('a bigint'), source: '' },
    { produce: structural(Symbol('s')), params: { found: 'symbol' }, message: shape('a symbol'), source: '' },
    { produce: structural(() => 1), params: { found: 'function' }, message: shape('a function'), source: '' },
  ],
};

describe('flow slot refusal codes — one pin per code (code, params, unchanged message)', () => {
  for (const code of FLOW_SLOT_REFUSAL_CODES) {
    it(code, () => {
      const cases = PINS[code] as readonly Pin<typeof code>[];
      for (const pin of cases) {
        const refusal = pin.produce();
        expect(refusal).toBeDefined();
        expect(refusal!.code).toBe(code);
        expect(refusal!.params).toEqual(pin.params);
        expect(refusal!.message).toBe(pin.message);
        expect(refusal!.source).toBe(pin.source);
      }
    });
  }

  it('the structural lead sentence is the published constant, byte for byte', () => {
    expect(STRUCTURAL_CONDITION_SHAPE_REFUSAL).toBe(STRUCTURAL_LEAD);
  });
});

/** Slot values of every shape — the sweep judges whatever each one provokes. */
const SWEEP: readonly unknown[] = [
  undefined,
  null,
  '',
  ' ',
  '\t\n',
  'record.rating >= 4',
  'x',
  { dialect: 'cel', source: 'x' },
  { dialect: 'cel' },
  { dialect: 'cel', source: 1 },
  { source: 'x' },
  { ast: { kind: 'const' } },
  { dialect: 'cel', ast: { kind: 'const' }, source: 'x' },
  {},
  [],
  ['x'],
  0,
  42,
  Number.NaN,
  true,
  false,
  10n,
  Symbol('s'),
  () => 1,
  new Date(0),
];

const PREDICATE_SLOT_CODES: ReadonlySet<PredicateSlotRefusalCode> = new Set<PredicateSlotRefusalCode>([
  'predicate-slot-missing',
  'predicate-slot-blank',
  'predicate-slot-not-text',
]);
const STRUCTURAL_CODES: ReadonlySet<StructuralConditionRefusalCode> = new Set<StructuralConditionRefusalCode>([
  'structural-condition-shape',
]);

describe('flow slot refusal codes — the closed set', () => {
  it('has a pin for every code, and no pin for a code outside the set', () => {
    expect(Object.keys(PINS).sort()).toEqual([...FLOW_SLOT_REFUSAL_CODES].sort());
    expect(new Set(FLOW_SLOT_REFUSAL_CODES).size).toBe(FLOW_SLOT_REFUSAL_CODES.length);
    for (const code of FLOW_SLOT_REFUSAL_CODES) expect(code).toMatch(/^[a-z]+(?:-[a-z]+)+$/);
  });

  it('splits between the two producers with nothing left over', () => {
    expect([...PREDICATE_SLOT_CODES, ...STRUCTURAL_CODES].sort()).toEqual([...FLOW_SLOT_REFUSAL_CODES].sort());
  });

  it('is published from the automation entry, frozen', () => {
    expect(automation.FLOW_SLOT_REFUSAL_CODES).toBe(FLOW_SLOT_REFUSAL_CODES);
    expect(Object.isFrozen(FLOW_SLOT_REFUSAL_CODES)).toBe(true);
  });

  it('every predicateSlotRefusal on the sweep carries a predicate-slot code, and every one is reached', () => {
    const provoked = new Set<string>();
    for (const value of SWEEP) {
      const refusal = predicateSlotRefusal(value);
      if (refusal === undefined) {
        // Only a non-blank string is admitted; its CEL is another validator's business.
        expect(typeof value === 'string' && value.trim() !== '').toBe(true);
        continue;
      }
      expect(PREDICATE_SLOT_CODES.has(refusal.code as PredicateSlotRefusalCode)).toBe(true);
      expect(typeof refusal.params).toBe('object');
      expect(refusal.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
      provoked.add(refusal.code);
    }
    expect([...provoked].sort()).toEqual([...PREDICATE_SLOT_CODES].sort());
  });

  it('every structuralConditionRefusal on the sweep carries a structural code, and every one is reached', () => {
    const provoked = new Set<string>();
    let refused = 0;
    for (const value of SWEEP) {
      const refusal = structuralConditionRefusal(value);
      if (refusal === undefined) {
        // Admitted: absent, any string, or an object carrying a string `source`.
        const admitted =
          value == null
          || typeof value === 'string'
          || (typeof value === 'object' && !Array.isArray(value) && typeof (value as { source?: unknown }).source === 'string');
        expect(admitted).toBe(true);
        continue;
      }
      refused++;
      expect(STRUCTURAL_CODES.has(refusal.code as StructuralConditionRefusalCode)).toBe(true);
      expect(typeof refusal.params).toBe('object');
      expect(refusal.message.startsWith(STRUCTURAL_CONDITION_SHAPE_REFUSAL)).toBe(true);
      provoked.add(refusal.code);
    }
    expect(refused).toBeGreaterThan(10);
    expect([...provoked].sort()).toEqual([...STRUCTURAL_CODES].sort());
  });

  it('a refusal without a code does not type-check, on either producer', () => {
    // @ts-expect-error — `code` and `params` are required on every predicate slot refusal.
    const noCode: PredicateSlotRefusal = { message: 'm', source: '' };
    // @ts-expect-error — a code's params are its own: `predicate-slot-blank` carries no `found`.
    const wrongParams: PredicateSlotRefusal = { message: 'm', source: '', code: 'predicate-slot-blank', params: { found: 'null' } };
    // @ts-expect-error — `code` and `params` are required on every structural condition refusal.
    const noStructuralCode: StructuralConditionRefusal = { message: 'm', source: '' };
    // @ts-expect-error — each producer emits only its own codes: a structural refusal is never a predicate-slot code.
    const foreignCode: StructuralConditionRefusal = { message: 'm', source: '', code: 'predicate-slot-blank', params: {} };
    expect([noCode, wrongParams, noStructuralCode, foreignCode]).toHaveLength(4);
  });
});
