// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the export-const → JSON Schema name mapping (#4592).
 *
 * The original inline `key.replace('Schema', '')` used a STRING pattern, and
 * `String.prototype.replace(string, …)` replaces only the FIRST occurrence —
 * so any const with `Schema` in prefix/middle position lost that inner
 * segment instead of its suffix. Four schemas published under names that
 * exist nowhere in the export surface (`data/ModeSchema` for
 * `SchemaModeSchema`, …), which poisoned all three public projections of the
 * name: the `$id` URL, the json-schema.manifest.json ratchet key, and the
 * docs section + import example (the docs then dropped the import entirely
 * because the mangled name resolved to no real export — #4570).
 *
 * MEASURED: reverting `schemaNameFromExportKey` to the string-pattern replace
 * fails the four prefix/middle cases below; the suffix-only cases keep
 * passing, which is exactly why the bug survived — every name without a
 * second `Schema` mapped correctly.
 */

import { describe, expect, it } from 'vitest';

import { schemaNameFromExportKey } from './lib/schema-name';

describe('schemaNameFromExportKey', () => {
  it('strips only the trailing Schema suffix on prefix-Schema names (the #4592 quartet)', () => {
    expect(schemaNameFromExportKey('SchemaModeSchema')).toBe('SchemaMode');
    expect(schemaNameFromExportKey('SchemaChangeSchema')).toBe('SchemaChange');
    expect(schemaNameFromExportKey('SchemaLevelIsolationStrategySchema')).toBe(
      'SchemaLevelIsolationStrategy',
    );
    expect(schemaNameFromExportKey('DocumentSchemaValidationSchema')).toBe(
      'DocumentSchemaValidation',
    );
  });

  it('strips a plain trailing suffix', () => {
    expect(schemaNameFromExportKey('FieldSchema')).toBe('Field');
    expect(schemaNameFromExportKey('DatasourceSchema')).toBe('Datasource');
  });

  it('leaves non-Schema-suffixed names untouched', () => {
    expect(schemaNameFromExportKey('DriverType')).toBe('DriverType');
    expect(schemaNameFromExportKey('SchemaMode')).toBe('SchemaMode');
  });

  it('strips exactly one suffix occurrence', () => {
    // `XSchemaSchema` names the schema OF `XSchema` — only the outer suffix goes.
    expect(schemaNameFromExportKey('JsonSchemaSchema')).toBe('JsonSchema');
  });
});
