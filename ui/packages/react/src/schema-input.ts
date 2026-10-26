/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { SchemaNode } from '@object-ui/types';
import type { SchemaRendererProps } from './SchemaRenderer.js';

/**
 * Narrow a loosely-typed metadata node onto {@link SchemaRendererProps.schema}.
 *
 * `@object-ui/types` declares `SchemaNode` as
 * `DeclaredNode | string | number | boolean | null | undefined` (its object
 * arm the declared-node union, objectui#11466), and a lot of metadata plumbing (page regions, header-bar actions, detail tabs, view
 * configs) is typed with it. `SchemaRenderer` deliberately does NOT declare the
 * `number` / `boolean` members — nobody should be invited to author them — so
 * forwarding such a value needs one honest step in between.
 *
 * This is that step, and it is a TOTAL function rather than a cast: it maps the
 * two primitive members onto whatever `SchemaRenderer` would itself render for
 * them. So it changes no behaviour and tells no lie — the value a caller
 * forwards renders identically whether or not it passes through here.
 *
 * ## Why the mapping has TWO legs and not one
 *
 * Because the renderer's own narrowing has two, in a fixed order: the
 * `!evaluatedSchema` leg returns nothing and runs FIRST, and only below it does
 * the defensive branch return the value's `String` form. So the falsy
 * primitives — `0`, `-0`, `NaN`, `false` — never reach that branch at all; they
 * render as nothing. `!node` is exactly that set for the two members this
 * function converts, so the ternary below IS the renderer's order, restated for
 * a value that has to cross the type boundary as a string.
 *
 * ⚠️ The single-leg `String(node)` that stood here until objectui#8908 was the
 * lie this paragraph used to tell. `String(0)` and `String(false)` are the
 * NON-EMPTY strings `'0'` and `'false'`, which are truthy, so they sailed past
 * the renderer's first leg and printed themselves — while the same two values
 * handed to `SchemaRenderer` directly render nothing, pinned since
 * objectui#4548 in `packages/react/src/__tests__/SchemaRenderer.primitiveSchema.test.tsx`.
 * The shipped `empty` renderer, whose `action` slot gates on nullish rather than
 * truthiness, printed a stray `0` for `{ type: 'empty', action: 0 }` because of
 * it. ⛔ Do not "simplify" the two legs back into one.
 *
 * ## Why the falsy leg returns nothing rather than the value itself
 *
 * Passing `0` / `false` through UNCHANGED would widen this function's return
 * type to admit `number` / `boolean`, and that is not a free choice: the return
 * type is pinned exactly equal to `SchemaRendererProps['schema']` by
 * `packages/react/src/__tests__/SchemaRenderer.propsResolution.test.ts`, which
 * also pins that the prop admits NEITHER member (objectui#4548 ruling Q2). A
 * widened return would therefore be a TS2322 at every call site that forwards
 * it straight into `<SchemaRenderer schema={…} />`, which is all of them. The
 * nullish leg is the spelling that keeps the guarantee and the type both.
 *
 * The bridge is PERMANENT — not scaffolding awaiting a merge. The two competing
 * repo-wide `SchemaNode` spellings ARE reconciled (objectui#4580, PR #4608):
 * `@object-ui/core` stopped hand-declaring its own interface and now re-exports
 * `@object-ui/types`' union, so one declaration is left to disagree with. That
 * reconciliation resolved in favour of the UNION, while `SchemaRenderer`'s prop
 * stays deliberately narrow (objectui#4548 ruling Q2 — it declares no `number`
 * or `boolean`), so a `SchemaNode` is now LESS assignable to that prop than it
 * was, not more. This step therefore bridges two intentionally different types,
 * and it stays. ⛔ Do not "tidy" a call site back into a direct forward: the
 * five `apps/site` sites that were forwarding directly when PR #4608 landed are
 * what kept `Build Docs` red on `main` for ~5 hours — each one a TS2322 naming
 * `number` against this function's return type, spelled
 * `string | BaseSchema | null | undefined` in objectui#4617's logs — until
 * PR #4621 routed all five through here. An earlier revision of this paragraph
 * said the reconciliation was still pending and invited exactly that edit.
 */
export function toRenderableSchema(
  node: SchemaNode,
): SchemaRendererProps['schema'] {
  return typeof node === 'number' || typeof node === 'boolean'
    ? (node ? String(node) : undefined)
    : node;
}
