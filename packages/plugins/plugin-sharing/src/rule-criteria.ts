// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sharing-rule criteria normalisation + the ADR-0049 match-all guard (#3896).
 *
 * A sharing rule's `criteria` is the ONLY thing standing between a recipient
 * and every row of the target object: the evaluator feeds it straight to
 * `engine.find(object, { filter, context: SYSTEM_CTX })`. An absent or empty
 * predicate is therefore not "no constraint" — it is **share everything**,
 * which is exactly the shape `SharingRuleSchema` forbids:
 *
 * > A `condition` the compiler cannot lower … is skipped and logged — never
 * > seeded as a permissive match-all (ADR-0049).
 *
 * The seed path honoured that; `defineRule` (and through it
 * `POST {basePath}/sharing/rules`) and direct `sys_sharing_rule` writes did
 * not — a missing, `null`, or misspelled (`criterias`) key was stored as
 * `criteria_json: null` and evaluated as `{}`. These helpers are the single
 * definition of "this predicate constrains nothing", used by every authoring
 * entry (reject) and by the evaluator itself (match nothing, log) so rows
 * written before the gate existed cannot over-share either.
 */

/**
 * Normalise a stored / submitted criteria value into an engine
 * `FilterCondition`, or `undefined` when it carries no usable predicate.
 *
 * A string is JSON-parsed; an unparsable one (most likely a CEL source typed
 * into the Setup textarea, which the v1 evaluator does not lower) yields
 * `undefined` rather than being passed through — the engine would ignore it
 * and match every row.
 */
export function parseCriteria(raw: unknown): unknown | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Treat unparsable strings as opaque — most likely a CEL source
      // that v1's evaluator doesn't grok yet; rule will match nothing.
      return undefined;
    }
  }
  return raw;
}

/**
 * Does this criteria select EVERY record of its object?
 *
 * True for the shapes that reach the engine as an unconstrained filter:
 * missing / `null` / `''` / unparsable JSON / `{}` / `[]` / a non-object
 * scalar, and the empty or vacuous boolean combinators (`{ $and: [] }`,
 * `{ $or: [ {} ] }`). Any concrete field predicate makes it false.
 *
 * Conservative by design: it answers "could this fail open?", so an
 * ambiguous shape counts as match-all. Both consequences of a false positive
 * are safe — an authoring call is rejected with a message naming the field,
 * and an already-stored rule under-shares instead of over-sharing.
 */
export function isMatchAllCriteria(raw: unknown): boolean {
  const parsed = parseCriteria(raw);
  if (parsed == null) return true;
  // An array is the implicit-AND condition list: empty (or all-vacuous)
  // constrains nothing.
  if (Array.isArray(parsed)) return parsed.every((c) => isMatchAllCriteria(c));
  // A scalar (`true`, a number, …) is not a predicate the engine narrows on.
  if (typeof parsed !== 'object') return true;

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return true;
  for (const [key, value] of entries) {
    if (key === '$and') {
      // AND of nothing / of vacuous branches ⇒ still everything.
      if (!Array.isArray(value) || value.every((c) => isMatchAllCriteria(c))) continue;
      return false;
    }
    if (key === '$or') {
      // OR is match-all as soon as ONE branch is; an empty OR has no
      // portable meaning, so treat it as unconstrained too.
      if (!Array.isArray(value) || value.length === 0 || value.some((c) => isMatchAllCriteria(c))) continue;
      return false;
    }
    // A named field predicate — this narrows the result set.
    return false;
  }
  return true;
}

/**
 * The authoring rejection message. Names the offending shape rather than just
 * "required": the reported trigger (#3896) was a typo — `criterias` instead of
 * `criteria` — which a bare "field missing" would not explain.
 */
export const MATCH_ALL_CRITERIA_MESSAGE =
  'criteria is required and must narrow the records it shares — missing, empty, ' +
  'or unparsable criteria would share every record of the object, which a sharing ' +
  'rule must never do (ADR-0049). Check for a misspelled key (e.g. `criterias`).';

/**
 * Field-level rejection for the data-API path.
 *
 * Structurally what `@objectstack/objectql`'s `ValidationError` is — REST maps
 * on `code === 'VALIDATION_FAILED' || name === 'ValidationError'` and forwards
 * `fields[]` — but declared locally so a security guard in a plugin never
 * depends on another package's build output at runtime.
 */
export class SharingCriteriaValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly fields: Array<{ field: string; code: string; message: string }>;
  constructor(field = 'criteria_json', message = MATCH_ALL_CRITERIA_MESSAGE) {
    super(message);
    this.name = 'ValidationError';
    this.fields = [{ field, code: 'required', message }];
  }
}
