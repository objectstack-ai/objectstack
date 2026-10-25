/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Client-side evaluation of field-level conditional rules
 * (`visibleWhen` / `readonlyWhen` / `requiredWhen`).
 *
 * These predicates are authored as CEL — the *same* dialect the server
 * enforces in `@objectstack/objectql`'s rule-validator (`requiredWhen`) and
 * `stripReadonlyWhenFields` (`readonlyWhen`). To guarantee the client UX and
 * the server enforcement reach the *identical* verdict for a given record we
 * delegate to the canonical engine, `@objectstack/formula`'s
 * `ExpressionEngine`, rather than re-implementing a parallel evaluator. See
 * ADR-0036 (field-level conditional rules) and the framework's
 * `packages/formula` "No private expression DSL" note.
 *
 * A predicate is `string | { dialect, source }`. A bare string is treated as
 * CEL (mirrors the server's `toExpression`). Evaluation is *fail-open* for
 * visibility/required (a broken predicate must not hide a field or wrongly
 * block submit) and *fail-open* for readonly (a broken predicate leaves the
 * field editable).
 *
 * Fail-open agrees with the server for MOST faults — but not for all, and the
 * exception is the half worth knowing. Since objectstack#4889 a `readonlyWhen`
 * predicate that faults because it names a scope ROOT the write never bound —
 * `parent.status == 'paid'` with no master-detail header in hand — is
 * fail-CLOSED on the server: `isReadonlyWhenLocked` warns and then returns
 * TRUE, i.e. LOCKED (a declared lock is not waived merely because it could not
 * be evaluated), and `stripReadonlyWhenFields` — plus
 * `stripReadonlyWhenFieldsMulti` on the bulk path — DELETES that key from the
 * UPDATE payload. This file keeps the same fault fail-OPEN. For that one class
 * the two ends therefore point in OPPOSITE directions, deliberately: the
 * framework's ADR-0124 D1 — server enforces, client is courtesy — makes the
 * server the authority, so the courtesy layer does not get to guess "locked"
 * and grey out a field the server might have accepted.
 *
 * The caller-visible consequence, spelled out because the symptom is silent:
 * the form renders the field EDITABLE, the user edits it, the save reports
 * SUCCESS, and the new value never lands — the server dropped the key and kept
 * the persisted one. Debug that toward the SERVER-side lock (its `… treating
 * the field as LOCKED` warning, and the write response's `droppedFields`), not
 * toward the client predicate, which did exactly what it was asked to. The
 * other two halves carry no such carve-out: `requiredWhen` binds the same
 * `parent` scope but deliberately kept fail-open semantics (objectstack#4977),
 * so an unevaluable requirement is skipped on BOTH ends, and field-level
 * `visibleWhen` is not a server concept at all.
 *
 * Fail-open is **loud**, not silent (objectstack#5149): a predicate that
 * cannot be evaluated — parse error, unbound identifier, engine fault — logs
 * one `console.warn` per predicate text with the source and the failure
 * reason, then still returns the caller's fallback. Without the warning a
 * broken predicate is indistinguishable from an absent one, so
 * conditional-visibility bugs survive inspection indefinitely. This is the
 * client half of the server's "log and allow" convention for the faults where
 * the two ends DO agree (`readonlyWhen for 'x' failed to evaluate — change
 * allowed through` — the GENERIC-fault message; the unbound-root fault above
 * logs `treating the field as LOCKED` instead). The *default* stays
 * fail-open on purpose — flipping it is a shipped-behavior change tracked
 * separately in objectstack#5149 (appeal 1, undecided).
 *
 * A predicate the author DECLARED and left BLANK is loud too, since
 * objectui#8069 — and it did not used to be. It is a third state, not a
 * spelling of either neighbour: the key is present (so it is not "no rule")
 * and nothing evaluates (so no engine fault is raised), and it used to return
 * the caller's permissive fallback before any warning could fire. `''` and
 * `'   '` are authorable — `ExpressionWireSchema` is a bare `z.string()`, and
 * `resolveFieldRuleState`'s own guard is `!= null` — so the one state an author
 * reaches by *starting* a rule and not finishing it was the one state that said
 * nothing at all. Both spellings now report `[blank]` through the same single
 * site as every other fault; the VERDICT is unchanged for every input.
 */
import { ExpressionEngine } from '@objectstack/formula';
import { subjectCapabilitiesOf, subjectPermissionsOf } from './subjectPermissions.js';
import type { Expression } from '@objectstack/spec';

import { isBlankPredicateText } from './declaredPredicate.js';
import { isUnevaluablePredicate, UNEVALUABLE_PREDICATE_REASON } from './unevaluablePredicate.js';

/** A field-rule predicate as authored in metadata. */
export type FieldRulePredicate = string | { dialect?: string; source: string };

/** Normalize a predicate into the `Expression` shape the engine expects. */
function toExpression(pred: FieldRulePredicate): Expression {
  if (typeof pred === 'string') return { dialect: 'cel', source: pred };
  return { dialect: (pred.dialect ?? 'cel') as Expression['dialect'], source: pred.source };
}

/** Diagnostic options for {@link evalFieldPredicate} evaluation failures. */
export interface FieldPredicateDiagnostic {
  /**
   * Human-readable locator included in the one-time failure warning — e.g.
   * `"visibleWhen of field 'amount'"`. Pass whatever the call site knows; the
   * predicate source text and failure reason are always included.
   */
  context?: string;
  /**
   * Set `false` when the caller deliberately probes for faults (evaluating
   * twice with both fallbacks) and surfaces its own diagnostic — prevents two
   * warnings for one broken predicate. Defaults to `true`.
   */
  warn?: boolean;
  /**
   * Called with the engine's failure reason (`"[kind] message"`, the exact text
   * the built-in warning prints after `Reason:`) when the predicate cannot be
   * evaluated. This is the passback for callers that set `warn: false` and
   * report the fault themselves — without it, silencing the built-in warning
   * also discards the only description of *why* the predicate failed, which is
   * how the fail-closed row-predicate path ended up the least debuggable one
   * (objectui#3792).
   *
   * Independent of `warn` and of the one-time-warning dedupe: it fires on every
   * fault, so a caller doing its own warn-once bookkeeping keeps control of it.
   * The returned verdict is unaffected. Must not throw — it is invoked outside
   * the engine guard, so an exception here propagates to the caller rather than
   * being reported as an engine fault.
   */
  onFault?: (reason: string) => void;
}

const warnedPredicates = new Set<string>();

/**
 * The `reason` reported for a predicate the author DECLARED and left blank.
 *
 * Tagged like an engine reason (`[parse]`, `[type]`, `[throw]`) because it
 * travels the same two channels — the built-in warning and the `onFault`
 * passback — and a caller that routes on the tag must be able to tell this
 * apart from a predicate that faulted with text in it: the fix for a blank one
 * is to finish it or delete the key, never to debug its syntax.
 */
const BLANK_PREDICATE_REASON = '[blank] the predicate is declared but empty — nothing to evaluate';

/**
 * One-time warning for a predicate that could not be evaluated. Deduped per
 * predicate TEXT (dialect + source): a broken predicate is re-evaluated on
 * every render/keystroke, and the point is one loud line, not a scrolling
 * wall. The dedupe key is JSON-encoded — never a control-character separator
 * (objectstack#5450 made a sibling of this file binary to grep that way).
 *
 * ⚠️ One class joins the LOCATOR to that key: a BLANK predicate. The text is
 * what identifies the authoring site for every other fault — it carries the
 * typo — but every blank predicate in an app shares the key `""`, so text
 * alone would let the first blank rule silence every other author's. Non-blank
 * keys are unchanged (objectui#8069).
 */
function warnPredicateFailure(
  expr: Expression,
  fallback: boolean,
  reason: string,
  context?: string,
): void {
  // `Expression['source']` is optional in the spec; an absent source is blank
  // by the same rule as a whitespace-only one, and lands in the same key shape.
  const key = expr.source?.trim()
    ? JSON.stringify([expr.dialect, expr.source])
    : JSON.stringify([expr.dialect, expr.source, context ?? '']);
  if (warnedPredicates.has(key)) return;
  warnedPredicates.add(key);
  console.warn(
    '[object-ui] A conditional predicate failed to evaluate' +
      (context ? ` (${context})` : '') +
      ` and was treated as its safe default (${String(fallback)}): ` +
      JSON.stringify(expr.source) +
      `. Reason: ${reason}. ` +
      "Values are bound under 'record.' (e.g. record.status) — check the field names and CEL syntax.",
  );
}

/**
 * Evaluate a field-rule CEL predicate against a record.
 *
 * ## `fallback` is a per-CALL-SITE policy, not a default this helper owns
 *
 * The parameter is required and carries no default value, so every call site
 * states a direction of its own — and the directions in this repo do not
 * agree. Five distinct fault policies share this one helper today, which is
 * readable nowhere but here (objectui#8069):
 *
 * 1. **Fixed permissive, paired with an equal "no rule" literal.**
 *    {@link resolveFieldRuleState} (`true` / `false` / `false`) and
 *    `resolveVisibleOptions` (`evaluator/optionRules.ts`, `true`). A fault
 *    produces the permissive verdict, indistinguishable from the verdict for
 *    "the author wrote no rule" — see the `…_FAULTED` / `…_ABSENT` note below.
 * 2. **Fixed permissive, unguarded — ONE literal answers absent *and*
 *    faulted.** Every visibility call site outside core: the form renderer
 *    (`components/renderers/form/form.tsx`), console's `FormPage`, app-shell's
 *    `ScreenView`, `plugin-form`'s `WizardForm`. All of them pass `true`, and
 *    none has a separate absent branch at all.
 * 3. **Caller-parameterised.** `evalRowPredicate`'s single-eval fast route
 *    (`evaluator/listConditional.ts`) forwards `opts.fallback`, so the
 *    direction is the mounting surface's to state.
 * 4. **Divergence probe → fault FLAG.** `evalCel`
 *    (`evaluator/listConditional.ts`) calls this helper once per direction with
 *    `warn: false` + `onFault`: a verdict that tracks the fallback in BOTH runs
 *    is a fault, and the caller emits its own labelled warning and returns its
 *    own fallback.
 * 5. **Divergence probe → THROW.** `ExpressionEvaluator.evaluateCelCondition`
 *    under `throwOnError` runs the same two-call trick and converts the
 *    disagreement into `throw new Error('CEL predicate failed to evaluate: …')`.
 *
 * ⚠️ The last two policies exist **because** `fallback` is free to specify: they
 * detect a fault by disagreeing with themselves. Fixing a direction *inside*
 * this helper would remove the mechanism they are built on, which is why
 * ADR-0137 D5 keeps `fallback` free and declares the direction at the
 * field-rule and gate layer instead.
 *
 * @param pred      The `visibleWhen` / `readonlyWhen` / `requiredWhen` predicate.
 * @param record    The live form values (overlays prior persisted record).
 * @param fallback  Value to return when the predicate is ABSENT (`null` /
 *                  `undefined`), and — separately — the value returned when a
 *                  present predicate cannot be evaluated. ⚠️ Those are two
 *                  questions this one parameter answers with one value; a
 *                  caller that wants different answers must branch before the
 *                  call, as {@link resolveFieldRuleState} does. The historic
 *                  advice is to pick the *safe* default (`false` for
 *                  readonly/required — don't lock/block on error; `true` for
 *                  visibility — don't hide on error). ADR-0137 kept those
 *                  directions for RENDER (D3) and put the answer to a broken
 *                  field rule at SUBMIT (D2) — see {@link FieldRuleFaults}.
 * @param previous  The prior persisted record, if any (for `previous.*` refs).
 * @param scope     Extra top-level scope variables bound alongside `record` —
 *                  e.g. `{ parent }` so an inline line-item cell can reference
 *                  its header (`parent.status == 'paid'`) as well as its own
 *                  row (`record.quantity`). Bound via the engine's `extra`.
 * @param diagnostic  Failure-warning options: a `context` locator for the
 *                  one-time warning, and `warn: false` for callers that probe
 *                  for faults and report them themselves. The returned value
 *                  is unaffected either way.
 */
export function evalFieldPredicate(
  pred: FieldRulePredicate | undefined | null,
  record: Record<string, unknown>,
  fallback: boolean,
  previous?: Record<string, unknown>,
  scope?: Record<string, unknown>,
  diagnostic?: FieldPredicateDiagnostic,
): boolean {
  if (pred == null) return fallback;
  const expr = toExpression(pred);
  // The fault sources — a blank predicate, a not-ok verdict, and a throw that
  // slipped past the engine's "never throws" contract — converge on one reason
  // string and one reporting site below, so the built-in warning and the
  // `onFault` passback can never describe the failure differently.
  let reason: string | undefined;
  let value = fallback;
  if (isBlankPredicateText(pred)) {
    // Declared-and-blank, in EITHER spelling. Answered here rather than by the
    // engine for two reasons: the bare-string spelling never reached the engine
    // at all (this line used to `return fallback` before any warning could
    // fire — objectui#8069), and the envelope spelling reached it and came back
    // with `AST-only evaluation not yet supported; persist \`source\`` for
    // `{ source: '' }`, a reason that sends the author looking for a
    // serialization bug. `isBlankPredicateText` is the repo's one definition of
    // this question (objectui#3960) — a fourth local `trim()` here is exactly
    // the drift it was consolidated to stop.
    reason = BLANK_PREDICATE_REASON;
  } else if (isUnevaluablePredicate(pred)) {
    // Declared, and nothing here can be evaluated: an envelope with no string
    // `source` (an `ast`-only one), a number, `{}`, an array (objectui#11358).
    // Answered here, beside the blank, for the blank's reasons: there is no
    // `source` to hand the engine, and the engine's answer for one —
    // `AST-only evaluation not yet supported; persist \`source\`` — was what
    // a `0` reported too, which sends its author looking for a serializer.
    // One reason, one tag, the same two channels.
    reason = UNEVALUABLE_PREDICATE_REASON;
  } else {
    try {
      // objectui#4421 — the acting subject's effective object permissions, the
      // one input `current_user.can(object, verb)` is answered from. They ride
      // on the subject the scope already carries (`subjectPermissions.ts`),
      // never under a scope key, because every key of `scope` is a CEL root
      // and the engine keeps this map out of the variable namespace. A subject
      // with none passes none, and `can` then refuses loudly: that fault goes
      // through the caller's `fallback` like any other.
      const permissions = subjectPermissionsOf(scope?.current_user);
      // objectui#13006 — the subject's held system capabilities, the one input
      // `current_user.hasCapability(name)` is answered from, carried the same
      // way and for the same reason; absent stays absent, so the call refuses.
      const systemPermissions = subjectCapabilitiesOf(scope?.current_user);
      const res = ExpressionEngine.evaluate<boolean>(expr, {
        record,
        previous,
        ...(scope ? { extra: scope } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
        ...(systemPermissions !== undefined ? { systemPermissions } : {}),
      });
      // Parse error, type error, unbound identifier, engine fault … — every
      // not-ok verdict resolves to the fallback, but never silently (objectstack-ai/objectstack#5149).
      if (!res.ok) reason = `[${res.error.kind}] ${res.error.message}`;
      else value = res.value === true;
    } catch (err) {
      reason = `[throw] ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (reason !== undefined) {
    if (diagnostic?.warn !== false) {
      warnPredicateFailure(expr, fallback, reason, diagnostic?.context);
    }
    // Outside the try on purpose: a throwing callback is a caller bug and must
    // surface as one, not be swallowed and re-reported as an engine fault.
    diagnostic?.onFault?.(reason);
    return fallback;
  }
  return value;
}

/**
 * The verdict {@link resolveFieldRuleState} applies when a rule's predicate
 * CANNOT BE EVALUATED — parse error, unbound identifier, engine fault, or a
 * predicate the author left blank.
 *
 * ⚠️ These answer **"what should the form do when this rule is BROKEN?"** —
 * *not* "what should the form do when the author declared NO rule?" That
 * second question is answered separately, by the `…_ABSENT` set below. The two
 * sets hold pairwise EQUAL values today, and that equality is a copy, not an
 * implication: each `rules.<key> != null` ternary answers the absent case with
 * its own literal and hands `evalFieldPredicate` the same literal as the fault
 * fallback beside it, so every permissive value is written twice and the "it
 * broke" answer was chosen by aligning it with the "it is absent" answer next
 * to it. Nothing was *inherited* from a shared default — `evalFieldPredicate`'s
 * `fallback` parameter is required and has none (objectui#8069 measured both
 * halves).
 *
 * All three directions are the PERMISSIVE one, so a single mistyped column in
 * one authored predicate yields a form that shows more, locks less and demands
 * less — three faults from one typo, composing rather than cancelling.
 * ADR-0137 answered that without moving any of the three: they stay the RENDER
 * direction (D3 — a faulting `visibleWhen` shows the field), and the composite
 * is closed at SUBMIT instead (D2), from the `faults` report
 * {@link resolveFieldRuleState} returns beside the verdicts.
 *
 * **What the history records** (read on full, unshallowed history — a shallow
 * clone answers this with one commit and no warning): the direction *was*
 * reasoned about, once, when the helper landed (objectui#1578). This module's
 * head and ADR-0036 both record the same rationale — the fallbacks are "chosen
 * so a fault is *safe*: `true` for visibility (don't hide content on error),
 * `false` for required/readonly (don't block submit or lock a field on
 * error)". What no commit records is the COMPOSITION: every recorded argument
 * is per-key, and the case where all three faults arrive from one typo was
 * never put. objectstack#5149 then removed the SILENCE and left the direction
 * explicitly undecided ("appeal 1").
 *
 * ⛔ These values are shipped behaviour, declared by ADR-0137 D3. Changing one
 * is not a refactor — and `6a449fc49` leans on the `visibleWhen` half staying
 * fail-open (a broken predicate must never silently null a stored column).
 */
const VISIBLE_WHEN_FAULTED = true;
const READONLY_WHEN_FAULTED = false;
const REQUIRED_WHEN_FAULTED = false;

/**
 * The verdict {@link resolveFieldRuleState} applies when the author declared NO
 * rule for that key at all — the `: <literal>` arm of each `!= null` ternary.
 *
 * Spelled apart from the `…_FAULTED` set above because they answer a different
 * question, not because they differ: changing one of THESE changes what an
 * unconditional field does, which is a louder and quite separate decision.
 */
const VISIBLE_WHEN_ABSENT = true;
const READONLY_WHEN_ABSENT = false;
const REQUIRED_WHEN_ABSENT = false;

/**
 * Which of {@link resolveFieldRuleState}'s rules could NOT be evaluated, and
 * why — keyed by rule, valued by the reason the one-time warning prints after
 * `Reason:` (`"[kind] message"`). A key is present only for a rule that ran and
 * faulted (objectui#8069).
 *
 * This is the report a SUBMIT path reads — ADR-0137 D2, "at submit time, a
 * field-rule predicate that cannot be evaluated refuses the write and names the
 * field and the rule" — so that the refusal is decided by the very evaluation
 * that drew the verdict, never by a second one with its own record assembly.
 * Which rules a submit path refuses on is that path's ruling, not this
 * function's: under objectui#8069's ruling (Q1 = B, one judge per rule) the
 * client refuses `visibleWhen` only, because no server evaluates it, and leaves
 * `readonlyWhen` / `requiredWhen` to the server's own D2 refusal. The other two
 * keys are reported all the same, so the report does not encode that ruling.
 *
 * A BLANK predicate IS in it, as the `[blank]` reason. ADR-0137 makes a
 * declared-but-blank field rule a third state, not a spelling of "no rule":
 * "A blank predicate takes this path too, wherever one is already stored — D1
 * keeps new ones from being authored, and D2 is what a stored one meets" (D2),
 * and its Alternatives refuse "blank means no rule" for this triad by name. So
 * a stored blank `visibleWhen` is refused at submit like any other fault. The
 * trap that would otherwise make — an authorable value that no submit can ever
 * pass — is closed at AUTHORING: the triad's form wire refuses a blank at parse
 * (`FieldRulePredicateWireSchema` in `@object-ui/types`' `form.zod.ts`, D1).
 * The render verdict of a blank rule is unchanged (D3: the permissive one).
 * A blank GATE is a different thing: `hasDeclaredPredicate` still folds it to
 * "no gate" and only diagnoses it (D4) — it never reaches this function.
 *
 * Deliberately NOT in it: a rule the verdict did not need. `readonlyWhen` under
 * a static `readonly: true`, and `requiredWhen` under `serverOwnedValue` or a
 * static `required: true`, are short-circuited and never run, so they cannot
 * fault.
 */
export interface FieldRuleFaults {
  visibleWhen?: string;
  readonlyWhen?: string;
  requiredWhen?: string;
}

/**
 * Resolve the effective `{ visible, readonly, required }` state for a field
 * given its conditional rules and the live record. Each `*When` rule, when
 * present, *overrides* the static flag. A static `true` is never weakened by a
 * `false` predicate result for required/readonly — but `visibleWhen` is
 * authoritative when present (so a field can be conditionally shown/hidden).
 *
 * ## `statics.serverOwnedValue` — the one thing that outranks BOTH
 *
 * A CREATE form leaves a producer-owned control empty on purpose and omits the
 * key, so the server resolves the declared runtime default (#4069). Required-
 * ness is then not the client's question at all, and this is the single place
 * that answers it: `required` resolves to `false` whatever `statics.required`
 * says and whatever `requiredWhen` evaluates to.
 *
 * Both spellings had to land HERE, not in a gate a layer up. Since
 * objectui#4201 the submit-time check and the required marker read one live
 * verdict — this function's — so a suppression applied anywhere else would
 * show a field without an asterisk and still refuse the submit, which is the
 * exact two-layer disagreement #4201 removed. #4085 is the conditional half:
 * `requiredWhen` resolving TRUE on a create form re-required a control the
 * renderer deliberately left empty, with nothing the user could type to
 * unblock it. See `isServerOwnedValue` in `../validation/server-owned-value.js`
 * for who computes the fact and why the mode is the caller's to state.
 *
 * @param fieldContext  Optional locator for failure warnings — e.g.
 *                      `"field 'amount'"`. The warning then reads
 *                      `visibleWhen of field 'amount' …`; without it, the rule
 *                      kind alone is reported.
 * @returns The three verdicts, plus `faults` — see {@link FieldRuleFaults} for
 *          what a submit path reads from it and what it leaves out.
 */
export function resolveFieldRuleState(
  rules: {
    visibleWhen?: FieldRulePredicate;
    readonlyWhen?: FieldRulePredicate;
    requiredWhen?: FieldRulePredicate;
  },
  record: Record<string, unknown>,
  statics: { required?: boolean; readonly?: boolean; serverOwnedValue?: boolean },
  previous?: Record<string, unknown>,
  scope?: Record<string, unknown>,
  fieldContext?: string,
): { visible: boolean; readonly: boolean; required: boolean; faults: FieldRuleFaults } {
  const faults: FieldRuleFaults = {};
  // `onFault` fires beside the built-in warning, not instead of it (`warn`
  // stays on), so recording the report costs no diagnostic and no second
  // engine call.
  const diag = (rule: keyof FieldRuleFaults): FieldPredicateDiagnostic => ({
    context: fieldContext ? `${rule} of ${fieldContext}` : rule,
    onFault: (reason) => {
      faults[rule] = reason;
    },
  });

  const visible =
    rules.visibleWhen != null
      ? evalFieldPredicate(
          rules.visibleWhen,
          record,
          VISIBLE_WHEN_FAULTED,
          previous,
          scope,
          diag('visibleWhen'),
        )
      : VISIBLE_WHEN_ABSENT;

  const readonly =
    statics.readonly === true ||
    (rules.readonlyWhen != null
      ? evalFieldPredicate(
          rules.readonlyWhen,
          record,
          READONLY_WHEN_FAULTED,
          previous,
          scope,
          diag('readonlyWhen'),
        )
      : READONLY_WHEN_ABSENT);

  // Short-circuited, not evaluated-and-discarded: the verdict cannot depend on
  // the predicate, so running it would only spend an engine call per field per
  // render. A broken `requiredWhen` still warns wherever it decides something
  // — the same object's EDIT form, and any create form where the field is not
  // server-owned.
  const required =
    statics.serverOwnedValue === true
      ? false
      : statics.required === true ||
        (rules.requiredWhen != null
          ? evalFieldPredicate(
              rules.requiredWhen,
              record,
              REQUIRED_WHEN_FAULTED,
              previous,
              scope,
              diag('requiredWhen'),
            )
          : REQUIRED_WHEN_ABSENT);

  return { visible, readonly, required, faults };
}
