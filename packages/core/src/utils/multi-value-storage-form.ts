// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21238] THE storage form of one value written to a declared multi-valued
 * column — one rule, read by the write door that stores it and by the check
 * that judges the row it stores.
 *
 * A multi-valued column (`@objectstack/spec/data`'s `isMultiValueField`: an
 * inherently-multi option type such as `tags` or `multiselect`, or a
 * multi-capable type flagged `multiple: true`) persists a LIST. A client may
 * still send one lone scalar — a legacy console bulk-edit sent
 * `{ labels: 'frontend' }` at a multiselect (#2552) — and the write door stores
 * it as a one-member list, so `tags: 'x'` is stored as `['x']`.
 *
 * ## Two faces, one rule
 *
 * - `@objectstack/objectql`'s record validator applies it on every write
 *   (`normalizeMultiValueFields`), before validation, so the row it hands the
 *   driver holds the list.
 * - `@objectstack/plugin-security`'s row-level write `check` applies it to the
 *   image it judges (`storedFormCheckJudge`), because some of the images it
 *   judges are formed before the write door has run: the insert seam and the
 *   by-id update image. Judged raw, `tags: 'x'` under
 *   `record.tags.contains('x')` was refused while the stored `['x']` was shown
 *   by the read the same policy scopes, and admitted under
 *   `!record.tags.contains('x')` while the read hid it.
 *
 * The two packages do not depend on each other at runtime, and a copy each is
 * how one write comes to get two answers. So the rule lives here, beside
 * `temporalStorageForm`, which the same two faces share for the same reason.
 * Which columns it applies to is the caller's: the declared-type predicate
 * stays the spec's, and the write door also skips the columns the engine owns.
 *
 * ## The rule
 *
 * - A string, a number or a boolean is wrapped: `[value]`.
 * - A list is already in the form, and is returned as it is.
 * - `null`, `undefined`, the empty string and a string of whitespace are not
 *   wrapped: the write door reads a blank as missing, never as a member.
 * - Anything else (an object, a `Date`, a function) is returned unchanged, so
 *   the validator refuses it as a value that is not a list. ⛔ No shape is
 *   guessed into a list.
 *
 * It returns the SAME value when there is nothing to wrap, so a caller can
 * tell "already in the form" by identity.
 */
export function multiValueStorageForm(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string' && value.trim() === '') return value;
  if (Array.isArray(value)) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return [value];
  return value;
}
