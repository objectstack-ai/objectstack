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
  VALUE_SLOT_TEMPLATE_REFUSAL,
  flowNodeValueTemplateRefusals,
} from '@objectstack/spec/automation';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec';
import { ExpressionEngine } from '@objectstack/formula';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';
import { interpolate } from './template.js';

/** The thrown error, so a pin can assert its message substance rather than `toThrow()` alone. */
function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the call to throw');
}

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
  // The two shapes the persistence contract accepts while no engine can run
  // them, refused since #15430 by the spec's evaluated-slot rule — here the
  // shape half catches them too, so they never reach the run that faulted.
  { label: 'an `ast`-only envelope', envelope: { dialect: 'cel', ast: { op: 'value' } } },
  { label: 'a whitespace-only `source`', envelope: { dialect: 'cel', source: '   ' } },
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
          greeting: 'Hello',                 // a literal (#19939 retired `{token}` here)
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

  it('an `ast`-only envelope is refused at the shape door with the spec\'s own sentence — the engine\'s fault is no longer reachable (#15430)', () => {
    // FLIPPED. `ExpressionSchema` accepts `source`-or-`ast`, but this slot is
    // EVALUATED: `AssignmentExpressionValueSchema` composes the spec's
    // `EvaluatedExpressionSchema`, which requires a non-blank `source` — what
    // the CEL engine actually evaluates. So the shape half refuses it, located
    // at `source`, and `evaluateValueEnvelope` (which runs that same shape
    // pass first) never hands it to the engine. The engine's own arm — "AST-only
    // evaluation not yet supported; persist `source`" — is reachable only by
    // calling `ExpressionEngine.evaluate` directly, bypassing every schema;
    // pinned below as defence in depth, not as a path metadata can take.
    const error = catchError(() => engine.evaluateValueEnvelope({ dialect: 'cel', ast: { op: 'value' } }, new Map(), 'assignments.digest'));
    expect(error.message).toContain('assignments.digest');
    expect(error.message).toContain(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
    expect(error.message).toContain('`source`: ' + EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    expect(error.message).not.toContain('AST-only evaluation not yet supported');
  });

  it('defence in depth — the engine itself, reached with no schema in front of it, still refuses an `ast`-only envelope', () => {
    // Not a path authored metadata can take (both validators and the executor
    // run the schema first); kept so the last layer never silently answers a
    // value if a future caller bypasses the door.
    const result = ExpressionEngine.evaluate({ dialect: 'cel', ast: { op: 'value' } }, {});
    // `EvalResult` is a discriminated union — `error` exists only on the
    // `ok: false` arm, so narrow on the discriminant before reading it.
    if (result.ok) throw new Error('expected the engine to refuse an `ast`-only envelope, got a value');
    expect(result.error.message).toContain('AST-only evaluation not yet supported');
  });

  /**
   * FLIPPED by #15430 — this used to pin the BOUND of the property: a
   * whitespace-only `source` passed `ExpressionSchema.source`'s `min(1)`,
   * `validateExpression` trimmed it to empty and answered `ok: true` ("not
   * authored"), the flow REGISTERED, and the run faulted because the CEL engine
   * parses the string untrimmed. The file said the fix did not belong here (a
   * trim rule of the engine's own would be a third notion of "malformed"), but
   * where the shape rule is declared — and that is where it landed: the spec's
   * `EvaluatedExpressionSchema` requires a non-blank `source` on an evaluated
   * slot, with the engine's own notion of blank (`.trim()`).
   *
   * So the property is now the unqualified one: registration and evaluation
   * refuse the same set, and that set includes every shape no engine can run.
   * The refusal is the SHAPE half's, at the value's own `source`, led by the
   * published sentence — and the same call refuses it at run time (the
   * `it.each(MALFORMED)` pin above holds both halves for this envelope too).
   */
  it('a whitespace-only `source` is refused at registration by the schema, located at the value\'s `source` (#15430)', () => {
    const flow = assignmentFlow({ assignments: { digest: { dialect: 'cel', source: '   ' } } });
    const error = catchError(() => engine.registerFlow('assign_flow', flow));
    expect(error.message).toContain(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
    expect(error.message).toContain('`source`: ' + EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    expect(error.message).toContain('assignments.digest');
    // Not the engine's parse fault any more — the run never happens.
    expect(error.message).not.toContain('failed to evaluate as CEL');
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

  // An envelope there is a literal, so its MALFORMED shape stops nothing
  // registering — except where the literal's own strings spell the retired
  // `{…}` template dialect, which the legacy shapes read like any value
  // (#19939: no shape is a way around that retirement).
  it.each(MALFORMED.filter(({ envelope }) => !String(envelope.source ?? '').includes('{')))(
    '$label registers unchanged in the legacy array form — no flow stops registering',
    ({ envelope }) => {
      expect(() => engine.registerFlow('assign_flow', assignmentFlow({
        assignments: [{ variable: 'digest', value: envelope }],
      }))).not.toThrow();
    },
  );

  it('[#19939] a legacy-shape literal whose string spells the `{…}` dialect is refused like any value', () => {
    expect(() => engine.registerFlow('assign_flow', assignmentFlow({
      assignments: [{ variable: 'digest', value: { dialect: 'template', source: 'Hello {name}' } }],
    }))).toThrow(VALUE_SLOT_TEMPLATE_REFUSAL);
  });
});

/**
 * [#19939 pass 3, carried from pass 2] **Where an envelope is literal data,
 * the refusal names one that evaluates.** The value-slot judge used to print
 * `{ dialect: 'cel', source: … }` at whatever position it refused a `{…}`
 * token — and at an element of the legacy `assignments` ARRAY, at a key of the
 * bare legacy config, and at a string nested inside an object literal, the
 * executor reads that envelope as DATA: the prescribed metadata registered and
 * stored the envelope object (the controls below). The remedy there now moves
 * the assignment into the canonical map, or builds the whole value as one CEL
 * literal — and each spelling it names, read off the refusal itself and put
 * back, writes what the template wrote.
 *
 * The judge is fixed rather than the executor: an envelope-shaped object in
 * those positions is data today (`the legacy shapes are untouched` above, and
 * the CRUD test's nested-envelope pin), and evaluating it would change what an
 * existing flow writes.
 */
describe('[#19939] where an envelope is literal data, the refusal names a spelling that evaluates', () => {
  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(createTestLogger());
    registerLogicNodes(engine, createCtx());
  });

  /** `assignmentFlow` with `name` as an input. */
  function literalFlow(config: Record<string, unknown>, outputs: string[]) {
    const flow = assignmentFlow(config, outputs);
    return { ...flow, variables: [{ name: 'name', type: 'text', isInput: true }, ...flow.variables] };
  }
  const RUN = { params: { name: 'Ada' } } as any;
  const VARIABLES = new Map<string, unknown>([['name', 'Ada']]);

  /** The envelope source a refusal message names after `lead` — read off the message, never re-spelled. */
  function envelopeAfter(message: string, lead: string): string {
    const at = message.indexOf(lead);
    expect(at, message).toBeGreaterThanOrEqual(0);
    const found = /\{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/.exec(message.slice(at));
    expect(found, message).not.toBeNull();
    return found![1] ?? (JSON.parse(found![2]!) as string);
  }

  it.each([
    ['the legacy `assignments` array', { assignments: [{ variable: 'greeting', value: 'Hello {name}' }] }, 'config.assignments[0].value'],
    ['the legacy bare config', { greeting: 'Hello {name}' }, 'config.greeting'],
  ] as const)('%s: the remedy moves it into the canonical map, where the envelope evaluates', async (_label, config, at) => {
    const message = catchError(() => engine.registerFlow('assign_flow', literalFlow(config, ['greeting']))).message;
    expect(message).toContain(`assignment value at ${at}`);
    expect(message).toContain('Move the node\'s assignments into the canonical map');
    const source = envelopeAfter(message, 'canonical map');
    expect(source).toBe("'Hello ' + name");

    // Put back where the remedy says — the canonical map — it writes the template's value.
    engine.registerFlow('assign_flow', literalFlow({ assignments: { greeting: { dialect: 'cel', source } } }, ['greeting']));
    const result = await engine.execute('assign_flow', RUN);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ greeting: interpolate('Hello {name}', VARIABLES, {} as any) });
    expect(result.output).toEqual({ greeting: 'Hello Ada' });
  });

  it.each([
    ['the legacy `assignments` array', { assignments: [{ variable: 'greeting', value: { dialect: 'cel', source: "'Hello ' + name" } }] }],
    ['the legacy bare config', { greeting: { dialect: 'cel', source: "'Hello ' + name" } }],
  ] as const)('control — %s: the envelope the old remedy named there is stored as the object it spells', async (_label, config) => {
    engine.registerFlow('assign_flow', literalFlow(config, ['greeting']));
    const result = await engine.execute('assign_flow', RUN);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ greeting: { dialect: 'cel', source: "'Hello ' + name" } });
  });

  it('a string nested in an object literal: the whole value as one CEL map literal writes the template\'s object', async () => {
    const value = { who: '{name}', meta: { note: 'for {name}' } };
    const refusals = flowNodeValueTemplateRefusals('assignment', { assignments: { o: value } });
    expect(refusals.map((r) => r.path)).toEqual(['assignments.o.who', 'assignments.o.meta.note']);
    for (const refusal of refusals) {
      expect(refusal.message).toContain('sits inside an object or list literal, where nothing evaluates');
      expect(refusal.message).toContain('wrap each one in `dyn(…)`');
    }
    // Each refusal's literal holds its own string at its place; the two, side by
    // side, are the whole value — a string beside a map, so each is wrapped in
    // `dyn(…)` as the remedy says (unwrapped, CEL refuses the map at registration).
    expect(envelopeAfter(refusals[0]!.message, 'for this string alone')).toBe("{'who': name}");
    expect(envelopeAfter(refusals[1]!.message, 'for this string alone')).toBe("{'meta': {'note': 'for ' + name}}");
    expect(() => engine.registerFlow('assign_flow', literalFlow({
      assignments: { o: { dialect: 'cel', source: "{'who': name, 'meta': {'note': 'for ' + name}}" } },
    }, ['o']))).toThrow(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
    const whole = "{'who': dyn(name), 'meta': dyn({'note': 'for ' + name})}";

    engine.registerFlow('assign_flow', literalFlow({ assignments: { o: { dialect: 'cel', source: whole } } }, ['o']));
    const result = await engine.execute('assign_flow', RUN);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ o: interpolate(value, VARIABLES, {} as any) });
    expect(result.output).toEqual({ o: { who: 'Ada', meta: { note: 'for Ada' } } });

    // Control: the envelope the old remedy named at the nested position is data.
    const control = new AutomationEngine(createTestLogger());
    registerLogicNodes(control, createCtx());
    control.registerFlow('assign_flow', literalFlow({ assignments: { o: { who: { dialect: 'cel', source: 'name' } } } }, ['o']));
    const controlResult = await control.execute('assign_flow', RUN);
    expect(controlResult.output).toEqual({ o: { who: { dialect: 'cel', source: 'name' } } });
  });

  it('a map mixing types: the `dyn(…)` the remedy names is what makes it evaluate', async () => {
    const message = flowNodeValueTemplateRefusals('assignment', { assignments: { o: { who: '{name}', n: 3 } } })[0]!.message;
    expect(message).toContain('wrap each one in `dyn(…)`');
    // Without `dyn`, CEL refuses a map whose values differ in type — at registration.
    expect(() => engine.registerFlow('assign_flow', literalFlow({
      assignments: { o: { dialect: 'cel', source: "{'who': name, 'n': 3}" } },
    }, ['o']))).toThrow(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
    engine.registerFlow('assign_flow', literalFlow({
      assignments: { o: { dialect: 'cel', source: "{'who': dyn(name), 'n': dyn(3)}" } },
    }, ['o']));
    const result = await engine.execute('assign_flow', RUN);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ o: interpolate({ who: '{name}', n: 3 }, VARIABLES, {} as any) });
  });
});
