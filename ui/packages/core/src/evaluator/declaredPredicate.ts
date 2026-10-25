/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { toPredicateInput } from './predicateInput.js';
// A cycle with `fieldRules.ts`, which imports `isBlankPredicateText` from here.
// Benign by construction: each side reads the other only inside a function
// body, never while its module is being evaluated.
import { evalFieldPredicate, type FieldRulePredicate } from './fieldRules.js';

/**
 * Is the predicate TEXT blank — in EITHER spelling? (objectui#3960)
 *
 * `'   '` and `{ dialect: 'cel', source: '   ' }` are the same author mistake
 * written two ways, and {@link toPredicateInput} folds neither: it wraps a
 * whitespace-only string into `'${   }'`, and it only folds an envelope whose
 * `source` is exactly `''`. So blankness cannot be derived from the normalizer's
 * answer and has to be stated once, here, for both spellings — trimming one and
 * not the other is the asymmetry objectui#3960 measured (`disabled` greyed out,
 * `ActionRunner` refused to execute, for a predicate that says nothing).
 *
 * This is not a fourth dialect of "empty": it is the SAME rule core's evaluation
 * entries already apply on the value side — `evaluateCondition` on both of its
 * routes (which ask THIS function: the CEL route since objectui#8069, the
 * legacy path since objectui#11262), `evalRowPredicate` (`listConditional.ts`,
 * whose blank reaches `evalFieldPredicate`, which asks it too) — brought to the
 * one place that answers "is there a condition at all?", so the two halves
 * cannot disagree about the same blank.
 *
 * Exported since objectui#8069 for its second consumer, `evalFieldPredicate`
 * (`evaluator/fieldRules.ts`), which is the entry this docblock's list did NOT
 * name because it did not apply the rule: it trimmed the STRING spelling only,
 * so `{ dialect: 'cel', source: '   ' }` went to the engine and came back as a
 * parse fault while `'   '` returned the caller's fallback in silence. Reusing
 * this definition rather than writing a fourth `trim()` is the whole point of
 * the paragraph above.
 */
export function isBlankPredicateText(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  if (value !== null && typeof value === 'object') {
    const source = (value as { source?: unknown }).source;
    if (typeof source === 'string') return source.trim() === '';
  }
  return false;
}

