/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * **The detail page's system-field partition is derived, not restated**
 * (objectui#3017). `HIDDEN_SYSTEM_FIELD_NAMES` used to hard-code four
 * bookkeeping columns under a comment; it is now the spec's
 * `FIELD_GROUP_SYSTEM_FIELDS` minus the audit set, so a system column the
 * framework starts injecting tomorrow defaults to hidden instead of leaking
 * into the auto-generated body sections until someone edits a hand list.
 *
 * What is worth asserting is that the partition stays a partition, and that
 * the columns each side exists for are still on that side.
 */

import { describe, it, expect } from 'vitest';
import { FIELD_GROUP_SYSTEM_FIELDS } from '@objectstack/spec/data';
import { AUDIT_FIELD_NAMES, HIDDEN_SYSTEM_FIELD_NAMES } from './record-detail-system-fields';

describe('record-detail system-field partition (objectui#3017)', () => {
  it('audit ∪ hidden covers the spec vocabulary exactly — nothing leaks into the body', () => {
    const union = [...AUDIT_FIELD_NAMES, ...HIDDEN_SYSTEM_FIELD_NAMES].sort();
    expect(union).toEqual([...FIELD_GROUP_SYSTEM_FIELDS].sort());
  });

  it('audit and hidden are disjoint — a column gets one treatment, not two', () => {
    for (const name of AUDIT_FIELD_NAMES) {
      expect(HIDDEN_SYSTEM_FIELD_NAMES.has(name), `'${name}' is both footer-rendered and hidden`).toBe(false);
    }
  });

  it('is not vacuous — the bookkeeping columns the hidden set exists for are still hidden', () => {
    // If the spec dropped or renamed one of these, the derivation would
    // silently stop hiding it and the column would surface as a raw field on
    // every detail page. Fail loudly and make that a deliberate decision.
    for (const name of ['organization_id', 'tenant_id', 'is_deleted', 'deleted_at']) {
      expect(HIDDEN_SYSTEM_FIELD_NAMES.has(name), `'${name}' no longer derived as hidden — spec vocabulary moved?`).toBe(true);
    }
  });

  it('provenance stays in the footer, never silently swallowed by the hidden set', () => {
    for (const name of ['created_at', 'created_by', 'updated_at', 'updated_by']) {
      expect(AUDIT_FIELD_NAMES.has(name)).toBe(true);
    }
  });
});
