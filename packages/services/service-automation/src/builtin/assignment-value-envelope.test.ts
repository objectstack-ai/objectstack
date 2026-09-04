// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The `value`-role CEL envelope in the `assignment` node** (#15137) — the
 * executor half of the maintainer's 2026-09-02 ruling on #14149, whose spec
 * half landed in PR #15113.
 *
 * Before this, an `assignment` value that was an `{ dialect: 'cel', source }`
 * envelope went to `interpolate()`, which recursed into it as a plain object
 * and wrote it into the variable VERBATIM — `notify` then rendered
 * `{"dialect":"cel","source":"…"}` as JSON into a message body. The whole
 * declared CEL stdlib was unreachable from metadata, because CEL was only ever
 * asked for a boolean.
 *
 * Three things are pinned here, and the third is the one that matters most:
 *
 *  1. **Evaluate** (ask 2) — a declared envelope is evaluated to a value.
 *  2. **Validate** (ask 1) — a malformed envelope stops the flow REGISTERING,
 *     the same severity a malformed predicate gets.
 *  3. **One notion of malformed** — registration and evaluation refuse the same
 *     set, because both call the same composition
 *     (`AutomationEngine.valueEnvelopeRefusals`: the spec's
 *     `AssignmentValueSchema` for shape, then `validateExpression('value', …)`
 *     for CEL). Two independently-derived notions is how a flow comes to
 *     register cleanly and then fault at run time, or to be refused for a shape
 *     the executor would happily have run.
 *
 * And the preservation half, which is what makes the behaviour change safe: the
 * ledger declares ONLY the canonical `assignments` map, so both legacy shapes —
 * the `assignments: [{ variable, value }]` array and the bare
 * `{ <variable>: <value> }` config — keep every meaning they had, envelope-
 * shaped values included.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveFlowNodeExpressions,
  isExpressionEnvelopeShaped,
  ASSIGNMENT_VALUE_ENVELOPE_REFUSAL,
} from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';

function createTestLogger() {
  return {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    child: () => createTestLogger(),
  } as any;
}
function createCtx() {
  return { logger: createTestLogger(), getService: () => undefined } as any;
}

/** A one-`assignment`-node flow whose assigned variables surface as outputs. */
function assignmentFlow(config: Record<string, unknown>, outputs: string[] = ['digest']) {
  return {
    name: 'assign_flow',
    label: 'Assign Flow',
    type: 'autolaunched' as const,
    variables: outputs.map((name) => ({ name, type: 'text', isOutput: true })),
    nodes: [
      { id: 'start', type: 'start' as const, label: 'Start' },
      { id: 'assign', type: 'assignment' as const, label: 'Set variables', config },
      { id: 'end', type: 'end' as const, label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'assign' },
      { id: 'e2', source: 'assign', target: 'end' },
    ],
  };
}

/** The ruling's own example: a digest body built from a list of rows. */
const RULING_EXAMPLE = { dialect: 'cel', source: 'joinNonEmpty(rows.map(r, r.subject), "\\n")' };

/** Every way an envelope can be malformed, with what makes each one wrong. */
const MALFORMED: ReadonlyArray<{ label: string; envelope: Record<string, unknown> }> = [
  // The one shape `validateExpression` alone lets through: an empty source reads
  // as "not authored" there (`ok: true`), so only the spec's shape rule catches
  // it. Its presence in this list IS the argument for composing both halves.
  { label: 'no `source` at all', envelope: { dialect: 'cel' } },
  { label: 'an empty `source`', envelope: { dialect: 'cel', source: '' } },
  { label: 'a non-`cel` dialect', envelope: { dialect: 'template', source: 'Hello {name}' } },
  // The one the CEL half catches and the shape half cannot.
  { label: 'CEL that does not parse', envelope: { dialect: 'cel', source: 'rows.map(r,' } },
  { label: 'an unknown function', envelope: { dialect: 'cel', source: 'nosuchfn(rows)' } },
];

