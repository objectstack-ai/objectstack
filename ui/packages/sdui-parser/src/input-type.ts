/**
 * ObjectUI — the arms of a manifest input's coarse type (objectui#3832)
 *
 * `ManifestInput.type` carries ONE coarse kind, or an ARRAY of kinds when the
 * key's contract is a union. Every reader of that field needs the same two
 * decisions made the same way — how to see the arms, and which single form to
 * publish — so they live here once instead of at each call site. A reader that
 * forgets is not loud: `switch (input.type)` handed an array falls through to
 * the default branch and reports NOTHING, which looks exactly like a value that
 * validated cleanly.
 */

import type { ManifestInput, ManifestInputType } from './types.js';

/** The eleven coarse kinds, as a runtime set for guarding untyped input. */
export const MANIFEST_INPUT_TYPES: ReadonlySet<string> = new Set<ManifestInputType>([
  'string',
  'number',
  'boolean',
  'enum',
  'array',
  'object',
  'color',
  'date',
  'code',
  'file',
  'slot',
]);

/**
 * The declared arms of an input's coarse type, always as an array.
 *
 * Exported (not merely internal) so a third-party manifest consumer — a
 * designer panel, a codegen, a validator of its own — reads the arms through
 * the same accessor this package's own gate does, rather than re-deriving the
 * `Array.isArray` branch and getting it subtly wrong on the union form.
 */
export function inputTypeArms(
  type: ManifestInput['type'] | undefined,
): ManifestInputType[] {
  if (type === undefined) return [];
  return Array.isArray(type) ? type : [type];
}

/**
 * Project a DECLARED type (which may come from an untyped registry config) into
 * the canonical published form: a bare string for one arm, an array for a real
 * union.
 *
 * Two deliberate asymmetries between the single and array forms:
 *
 *  - A single unrecognized kind still becomes `'string'`. That coercion predates
 *    the union work and is kept exactly: with one arm there is no other
 *    information to fall back on, and a manifest whose `type` is off-vocabulary
 *    would make every consumer's switch silently inert.
 *  - An unrecognized arm INSIDE an array is DROPPED, not coerced. Promoting it
 *    to `'string'` would publish an arm the author never declared — a widening
 *    invented by the serializer — and the surviving arms already carry the
 *    declaration. If dropping empties the array, the single-arm fallback applies
 *    so the output is always a valid manifest.
 *
 * Collapsing one arm to the bare string is what keeps this a backward-compatible
 * extension of `sdui.manifest.json`: every input declared today serializes to
 * the byte-identical entry it does now, and arrays appear only where a union was
 * really declared.
 */
export function canonicalizeInputType(type: unknown): ManifestInputType | ManifestInputType[] {
  const arms = (Array.isArray(type) ? type : [type]).filter(
    (arm): arm is ManifestInputType => typeof arm === 'string' && MANIFEST_INPUT_TYPES.has(arm),
  );
  const distinct = [...new Set(arms)];
  if (distinct.length === 0) return 'string';
  if (distinct.length === 1) return distinct[0];
  return distinct;
}