/**
 * Is a predicate gate DECLARED on this value — i.e. after normalization, is
 * there still a CONDITION for {@link ExpressionEvaluator.evaluateCondition} to
 * reach a verdict on? (objectui#3850's ruling, key-neutral: `visible` /
 * `hidden` / `enabled` / `disabled` / `condition` all ask it.)
 *
 * This is the ONE definition of that question in the repo, and it lives here —
 * one layer under every consumer, beside {@link toPredicateInput}, whose answer
 * it is derived from. It has to be asked separately from the verdict because
 * `evaluateCondition` documents and implements exactly one default for "there
 * is nothing here to evaluate": it returns `true`, meaning *visible/enabled*.
 * That default is right on `visible` / `enabled` and INVERTED on `disabled`,
 * where `true` means "greyed out" — so a gate that hands an empty predicate to
 * the evaluator gets the strongest possible "yes, disable it" for a value the
 * metadata never used to say anything. Truthiness cannot answer it either, and
 * asking it that way was objectui#3812: `if (action.visible && !isVisible)`
 * read `visible: false` — the most explicit "never show this" an author can
 * write — as *ungated*, and rendered the action for everyone.
 *
 * ## What counts as "nothing to evaluate"
 *
 * Exactly the shapes {@link toPredicateInput} folds to `undefined`, plus the two
 * BLANK spellings it wraps or passes through instead of folding:
 *
 *   - `null` / `undefined` — no key at all.
 *   - `''` — an empty predicate (objectui#3492 / objectui#3842).
 *   - blank predicate TEXT, in either spelling — a whitespace-only string
 *     (`'   '`, which the normalizer wraps into `'${   }'`) and an envelope whose
 *     `source` is whitespace-only (`{ dialect: 'cel', source: '   ' }`, which the
 *     normalizer passes through because it only folds a `source` of `''`).
 *     Neither can be read off the normalizer's answer, so both are named here —
 *     see {@link isBlankPredicateText} for why this is the layer that says it.
 *     Core's other predicate entries already treat both as blank:
 *     `evaluateCondition` (`isBlankPredicateText`, then `true` — diagnosed on
 *     the CEL route since objectui#8069 and on the legacy path since
 *     objectui#11262) and `evalRowPredicate` (`evaluator/listConditional.ts`,
 *     the caller's fallback, through `evalFieldPredicate`'s `[blank]` report
 *     since objectui#11262).
 *   - `{ dialect, source: '' }` — the empty ENVELOPE. This is not an exotic
 *     spelling: `@objectstack/spec`'s `ExpressionInputSchema` normalizes every
 *     authored predicate into an envelope, so "author left the predicate empty"
 *     compiles to exactly this, which makes it the likeliest empty shape in real
 *     metadata (objectui#3850).
 *
 * The three BLANK shapes above (`''`, whitespace-only text, and an envelope
 * whose `source` is blank) are still folded to "not declared" — that is the
 * verdict — but no longer in silence: each is reported once (objectui#8069,
 * ADR-0137 D4), see {@link reportBlankGate}. `null` / `undefined` (no key) is
 * not blank TEXT and stays silent: nothing was declared there to report.
 *
 * ## What is DECLARED although nothing in it can be evaluated (objectui#11358)
 *
 * A value that is present but is not a predicate the client can evaluate — an
 * envelope with no string `source` (the `ast`-only `{ dialect: 'cel', ast }` an
 * unmirrored authoring door admits), a number (`0`), an object with no `source`
 * (`{}`), an array — IS a declared gate. Triage's ruling on objectui#11358:
 * "declared and faulting", "reported once per predicate", and the action
 * "hides". It used to be the fifth "nothing to evaluate" shape here, answered
 * "not declared" in silence, so a bulk action gated that way ran over every
 * selected record and the toolbars and row menu showed it to everyone.
 *
 * This function's CODE did not change for it: the normalizer did.
 * {@link toPredicateInput} no longer folds such a value into `undefined`; it
 * returns a `cel` envelope with no `source`, so `toPredicateInput(x) !==
 * undefined` — the line below — answers "declared", and the derivation this
 * definition rests on still holds with no second list. The state is told apart
 * in one place, `isUnevaluablePredicate` (`./unevaluablePredicate.ts`).
 *
 * What a reader then DOES with it is the evaluation step's, not this
 * function's: `ExpressionEvaluator.evaluateCondition` and `evalFieldPredicate`
 * treat it as a FAULT, so each reader answers with the fail direction its key
 * already has for a predicate that cannot be evaluated, and reports it there,
 * once — through `evalFieldPredicate`'s report with the `[unevaluable]` reason,
 * or through the caller's own fault report. That is why this function reports
 * nothing for it: a declared gate always goes on to an evaluation, and two
 * reports for one fault is the noise objectstack-ai/objectstack#5149 removed.
 * On every action `visible` leg that direction is CLOSED (objectui#11212), on
 * every `disabled` leg too (objectui#11242), and the hide-polarity `hidden` /
 * `hiddenOn` legs of `SchemaRenderer` answer "hidden". The keys whose fault
 * direction is OPEN keep it — a `condition` still lets the action run, a
 * legacy `enabled` leaves the control enabled, an action param's `visible`
 * still shows the param — now diagnosed rather than silent.
 *
 * A declared-and-`false` gate is DECLARED (`toPredicateInput` returns the
 * boolean unchanged): `disabled: false` / `visible: false` are verdicts, and
 * routing them to the evaluator — which short-circuits booleans — is the point
 * of asking "declared?" rather than "truthy?".
 *
 * ## Why blankness is decided HERE and not in the normalizer (objectui#3960)
 *
 * The blank-`source` envelope arrived one release late: objectui#3850's ruling
 * enumerated three empty spellings, `toPredicateInput` folds a `source` of `''`
 * and does not trim, so `{ dialect: 'cel', source: '   ' }` stayed "declared"
 * while core's own CEL entry called that exact value "no predicate" — `disabled`
 * greyed out and `ActionRunner` refused to execute for a predicate that says
 * nothing (objectui#3960). The asymmetry was that this definition trimmed the
 * STRING spelling of a blank predicate and not the ENVELOPE spelling of the same
 * blank.
 *
 * Fixing it at the normalizer instead (`if (!src.trim()) return undefined`) would
 * have aligned every `evaluateCondition(toPredicateInput(x))` consumer at once,
 * and that is precisely why it is the wider, wrong lever: it changes what
 * normalization MEANS, which is a shape question ("what does the evaluator
 * accept"), to answer a declaredness question ("is there a condition"). Those are
 * different concepts on purpose — a blank `source` is a shape the evaluator
 * accepts and answers `true` for, by its own documented rule. The blast radius is
 * the concrete difference: at the normalizer, a NON-cel blank envelope
 * (`{ source: '   ' }` → `'${   }'` → falsy) flips verdict for every
 * `useCondition(toPredicateInput(…))` call site including the container-level
 * `visible` reads in `action-bar` / `action-group` / `action-menu` /
 * `RelatedList` / `record-alert`, none of which ask this question at all; here it
 * flips only for the consumers that DO ask it, and only on the inverted-polarity
 * keys where "declared" is what turns a control off.
 *
 * ## Why the callers still evaluate the RAW value
 *
 * Every consumer normalizes to decide DECLAREDNESS and then evaluates whatever
 * it was given, `evaluateCondition(raw)` or `evaluateCondition(toPredicateInput(
 * raw))` as it did before. Both agree since objectui#3871 made the normalizer
 * idempotent for an already-`${…}` string; before that they did not, and a
 * template-spelled predicate normalized twice came back as a constant. Nothing
 * here changes a verdict for a value that HAS one — this gate only decides
 * whether there is one to reach.
 *
 * ## Scope history (objectui#3850)
 *
 * The question used to be answered three times with three different scopes: the
 * renderer-side `hasDeclaredVisibilityGate` (`!= null && !== ''`, so every
 * object counted — including the empty envelope), `SchemaRenderer`'s inline
 * `!== undefined` (wider still: `disabled: null` greyed the control out,
 * objectui#3862), and `ActionRunner`'s module-private helper (this scope, which
 * arrived first with objectui#3848 and is what the ruling adopted). One
 * definition with one scope replaces all three:
 * `components/renderers/action/visibility-gate.ts` re-exports this function
 * under its historic name `hasDeclaredVisibilityGate` (the five member-action
 * renderer call sites are unchanged), `SchemaRenderer`'s `disabled` /
 * `disabledOn` chain reads it, and `ActionRunner`'s two gates read it instead of
 * a private twin.
 *
 * Two more consumers joined afterwards, and with them the last two places that
 * answered this question with a range of their own:
 * `SchemaRenderer`'s `hidden` / `hiddenOn` legs, whose verdict is NOT negated so
 * an empty predicate made the node VANISH (objectui#3955), and
 * `ActionEngine.getActionsForLocation`'s `visible` filter, which folded some
 * empty spellings by hand and coerced the rest with `Boolean(raw)`, so
 * `visible: 0` hid an action the renderers showed (objectui#3957).
 *
 * The last one joined with objectui#11322: plugin-grid's `hasVisibilityGate`,
 * on the grid's selection bar, asks it through the renderer-side name
 * `hasDeclaredVisibilityGate`. It decides whether a bulk button whose `visible`
 * admits no record is hidden, and `partitionBulkRows` asks it before handing a
 * bulk def's `visible` to `partitionRowsByPredicate`. It had kept the old
 * `!= null && !== ''` scope after every other member of the family moved here,
 * so a whitespace-only `visible` counted as declared on that bar, failed closed
 * for every record, and hid an action the row menu and toolbars showed.
 *
 * Nothing in the repo now asks "is a gate declared?" anywhere but here for
 * the keys this definition serves. What stays outside is a different family,
 * not a twin: the field-rule `*When` keys (ADR-0137) decide it by rules of
 * their own. Examples are the built-in Edit / Delete row item's
 * `visibleWhen != null` (`isBuiltinRowActionVisible`), and the opening test of
 * the shared partitioner `partitionRowsByPredicate` (`null` / `undefined` /
 * `''`), which is the answer its built-in Delete `visibleWhen` callers get. The
 * action family asks here before it calls that partitioner.
 * ⚠️ Nothing re-derives this paragraph: it was read off a source search when
 * objectui#11322 landed, and no test or gate repeats that search.
 */