describe('assignment value envelope — evaluation (#15137 ask 2)', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  it("evaluates the ruling's own example against a flow variable", async () => {
    const flow = assignmentFlow({ assignments: { digest: RULING_EXAMPLE } });
    flow.variables.push({ name: 'rows', type: 'text', isInput: true } as any);
    engine.registerFlow('assign_flow', flow);

    const result = await engine.execute('assign_flow', {
      params: { rows: [{ subject: 'Renewal due' }, { subject: '' }, { subject: 'Invoice overdue' }] },
    } as any);

    expect(result.success).toBe(true);
    // The value, not the envelope — and `joinNonEmpty` dropped the empty row,
    // which is the whole reason the stdlib had to become reachable.
    expect(result.output).toEqual({ digest: 'Renewal due\nInvoice overdue' });
  });

  it('this is a CHANGE: the same config used to write the envelope object verbatim', async () => {
    // The pre-#15137 behaviour, reproduced through the surface that still has
    // it — the legacy array form, which the ledger deliberately does not
    // declare. Same authored envelope, two shapes, two meanings: evaluated in
    // the declared map, stored as data everywhere else.
    const legacy = assignmentFlow({ assignments: [{ variable: 'digest', value: RULING_EXAMPLE }] });
    legacy.variables.push({ name: 'rows', type: 'text', isInput: true } as any);
    engine.registerFlow('legacy', { ...legacy, name: 'legacy' });
    const before = await engine.execute('legacy', { params: { rows: [{ subject: 'x' }] } } as any);
    expect(before.success).toBe(true);
    expect(before.output).toEqual({ digest: RULING_EXAMPLE });

    const declared = assignmentFlow({ assignments: { digest: RULING_EXAMPLE } });
    declared.variables.push({ name: 'rows', type: 'text', isInput: true } as any);
    engine.registerFlow('declared', { ...declared, name: 'declared' });
    const after = await engine.execute('declared', { params: { rows: [{ subject: 'x' }] } } as any);
    expect(after.output).toEqual({ digest: 'x' });
  });

  it('evaluates in the same scope a predicate sees — nested `step.result` keys included', async () => {
    // `celScope` is shared with `evaluateCondition` (one builder, #15137): a
    // dotted variable key becomes a nested path for both.
    const flow = assignmentFlow({
      assignments: { digest: { dialect: 'cel', source: 'upper(lookup.name)' } },
    });
    flow.variables.push({ name: 'lookup.name', type: 'text', isInput: true } as any);
    engine.registerFlow('assign_flow', flow);
    const result = await engine.execute('assign_flow', { params: { 'lookup.name': 'ada' } } as any);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ digest: 'ADA' });
  });

  it('a non-string CEL result keeps its type — this slot is not a text template', async () => {
    const flow = assignmentFlow({ assignments: { digest: { dialect: 'cel', source: 'size(rows) * 2' } } });
    flow.variables.push({ name: 'rows', type: 'text', isInput: true } as any);
    engine.registerFlow('assign_flow', flow);
    const result = await engine.execute('assign_flow', { params: { rows: [1, 2, 3] } } as any);
    expect(result.output).toEqual({ digest: 6 });
  });
});

describe('assignment value envelope — registration refusal (#15137 ask 1)', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  it.each(MALFORMED)('refuses $label at registerFlow, located and led by the published sentence', ({ envelope }) => {
    let thrown: Error | undefined;
    try {
      engine.registerFlow('assign_flow', assignmentFlow({ assignments: { digest: envelope } }));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown, 'a malformed envelope must not register').toBeDefined();
    // Located: which node, which slot. The `assignments.*` ledger path resolves
    // to the author's own variable name.
    expect(thrown!.message).toContain("node 'assign' (assignment)");
    expect(thrown!.message).toContain('config.assignments.digest');
    // The rule before the detail — the spec's published sentence, not a
    // re-spelling of it.
    expect(thrown!.message).toContain(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
  });

  it('a well-formed envelope registers, and so does every non-envelope value', () => {
    expect(() => engine.registerFlow('ok', {
      ...assignmentFlow({
        assignments: {
          digest: RULING_EXAMPLE,
          greeting: 'Hello {name}',          // `{token}` interpolation — untouched
          count: 3,                          // literal
          flags: { enabled: true },          // plain object literal
          nothing: null,
        },
      }),
      name: 'ok',
    })).not.toThrow();
  });

  it('the refusal is the ONLY newly refused shape — a predicate refusal still reads as one', () => {
    // Guard against the value arm swallowing the predicate arm: a braced
    // predicate in a `decision` branch must still fail with its own message.
    expect(() => engine.registerFlow('pred', {
      ...assignmentFlow({ assignments: { digest: 'plain' } }),
      name: 'pred',
      nodes: [
        { id: 'start', type: 'start' as const, label: 'Start' },
        { id: 'd', type: 'decision' as const, label: 'D', config: { conditions: [{ label: 'Y', expression: '{record.x} == 1' }] } },
        { id: 'end', type: 'end' as const, label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'd' },
        { id: 'e2', source: 'd', target: 'end' },
      ],
    })).toThrow(/template braces/);
  });
});

