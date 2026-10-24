/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3872 — `ActionRunner.execute`'s declared-`condition` gate. The
 * neighbour-line sibling of objectui#3848 (PR #3873, the `disabled` gate), and
 * the OVER-PERMISSIVE half of the objectui#3492 family.
 *
 * The gate asked `if (action.condition)`, i.e. "is the raw value truthy?", which
 * cannot answer "did the author declare a gate?". `condition: false` — the most
 * explicit "never execute" metadata can carry, and what a template that switches
 * an action off emits — landed on `if (false)`, so `evaluateCondition` was never
 * consulted and the action RAN. Measured on `origin/main` @ `2937bcf7d` before
 * this change, with a `probe` handler that counts its own calls:
 *
 *   condition: false                      | handler ran: true  | {"success":true}
 *   condition: 0                          | handler ran: true  | {"success":true}
 *   condition: {cel,'false'}              | handler ran: false | {"error":"Action condition not met"}
 *   condition: bare CEL false             | handler ran: false | {"error":"Action condition not met"}
 *   condition: '' / '   ' / {cel,''} / {} | handler ran: true  | {"success":true}
 *
 * So `false` and the semantically IDENTICAL `{ dialect: 'cel', source: 'false' }`
 * reached opposite conclusions: the boolean literal executed, its envelope
 * spelling was refused. Direction of the defect is over-permission — the action
 * really ran, possibly writing — which is the more dangerous side of the family
 * than objectui#3848's over-blocking.
 *
 * ## What each row detects
 *
 *   • `false` → must now BLOCK. THE defect, and the only row whose behaviour
 *     this change alters.
 *   • `true` / a truthy expression / a truthy CEL envelope / absent → still
 *     runs. Anti-mutation guards: "block whenever the key is present" satisfies
 *     the `false` row on its own, and these refuse it.
 *   • a falsy expression / a falsy CEL envelope / a falsy `${…}` template →
 *     still blocked, unchanged. These are what a correct `condition` already
 *     did, and the gate must not lose them while learning about `false`.
 *   • the three EMPTY shapes (`''`, whitespace-only, empty-`source` envelope) →
 *     still run, now because objectui#3850's ruling says nothing was declared
 *     rather than because `if ('')` happened to be falsy. Same verdict, sound
 *     reason; each arrives at "nothing to evaluate" by a different route
 *     (string identity, `trim()`, envelope `source`), so each is its own
 *     mutation detector.
 *   • the non-predicate junk rows (`0`, `{}`) → still run, and NOT because the
 *     old truthiness test skipped them. This used to be a deliberate departure
 *     from `ActionEngine.getActionsForLocation`'s `Boolean(raw)` junk branch,
 *     which would have `0` block here; objectui#3957 moved that filter onto the
 *     same shared definition, so the case below is now a CONVERGENCE pin rather
 *     than a documented divergence.
 *   • `condition: { dialect: 'cel', source: '   ' }` → still runs, and after
 *     objectui#3960 for the sound reason rather than the accidental one: it was
 *     declared-and-`true` (a blank CEL source evaluates to "no condition →
 *     `true`"), which on THIS key happens to mean "execute" — the same value on
 *     `disabled` was blocking execution. Nothing declared now, same verdict.
 *
 * ## Scope: what this change does NOT touch
 *
 * The `disabled` gate below it (objectui#3848 / PR #3873) keeps its semantics
 * and its message verbatim; `ActionRunner.disabledGate.test.ts` is its pin and
 * is unchanged by this PR. The only shared edit is the module-private
 * declaredness helper's key-neutral NAME, now that two gates ask it.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring the truthy gate (`if (action.condition)`) while leaving evaluation
 * untouched must turn exactly THREE tests RED, every one of them naming `false`:
 *
 *   1. the `condition: false` row — the handler runs again, so `blocked` fails;
 *   2. the boolean/envelope equivalence test — `false` runs while
 *      `{ dialect: 'cel', source: 'false' }` is refused, which is precisely the
 *      divergence objectui#3872 reported;
 *   3. "a declared boolean DOES reach the evaluator" — under truthiness it never
 *      does, so the `evaluateCondition` spy is never called with `false`.
 *
 * The two purely tabular tests (the changed-row set, the truthiness-vs-
 * declaredness table) and the normalizer case below stay GREEN by construction —
 * they assert about `Boolean` / `toPredicateInput` / the engine, not about the
 * gate (that case was the objectui#3871 tripwire, replaced by its converged
 * pin when the normalizer was fixed) —
 * and every other execution row stays GREEN too, including `0`, `{}` and all
 * three empty shapes, because the truthy test and the declaredness test agree on
 * every shape except a declared boolean. That is the whole diff, and it is a TIGHTENING:
 * this change can only start refusing execution, never start allowing it (the
 * mirror image of PR #3873, which could only stop blocking).
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionContext, type ActionDef } from '../ActionRunner';
import { ActionEngine } from '../ActionEngine';
import { ExpressionEvaluator } from '../../evaluator/ExpressionEvaluator';
import { toPredicateInput } from '../../evaluator/predicateInput';
import { hasDeclaredPredicate } from '../../evaluator/declaredPredicate';

const CONTEXT: ActionContext = {
  data: { id: 1 },
  record: { id: 1, status: 'active' },
  user: { id: 'u1', role: 'admin' },
};

interface Shape {
  label: string;
  /** Omit the key entirely (the "undeclared" row). */
  absent?: boolean;
  condition?: unknown;
  /** Does the gate refuse to run the handler? */
  blocked: boolean;
  /** `true` when this row's verdict CHANGED with objectui#3872. */
  changedBy3872?: boolean;
}

const SHAPES: Shape[] = [
  // ── the defect: a declared-and-false gate must block ─────────────────────
  {
    label: 'condition: false (declared "never execute")',
    condition: false,
    blocked: true,
    changedBy3872: true,
  },
  // ── unchanged: a declared-and-true gate runs ────────────────────────────
  { label: 'condition: true', condition: true, blocked: false },
  { label: 'condition absent (undeclared)', absent: true, blocked: false },
  // ── unchanged: real predicates keep their verdicts ──────────────────────
  {
    label: 'condition: bare CEL that is true',
    condition: 'user.role == "admin"',
    blocked: false,
  },
  {
    label: 'condition: bare CEL that is false',
    condition: 'user.role == "guest"',
    blocked: true,
  },
  {
    label: "condition: { dialect: 'cel', source: 'true' }",
    condition: { dialect: 'cel', source: 'true' },
    blocked: false,
  },
  {
    label: "condition: { dialect: 'cel', source: 'false' }",
    condition: { dialect: 'cel', source: 'false' },
    blocked: true,
  },
  {
    label: 'condition: legacy template that is true',
    condition: '${record.status === "active"}',
    blocked: false,
  },
  {
    label: 'condition: legacy template that is false',
    condition: '${record.status === "inactive"}',
    blocked: true,
  },
  // ── unchanged verdict, new reason: nothing was declared ─────────────────
  { label: "condition: '' (empty predicate)", condition: '', blocked: false },
  { label: "condition: '   ' (whitespace-only predicate)", condition: '   ', blocked: false },
  {
    label: "condition: { dialect: 'cel', source: '' } (empty envelope)",
    condition: { dialect: 'cel', source: '' },
    blocked: false,
  },
  {
    // objectui#3960's fourth empty spelling. Unchanged VERDICT on this key and a
    // changed reason: it was a declared gate whose blank CEL source evaluated to
    // `true` ("no condition → visible/enabled"), which on `condition` means
    // execute; now nothing is declared. The same value on `disabled` was blocking
    // execution, which is why the fix belongs to the shared definition and not to
    // either gate — see `ActionRunner.disabledGate.test.ts`.
    label: "condition: { dialect: 'cel', source: '   ' } (blank source — objectui#3960)",
    condition: { dialect: 'cel', source: '   ' },
    blocked: false,
  },
  // ── unchanged verdict: non-predicate junk still runs ────────────────────
  // Since objectui#11358 for a different reason: it is a DECLARED gate that
  // cannot be evaluated, `evaluateCondition` reports it and answers its
  // fail-soft `true`, and on this key that is "execute" — the direction a
  // faulting `condition` has always taken. See the objectui#11358 block below.
  { label: 'condition: 0 (not a predicate)', condition: 0, blocked: false },
  { label: 'condition: {} (not a predicate)', condition: {}, blocked: false },
];

/** Execute one shape and report whether the handler ran. */
async function runShape(shape: Pick<Shape, 'absent' | 'condition'>) {
  const runner = new ActionRunner(CONTEXT);
  const onClick = vi.fn();
  const action: Record<string, unknown> = { onClick };
  if (!shape.absent) action.condition = shape.condition;
  const result = await runner.execute(action as unknown as ActionDef);
  return { result, ran: onClick.mock.calls.length > 0 };
}

describe('ActionRunner.execute — declared `condition` gate (objectui#3872)', () => {
  it.each(SHAPES)('$label', async (shape) => {
    const { result, ran } = await runShape(shape);
    if (shape.blocked) {
      // The handler NOT running is the assertion that matters: objectui#3872 was
      // measured by the handler running despite a declared "never execute".
      expect(ran).toBe(false);
      expect(result).toEqual({ success: false, error: 'Action condition not met' });
    } else {
      expect(ran).toBe(true);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    }
  });

  it('changes exactly one shape — the declared boolean `false` (tightening only)', () => {
    // Guards the report's per-shape table: if a later edit widens the blast
    // radius, this row-set assertion is what says so.
    expect(SHAPES.filter(s => s.changedBy3872).map(s => s.label)).toEqual([
      'condition: false (declared "never execute")',
    ]);
    // And the direction: the only altered row moved toward REFUSING execution.
    expect(SHAPES.find(s => s.changedBy3872)!.blocked).toBe(true);
  });

  it('a declared boolean and its envelope spelling reach the SAME verdict', async () => {
    // objectui#3872's headline: these two say the identical thing, and before
    // the fix the literal ran while the envelope was refused.
    const literal = await runShape({ condition: false });
    const envelope = await runShape({ condition: { dialect: 'cel', source: 'false' } });
    expect(literal.ran).toBe(false);
    expect(envelope.ran).toBe(false);
    expect(literal.result).toEqual(envelope.result);

    const literalTrue = await runShape({ condition: true });
    const envelopeTrue = await runShape({ condition: { dialect: 'cel', source: 'true' } });
    expect(literalTrue.ran).toBe(true);
    expect(envelopeTrue.ran).toBe(true);
  });

  it('an empty predicate does not even reach the evaluator (the gate decides, not the verdict)', async () => {
    const runner = new ActionRunner(CONTEXT);
    const spy = vi.spyOn(
      runner.getEvaluator() as unknown as { evaluateCondition: (c: unknown) => boolean },
      'evaluateCondition',
    );
    const onClick = vi.fn();
    await runner.execute({ condition: '', onClick } as unknown as ActionDef);
    expect(onClick).toHaveBeenCalledOnce();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a declared boolean DOES reach the evaluator, which short-circuits it', async () => {
    // Why the gate needs no boolean branch of its own: asking the right question
    // at the door is sufficient, because `evaluateCondition` returns a boolean
    // argument verbatim. This is also what makes the fix a two-line change
    // rather than a re-implementation of the verdict.
    const runner = new ActionRunner(CONTEXT);
    const spy = vi.spyOn(
      runner.getEvaluator() as unknown as { evaluateCondition: (c: unknown) => boolean },
      'evaluateCondition',
    );
    await runner.execute({ condition: false, onClick: vi.fn() } as unknown as ActionDef);
    expect(spy).toHaveBeenCalledWith(false);
    spy.mockRestore();

    const ev = new ExpressionEvaluator(CONTEXT);
    expect(ev.evaluateCondition(false)).toBe(false);
    expect(ev.evaluateCondition(true)).toBe(true);
  });
});

describe('why the `condition` gate cannot ask truthiness (objectui#3872)', () => {
  it('truthiness and declaredness disagree on exactly the declared booleans', () => {
    // The mechanism in one table, asked through the REAL definition. It used to
    // be re-spelled inline here (`typeof v === 'string' && v.trim() === '' ? …`)
    // because the helper was module-private; objectui#3850 sank it into
    // `evaluator/declaredPredicate.ts`, and a copy of a definition that has moved
    // is a twin that drifts — objectui#3960 widened the real one and the copy
    // would have kept answering the old way.
    const declared = hasDeclaredPredicate;

    // `false` is the divergence: not truthy, yet plainly declared.
    expect(Boolean(false)).toBe(false);
    expect(declared(false)).toBe(true);

    // On the empty shapes the two questions agree, which is why one row
    // changed here.
    for (const v of ['', '   ', { dialect: 'cel', source: '' }, { dialect: 'cel', source: '   ' }]) {
      expect(declared(v), `${JSON.stringify(v)} declares no gate`).toBe(false);
    }
    // objectui#11358: a value with no evaluable `source` is DECLARED (and
    // faults), whatever its truthiness — `0` is falsy, `{}` truthy, both are
    // gates. Their verdict on this key is the fault direction (see below).
    for (const v of [0, {}]) {
      expect(declared(v), `${JSON.stringify(v)} declares a gate that cannot be evaluated`).toBe(true);
    }
    for (const v of [true, 'user.role == "admin"', { dialect: 'cel', source: 'false' }]) {
      expect(declared(v), `${JSON.stringify(v)} declares a gate`).toBe(true);
      expect(Boolean(v)).toBe(true);
    }
  });

  it('normalizing a `${…}` condition now agrees with the raw value (was objectui#3871)', () => {
    // Replaces the objectui#3871 TRIPWIRE that stood here. It pinned the defect
    // — `toPredicateInput('${x}')` was `'${${x}}'`, unparseable, returned
    // verbatim, `Boolean(…)` = a constant `true`, which on THIS key would have
    // run every template-spelled `condition` regardless of its verdict — and its
    // note said the day it went red was the day to delete it and (only then) let
    // the gate evaluate the normalized value.
    //
    // It went red as predicted (PR for objectui#3871), and is replaced rather
    // than deleted for the reasons written out next to its `disabled` twin in
    // `ActionRunner.disabledGate.test.ts`: the repaired property (the normalizer
    // is idempotent, so normalized and raw reach one verdict) is what makes
    // "normalize to decide, evaluate the raw value" safe, and it should be
    // pinned beside the gate that relies on it. The gate itself is unchanged.
    const ev = new ExpressionEvaluator(CONTEXT);
    const falsePredicate = '${record.status === "inactive"}';
    expect(ev.evaluateCondition(falsePredicate)).toBe(false);
    expect(toPredicateInput(falsePredicate)).toBe(falsePredicate);
    expect(ev.evaluateCondition(toPredicateInput(falsePredicate) as never)).toBe(false);
    const truePredicate = '${record.status === "active"}';
    expect(ev.evaluateCondition(truePredicate)).toBe(true);
    expect(ev.evaluateCondition(toPredicateInput(truePredicate) as never)).toBe(true);
  });

  it('CONVERGED (objectui#3957), then objectui#11358: the engine `visible` filter reads junk as the definition does', () => {
    // This case used to be a DOCUMENTED DIVERGENCE. `ActionEngine.
    // getActionsForLocation` is the in-repo template this gate took its shape
    // from, but its non-predicate branch kept a historical `Boolean(raw)`
    // coercion, so `visible: 0` HID an action the renderer face showed — one
    // value, two answers, the shape objectui#3314's invariant forbids. This gate
    // deliberately did not copy it (`catch { isDisabled = false }` had already
    // committed this module to fail-OPEN on junk), and objectui#3850 landed
    // without unifying the engine: its ruling covered the "declared?" definition
    // and its placement, not that filter's own range.
    //
    // objectui#3957 moved the engine onto the same definition, so `0` got one
    // answer at every entry. objectui#11358 then changed that ONE answer:
    // `0` is a declared gate that cannot be evaluated, so the engine filter
    // (fail-closed on any fault) hides it — still the same answer the renderer
    // `visible` legs give, which is what this case pins.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const engine = new ActionEngine(CONTEXT);
      engine.registerAction(
        { name: 'junk_visible', type: 'script', target: '"ran"', visible: 0 } as unknown as ActionDef,
        { locations: ['record_section'] },
      );
      expect(engine.getActionsForLocation('record_section')).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
    // Anti-mutation: "the filter passes everything" satisfies the line above. A
    // declared-and-false gate still hides, at the engine as at this gate.
    const gated = new ActionEngine(CONTEXT);
    gated.registerAction(
      { name: 'off', type: 'script', target: '"ran"', visible: false } as unknown as ActionDef,
      { locations: ['record_section'] },
    );
    expect(gated.getActionsForLocation('record_section')).toHaveLength(0);
  });
});

/**
 * objectui#11358 — a `condition` that is DECLARED but has no evaluable `source`
 * (an `ast`-only envelope, `0`, `{}`, an array).
 *
 * It is a declared gate (`hasDeclaredPredicate` → `true`), so it reaches
 * `evaluateCondition`, which treats it as a fault: reported once, answered with
 * the fail-soft `true`. On THIS key `true` means "execute" — exactly what a
 * `condition` that faults with text in it does (`record.(` below). So the
 * verdict is the one these shapes had before; what changed is that it is no
 * longer silent. Whether `condition` should fail CLOSED on every fault is not
 * this card's to change: it is the key's single fault policy, and moving it
 * would move every typo'd `condition` too.
 */
describe('ActionRunner `condition`: declared but not evaluable is a reported fault (objectui#11358)', () => {
  const UNEVALUABLE: Array<{ label: string; value: unknown }> = [
    { label: "an `ast`-only envelope ({ dialect: 'cel', ast })", value: { dialect: 'cel', ast: { kind: 'call', fn: '==' } } },
    { label: '0', value: 0 },
    { label: '{} (no source)', value: {} },
    { label: '[] (array)', value: ['record.id'] },
  ];

  it.each(UNEVALUABLE)('condition: $label → declared, runs (the fault direction), reported', async ({ value }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(hasDeclaredPredicate(value)).toBe(true);
      const { result, ran } = await runShape({ condition: value });
      expect(ran).toBe(true);
      expect(result.success).toBe(true);
      // Reported through `evalFieldPredicate`'s one-time report, which every
      // shape of this class shares under one locator — so the report is
      // asserted, not counted per row.
      const reasons = warn.mock.calls.map(c => String(c[0])).filter(r => r.includes('[unevaluable]'));
      expect(reasons.length).toBeLessThanOrEqual(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('is reported at least once, and the verdict matches a condition that faults with text', async () => {
    const ev = new ExpressionEvaluator(CONTEXT);
    const onFault = vi.fn();
    expect(ev.evaluateCondition({} as never, { onFault })).toBe(true);
    expect(onFault).toHaveBeenCalledOnce();
    expect(String(onFault.mock.calls[0][0])).toContain('[unevaluable]');
    // The control: a faulting CEL source runs too, on the same fail-soft `true`.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const typo = await runShape({ condition: { dialect: 'cel', source: 'record.(' } });
      expect(typo.ran).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
