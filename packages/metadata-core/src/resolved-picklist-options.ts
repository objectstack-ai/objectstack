// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26886] The mark on an `options` array the runtime RESOLVED from a shared
 * picklist, as opposed to one an author wrote on the field.
 *
 * A field authors `picklist: '<name>'` and no `options`; every object read
 * serves it with the list's options written beside `picklist` (the registry's
 * picklist resolution in `@objectstack/objectql`). The load-time diagnostics in
 * `@objectstack/metadata-protocol` judge what the author wrote, so the field
 * schema's rule refusing `picklist` and `options` together must not read the
 * copy the runtime wrote. The resolution marks the array it derived and the
 * diagnostics leave only a marked array out.
 *
 * Here because both sides need the one spelling: the diagnostics live in
 * `@objectstack/metadata-protocol`, which `@objectstack/objectql` depends on,
 * and the resolution sits in the lean `@objectstack/objectql/core` closure,
 * which must not import `@objectstack/metadata-protocol` (ADR-0076 D2). Both
 * already declare this package.
 *
 * The mark is a non-enumerable property, so no response, stored row or JSON
 * key ever carries it, and it is keyed with `Symbol.for` so every loaded copy
 * of a package reads the one mark. A copy of the array (`.map`, a spread, a
 * JSON round trip) does not carry it: whoever reads the copy sees authored
 * options, so the failure direction is a reported diagnostic, never a missed one.
 */

const RESOLVED_PICKLIST_OPTIONS = Symbol.for('@objectstack/metadata-core:resolved-picklist-options');

/**
 * Mark an `options` array as resolved from a shared picklist rather than
 * authored on the field. Returns the same array.
 */
export function markResolvedPicklistOptions<T extends object>(options: T): T {
  if (!Object.prototype.hasOwnProperty.call(options, RESOLVED_PICKLIST_OPTIONS)) {
    Object.defineProperty(options, RESOLVED_PICKLIST_OPTIONS, { value: true });
  }
  return options;
}

/** `true` when `options` is an array {@link markResolvedPicklistOptions} marked. */
export function isResolvedPicklistOptions(options: unknown): boolean {
  return Array.isArray(options)
    && (options as unknown as Record<symbol, unknown>)[RESOLVED_PICKLIST_OPTIONS] === true;
}
