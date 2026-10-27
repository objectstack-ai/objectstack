// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26723] The actions a metadata save stores, as their `ActionSchema` parse.
 *
 * The save door judges a body by its type's spec schema and then keeps the
 * request body as written, with a few normalizations grafted back
 * (`graftFoldedFormSections`, `graftNormalizedOperators`). For an action that
 * dropped the one transform a reader depends on: `ActionSchema` lowers
 * `requiresMembershipReach` and `requiresFeature` into `visible`, the console
 * reads `visible` alone, and the stored body carried the two gate keys raw with
 * no `visible`. The declared gate did nothing: the button was offered to every
 * caller.
 *
 * So an action is stored as the parse the door already ran, the same parse the
 * code-package registration door stores since #25981 (`parsePackageAction` in
 * `@objectstack/objectql`'s registry). ⛔ No second copy of the lowering: the
 * values here are the parse's own output, read off the `parsed` tree, never
 * re-derived. The parse is idempotent over its own output, so a GET → PUT
 * round trip of a stored body stores the same bytes.
 *
 * - `object`: its own `actions` array is replaced by the parsed array
 *   (`ObjectSchema`'s `actions` is `ActionSchema[]`); every other key of the
 *   body stays as written.
 * - `action`: the body is the parsed action.
 * - Any other type, or an object with no `actions` array, is returned as is.
 */
export function withParsedStoredActions(singularType: string, authored: unknown, parsed: unknown): unknown {
    if (singularType === 'action') return parsed;
    if (singularType !== 'object') return authored;
    if (!authored || typeof authored !== 'object' || Array.isArray(authored)) return authored;
    const actions = (parsed as { actions?: unknown } | null | undefined)?.actions;
    if (!Array.isArray((authored as { actions?: unknown }).actions) || !Array.isArray(actions)) return authored;
    return { ...(authored as Record<string, unknown>), actions };
}
