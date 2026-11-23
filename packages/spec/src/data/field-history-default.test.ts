// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { FieldType } from './field.zod';
import { NO_LINE_VALUE_FIELD_TYPES, fieldChangeValuesShown } from './field-history-default';

describe('NO_LINE_VALUE_FIELD_TYPES (#36482)', () => {
  it('names only declared field types', () => {
    for (const t of NO_LINE_VALUE_FIELD_TYPES) expect(FieldType.options).toContain(t);
  });

  it('is frozen, so no consumer widens it at runtime', () => {
    expect(Object.isFrozen(NO_LINE_VALUE_FIELD_TYPES)).toBe(true);
  });
});

describe('fieldChangeValuesShown — the default an unset fieldHistory resolves to (#36482)', () => {
  it('shows a one-line type by default', () => {
    expect(fieldChangeValuesShown({ type: 'text' }, undefined)).toBe(true);
    expect(fieldChangeValuesShown({ type: 'number' }, {})).toBe(true);
  });

  it('keeps every no-line type off by default', () => {
    for (const type of NO_LINE_VALUE_FIELD_TYPES) {
      expect(fieldChangeValuesShown({ type }, undefined), type).toBe(false);
    }
  });

  it('keeps a credential field off by default, and with fieldHistory: true', () => {
    expect(fieldChangeValuesShown({ type: 'secret' }, undefined)).toBe(false);
    expect(fieldChangeValuesShown({ type: 'password' }, undefined)).toBe(false);
    expect(fieldChangeValuesShown({ type: 'secret', fieldHistory: true }, undefined)).toBe(false);
  });

  it('follows the read mask exemption: a better-auth password is not a masked credential', () => {
    expect(fieldChangeValuesShown({ type: 'password' }, { managedBy: 'better-auth' })).toBe(true);
  });

  it('turns a no-line type on with fieldHistory: true or trackHistory: true', () => {
    expect(fieldChangeValuesShown({ type: 'json', fieldHistory: true }, undefined)).toBe(true);
    expect(fieldChangeValuesShown({ type: 'image', trackHistory: true }, undefined)).toBe(true);
  });

  it('turns a field off with its own fieldHistory: false, whatever trackHistory says', () => {
    expect(fieldChangeValuesShown({ type: 'text', fieldHistory: false }, undefined)).toBe(false);
    expect(fieldChangeValuesShown({ type: 'json', fieldHistory: false, trackHistory: true }, undefined)).toBe(false);
  });

  it("lets the object's enable.fieldHistory: false win over the field", () => {
    expect(fieldChangeValuesShown({ type: 'text', fieldHistory: true }, { enable: { fieldHistory: false } })).toBe(false);
  });

  it('reads only literal booleans from stored metadata', () => {
    expect(fieldChangeValuesShown({ type: 'text', fieldHistory: 'false' }, undefined)).toBe(true);
    expect(fieldChangeValuesShown({ type: 'json', fieldHistory: 'true' }, undefined)).toBe(false);
    expect(fieldChangeValuesShown({ type: 'text' }, { enable: null })).toBe(true);
  });

  it('answers false for no field at all', () => {
    expect(fieldChangeValuesShown(undefined, undefined)).toBe(false);
  });

  it('shows a field whose type is not picked yet: no type is no-line or a credential', () => {
    expect(fieldChangeValuesShown({}, undefined)).toBe(true);
  });
});
