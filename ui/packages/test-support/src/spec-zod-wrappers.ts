/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE ZOD WRAPPER WALK — one implementation, every reader in this package that
 * has to look past `.optional()` / `.default()` / `.nullable()` / `.readonly()`
 * / `z.lazy()` before it can answer (objectui#5872).
 *
 * ## Why this module exists at all
 *
 * `spec-enum-options.ts` closed with a promise: "There is exactly one
 * wrapper-walk in this repository, and adding a third entry point later must
 * not change that." A SECOND reader class — array-element unwrapping, this
 * card's class (2) — arrived, and it needed the same walk with a different
 * question asked at each step. Writing that walk out again inside the new
 * reader would have been this package's own failure mode reintroduced by the
 * package that exists to end it. So the walk moved HERE and both readers stand
 * on it; `enumOptions` and `arrayElementSchema` differ only in what they read.
 *
 * ## What a "step" is, and why it is a superset rather than a rewrite
 *
 * The step is the one `enumOptions` carried, unchanged in the order it tried
 * things — `unwrap()`, then `def.innerType`, then `_def.innerType` — plus one
 * limb: a `def.getter()` / `_def.getter()` thunk, which is how `z.lazy()`
 * spells its inner schema on a build that does not put `unwrap()` on
 * `ZodLazy`. That limb is a WIDENING in the only safe direction: it can fire
 * only where every earlier limb already yielded `undefined`, i.e. where the
 * walk used to stop and the caller used to get the empty answer.
 *
 * ⚠️ Measured against the installed pin (`zod@4.4.3`, `@objectstack/spec@17.2.0`)
 * the new limb is UNREACHABLE: the only class carrying `def.getter` is
 * `ZodLazy`, and on this pin `ZodLazy` also exposes `unwrap()`, which the first
 * limb takes. So `enumOptions` is bit-for-bit the same walk it was before this
 * module existed, and the limb is there for the build where it is not.
 *
 * ## `def`, `_def` and `_zod.def` are the SAME OBJECT on this pin
 *
 * Measured, not assumed: on `zod@4.4.3` every node satisfies
 * `node.def === node._def === node._zod.def`. The three spellings the censused
 * hand copies disagreed about are one object, so a reader that tries `def`
 * before `_def` cannot answer differently from one that tries the reverse —
 * TODAY. Both are tried anyway, in `enumOptions`'s original order, because the
 * whole point of confining the walk is that the day they stop being the same
 * object, ONE place has to move.
 *
 * ⚠️ The same measurement is what makes Zod 3's `_def.type` spelling a trap
 * rather than a fallback: on Zod 3 `_def.type` IS the element schema of a
 * `ZodArray`, and on Zod 4 `_def.type` is the type-name STRING `'array'`.
 * `spec-array-element.ts` documents how it is guarded; nothing here may read
 * `type` as a schema.
 *
 * ## Bounded, not `while (node)`
 *
 * Same reason and same bound as the loop this replaces: the step is reached
 * through `unknown`, so a node that unwraps to itself ends the walk instead of
 * the process. Eight is far past anything the contract stacks today (the
 * deepest in-tree member is one wrapper).
 */

/** A Zod node, as far as walking past its wrappers needs to see it. */
export interface ZodWrapperCarrier {
  readonly options?: unknown;
  readonly element?: unknown;
  readonly unwrap?: () => unknown;
  readonly def?: ZodDefView;
  readonly _def?: ZodDefView;
}

/** The `def` bag, under whichever of its three names a build exposes. */
export interface ZodDefView {
  readonly type?: unknown;
  readonly typeName?: unknown;
  readonly innerType?: unknown;
  readonly element?: unknown;
  readonly getter?: unknown;
}

/**
 * How many wrappers deep to look before giving up.
 *
 * Exported so a reader's own calibration can assert the bound rather than
 * restate the number — a restated `8` is one more copy of the kind this
 * package exists to end.
 */
export const MAX_WRAPPER_DEPTH = 8;

/** `z.lazy()`'s inner schema, on a build that spells it as a thunk. */
function callGetter(def: ZodDefView | undefined): unknown {
  return typeof def?.getter === 'function' ? (def.getter as () => unknown)() : undefined;
}

/**
 * Ask `read` of a node and of each node inside its wrappers, outermost first,
 * and answer with the FIRST non-`undefined` result — `undefined` when no level
 * answers.
 *
 * The walk is lazy in the way that matters: `read` is asked BEFORE the next
 * `unwrap()` is called, so a reader that answers at the top never triggers the
 * step. That is the property the loop this replaced had, kept deliberately.
 *
 * `undefined` is the not-here signal, so a reader must not use it as a value.
 * Both readers in this package answer with `[]` / `undefined` at their own
 * surface instead, and both document what that means for their caller's
 * non-vacuity duty.
 */
export function firstInWrapperChain<T>(
  node: unknown,
  read: (carrier: ZodWrapperCarrier) => T | undefined,
): T | undefined {
  let carrier = node as ZodWrapperCarrier | undefined;
  for (let depth = 0; carrier && depth <= MAX_WRAPPER_DEPTH; depth += 1) {
    const answer = read(carrier);
    if (answer !== undefined) return answer;
    const inner =
      typeof carrier.unwrap === 'function'
        ? carrier.unwrap()
        : (carrier.def?.innerType ??
          carrier._def?.innerType ??
          callGetter(carrier.def) ??
          callGetter(carrier._def));
    carrier = inner as ZodWrapperCarrier | undefined;
  }
  return undefined;
}
