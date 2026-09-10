// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Every shape `evaluateValueEnvelope` can be handed fails ATTRIBUTED** (#16439)
 * — the exhaustive sweep the card is built on, pinned as one table.
 *
 * `AutomationEngine.evaluateValueEnvelope` is a public method on an exported
 * class, so its argument is not only what the `assignment` executor produces:
 * the executor guards the call with `isExpressionEnvelopeShaped`, but a DIRECT
 * caller has no such door. Driven across the ten shapes the card enumerates,
 * eight folded into one attributed refusal — a `where`, the source, and the
 * published rule sentence — and exactly two, `null` and `undefined`, fell
 * through as a bare `TypeError: Cannot read properties of null (reading
 * 'source')`. One cell left over after an exhaustive sweep, which is what makes
 * it the exception rather than the rule.
 *
 * ⚠️ The regression is the WHOLE table, not the two repaired cells. A test
 * covering only `null` / `undefined` could not show the other eight were left
 * alone, and "left the other eight alone" is most of what makes the fix safe —
 * so every row is pinned to its message BYTE-FOR-BYTE. The eight literals below
 * were captured on the unfixed tree at `origin/main` and must not drift; the
 * two new ones join them in the same shape.
 *
 * Composed from the published constants wherever one exists
 * (`ASSIGNMENT_VALUE_ENVELOPE_REFUSAL`, `EVALUATED_EXPRESSION_SOURCE_REQUIRED`)
 * so this file re-spells no sentence that has an owner. The two fragments below
 * that ARE literal belong to `@objectstack/formula`, which deliberately does not
 * export them (`validate.ts`: "the published surface … does not move for this
 * fix"); a legitimate rewording there re-captures this table rather than
 * loosening it.
 *
 * The refusal is stated in the SHARED `valueEnvelopeRefusals` — the same call
 * `registerFlow` makes — never as a guard in the evaluator, so registration's
 * reject set and evaluation's reject set stay one set by construction. The two
 * readings that show this adds nothing to what `registerFlow` rejects are
 * pinned at the bottom of this file, together with the deliberate asymmetry on
 * the condition side, which this card must NOT harmonise away.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ASSIGNMENT_VALUE_ENVELOPE_REFUSAL,
  FlowSchema,
  isExpressionEnvelopeShaped,
  resolveFlowNodeExpressions,
  structuralConditionRefusal,
} from '@objectstack/spec/automation';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';

function createTestLogger(): any {
  return {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    child: () => createTestLogger(),
  };
}
function createCtx(): any {
  return { logger: createTestLogger(), getService: () => undefined };
}

/** The `where` every attributed refusal must carry — the slot's own ledger path. */
const WHERE = 'assignments.digest';

/** `@objectstack/formula`'s non-string-`source` refusal, unexported by design. */
const NON_STRING_SOURCE =
  'invalid value envelope: an expression envelope carries its expression as a string `source` — found a number. '
  + "Write the expression as bare text (e.g. `record.rating >= 4`), or as an envelope whose `source` is that text "
  + "(e.g. `{ dialect: 'cel', source: '…' }`).";

/** The CEL engine's own fault for an envelope it cannot run, unexported by design. */
const AST_ONLY = 'AST-only evaluation not yet supported; persist `source`';

/** A refusal raised by `valueEnvelopeRefusals`: rule sentence, detail, source. */
const refusal = (detail: string) => `${WHERE}: ${ASSIGNMENT_VALUE_ENVELOPE_REFUSAL} ${detail} — source: \`\``;
/** A located CEL fault raised after the refusals pass found nothing. */
const celFault = (detail: string) => `${WHERE}: value expression failed to evaluate as CEL: ${detail} — source: \`\`.`;

/**
 * The card's table, every row. `attributedBefore` records which rows already
 * failed attributed on the unfixed tree — the eight that must not move, versus
 * the two this card repairs.
 */
