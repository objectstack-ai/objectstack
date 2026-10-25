/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3848 — `ActionRunner.execute`'s declared-`disabled` gate. The
 * EXECUTION half of the objectui#3492 family whose renderer halves are
 * objectui#3842 (PR #3851) and objectui#3849 (PR #3861).
 *
 * The gate asked `action.disabled != null && action.disabled !== false`, so every
 * EMPTY predicate got past it and was handed to `evaluateCondition` — which
 * documents exactly one default for "there is no condition here": return `true`,
 * meaning visible/enabled. On `disabled` that `true` means BLOCKED. Measured on
 * `origin/main` @ f0a625aa7 before this change, with a `probe` handler that
 * counts its own calls:
 *
 *   disabled ''                        | handler ran: false | {"success":false,"error":"Action is disabled"}
 *   disabled '   '                     | handler ran: false | {"success":false,"error":"Action is disabled"}
 *   disabled {dialect:'cel',source:''} | handler ran: false | {"success":false,"error":"Action is disabled"}
 *   disabled absent                    | handler ran: true  | {"success":true}
 *   disabled false                     | handler ran: true  | {"success":true}
 *
 * …and two rows that stayed BLOCKED after this card's fix, until objectui#3960
 * widened the shared definition to blank predicate text in either spelling.
 * Measured by running these two rows against `ab3ad4f3f`'s scope — the string-only
 * `value.trim() === ''` half of the definition, which is what the reverse
 * verification below restores:
 *
 *   disabled {dialect:'cel',source:'   '} | handler ran: false | {"success":false,"error":"Action is disabled"}
 *   disabled {source:'   '}               | handler ran: false | {"success":false,"error":"Action is disabled"}
 *
 * So this was not "the click did nothing" — execution was refused and the caller
 * got an error naming a state the metadata never declared.
 *
 * ## What each row detects
 *
 *   • the three EMPTY shapes (`''`, whitespace-only, empty-`source` envelope) →
 *     the handler must run. THE defect; each is an independent mutation
 *     detector, since the three arrive at "nothing to evaluate" by three
 *     different routes (string identity, `trim()`, envelope `source`).
 *   • the FOURTH empty shape, added by objectui#3960 — an envelope whose `source`
 *     is blank but not empty, in both its dialect spellings. It was still BLOCKED
 *     after this card's own fix: the normalizer folds a `source` of `''` and does
 *     not trim, so the value reached `evaluateCondition`, which calls a blank
 *     source "no condition" and answers `true` — and on this key `true` means
 *     "Action is disabled". Same defect, same mechanism, blank moved inside the
 *     envelope; behaviour change, and the same fail-open direction as the rows
 *     above.
 *   • `true` / a truthy expression / a truthy CEL envelope → still blocked.
 *     Anti-mutation guards: "never block anything" satisfies most of this table
 *     on its own, and these are what refuse it.
 *   • `false` / absent → still runs (ungated stays ungated), and `false` proves
 *     the gate did not start treating a declared-and-false gate as absent.
 *   • the non-predicate junk rows (`0`, `{}`, an `ast`-only envelope, an
 *     array) → BLOCKED since objectui#11358. They ran from objectui#3850 to
 *     then, read as "no gate"; that ruling makes them a declared gate that
 *     cannot be evaluated, which faults, and a faulting `disabled` refuses the
 *     action (objectui#11242). Reported once, by `evaluateCondition`.
 *
 * ## The parity claim, now made for EVERY row (objectui#3850 closed the last three)
 *
 * `rendererDisabled` is transcribed from objectui#3848's divergence table (the
 * action face as it stands after #3842 + #3849), NOT recomputed here:
 * `@object-ui/core` is the dependency of the renderer packages, so it cannot
 * import them, and the live renderer-side pins are in those PRs' tests. The
 * parity test below therefore asserts that the verdicts THIS suite pins equal
 * the verdicts recorded from the renderers — the #3314 invariant (one predicate
 * value, one answer, whichever entry reads it).
 *
 * Three rows used to be excluded, all of them the renderer's "is a gate
 * DECLARED?" scope: `{ dialect: 'cel', source: '' }` (an envelope passes
 * `!= null && !== ''`, so the renderer greyed the button out while this side read
 * the same value as nothing to evaluate) and the two junk rows `0` / `{}` (same
 * mechanism, coerced instead of folded). objectui#3850 ruled that scope — a gate
 * is declared when normalization still leaves a condition — and the definition
 * this file's gate asked privately moved into
 * `evaluator/declaredPredicate.ts` as `hasDeclaredPredicate`, which the renderer
 * side now re-exports as `hasDeclaredVisibilityGate`. So the three rows claim
 * parity, backed by live renderer-side pins rather than transcription alone:
 * `packages/components/src/renderers/action/__tests__/action-empty-predicate-scope.test.tsx`
 * (the action leaf, all five empty spellings plus the junk rows) and
 * `packages/react/src/__tests__/SchemaRenderer.disabledDeclaredGate.test.tsx`
 * (the generic path, objectui#3862).
 *
 * The two `${…}`-spelled rows used to be excluded as well, and no longer are.
 * The action-face renderers compose `evaluateCondition(toPredicateInput(x))`,
 * and `toPredicateInput` double-wrapped an already-templated string into
 * `'${${x}}'`, so the renderer verdict was a CONSTANT unrelated to the
 * expression — that is objectui#3871, fixed at the normalizer. The renderer face
 * now reaches the verdicts this suite pins, so both rows claim parity, each
 * backed by a live renderer-side pin rather than transcription alone:
 * `packages/components/src/renderers/action/__tests__/action-template-predicate-gate.test.tsx`
 * (five leaves + two hosts), the `${…}` cases in
 * `packages/app-shell/src/views/__tests__/DeclaredActionsBar.test.tsx`, and
 * `packages/plugin-detail/src/renderers/__tests__/record-quick-actions.template-predicate.test.tsx`.
 * The execution path still reads the RAW value, untouched by that fix — what
 * changed is that normalizing no longer disagrees with it.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring the old gate (`action.disabled != null && action.disabled !== false`)
 * while leaving evaluation untouched must turn exactly the seven
 * nothing-to-evaluate rows RED — `''`, `'   '`, the empty envelope, both
 * blank-`source` envelopes, `0`, `{}` — each naming its own shape, and leave
 * `absent` / `false` / `true` / both expression rows / both non-empty envelope
 * rows GREEN. That is the whole diff: this change can only stop blocking things,
 * never start.
 *
 * Reverting objectui#3960 alone (dropping the envelope half of the shared
 * definition's `isBlankPredicateText`) must turn RED exactly the two
 * blank-`source` rows and nothing else — including the parity test, whose column
 * for those rows is a claim about the renderer face reading the SAME definition.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionContext, type ActionDef } from '../ActionRunner';