export function hasDeclaredPredicate(value: unknown): boolean {
  if (isBlankPredicateText(value)) {
    reportBlankGate(value as FieldRulePredicate);
    return false;
  }
  return toPredicateInput(value) !== undefined;
}

/**
 * Say out loud that a DECLARED gate was blank — the one side effect
 * {@link hasDeclaredPredicate} has (objectui#8069).
 *
 * The fold above is objectui#3850 / #3960's ruled verdict and it stands: a
 * blank gate is "no gate". What ADR-0137 D4 removed is the SILENCE of it — "a
 * gate predicate that is blank or faulting is diagnosed, never a silent
 * `true`" — and this fold is where a blank `visible` / `hidden` / `enabled` /
 * `disabled` / `condition` stopped before it could reach any evaluator that
 * might have said so.
 *
 * Reported through `evalFieldPredicate`'s own `[blank]` report — the channel
 * every other predicate fault already uses, with its once-per-(text, locator)
 * dedupe — and not through a warner of its own. It makes no engine call: a
 * blank predicate never reaches the engine. The `false` it is handed is this
 * function's answer ("not declared"); nothing reads it back.
 *
 * ⚠️ The locator is FIXED, because this question is key-neutral and receives
 * nothing that names the node. So the dedupe is per blank SPELLING across the
 * app: `''`, `'   '` and a blank envelope each warn once, and a second node
 * with the same blank spelling does not warn again. That is weaker than the
 * field-rule path, which joins the field's locator to a blank's key, and it is
 * the price of diagnosing at the one definition rather than at each of its
 * callers.
 */
function reportBlankGate(value: FieldRulePredicate): void {
  evalFieldPredicate(value, {}, false, undefined, undefined, {
    context: 'a declared gate, read as no gate',
  });
}
