/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Did this action DECLARE a visibility gate at all? The renderer-side name for
 * the repo's one definition of that question, which now lives one layer down in
 * `@object-ui/core` as `hasDeclaredPredicate`
 * (`packages/core/src/evaluator/declaredPredicate.ts`) — read the reasoning
 * there; only what is specific to this file is repeated below.
 *
 * ## Why this module is now a re-export (objectui#3850 / objectui#3862)
 *
 * The question was answered three times with three different scopes, and the
 * widest-scoped answer was on the key where the mistake is not benign:
 *
 *   - HERE, `!= null && !== ''` — so every OBJECT counted as a declared gate,
 *     including `{ dialect: 'cel', source: '' }`. That envelope is not an exotic
 *     spelling: `@objectstack/spec`'s `ExpressionInputSchema` normalizes every
 *     authored predicate into one, so "the author left the predicate empty"
 *     compiles to exactly it. The verdict path then normalized the same value to
 *     `undefined` and `evaluateCondition(undefined)` answered `true` = "no
 *     condition, so visible/enabled" — which on `disabled` means GREYED OUT.
 *     A button disabled forever, indistinguishable from the metadata's intent
 *     (objectui#3850).
 *   - `SchemaRenderer`'s inline `!== undefined`, one notch wider again, so
 *     `disabled: null` greyed out any node on the generic rendering path
 *     (objectui#3862).
 *   - `ActionRunner`'s module-private helper, which asked "does this normalize
 *     to something evaluable?" — the scope objectui#3850 then ruled to be THE
 *     scope (objectui#3848).
 *
 * The ruling: a gate is declared when normalization still leaves a condition to
 * evaluate. `''`, a whitespace-only string and an empty-`source` envelope are
 * therefore NOT declared, and one definition in core says so for the
 * renderers, `SchemaRenderer` and the execution entry alike. (A non-predicate
 * value — `0`, `{}`, an array, an `ast`-only envelope — was in that list until
 * objectui#11358, which made it a DECLARED gate that cannot be evaluated: the
 * normalizer keeps it, the evaluator faults on it, and each leg fails it in
 * its key's fault direction — `visible` hidden, `disabled` greyed out.)
 *
 * The NAME is kept (`hasDeclaredVisibilityGate`) and this module keeps
 * re-exporting it: the five member-action call sites — `action:button`,
 * `action:icon`, `action:group`'s inline button and dropdown item, and
 * `action:menu`'s item, plus `DeclaredActionsBar` and `record-quick-actions`
 * through the `@object-ui/components` barrel — are unchanged by this move. The
 * name is historic (objectui#3492 arrived through `visible`) and the predicate is
 * key-neutral, which the call-site comments already say.
 *
 * ## What did NOT change: truthiness still cannot answer this
 *
 * `if (action.visible && !isVisible)` was the objectui#3812 defect: it
 * classified `visible: false` — the most explicit way an author can say "never
 * show this" — as *ungated*, so the gate never consulted the verdict and the
 * action rendered for everyone. A declared boolean is still a declared gate
 * here; only the empty and non-predicate shapes moved.
 *
 * ## The scope change is not verdict-neutral on every key — measured
 *
 * On `visible` the empty shapes were mostly benign already, because the two
 * mistakes cancelled: over-broad "declared" plus `evaluateCondition` answering
 * `true` for an empty predicate = SHOWN, the same result as "no gate". Measured
 * on this tree (`action:button`, before → after):
 *
 *   | value                        | `visible`         | `disabled`        | `enabled`         |
 *   |------------------------------|-------------------|-------------------|-------------------|
 *   | `''`                         | shown → shown     | on → on           | on → on           |
 *   | `{ dialect:'cel', source:'' }`| shown → shown    | GREY → on         | on → on           |
 *   | `{ source: '' }`             | shown → shown     | GREY → on         | on → on           |
 *   | `'   '` (whitespace)         | HIDDEN → shown    | on → on           | GREY → on         |
 *   | `0` / `{}` (not a predicate) | shown → shown     | GREY → on         | on → on           |
 *
 * (The table is objectui#3850's measurement. Since objectui#11358 the `0` /
 * `{}` row reads HIDDEN / GREY / on: declared and faulting, each leg's fault
 * direction — pinned in `__tests__/action-empty-predicate-scope.test.tsx`.)
 *   | `true` / `false` / CEL / `${…}`| unchanged        | unchanged         | unchanged         |
 *
 * The whitespace row is the one that moves on `visible`, and it moves toward the
 * invariant rather than away from it: `'   '` used to be normalized to `'${   }'`
 * (the normalizer wraps it rather than folding it), which evaluates falsy, so a
 * predicate that says nothing HID the action from everyone. "An empty predicate
 * must not hide the action from everyone" is what this gate has always claimed —
 * the whitespace spelling simply never obeyed it. Same story on the negated
 * `enabled` leg, where it greyed the control out instead.
 */
export { hasDeclaredPredicate as hasDeclaredVisibilityGate } from '@object-ui/core';