const TABLE: ReadonlyArray<{
  label: string;
  value: unknown;
  message: string;
  attributedBefore: boolean;
}> = [
  { label: '{ source: 1 }', value: { source: 1 }, attributedBefore: true, message: refusal(NON_STRING_SOURCE) },
  {
    label: "{ dialect: 'cel', source: 1 }", value: { dialect: 'cel', source: 1 }, attributedBefore: true,
    message: refusal('`source`: ' + EVALUATED_EXPRESSION_SOURCE_REQUIRED),
  },
  {
    label: "{ dialect: 'cel', source: {} }", value: { dialect: 'cel', source: {} }, attributedBefore: true,
    message: refusal('`source`: ' + EVALUATED_EXPRESSION_SOURCE_REQUIRED),
  },
  {
    label: '{ ast, source: 1 }', value: { ast: { op: 'value' }, source: 1 }, attributedBefore: true,
    message: refusal(NON_STRING_SOURCE),
  },
  {
    label: "{ dialect: 'cel' }", value: { dialect: 'cel' }, attributedBefore: true,
    message: refusal('`source`: ' + EVALUATED_EXPRESSION_SOURCE_REQUIRED),
  },
  // Not envelope-shaped and not nullish: both validators pass, `.source` reads
  // `undefined` off a boxed primitive / an array / a plain object, and the CEL
  // engine faults on the empty source — located, and carrying it.
  { label: '42', value: 42, attributedBefore: true, message: celFault(AST_ONLY) },
  { label: "['a']", value: ['a'], attributedBefore: true, message: celFault(AST_ONLY) },
  { label: '{}', value: {}, attributedBefore: true, message: celFault(AST_ONLY) },
  // The two cells this card repairs. Before: `TypeError: Cannot read properties
  // of null (reading 'source')`, with no `where`, no source and no rule.
  {
    label: 'null', value: null, attributedBefore: false,
    message: refusal(
      'no envelope was passed: the argument is `null`, so there is nothing to evaluate. An absent envelope is '
      + "not \"not authored\" — the predicate side admits absence because the condition field is optional, but a "
      + "value slot's envelope IS the value. Write `{ dialect: 'cel', source: '…' }`.",
    ),
  },
  {
    label: 'undefined', value: undefined, attributedBefore: false,
    message: refusal(
      'no envelope was passed: the argument is `undefined`, so there is nothing to evaluate. An absent envelope '
      + "is not \"not authored\" — the predicate side admits absence because the condition field is optional, but "
      + "a value slot's envelope IS the value. Write `{ dialect: 'cel', source: '…' }`.",
    ),
  },
];

/** The thrown error, so a pin can assert its class and its message. */
function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the call to throw');
}

describe('evaluateValueEnvelope — every shape fails attributed (#16439)', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  it.each(TABLE)('$label — attributed, byte for byte', ({ value, message }) => {
    // The cast is the surface itself: the declared parameter is an envelope, so
    // only an untyped direct caller reaches the nullish rows. That is precisely
    // the caller this card exists for.
    const error = catchError(() => engine.evaluateValueEnvelope(value as any, new Map(), WHERE));

    // ⛔ Not a `TypeError` — the failure mode this card removes. Asserted as the
    // class, so a future refactor cannot satisfy the message pin with a throw
    // that is still a language-level fault.
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);

    // Attributed: the `where` leads, the source is carried, and the message is
    // byte-identical to what this shape has always produced.
    expect(error.message.startsWith(`${WHERE}: `), 'the refusal must carry its `where`').toBe(true);
    expect(error.message).toContain('source: `');
    expect(error.message).toBe(message);
  });

  it('the table is the card\'s table: ten shapes, eight already attributed, two repaired', () => {
    expect(TABLE).toHaveLength(10);
    expect(TABLE.filter((row) => row.attributedBefore)).toHaveLength(8);
    expect(TABLE.filter((row) => !row.attributedBefore).map((row) => row.label)).toEqual(['null', 'undefined']);
  });

  it('every row leads with the published rule or a located CEL fault — no third vocabulary', () => {
    for (const row of TABLE) {
      const rest = row.message.slice(`${WHERE}: `.length);
      const known =
        rest.startsWith(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL) || rest.startsWith('value expression failed to evaluate as CEL:');
      expect(known, `${row.label} must lead with a published sentence`).toBe(true);
    }
  });
});

