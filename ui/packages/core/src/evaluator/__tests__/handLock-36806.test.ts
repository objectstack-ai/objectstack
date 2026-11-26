/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #36806 — the one hand-lock verdict folds all four field-lock keys
 * (`readonly`, `readonlyWhen`, `uiReadonly`, `uiReadonlyWhen`), and the form's
 * shared verdict (`resolveFieldRuleState`) folds the hand lock the same way.
 */
import { describe, it, expect } from 'vitest';
import {
  fieldReadOnlyByHand,
  fieldStaticallyReadOnlyByHand,
  resolveFieldRuleState,
} from '../../index';

describe('fieldReadOnlyByHand (#36806)', () => {
  it('the static half: readonly or uiReadonly', () => {
    expect(fieldStaticallyReadOnlyByHand({ uiReadonly: true })).toBe(true);
    expect(fieldStaticallyReadOnlyByHand({ readonly: true })).toBe(true);
    expect(fieldStaticallyReadOnlyByHand({})).toBe(false);
    expect(fieldStaticallyReadOnlyByHand(undefined)).toBe(false);
    // Only a literal `true` locks — no truthy coercion.
    expect(fieldStaticallyReadOnlyByHand({ uiReadonly: 'yes' })).toBe(false);
  });

  it('the full verdict judges uiReadonlyWhen and readonlyWhen over the record', () => {
    const def = { uiReadonlyWhen: "record.status != 'draft'" };
    expect(fieldReadOnlyByHand(def, { status: 'approved' })).toBe(true);
    expect(fieldReadOnlyByHand(def, { status: 'draft' })).toBe(false);
    const server = { readonlyWhen: "record.status == 'paid'" };
    expect(fieldReadOnlyByHand(server, { status: 'paid' })).toBe(true);
    expect(fieldReadOnlyByHand(server, { status: 'draft' })).toBe(false);
    expect(fieldReadOnlyByHand({ uiReadonly: true }, { status: 'draft' })).toBe(true);
    expect(fieldReadOnlyByHand({}, { status: 'draft' })).toBe(false);
  });

  it('a predicate that cannot be evaluated leaves the field editable (fail-open)', () => {
    expect(fieldReadOnlyByHand({ uiReadonlyWhen: 'record.(' }, { status: 'x' })).toBe(false);
  });
});

describe('resolveFieldRuleState folds the hand lock (#36806)', () => {
  it('statics.uiReadonly locks', () => {
    expect(resolveFieldRuleState({}, {}, { uiReadonly: true }).readonly).toBe(true);
    expect(resolveFieldRuleState({}, {}, {}).readonly).toBe(false);
  });

  it('uiReadonlyWhen TRUE locks, FALSE does not', () => {
    const rules = { uiReadonlyWhen: "record.status != 'draft'" };
    expect(resolveFieldRuleState(rules, { status: 'approved' }, {}).readonly).toBe(true);
    expect(resolveFieldRuleState(rules, { status: 'draft' }, {}).readonly).toBe(false);
  });
});