import { ExpressionEvaluator } from '../../evaluator/ExpressionEvaluator';
import { toPredicateInput } from '../../evaluator/predicateInput';

const CONTEXT: ActionContext = {
  data: { id: 1 },
  record: { id: 1, status: 'active' },
  user: { id: 'u1', role: 'admin' },
};

interface Shape {
  label: string;
  /** Omit the key entirely (the "undeclared" row). */
  absent?: boolean;
  disabled?: unknown;
  /** Execution-side expectation: does the gate refuse to run the handler? */
  blocked: boolean;
  /**
   * The action-face renderer's verdict for the SAME value, transcribed from
   * objectui#3848's table. `null` = parity deliberately not claimed for this
   * row; `divergence` names the issue that owns the difference.
   */
  rendererDisabled: boolean | null;
  divergence?: string;
}

const SHAPES: Shape[] = [
  // ── the defect: nothing to evaluate must not block ───────────────────────
  { label: "disabled: '' (empty predicate)", disabled: '', blocked: false, rendererDisabled: false },
  { label: "disabled: '   ' (whitespace-only predicate)", disabled: '   ', blocked: false, rendererDisabled: false },
  {
    // Parity claimed since objectui#3850 moved the "declared?" definition into
    // core and the renderer side started reading it: an envelope with no source
    // is nothing to evaluate on both faces.
    label: "disabled: { dialect: 'cel', source: '' } (empty envelope)",
    disabled: { dialect: 'cel', source: '' },
    blocked: false,
    rendererDisabled: false,
  },
  // ── behaviour change (objectui#3960): the FOURTH empty spelling ───────────
  // A `source` that is blank but not empty. Measured as BLOCKED on this gate
  // before objectui#3960 — `toPredicateInput` folds a `source` of `''` and does
  // not trim, so the envelope reached `evaluateCondition`, whose CEL entry
  // answers `if (!source.trim()) return true`, and on this key that `true` means
  // "Action is disabled". Declaredness now decides blankness in both spellings,
  // so the handler runs. Parity is claimed on the same footing as the rows above:
  // one definition, read by the renderer face too.
  {
    label: "disabled: { dialect: 'cel', source: '   ' } (blank source — objectui#3960)",
    disabled: { dialect: 'cel', source: '   ' },
    blocked: false,
    rendererDisabled: false,
  },
  {
    // The dialect-less spelling takes the other route through the normalizer
    // (unwrapped and wrapped into `'${   }'`), so it is its own mutation
    // detector — and its verdict came out the same way, `true` = blocked, via
    // `evaluateCondition`'s `if (!trimmed) return true` instead of the CEL entry.
    label: "disabled: { source: '   ' } (blank source, no dialect)",
    disabled: { source: '   ' },
    blocked: false,
    rendererDisabled: false,
  },
  // ── unchanged: ungated stays ungated ────────────────────────────────────
  { label: 'disabled absent (undeclared)', absent: true, blocked: false, rendererDisabled: false },
  { label: 'disabled: false (declared, verdict false)', disabled: false, blocked: false, rendererDisabled: false },
  // ── unchanged: a real gate still blocks ─────────────────────────────────
  { label: 'disabled: true', disabled: true, blocked: true, rendererDisabled: true },
  {
    label: 'disabled: bare CEL that is true',
    disabled: 'user.role == "admin"',
    blocked: true,
    rendererDisabled: true,
  },
  {
    label: 'disabled: bare CEL that is false',
    disabled: 'user.role == "guest"',
    blocked: false,
    rendererDisabled: false,
  },
  {
    label: "disabled: { dialect: 'cel', source: 'true' }",
    disabled: { dialect: 'cel', source: 'true' },
    blocked: true,
    rendererDisabled: true,
  },
  {
    label: "disabled: { dialect: 'cel', source: 'false' }",
    disabled: { dialect: 'cel', source: 'false' },
    blocked: false,
    rendererDisabled: false,
  },
  // Parity claimed since objectui#3871 fixed the normalizer's double wrap; the
  // renderer face now answers by the expression, as this side always did.
  {
    label: 'disabled: legacy template that is true',
    disabled: '${user.role === "admin"}',
    blocked: true,
    rendererDisabled: true,
  },
  {
    label: 'disabled: legacy template that is false',
    disabled: '${user.role === "guest"}',
    blocked: false,
    rendererDisabled: false,
  },
  // ── behaviour change (objectui#11358): non-predicate junk fails CLOSED ──
  // It used to fail open on both faces (objectui#3850: "not declared"). Triage's
  // ruling on objectui#11358 made a present value with no evaluable `source` a
  // DECLARED gate that faults, so it takes the direction every faulting
  // `disabled` takes (objectui#11242): refused here, greyed out on the
  // renderers. Parity still claimed — `rendererDisabled` moved with it, pinned
  // live in `action-disabled-declared-gate.test.tsx` (components).
  { label: 'disabled: 0 (not a predicate)', disabled: 0, blocked: true, rendererDisabled: true },
  { label: 'disabled: {} (not a predicate)', disabled: {}, blocked: true, rendererDisabled: true },
  {
    label: "disabled: { dialect: 'cel', ast } (an `ast`-only envelope)",
    disabled: { dialect: 'cel', ast: { kind: 'call', fn: '==' } },
    blocked: true,
    rendererDisabled: true,
  },
  { label: 'disabled: [] (an array)', disabled: ['record.id'], blocked: true, rendererDisabled: true },
];

