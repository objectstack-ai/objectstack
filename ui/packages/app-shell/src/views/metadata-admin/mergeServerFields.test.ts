// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * mergeServerFields — the curated-form half of the cross-repo spec-skew
 * root-cure. Grafts server-only top-level fields onto the bundled-spec form
 * so new server fields (e.g. a report's dataset/rows/values) are directly
 * editable even when the bundled @objectstack/spec lags the running server.
 */

import { describe, it, expect } from 'vitest';
import { mergeServerFields } from './mergeServerFields';

const bundledSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    objectName: { type: 'string' },
    columns: { type: 'array' },
    type: { type: 'string' },
  },
} as Record<string, any>;

const bundledForm = {
  type: 'simple' as const,
  sections: [{ label: 'Basics', fields: [{ field: 'label' }, { field: 'type' }] }],
};

// Newer server: adds dataset/rows/values/runtimeFilter on top of the bundle.
const serverSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    objectName: { type: 'string' },
    columns: { type: 'array' },
    type: { type: 'string' },
    dataset: { type: 'string' },
    rows: { type: 'array', items: { type: 'string' } },
    values: { type: 'array', items: { type: 'string' } },
    runtimeFilter: { type: 'object' },
  },
} as Record<string, any>;

const CURATED = new Set(['type', 'objectName', 'label', 'name', 'columns']);

describe('mergeServerFields', () => {
  it('grafts server-only fields into BOTH schema.properties and a trailing form section', () => {
    const { schema, form } = mergeServerFields({
      bundledSchema,
      bundledForm,
      serverSchema,
      excludeFields: CURATED,
      sectionTitle: 'More fields',
    });

    // schema gains the new props…
    expect(schema!.properties).toHaveProperty('dataset');
    expect(schema!.properties).toHaveProperty('rows');
    expect(schema!.properties).toHaveProperty('values');
    expect(schema!.properties).toHaveProperty('runtimeFilter');

    // …and a trailing section declares exactly those new fields so SchemaForm
    // (which renders only declared fields when a form is present) shows them.
    const sections = form!.sections!;
    expect(sections).toHaveLength(2);
    const added = sections[1];
    expect(added.label).toBe('More fields');
    // `fields` is optional on `FormSectionSpec` since objectui#8725. The merge
    // always appends an enumerated section, so `!` throws if it ever stops doing
    // so; `?? []` would instead make every `not.toContain` leg below vacuous.
    const fieldNames = added.fields!.map((f) => (typeof f === 'string' ? f : f.field));
    expect(fieldNames).toEqual(['dataset', 'rows', 'values', 'runtimeFilter']);
  });

  it('does not graft curated-owned fields even if the server still has them', () => {
    const { schema, form } = mergeServerFields({
      bundledSchema,
      bundledForm,
      serverSchema,
      excludeFields: CURATED,
      sectionTitle: 'More fields',
    });
    const added = form!.sections![1];
    const fieldNames = added.fields!.map((f) => (typeof f === 'string' ? f : f.field));
    expect(fieldNames).not.toContain('objectName');
    expect(fieldNames).not.toContain('columns');
    // bundled props/sections are untouched (additive only)
    expect(form!.sections![0]).toEqual(bundledForm.sections[0]);
    expect(schema!.properties.label).toEqual(bundledSchema.properties.label);
  });

  it('is a no-op when the server schema has no extra fields', () => {
    const { schema, form } = mergeServerFields({
      bundledSchema,
      bundledForm,
      serverSchema: bundledSchema, // identical shape — nothing new
      excludeFields: CURATED,
      sectionTitle: 'More fields',
    });
    expect(schema).toBe(bundledSchema);
    expect(form).toBe(bundledForm);
  });

  it('is a no-op when no server schema is provided (offline / older server)', () => {
    const { schema, form } = mergeServerFields({
      bundledSchema,
      bundledForm,
      serverSchema: undefined,
      excludeFields: CURATED,
      sectionTitle: 'More fields',
    });
    expect(schema).toBe(bundledSchema);
    expect(form).toBe(bundledForm);
  });

  it('does not re-add a field once the bundle catches up', () => {
    // Bundle now ALSO has dataset → it must not be grafted again.
    const caughtUp = {
      ...bundledSchema,
      properties: { ...bundledSchema.properties, dataset: { type: 'string' } },
    };
    const { schema, form } = mergeServerFields({
      bundledSchema: caughtUp,
      bundledForm,
      serverSchema,
      excludeFields: CURATED,
      sectionTitle: 'More fields',
    });
    const added = form!.sections![1];
    const fieldNames = added.fields!.map((f) => (typeof f === 'string' ? f : f.field));
    expect(fieldNames).not.toContain('dataset');
    expect(fieldNames).toEqual(['rows', 'values', 'runtimeFilter']);
    expect(schema!.properties.dataset).toEqual(caughtUp.properties.dataset);
  });

  it('grafts schema props but synthesises no form when the bundle ships none (flat render)', () => {
    const { schema, form } = mergeServerFields({
      bundledSchema,
      bundledForm: undefined,
      serverSchema,
      excludeFields: CURATED,
      sectionTitle: 'More fields',
    });
    // Flat SchemaForm renders every property, so the schema graft alone surfaces them.
    expect(schema!.properties).toHaveProperty('dataset');
    expect(form).toBeUndefined();
  });

  it('skips fields the bundled form already declares (no duplicate render)', () => {
    const formWithDataset = {
      type: 'simple' as const,
      sections: [{ label: 'Basics', fields: [{ field: 'label' }, { field: 'dataset' }] }],
    };
    const { form } = mergeServerFields({
      bundledSchema,
      bundledForm: formWithDataset,
      serverSchema,
      excludeFields: CURATED,
      sectionTitle: 'More fields',
    });
    const added = form!.sections![1];
    const fieldNames = added.fields!.map((f) => (typeof f === 'string' ? f : f.field));
    expect(fieldNames).not.toContain('dataset');
  });
});
