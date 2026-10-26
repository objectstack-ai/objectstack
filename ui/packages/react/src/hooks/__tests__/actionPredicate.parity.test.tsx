/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Parity suite for action `visible` predicates: the ENGINE path
 * (`ActionEngine.getActionsForLocation`) and the RENDERER path
 * (`toPredicateInput` → `useCondition`, what `action-button` / `action-menu` /
 * `action-bar` actually call) must reach the same verdict for the same
 * predicate.
 *
 * They did not (#3314). `getActionsForLocation` hand-rolled its own
 * normalization that unwrapped a `{ dialect: 'cel', source }` envelope into a
 * `${source}` string; `ExpressionEvaluator.evaluateCondition` only routes to
 * the canonical `@objectstack/formula` engine while the argument is still an
 * envelope, so the engine silently ran every CEL predicate on the legacy JS
 * evaluator while the renderers ran it on CEL (#2661). Since
 * `ExpressionInputSchema` normalizes even a bare authored string into
 * `{ dialect: 'cel', source }`, that was the common case, not an edge one.
 *
 * Two things are pinned here:
 *   1. There is only ONE normalizer. `@object-ui/core` owns the canonical
 *      `toPredicateInput`, and since #3367 `@object-ui/react` re-exports it
 *      rather than keeping a renderer-side twin — so this suite asserts
 *      *identity* (same function object), not input shapes one by one. The old
 *      14-shape normalization table was a guardrail against drift between two
 *      implementations; with one implementation it compared a function to
 *      itself and could no longer fail.
 *   2. The two PATHS agree verdict-for-verdict, including on a predicate where
 *      the engines genuinely disagree (`null < null` faults in CEL, is `false`
 *      in JS) — so the parity is proven, not merely assumed. This half is
 *      untouched by #3367: sharing a normalizer does not by itself prove the
 *      engine and the renderer reach the same verdict, because they run the
 *      normalized predicate through different call paths.
 *   3. The two paths agree on the DECLARED-GATE question as well as the verdict
 *      (objectui#3957 — the suite at the bottom of this file). A face is two
 *      questions, "is a gate declared?" then "what does it say?", and the engine
 *      answered the first one with a range of its own until then: `visible: 0` was
 *      hidden by the engine and shown by every renderer.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ActionEngine, hasDeclaredPredicate, toPredicateInput as coreToPredicateInput } from '@object-ui/core';
import { toPredicateInput, useCondition } from '../useExpression';

describe('action predicate normalization — one implementation, not two (#3314 / #3367)', () => {
  it('re-exports the canonical core normalizer instead of a renderer-side twin', () => {
    // The whole guarantee, in one assertion: the name `@object-ui/react` hands
    // to renderers IS `@object-ui/core`'s function object. Same function ⇒ the
    // input shapes cannot disagree and there is nothing left to drift, which is
    // strictly stronger than the 14-shape table this replaces (#3367).
    //
    // Enumerating shapes here again would be theatre — after the re-export both
    // columns of that table called the same function, so every row passed by
    // construction and the table could not fail for any implementation of it.
    // Per-shape behaviour is still covered where it is a real assertion:
    // `packages/react/src/hooks/__tests__/useExpression.test.ts` (through the
    // react export) and the verdict suite below (through both call paths).
    expect(toPredicateInput).toBe(coreToPredicateInput);
  });

  it('preserves the cel dialect instead of flattening it to a `${…}` string', () => {
    // The one branch #3314 was about: flattening here is what demoted the
    // predicate to the legacy JS engine on the engine path.
    const envelope = { dialect: 'cel', source: 'record.done == true' };
    expect(coreToPredicateInput(envelope)).toEqual({ dialect: 'cel', source: 'record.done == true' });
    expect(coreToPredicateInput({ dialect: 'template', source: 'record.done == true' }))
      .toBe('${record.done == true}');
  });
});

describe('action `visible` — engine path vs renderer path parity (#3314)', () => {
  const RECORD = { a: null, b: null, status: 'open' };
  const CONTEXT = { record: RECORD };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The engine path: what `getActionsForLocation` decides. */
  function engineVerdict(visible: unknown): boolean {
    const engine = new ActionEngine({ ...CONTEXT });
    engine.registerAction(
      { name: 'probe', type: 'api', visible } as any,
      { locations: ['record_section'] },
    );
    return engine.getActionsForLocation('record_section').length === 1;
  }

  /** The renderer path: what `action-button` & friends decide. */
  function rendererVerdict(visible: unknown): boolean {
    const { result } = renderHook(() =>
      useCondition(toPredicateInput(visible), { ...CONTEXT }, {
        throwOnError: true,
        label: 'action "probe" (visible)',
      }),
    );
    return result.current;
  }

  const VERDICT_CASES: { what: string; visible: unknown; expected: boolean }[] = [
    // The discriminator. CEL has no `<` overload for `null`, so the predicate
    // FAULTS and both fail-closed paths hide the action. On the legacy JS
    // engine `null < null` is `false`, so `!(…)` is `true` and the action
    // shows — which is exactly what the engine used to do here, and the
    // renderer did not.
    {
      what: 'cel envelope whose null comparison faults → hidden on both paths',
      visible: { dialect: 'cel', source: '!(record.a < record.b)' },
      expected: false,
    },
    // Same text, no envelope → legacy JS on BOTH paths → shown on both.
    {
      what: 'bare string with the same null comparison → shown on both paths',
      visible: '!(record.a < record.b)',
      expected: true,
    },
    {
      what: 'non-cel dialect envelope stays on the legacy path → shown on both',
      visible: { dialect: 'template', source: '!(record.a < record.b)' },
      expected: true,
    },
    {
      what: 'cel envelope that genuinely holds → shown on both paths',
      visible: { dialect: 'cel', source: 'record.status == "open"' },
      expected: true,
    },
    {
      what: 'cel envelope that genuinely fails → hidden on both paths',
      visible: { dialect: 'cel', source: 'record.status == "closed"' },
      expected: false,
    },
    // objectui#3871 — the legacy `${…}` spelling. Both paths normalize with
    // `toPredicateInput` and both opt into `throwOnError`, so the double wrap
    // made them agree on a constant "hidden": this table was GREEN for the
    // `false` row and could only have caught the defect on the `true` row,
    // which is why that row is the one added first. Parity was never the
    // question here — the shared verdict was simply wrong on both paths.
    {
      what: 'legacy `${…}` template that holds → shown on both paths',
      visible: '${record.status === "open"}',
      expected: true,
    },
    {
      what: 'legacy `${…}` template that fails → hidden on both paths',
      visible: '${record.status === "closed"}',
      expected: false,
    },
    { what: 'literal true', visible: true, expected: true },
    { what: 'literal false', visible: false, expected: false },
    { what: 'absent predicate', visible: undefined, expected: true },
    { what: 'cel envelope with an empty source', visible: { dialect: 'cel', source: '' }, expected: true },
  ];

  it.each(VERDICT_CASES)('$what', ({ visible, expected }) => {
    // Both paths warn once on a fail-closed hide; keep the suite output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fromEngine = engineVerdict(visible);
    const fromRenderer = rendererVerdict(visible);
    expect(fromEngine).toBe(expected);
    expect(fromRenderer).toBe(expected);
    expect(fromEngine).toBe(fromRenderer);
  });
});

/**
 * objectui#3957 — the DECLARED-GATE half of the same parity claim.
 *
 * The suite above compares VERDICTS, which is only half of what a face decides.
 * The renderer face is two questions: `hasDeclaredVisibilityGate(schema.visible)
 * && !isVisible` — a gate is consulted only when one is declared. The engine face
 * used to ask the first question with a range of its own (three empty spellings
 * folded by hand, everything else coerced with `Boolean(raw)`), so one value got
 * two answers depending on which entry read it:
 *
 *   value            | engine (before) | renderer face | agree?
 *   0                | HIDDEN          | shown         | no
 *   NaN              | HIDDEN          | shown         | no
 *   '   ' (blank)    | HIDDEN          | shown         | no
 *   {} / ''          | shown           | shown         | yes
 *   {cel, source:''} | shown           | shown         | yes
 *
 * That is the shape objectui#3314's invariant forbids, and the `'   '` row was
 * created by objectui#3966 the day it landed: the ruling made a blank predicate
 * "no gate" on the renderer face while the engine kept evaluating `'${   }'` to a
 * falsy verdict. objectui#3957 moved the engine onto the same definition.
 *
 * Why `rendererVerdict` alone cannot pin this: it models only the second question.
 * For `visible: '   '` it returns `false` (the normalizer wraps a blank string into
 * `'${   }'`, whose verdict is falsy) even though the real renderer SHOWS the
 * action, because the declared gate in front of it never consults that verdict.
 * `rendererFace` below composes both questions, exactly as `action-button` /
 * `action-menu` / `DeclaredActionsBar` do.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring the engine's hand-rolled range must turn RED the
 * `'   '` / `'\t\n'` / blank-`source`-without-dialect rows of the table below —
 * `engine` becomes `false` while `rendererFace` stays `true` — and leave the rows
 * both ranges agreed on GREEN. It cannot go red in the other direction: the change
 * only ever stops the engine hiding an action.
 *
 * ⚠️ objectui#11358 moved the `0` / `NaN` / `{}` rows: they are declared gates
 * that cannot be evaluated, HIDDEN on both faces now — the engine's old
 * `Boolean(raw)` answer for `0` was the right verdict reached for the wrong
 * reason, and the faces still agree, which is this suite's claim.
 */
describe('action `visible` — the DECLARED gate agrees on both faces too (objectui#3957)', () => {
  const CONTEXT = { record: { id: 'r1', status: 'open' } };

  /** The engine face: what `getActionsForLocation` surfaces. */
  function engineFace(visible: unknown): boolean {
    const engine = new ActionEngine({ ...CONTEXT });
    engine.registerAction(
      { name: 'probe', type: 'api', visible } as never,
      { locations: ['record_section'] },
    );
    return engine.getActionsForLocation('record_section').length === 1;
  }

  /**
   * The renderer face, BOTH questions: `hasDeclaredVisibilityGate(visible) &&
   * !isVisible` → hidden. This is the composition every action leaf performs.
   */
  function rendererFace(visible: unknown): boolean {
    if (!hasDeclaredPredicate(visible)) return true;
    const { result } = renderHook(() =>
      useCondition(toPredicateInput(visible), { ...CONTEXT }, {
        throwOnError: true,
        label: 'action "probe" (visible)',
      }),
    );
    return result.current;
  }

  const GATE_CASES: Array<{ what: string; visible: unknown; shown: boolean }> = [
    // ── nothing declared → shown on both faces ────────────────────────────
    { what: "'' (empty predicate)", visible: '', shown: true },
    { what: 'null', visible: null, shown: true },
    { what: "'   ' (blank predicate text — the row objectui#3966 created)", visible: '   ', shown: true },
    { what: "'\\t\\n' (other blanks)", visible: '\t\n', shown: true },
    { what: "{ dialect: 'cel', source: '' } (what `objectstack build` emits)", visible: { dialect: 'cel', source: '' }, shown: true },
    { what: "{ dialect: 'cel', source: '   ' } (blank source — objectui#3960)", visible: { dialect: 'cel', source: '   ' }, shown: true },
    { what: "{ source: '   ' } (blank source, no dialect)", visible: { source: '   ' }, shown: true },
    // ── declared, nothing evaluable → hidden on both faces (objectui#11358) ─
    // These were "nothing declared → shown" rows until triage's ruling on
    // objectui#11358: a present value with no evaluable `source` is a declared
    // gate that faults, and `visible` fails closed on a fault on both faces.
    { what: '0 (declared, not evaluable)', visible: 0, shown: false },
    { what: 'NaN (declared, not evaluable)', visible: NaN, shown: false },
    { what: '{} (declared, not evaluable)', visible: {}, shown: false },
    { what: '[] (declared, not evaluable)', visible: ['record.status'], shown: false },
    { what: "{ dialect: 'cel', ast } (an `ast`-only envelope)", visible: { dialect: 'cel', ast: { kind: 'call', fn: '==' } }, shown: false },
    // ── declared → the verdict decides, identically on both faces ──────────
    { what: 'true', visible: true, shown: true },
    { what: 'false (a verdict, not a missing gate)', visible: false, shown: false },
    { what: 'a holding predicate', visible: 'record.status == "open"', shown: true },
    { what: 'a failing predicate', visible: 'record.status == "closed"', shown: false },
    { what: 'a holding CEL envelope', visible: { dialect: 'cel', source: 'record.status == "open"' }, shown: true },
    { what: 'a failing CEL envelope', visible: { dialect: 'cel', source: 'record.status == "closed"' }, shown: false },
    // Blankness is `trim()`, not "short" — the anti-mutation row for the two
    // blank-source rows above.
    { what: 'a failing CEL envelope padded with blanks', visible: { dialect: 'cel', source: ' record.status == "closed" ' }, shown: false },
  ];

  it.each(GATE_CASES)('$what → shown=$shown on the engine face AND the renderer face', ({ visible, shown }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = engineFace(visible);
    const renderer = rendererFace(visible);
    expect(engine).toBe(shown);
    expect(renderer).toBe(shown);
    // The invariant itself, asserted as such: one value, one answer, whichever
    // entry reads it (objectui#3314).
    expect(engine).toBe(renderer);
  });

  it('the declared-gate question is asked with ONE definition, not two ranges', () => {
    // What makes the table above a convergence rather than a coincidence: both
    // faces call `hasDeclaredPredicate`, so there is no second range left to
    // drift. Enumerating shapes cannot show that — this can.
    for (const c of GATE_CASES) {
      const declared = hasDeclaredPredicate(c.visible);
      // Every "shown because nothing is declared" row must be undeclared, and
      // every row whose verdict decides must be declared. A row that is shown for
      // BOTH reasons (e.g. `true`) is declared, so the check is one-directional.
      if (!declared) {
        expect(c.shown, `${c.what}: nothing declared must mean shown`).toBe(true);
      }
    }
    expect(GATE_CASES.filter(c => !hasDeclaredPredicate(c.visible)).length).toBe(7);
  });
});