/** Execute one shape and report whether the handler ran. */
async function runShape(shape: Shape) {
  const runner = new ActionRunner(CONTEXT);
  const onClick = vi.fn();
  const action: Record<string, unknown> = { onClick };
  if (!shape.absent) action.disabled = shape.disabled;
  const result = await runner.execute(action as unknown as ActionDef);
  return { result, ran: onClick.mock.calls.length > 0 };
}

describe('ActionRunner.execute — declared `disabled` gate (objectui#3848)', () => {
  it.each(SHAPES)('$label', async (shape) => {
    const { result, ran } = await runShape(shape);
    if (shape.blocked) {
      expect(ran).toBe(false);
      expect(result).toEqual({ success: false, error: 'Action is disabled' });
    } else {
      // The handler RUNNING is the assertion that matters: objectui#3848 was
      // measured by the handler never being invoked, not by a missing toast.
      expect(ran).toBe(true);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    }
  });

  it('an empty predicate does not even reach the evaluator (the gate decides, not the verdict)', async () => {
    const runner = new ActionRunner(CONTEXT);
    const spy = vi.spyOn(
      runner.getEvaluator() as unknown as { evaluateCondition: (c: unknown) => boolean },
      'evaluateCondition',
    );
    const onClick = vi.fn();
    await runner.execute({ disabled: '', onClick } as unknown as ActionDef);
    expect(onClick).toHaveBeenCalledOnce();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('the execution verdict equals the renderer verdict for every shape where parity is claimed', () => {
    const claimed = SHAPES.filter(s => s.rendererDisabled !== null);
    // Guard the guard: if a future edit nulls out the column, this test would
    // pass by asserting nothing. 8 → 10 when objectui#3871 brought the two `${…}`
    // rows into the claim, 10 → the whole table when objectui#3850 brought the
    // envelope and junk rows in. A floor that does not move with the table is a
    // floor that stops guarding it.
    expect(claimed.length).toBe(SHAPES.length);
    for (const shape of claimed) {
      expect(
        shape.blocked,
        `${shape.label}: execution and the action-face renderer must agree (objectui#3314)`,
      ).toBe(shape.rendererDisabled);
    }
  });

  it('no shape is exempt from the parity claim any more, and a future exemption must name its issue', () => {
    // This replaces the "which rows are knowingly divergent" case, which after
    // objectui#3850 would have asserted an EMPTY list — green because nothing is
    // produced, not because the invariant holds. The claim now is the stronger
    // one: every shape in the table is compared, and the `divergence` escape
    // hatch stays exercised — re-introducing one without an owning issue fails
    // here rather than quietly shrinking the comparison.
    const divergent = SHAPES.filter(s => s.rendererDisabled === null);
    expect(divergent.map(s => s.label)).toEqual([]);
    for (const shape of SHAPES) {
      if (shape.rendererDisabled === null) {
        expect(shape.divergence, `${shape.label} must name the issue that owns it`).toMatch(/objectui#\d+/);
      } else {
        expect(shape.divergence, `${shape.label} claims parity, so it must not also claim a divergence`).toBeUndefined();
      }
    }
  });
});

describe('why the gate cannot delegate "is there a condition?" to the verdict (objectui#3848)', () => {
  it('evaluateCondition answers `true` for "no condition" — which on `disabled` means blocked', () => {
    const ev = new ExpressionEvaluator(CONTEXT);
    // The inverted default, in one line. This is the whole mechanism: correct on
    // `visible`/`enabled`, backwards on `disabled`.
    expect(ev.evaluateCondition(undefined)).toBe(true);
    expect(ev.evaluateCondition('')).toBe(true);
    expect(ev.evaluateCondition('   ')).toBe(true);
    expect(ev.evaluateCondition({ dialect: 'cel', source: '' })).toBe(true);
  });

  it('toPredicateInput collapses the EMPTY shapes and passes the BLANK ones through', () => {
    // Why the gate is not simply `toPredicateInput(x) !== undefined`: blank
    // predicate text survives normalization as an evaluable-looking value in both
    // its spellings — a wrapped template for the bare string, an intact envelope
    // for a blank `source` — so the shared definition names blankness explicitly
    // (objectui#3960; the same blank rule `evalRowPredicate` applies in
    // `evaluator/listConditional.ts`).
    expect(toPredicateInput('')).toBeUndefined();
    expect(toPredicateInput({ dialect: 'cel', source: '' })).toBeUndefined();
    expect(toPredicateInput('   ')).toBe('${   }');
    expect(toPredicateInput({ dialect: 'cel', source: '   ' })).toEqual({ dialect: 'cel', source: '   ' });
  });

  it('normalizing a `${…}` predicate now agrees with the raw value (was objectui#3871)', () => {
    // This case replaces the objectui#3871 TRIPWIRE that stood here. The
    // tripwire pinned the defect — `toPredicateInput('${x}')` was `'${${x}}'`,
    // unparseable, returned verbatim, `Boolean(…)` = a constant `true` — and its
    // note said the day it went red was the day to delete it and (only then) let
    // this gate evaluate the normalized value.
    //
    // It went red as predicted (PR for objectui#3871). It is REPLACED rather
    // than deleted, and this gate still reads the raw value, for two reasons:
    //
    //   1. deleting it would leave the repaired property — the normalizer is
    //      idempotent, so normalized and raw reach one verdict — pinned nowhere
    //      near the gate that depends on it. A regression to the old wrap would
    //      then be caught only by the producer-side suite, and the reader here
    //      would have no way to see why "normalize to decide, evaluate the raw
    //      value" is still safe;
    //   2. switching the gate to evaluate the normalized value is a change to
    //      landed objectui#3848 / objectui#3872 semantics with no defect behind
    //      it: raw and normalized now agree on every shape in the table above,
    //      so the switch would be pure churn on the execution path. The
    //      permission its note granted is not an obligation.
    const ev = new ExpressionEvaluator(CONTEXT);
    const falsePredicate = '${user.role === "guest"}';
    expect(ev.evaluateCondition(falsePredicate)).toBe(false);
    expect(toPredicateInput(falsePredicate)).toBe(falsePredicate);
    expect(ev.evaluateCondition(toPredicateInput(falsePredicate) as never)).toBe(false);
    // And the other polarity, which is what the double wrap was hiding on the
    // fail-closed `visible` legs (there it threw rather than reading as true).
    const truePredicate = '${user.role === "admin"}';
    expect(ev.evaluateCondition(truePredicate)).toBe(true);
    expect(ev.evaluateCondition(toPredicateInput(truePredicate) as never)).toBe(true);
  });
});
