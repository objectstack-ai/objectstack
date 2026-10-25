/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The opening record an `object-form`-shaped schema authors through its two
 * seed keys — `initialValues` and its alternate spelling `initialData`
 * (objectui#9760).
 *
 * ## The defect this replaces
 *
 * Every presentation arm used to choose between the two keys as WHOLE OBJECTS:
 *
 * ```ts
 * schema.initialData || schema.initialValues
 * ```
 *
 * `||` tests the object, never its size, and `{}` is truthy. So an author who
 * prefilled three fields through `initialValues` and added a one-member
 * `initialData` lost the other two, and an author whose `initialData` computed
 * to an EMPTY object — the shape a `?? {}` producer hands over when it has
 * nothing to contribute — got a completely blank form where a populated
 * `initialValues` sat right beside it. No warning, no empty state, no
 * diagnostic: the form simply opened blank where it used to open seeded.
 *
 * Nothing declared ever said that. The registration calls `initialData` an
 * "alternate spelling of `initialValues` … read FIRST", which is a statement of
 * PRECEDENCE — the reading a per-member merge implements — and is what an
 * author gets here now.
 *
 * ## Why it is one function rather than a corrected expression per arm
 *
 * The `||` was spelled at every read site of every presentation arm — the set a
 * `git grep` for this module's name now enumerates — and the two spellings
 * around it were not even the same: the create branches passed the chosen
 * object into `seedCreateValues` (which layers the object schema's declared
 * `defaultValue`s underneath it) while the rest installed it directly with a
 * trailing `|| {}`. Two expressions free to drift are how one arm comes to
 * answer "which spelling wins" differently from its neighbour, which is a
 * question no author can even ask of a JSON schema. One function cannot drift.
 *
 * ## The contract
 *
 * `initialData` wins PER MEMBER, `initialValues` supplies every member it says
 * nothing about, and the result is always a fresh plain object — never `null`,
 * never `undefined`, never either authored object by reference. Callers may
 * therefore spread it, hand it to `seedCreateValues` as the caller layer, or
 * install it as form state without a `|| {}` tail.
 *
 * An explicit `null` MEMBER is preserved, on both sides: a caller writing
 * `{ status: null }` is saying "open this control blank", which is a value and
 * not an absence — the same reading `seedCreateValues`' docblock takes of the
 * seed as a whole. Only a missing or nullish KEY contributes nothing.
 */

/** The two seed keys, as every presentation arm's schema declares them. */
export interface InitialRecordSchemaLike {
  /** Values to prefill in `create` mode. */
  initialValues?: Record<string, any> | null;
  /** Alternate spelling of `initialValues`, read FIRST — i.e. per member it wins. */
  initialData?: Record<string, any> | null;
}

/**
 * The record a form opens with, merged per member with `initialData` on top.
 *
 * Returns a fresh object (never shared with either input, never nullish), so
 * every caller can install or spread it unconditionally.
 */
export function resolveInitialRecord(
  schema: InitialRecordSchemaLike | null | undefined,
): Record<string, any> {
  return { ...(schema?.initialValues ?? {}), ...(schema?.initialData ?? {}) };
}
