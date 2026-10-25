/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `declaredNameField` — exported by objectui#9436 with NO semantic change.
 *
 * It was already the one spelling of the ADR-0079 declared pointer inside
 * `record-title.ts`, read by `getRecordDisplayName` (steps 1+2) and by
 * `resolveNameField`. Exporting it lets the record-page H1 readers
 * (`PageHeaderRenderer`, `DetailView.resolveDisplayTitle` and `record:details`'
 * H1 dedupe) rank the declared pointer ABOVE `titleFormat` and the type-aware
 * derivation BELOW it, without re-typing the `??` chain.
 *
 * What this pins is the contract those callers rely on:
 *   - the canonical `nameField` first, then the deprecated `displayNameField`
 *     / `NAME_FIELD_KEY` aliases, in that order;
 *   - it NEVER derives. That is the whole difference from `resolveNameField`,
 *     and the reason a caller can place the derivation on a lower rung;
 *   - read through `recordDisplayValueAt`, it is exactly the value
 *     `getRecordDisplayName` returns at steps 1+2, even when the object also
 *     carries a `titleFormat`.
 */

import { describe, it, expect } from 'vitest';
import {
  declaredNameField,
  getRecordDisplayName,
  recordDisplayValueAt,
  resolveNameField,
} from '../record-title';

describe('declaredNameField — the exported ADR-0079 declared pointer (#9436)', () => {
  it('answers the canonical `nameField`', () => {
    expect(declaredNameField({ nameField: 'contract_no' })).toBe('contract_no');
  });

  it('prefers `nameField` over the deprecated aliases', () => {
    expect(
      declaredNameField({ nameField: 'contract_no', displayNameField: 'name', NAME_FIELD_KEY: 'title' }),
    ).toBe('contract_no');
  });

  it('falls back to `displayNameField`, then `NAME_FIELD_KEY`', () => {
    expect(declaredNameField({ displayNameField: 'activity_name' })).toBe('activity_name');
    expect(declaredNameField({ NAME_FIELD_KEY: 'subject' })).toBe('subject');
  });

  it('never derives: an object that declares nothing answers undefined', () => {
    const objectDef = { fields: { name: { type: 'text' }, amount: { type: 'number' } } };
    expect(declaredNameField(objectDef)).toBeUndefined();
    // CONTROL: the derivation WOULD have answered, so the undefined above is
    // the absence of a declaration, not of a title-eligible field.
    expect(resolveNameField(objectDef)).toBe('name');
  });

  it('tolerates a missing object definition', () => {
    expect(declaredNameField(undefined)).toBeUndefined();
    expect(declaredNameField(null)).toBeUndefined();
  });

  it('valued through `recordDisplayValueAt`, it is exactly what the resolver answers at steps 1+2', () => {
    const objectDef = {
      nameField: 'contract_no',
      titleFormat: '{contract_no} - {name}',
      fields: { contract_no: { type: 'text' }, name: { type: 'text' } },
    };
    const record = { id: 'C1', contract_no: 'HT-2026-001', name: 'Acme Corporation' };
    const declared = recordDisplayValueAt(record, declaredNameField(objectDef));
    expect(declared).toBe('HT-2026-001');
    expect(getRecordDisplayName(objectDef, record)).toBe(declared);
  });
});
