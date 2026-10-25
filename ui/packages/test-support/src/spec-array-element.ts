/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ARRAY-ELEMENT UNWRAPPING — one reader for every gate that asks "what shape
 * does ONE entry of this array have?" (objectui#5872 class (2)).
 *
 * ## The three readers this replaces, and why they were not one
 *
 * Unlike class (1) — four byte-identical copies — this class was THREE
 * DIFFERENT spellings of one question, in three packages, disagreeing about
 * every choice a reader has to make:
 *
 * 1. `plugin-detail/.../recordDetailsInputs.spec-parity.test.ts` — no walk at
 *    all (its caller did one `.unwrap()` first), four element spellings tried
 *    in a row, ending in `_def.type`;
 * 2. `app-shell/.../previews/__tests__/block-config.test.ts` — a bounded
 *    6-iteration loop alternating `_def.innerType` / `_def.element`, reading
 *    `_def` and nothing else;
 * 3. `app-shell/.../clientValidation.optOuts.test.ts` — a recursive walk
 *    through `_zod.def`, gated on `def.type` naming a known wrapper, and the
 *    only one of the three that answers `undefined` when the node is NOT an
 *    array.
 *
 * A shared reader has to pick, and on this class picking can change a VERDICT
 * rather than preserve one. Every choice below is recorded with the site it
 * came from and what was measured before it was made.
 *
 * ## Choice 1 — `undefined` when the node is not an array (from (3))
 *
 * (3) is the only site whose assertion depends on it:
 * `expect(element, 'sharingRules must be an array collection').toBeDefined()`.
 * A reader that answered with the node itself for a non-array would make that
 * assertion pass for every input, which is a non-vacuity check deleted in
 * silence. (1) and (2) cannot tell the difference — their inputs are arrays —
 * so (3)'s stricter answer is the one that costs nothing and guards something.
 *
 * ## Choice 2 — the element is returned AS FOUND, not unwrapped again
 *
 * (3) unwrapped the element a second time; (1) and (2) did not. Measured on the
 * installed pin (`@objectstack/spec@17.2.0`), the element at all four converted
 * call sites is a bare `ZodObject` / `ZodString`, so the second unwrap is a
 * no-op and no verdict moves either way. The narrower answer is taken because
 * the wider one cannot be given safely: the walk steps through `.unwrap()`, and
 * on `zod@4.4.3` `ZodArray` HAS an `unwrap()` that returns its element — so
 * "unwrap the element too" would silently descend into an array-of-arrays and
 * answer with the wrong entry shape. A wrapped element instead fails LOUDLY at
 * the caller's shape read, which is the direction this package prefers.
 *
 * ## Choice 3 — Zod 3's `_def.type` is read only behind `typeName`
 *
 * (1) ended its chain with `arr?._def?.type`. On Zod 3 that IS the element of a
 * `ZodArray`. On the installed `zod@4.4.3` it is the type-name STRING
 * `'array'` — measured — so (1)'s last limb was a live landmine: had the three
 * limbs before it ever missed, it would have handed its caller the string
 * `'array'`, and `listedShapeKeys('array')` is `[]`, which is exactly the quiet
 * empty set this card family exists to stop. It is kept here, because a Zod 3
 * consumer is a real thing, but only when `_def.typeName === 'ZodArray'` says
 * so — the discriminator Zod 3 carries and Zod 4 does not.
 *
 * ## `undefined` and the non-vacuity duty it leaves with the caller
 *
 * Same duty `spec-enum-options.ts` states, for the same reason: `undefined`
 * means "no element could be read", NOT "this array has no entry shape". A
 * caller that derives a key set from the element and asserts over it owes an
 * assertion that the set is non-empty — without one, a reader that stopped
 * working and a satisfied parity check look exactly alike.
 */

import { firstInWrapperChain, type ZodWrapperCarrier } from './spec-zod-wrappers';

/** The element of an array node, under whichever spelling the build uses. */
function readArrayElement(carrier: ZodWrapperCarrier): unknown {
  if (carrier.element !== undefined) return carrier.element;
  if (carrier.def?.element !== undefined) return carrier.def.element;
  if (carrier._def?.element !== undefined) return carrier._def.element;
  // Zod 3 only — see "Choice 3" above. `typeName` is the discriminator that
  // keeps Zod 4's `_def.type` STRING from ever being returned as a schema.
  const legacy = carrier._def;
  if (legacy?.typeName === 'ZodArray' && typeof legacy.type === 'object' && legacy.type !== null) {
    return legacy.type;
  }
  return undefined;
}

/**
 * The element schema of a `z.array(...)`, reached past `.optional()` /
 * `.default()` / `.nullable()` / `.readonly()` / `z.lazy()` — `undefined` when
 * the node is not an array, or when no element could be read.
 *
 * Takes the node itself, the way `enumOptions` does, so it answers for a shape
 * member the caller already holds and for a top-level `z.array` imported
 * straight from `@objectstack/spec`. Compose it with `resolvePropsShape` when
 * the caller has a schema and a key:
 *
 *     arrayElementSchema(resolvePropsShape(RecordDetailsProps)?.sections)
 *
 * There is no `shapeArrayElement(schema, key)` entry point: no in-tree call
 * site needs one, and this package does not mint surface ahead of a consumer.
 *
 * `undefined` carries the non-vacuity duty described in this module's docblock.
 */
export function arrayElementSchema(node: unknown): unknown {
  return firstInWrapperChain(node, readArrayElement);
}
