// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Published JSON Schema name for an exported schema const.
 *
 * The convention is `<Name>Schema` (const) → `<Name>` (schema/doc/type name),
 * and the strip must be anchored to the END of the identifier: a string-pattern
 * `String.prototype.replace('Schema', '')` removes the FIRST occurrence, which
 * mangles every name that also contains `Schema` in prefix/middle position —
 * `SchemaModeSchema` became `ModeSchema` instead of `SchemaMode`, publishing a
 * `$id`, a manifest key and a docs section under a type name that does not
 * exist (#4592).
 *
 * Single source of truth for `build-schemas.ts` (the `$id` / manifest /
 * authorable-surface key) and `build-docs.ts` (the docs section + import
 * example), so the two generators cannot drift apart again. The inverse
 * lookup (`lib/docs-import-surface.ts`) appends the suffix and is already
 * anchored by construction.
 */
export function schemaNameFromExportKey(key: string): string {
  return key.replace(/Schema$/, '');
}
