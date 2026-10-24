/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Is this value a real config bag — an object, and not an array pretending to
 * be one? (objectui#6761)
 *
 * This is the ONE definition of that question in `@object-ui/react`, and it
 * lives here rather than in whichever module happened to need it first,
 * because every module that asks it is a CONSUMER of the same authored shape:
 * the `properties` / `props` bags a node may carry. `typeof null === 'object'`
 * is covered by the truthiness test.
 *
 * ## Why one definition, when all the copies agreed
 *
 * They agreed; that was never the cost. The cost is that disagreement between
 * them produces NO error — each copy is a boolean expression, and a copy that
 * drifts answers a different question on ONE channel while every other channel
 * keeps the old answer. That is the same failure mode `hasDeclaredPredicate`
 * (`@object-ui/core`) was created to end for "is a gate DECLARED?", which had
 * three spellings with three different SCOPES before objectui#3850 —
 * `disabled: null` greying a control out on one path and not another
 * (objectui#3862).
 *
 * ## The spellings this replaces, measured on `b98352a15`
 *
 * Six occurrences, four spellings, all in `packages/react/src`:
 *
 *   1. `SchemaRenderer`'s module-private `isConfigBag` — itself already the
 *      merge of the `properties` evaluation guard and `propsWithoutCanonicalKeys`
 *      (objectui#6752, which unified those two because it had to touch both,
 *      and filed the rest as objectui#6761 rather than smuggling it in);
 *   2. `SchemaRenderer`'s `winningVisibilityKey`, inline, spelled with
 *      `!= null` where the others spell truthiness;
 *   3. `utils/propsBagDiagnostic.ts`'s module-private twin (objectui#6708);
 *   4. `utils/unevaluatedExpression.ts`'s `scanBag` early return, spelled
 *      NEGATED (objectui#4795);
 *   5. `utils/unevaluatedExpression.ts`'s `hoisted`, in the same file as (4)
 *      and spelled positively — this one is not in objectui#6761's inventory
 *      of five, which counted the file once; six occurrences is the count
 *      measured on this branch's base, and it was six on the card's base
 *      (`b76ca6764`) too.
 *
 * `!= null` (2) and truthiness (1, 3, 5) cannot disagree HERE, and the
 * difference is worth naming rather than smoothing over: they part company
 * only on a falsy value, and every falsy value except `document.all` fails
 * `typeof === 'object'` in the very next conjunct. The texts differ; the
 * answers cannot.
 *
 * ## What this is NOT
 *
 * Not a general "is this a plain object?" utility, and deliberately not shared
 * with the two sites that ask the same SHAPE question about a data ROW —
 * `SchemaRenderer`'s `boundRecord` scope entry and
 * `usePredicateRecordContext` (`hooks/useExpression.ts`). Those answer "did a
 * row bind?", and their answer has its own pinned meaning: binding NOTHING
 * rather than an empty row is what keeps a host-supplied `record` from being
 * shadowed. Should "config bag" ever narrow (rejecting a class instance, say),
 * the row sites must NOT follow — merging them would make that a single edit
 * with two rulings behind it. The pin in `configBag.pin.test.ts` names both
 * sites with this reason, so the next reader finds a decision rather than an
 * oversight.
 */
export function isConfigBag(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