describe('assignment value envelope — one notion of malformed (#15137)', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  // The property the two halves exist to have. Registration and evaluation are
  // derived from ONE call, so this holds by construction — and this test is what
  // keeps it true if either side is ever "improved" separately.
  it.each(MALFORMED)('$label: refused at registration AND refused by the evaluator, never one or the other', async ({ envelope }) => {
    expect(() => engine.registerFlow('reg', {
      ...assignmentFlow({ assignments: { digest: envelope } }), name: 'reg',
    })).toThrow(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);

    // The evaluator, reached directly — registration would not let this flow
    // through, which is the point: the executor never silently degrades a
    // malformed envelope to a literal for a flow that predates this card.
    expect(() => engine.evaluateValueEnvelope(envelope, new Map(), 'assignments.digest'))
      .toThrow(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
  });

  it('a value that fails at run time faults loudly with its source — never a silent `undefined`', async () => {
    // Registers (the CEL parses); faults on the live values. ADR-0032 §1c/§1d:
    // a value that failed to compute has no falsy default to hide behind.
    const flow = assignmentFlow({ assignments: { digest: { dialect: 'cel', source: 'rows.map(r, r.subject)' } } });
    engine.registerFlow('assign_flow', flow);
    const result = await engine.execute('assign_flow', {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('assignments.digest');
    expect(result.error).toContain('rows.map(r, r.subject)');
  });

  it('an `ast`-only envelope faults with the engine\'s own prescription, not a wrong value', () => {
    // `ExpressionSchema` accepts `source`-or-`ast`, so this passes both
    // validators; the CEL engine evaluates `source` only. Refused loudly at the
    // one layer that can see it. (Reported upward as a spec-lane finding — the
    // contract accepts a shape no engine evaluates.)
    expect(() => engine.evaluateValueEnvelope({ dialect: 'cel', ast: { op: 'value' } }, new Map(), 'assignments.digest'))
      .toThrow(/AST-only evaluation not yet supported/);
  });

  /**
   * The BOUND of the property above, pinned rather than papered over (found by
   * the #15137 contract review).
   *
   * A whitespace-only `source` REGISTERS — `ExpressionSchema.source` is
   * `z.string().min(1)`, so `'   '` passes the shape rule, and
   * `validateExpression` trims it to empty and answers `ok: true` ("not
   * authored") — and then faults at run time, because the CEL engine parses the
   * string untrimmed.
   *
   * So the true statement of the property is narrower than "a registered flow
   * can never fault": registration and evaluation refuse the same set THE TWO
   * PUBLISHED VALIDATORS DEFINE, and the shapes both of them accept while no
   * engine can run them fault loudly at run time rather than assigning a wrong
   * value. Same seam class as the `ast`-only case above, tracked in the same
   * finding (#15430).
   *
   * ⛔ Not fixable here by adding a trim rule of the engine's own: a third,
   * locally-invented notion of "malformed" is exactly what this file exists to
   * prevent. The fix belongs where the shape rule is declared.
   */
  it('a whitespace-only `source` registers and then faults loudly — the bound of the property (#15430)', async () => {
    const flow = assignmentFlow({ assignments: { digest: { dialect: 'cel', source: '   ' } } });
    expect(() => engine.registerFlow('assign_flow', flow), 'both validators accept it').not.toThrow();

    const result = await engine.execute('assign_flow', {} as any);
    expect(result.success).toBe(false);
    // Loud, located and carrying the source — never a silent `undefined` in the
    // variable, which is the property that does hold for every shape.
    expect(result.error).toContain('assignments.digest');
    expect(result.error).toContain('failed to evaluate as CEL');
  });
});

describe('assignment value envelope — the discriminator, and what it must NOT capture (#15137)', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  /**
   * The silent-change hazard, pinned. An authored config that writes an
   * envelope-shaped object as DATA now evaluates it — no error on either side,
   * just a different value. The discriminator is
   * `isExpressionEnvelopeShaped` (spec): a plain object naming a STRING
   * `dialect`. Everything below is data and stays data, byte-identical.
   */
  it.each([
    ['no `dialect` key', { source: 'joinNonEmpty(x)' }],
    ['a non-string `dialect`', { dialect: 1, source: 'x' }],
    ['a nested envelope, not a top-level one', { payload: { dialect: 'cel', source: 'x' } }],
    ['an ARRAY carrying a dialect entry', [{ dialect: 'cel', source: 'x' }]],
  ] as const)('%s is data — assigned verbatim, exactly as before', async (_label, value) => {
    engine.registerFlow('assign_flow', assignmentFlow({ assignments: { digest: value } }));
    const result = await engine.execute('assign_flow', {} as any);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ digest: value });
    expect(isExpressionEnvelopeShaped(value)).toBe(false);
  });

  it('a string is `{token}` interpolation, never CEL — the two dialects do not compete', async () => {
    const flow = assignmentFlow({ assignments: { digest: 'joinNonEmpty(rows)' } });
    engine.registerFlow('assign_flow', flow);
    const result = await engine.execute('assign_flow', {} as any);
    // Not evaluated as CEL: it is text with no holes, so it is the text.
    expect(result.output).toEqual({ digest: 'joinNonEmpty(rows)' });
  });

  it('the executor evaluates exactly the slots the ledger resolves — one discriminator, not two', () => {
    // The engine's validator walks `resolveFlowNodeExpressions`; the executor
    // tests `isExpressionEnvelopeShaped` inside the canonical map. This asserts
    // the two agree on a battery of configs, which is what stops "validated" and
    // "evaluated" from drifting into different sets.
    const configs: Array<{ config: Record<string, unknown>; evaluated: string[] }> = [
      { config: { assignments: { a: RULING_EXAMPLE, b: 'plain', c: 7 } }, evaluated: ['assignments.a'] },
      { config: { assignments: { a: { dialect: 'cel' } } }, evaluated: ['assignments.a'] },
      { config: { assignments: { a: { notDialect: 'cel' } } }, evaluated: [] },
      { config: { assignments: [{ variable: 'a', value: RULING_EXAMPLE }] }, evaluated: [] },
      { config: { a: RULING_EXAMPLE }, evaluated: [] },
      { config: {}, evaluated: [] },
    ];
    for (const { config, evaluated } of configs) {
      expect(resolveFlowNodeExpressions('assignment', config).map((f) => `assignments.${f.path.split('.').slice(1).join('.')}`))
        .toEqual(evaluated);
    }
  });
});

