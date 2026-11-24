// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { FieldType } from './field.zod';
import { FIELD_HISTORY_DEFAULT_OFF_TYPES, resolveFieldHistory } from './field-history-default';

describe('FIELD_HISTORY_DEFAULT_OFF_TYPES (#36482)', () => {
  it('names only declared field types', () => {
    for (const t of FIELD_HISTORY_DEFAULT_OFF_TYPES) expect(FieldType.options).toContain(t);
  });

  it('is frozen, so no consumer widens it at runtime', () => {
    expect(Object.isFrozen(FIELD_HISTORY_DEFAULT_OFF_TYPES)).toBe(true);
  });
});

describe('resolveFieldHistory — the default an unset fieldHistory resolves to (#36482)', () => {
  it('shows a one-line type by default', () => {
    expect(resolveFieldHistory({ type: 'text' }, undefined)).toBe(true);
    expect(resolveFieldHistory({ type: 'number' }, {})).toBe(true);
  });

  it('keeps every no-line type off by default', () => {
    for (const type of FIELD_HISTORY_DEFAULT_OFF_TYPES) {
      expect(resolveFieldHistory({ type }, undefined), type).toBe(false);
    }
  });

  it('keeps a credential field off by default, and with fieldHistory: true', () => {
    expect(resolveFieldHistory({ type: 'secret' }, undefined)).toBe(false);
    expect(resolveFieldHistory({ type: 'password' }, undefined)).toBe(false);
    expect(resolveFieldHistory({ type: 'secret', fieldHistory: true }, undefined)).toBe(false);
  });

  it('follows the read mask exemption: a better-auth password is not a masked credential', () => {
    expect(resolveFieldHistory({ type: 'password' }, { managedBy: 'better-auth' })).toBe(true);
  });

  it('turns a no-line type on with fieldHistory: true or trackHistory: true', () => {
    expect(resolveFieldHistory({ type: 'json', fieldHistory: true }, undefined)).toBe(true);
    expect(resolveFieldHistory({ type: 'image', trackHistory: true }, undefined)).toBe(true);
  });

  it('turns a field off with its own fieldHistory: false, whatever trackHistory says', () => {
    expect(resolveFieldHistory({ type: 'text', fieldHistory: false }, undefined)).toBe(false);
    expect(resolveFieldHistory({ type: 'json', fieldHistory: false, trackHistory: true }, undefined)).toBe(false);
  });

  it("lets the object's enable.fieldHistory: false win over the field", () => {
    expect(resolveFieldHistory({ type: 'text', fieldHistory: true }, { enable: { fieldHistory: false } })).toBe(false);
  });

  it('reads only literal booleans from stored metadata', () => {
    expect(resolveFieldHistory({ type: 'text', fieldHistory: 'false' }, undefined)).toBe(true);
    expect(resolveFieldHistory({ type: 'json', fieldHistory: 'true' }, undefined)).toBe(false);
    expect(resolveFieldHistory({ type: 'text' }, { enable: null })).toBe(true);
  });

  it('answers false for no field at all', () => {
    expect(resolveFieldHistory(undefined, undefined)).toBe(false);
  });

  it('shows a field whose type is not picked yet: no type is no-line or a credential', () => {
    expect(resolveFieldHistory({}, undefined)).toBe(true);
  });
});
