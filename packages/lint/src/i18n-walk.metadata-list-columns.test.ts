// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36860 — `walkMetadataForms` emits the form field slot
 * `metadataForms.<type>.fields.<path>.label` for every Studio list column
 * (`METADATA_LIST_REGISTRY`), so the server can translate each header.
 *
 *  - a column whose path the type's form does not label (a type with no form,
 *    or a path the form leaves out) gets its own entry, seeded with the
 *    column's header;
 *  - a column the form already labels keeps the form's entry, so the slot
 *    holds one English source;
 *  - every column of every type has an entry, so no header reaches a reader
 *    untranslatable.
 */
import { describe, it, expect } from 'vitest';
import { METADATA_LIST_REGISTRY } from '@objectstack/spec/system';
import { collectExpectedEntries } from './i18n-walk.js';

const entries = collectExpectedEntries({}, { warnedGroups: new Set() });
const slot = (type: string, path: string) =>
  entries.filter((e) => e.path.join('\u0000') === ['metadataForms', type, 'fields', path, 'label'].join('\u0000'));

describe('list column headers are walked into the form field slot (objectstack#36860)', () => {
  it('a column on a type with no form gets its own entry, seeded with the header', () => {
    const [entry] = slot('job', 'schedule');
    expect(entry).toBeDefined();
    expect(entry.sourceValue).toBe('Schedule');
  });

  it('a dotted column path the form does not label gets its own entry', () => {
    const [entry] = slot('agent', 'model.model');
    expect(entry).toBeDefined();
    expect(entry.sourceValue).toBe('Model');
  });

  it('a column the form already labels keeps one entry, the form field\'s', () => {
    const found = slot('hook', 'events');
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe('metadataFormField');
  });

  it('every column of every declared list has an entry at its slot', () => {
    const missing: string[] = [];
    for (const [type, list] of Object.entries(METADATA_LIST_REGISTRY)) {
      for (const column of list.columns) {
        if (slot(type, column.field).length !== 1) missing.push(`${type}.${column.field}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