describe('the refusal is the SHARED one — registration and evaluation stay one set (#16439)', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  /**
   * Why teaching the shared refusal costs the registration side nothing —
   * measured, not assumed. The value-role feeder emits ONLY envelope-shaped
   * objects, and neither nullish shape is one, so `registerFlow` never presents
   * a nullish value to `valueEnvelopeRefusals` at all.
   */
  it('the value-role feeder never emits a nullish value, so registration cannot reach the new rule', () => {
    expect(isExpressionEnvelopeShaped(null)).toBe(false);
    expect(isExpressionEnvelopeShaped(undefined)).toBe(false);

    const emitted = resolveFlowNodeExpressions('assignment', {
      assignments: { nothing: null, absent: undefined, ok: { dialect: 'cel', source: '1' } },
    });
    expect(emitted.map((e) => e.path)).toEqual(['assignments.ok']);
  });

  /**
   * The other half of the same reading, and the one triage asked for by name:
   * an authored `null` in a declared `value` slot parses today. It still does —
   * `null` in an assignment map is a literal, and this card does not touch that.
   */
  it('`FlowSchema.parse` still accepts an authored `null` in a declared `value` slot, and the flow still registers', () => {
    const flow = {
      name: 'assign_flow', label: 'Assign Flow', type: 'autolaunched' as const,
      variables: [{ name: 'digest', type: 'text', isOutput: true }],
      nodes: [
        { id: 'start', type: 'start' as const, label: 'Start' },
        { id: 'assign', type: 'assignment' as const, label: 'Set', config: { assignments: { nothing: null } } },
        { id: 'end', type: 'end' as const, label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'assign' },
        { id: 'e2', source: 'assign', target: 'end' },
      ],
    };
    const parsed = FlowSchema.safeParse(flow);
    expect(parsed.success).toBe(true);
    expect((parsed as any).data.nodes[1].config).toEqual({ assignments: { nothing: null } });
    expect(() => engine.registerFlow('assign_flow', flow as any)).not.toThrow();
  });

  /** An authored `null` still assigns `null` — the executor path is untouched. */
  it('an authored `null` still assigns the literal `null` at run time', async () => {
    const flow = {
      name: 'assign_null', label: 'Assign Null', type: 'autolaunched' as const,
      variables: [{ name: 'digest', type: 'text', isOutput: true }],
      nodes: [
        { id: 'start', type: 'start' as const, label: 'Start' },
        { id: 'assign', type: 'assignment' as const, label: 'Set', config: { assignments: { digest: null } } },
        { id: 'end', type: 'end' as const, label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'assign' },
        { id: 'e2', source: 'assign', target: 'end' },
      ],
    };
    engine.registerFlow('assign_null', flow as any);
    const result = await engine.execute('assign_null', {} as any);
    expect(result.success).toBe(true);
    expect((result.output as Record<string, unknown> | undefined)?.digest ?? null).toBeNull();
  });
});

describe('the condition side does not move — the asymmetry is deliberate (#16439)', () => {
  /**
   * ⛔ This card must not "harmonise" the predicate path. `null` / `undefined`
   * are admitted there ON PURPOSE: the condition FIELD is optional, so absence
   * means "the author wrote no predicate". A value slot's envelope IS the value,
   * which is why the same absence is refused on this side and only this side.
   */
  it('`structuralConditionRefusal` still returns nothing for `null` / `undefined`', () => {
    expect(structuralConditionRefusal(null as any)).toBeUndefined();
    expect(structuralConditionRefusal(undefined as any)).toBeUndefined();
  });

  it('and still refuses the malformed condition shapes it always refused', () => {
    expect(structuralConditionRefusal({ source: 1 } as any)).toBeDefined();
    expect(structuralConditionRefusal({} as any)).toBeDefined();
  });
});
