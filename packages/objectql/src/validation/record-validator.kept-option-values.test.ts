// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateRecord, ValidationError, type ValidateRecordOptions } from './record-validator.js';

/**
 * #22183 — the option arms admit the values a write names in
 * `keptOptionValues` (the cells an import kept under `createMissingOptions`),
 * and nothing else.
 *
 * The engine passes the write's `ExecutionContext.keptOptionValues` here; the
 * end-to-end half (the import runner through the real engine, and what a later
 * edit of the row does) is `../import-kept-option-values.test.ts`.
 */
const schema = {
  fields: {
    priority: { name: 'priority', label: 'Priority', type: 'select', options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
    tags: { name: 'tags', label: 'Tags', type: 'multiselect', options: [{ value: 'important', label: 'Important' }, { value: 'review', label: 'Review' }] },
    stage: { name: 'stage', label: 'Stage', type: 'select', picklist: 'deal_stages', options: [] },
  },
};

/** The refusal's envelope and its field findings, or `null` when the call accepted. */
function verdict(data: Record<string, unknown>, mode: 'insert' | 'update', options: ValidateRecordOptions = {}) {
  try {
    validateRecord(schema, data, mode, options);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    const err = e as ValidationError;
    return { code: err.code, fields: err.fields.map((f) => ({ field: f.field, code: f.code })) };
  }
}

describe('validateRecord — keptOptionValues (#22183)', () => {
  for (const mode of ['insert', 'update'] as const) {
    it(`${mode}: a single-value select admits the kept value and still refuses any other value outside the options`, () => {
      const kept = { keptOptionValues: { priority: ['Bogus'] } };
      expect(verdict({ priority: 'Bogus' }, mode, kept)).toBeNull();
      expect(verdict({ priority: 'high' }, mode, kept)).toBeNull();
      expect(verdict({ priority: 'Other' }, mode, kept)).toEqual({
        code: 'VALIDATION_FAILED', fields: [{ field: 'priority', code: 'invalid_option' }],
      });
      // Control: without the admission the same value is refused, as before.
      expect(verdict({ priority: 'Bogus' }, mode)).toEqual({
        code: 'VALIDATION_FAILED', fields: [{ field: 'priority', code: 'invalid_option' }],
      });
    });

    it(`${mode}: a multi-value field admits each kept item and refuses an item that was not kept`, () => {
      const kept = { keptOptionValues: { tags: ['Other'] } };
      expect(verdict({ tags: ['important', 'Other'] }, mode, kept)).toBeNull();
      expect(verdict({ tags: ['Other', 'Stray'] }, mode, kept)).toEqual({
        code: 'VALIDATION_FAILED', fields: [{ field: 'tags', code: 'invalid_option' }],
      });
      expect(verdict({ tags: ['important', 'Other'] }, mode)).toEqual({
        code: 'VALIDATION_FAILED', fields: [{ field: 'tags', code: 'invalid_option' }],
      });
    });
  }

  it('an admission is per field: a value kept for one field does not pass on another', () => {
    expect(verdict({ priority: 'Other', tags: ['Bogus'] }, 'insert', { keptOptionValues: { priority: ['Bogus'], tags: ['Other'] } })).toEqual({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'priority', code: 'invalid_option' }, { field: 'tags', code: 'invalid_option' }],
    });
  });

  it('a picklist that did not resolve stays refused, whatever the write admits', () => {
    expect(verdict({ stage: 'won' }, 'update', { keptOptionValues: { stage: ['won'] } })).toEqual({
      code: 'VALIDATION_FAILED', fields: [{ field: 'stage', code: 'invalid_option' }],
    });
  });
});
