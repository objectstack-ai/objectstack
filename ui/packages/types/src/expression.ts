/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Expression wire type
 *
 * The ONE TypeScript spelling of a predicate as it travels on the wire, shared
 * by every key that carries one. Its runtime twin is `ExpressionWireSchema`
 * in `./zod/expression.zod.ts`.
 *
 * @module expression
 * @packageDocumentation
 */

/**
 * The wire shape of a predicate expression (objectui#2212): a bare string, or
 * the envelope object `{ dialect?, source }` that `objectstack build` emits for
 * every authored predicate (a bare authored string compiles to
 * `{ dialect: 'cel', source }`, so the envelope is the LIKELIEST spelling in
 * real metadata, not an exotic one).
 *
 * ## Why this is a NAMED type (objectui#7530)
 *
 * `BaseSchema.visible` / `.hidden` / `.disabled` declare `boolean | ExpressionWire`
 * (maintainer ruling 2026-09-04, option A). The renderer evaluates all three
 * through the one path that already honoured the envelope, and declaring the
 * shape key by key would have produced three spellings of one contract. Before
 * this name existed `FormField.visibleWhen` and its `*When` / `*On` siblings
 * carried the same union inline, and the zod twin was a module-private const in
 * `zod/form.zod.ts`; `BaseSchema` and the form keys now read ONE definition per
 * face, so the wire contract widens or narrows in exactly one place.
 *
 * ## What it is, measured against the runtime (objectui#7530)
 *
 * Exactly the accept set of `@object-ui/core`'s `toPredicateInput` (the
 * normalizer under `hasDeclaredPredicate`) and `ExpressionEvaluator
 * .evaluateCondition` -- no wider, no narrower:
 *
 *   - `dialect` is OPTIONAL and UNCONSTRAINED. The runtime reads it the same
 *     way: a `'cel'` envelope keeps its envelope and is evaluated on the
 *     canonical `@objectstack/formula` engine (the server's verdict); any
 *     other dialect -- absent, `'template'`, or a string the runtime has never
 *     heard of -- is unwrapped to its `source` and evaluated on the legacy
 *     `${...}` path. Declaring `dialect: 'cel'` alone would refuse a spelling
 *     the evaluator answers.
 *   - `source` is REQUIRED and a string. The runtime treats an object without
 *     a string `source` as a declared gate it cannot evaluate — a fault, failed
 *     in its key's direction (objectui#11358) — so admitting it here would
 *     declare a value that never reaches a verdict.
 *
 * It is NOT `@object-ui/core`'s `EvaluatorPredicateInput`: that is the OUTPUT
 * of normalization (a boolean, a `${...}` template, a `cel`-only envelope
 * with a non-empty `source`, or one with no `source` for a declared gate that
 * cannot be evaluated); this is what an AUTHOR writes. And it is
 * deliberately not the spec's `ExpressionInput` pipe, which canonicalizes a
 * string into an envelope at parse time and would change the parsed shape of
 * every schema that adopted it -- objectui keeps the wire un-normalized and
 * lets core normalize once, at evaluation.
 *
 * `crud.ts` (`ActionSchema.condition`), `select-option.ts` (`visibleWhen`) and
 * the `objectql.ts` predicate keys still spell this union inline; they are
 * structurally identical to it and predate the name.
 */
export type ExpressionWire = string | { dialect?: string; source: string };