describe('assignment value envelope — the legacy shapes are untouched (#15137 ask 3)', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  /**
   * The seat's disposition on the card's ask 3: the
   * `assignments: [{ variable, value }]` array is accepted as **untyped
   * legacy**. `AssignmentConfigSchema` — which refuses it with
   * `ASSIGNMENT_ARRAY_FORM_PRESCRIPTION` — is deliberately NOT wired into
   * `parseNodeConfig` for that shape: refusing it would break flows that
   * register today, and the card says such a refusal is a ruling, not a lane's
   * call. Nothing here needed that wiring, so nothing here asked for it.
   *
   * The mechanical guarantee is structural, not a promise: the ledger's `*`
   * wildcard walks the own keys of a plain OBJECT and returns early on an
   * array, so the array form is invisible to the validator and to the executor's
   * envelope arm alike.
   */
  it('the array form is structurally invisible to the value machinery', () => {
    expect(resolveFlowNodeExpressions('assignment', {
      assignments: [{ variable: 'digest', value: RULING_EXAMPLE }],
    })).toEqual([]);
  });

  it.each([
    ['the legacy array form', { assignments: [{ variable: 'digest', value: RULING_EXAMPLE }] }],
    ['the bare no-wrapper config', { digest: RULING_EXAMPLE }],
  ] as const)('%s registers and assigns the envelope as the literal object it always was', async (_label, config) => {
    expect(() => engine.registerFlow('assign_flow', assignmentFlow(config))).not.toThrow();
    const result = await engine.execute('assign_flow', {} as any);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ digest: RULING_EXAMPLE });
  });

  it.each(MALFORMED)('$label registers unchanged in the legacy array form — no flow stops registering', ({ envelope }) => {
    expect(() => engine.registerFlow('assign_flow', assignmentFlow({
      assignments: [{ variable: 'digest', value: envelope }],
    }))).not.toThrow();
  });
});
