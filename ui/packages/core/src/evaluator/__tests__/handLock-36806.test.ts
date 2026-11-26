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

  // REWORK S2: no server judges the hand lock (ADR-0137 D2), so a fault
  // LOCKS the field — unlike `readonlyWhen`, whose fault the server answers.
  it('a uiReadonlyWhen that cannot be evaluated LOCKS the field (fail-closed)', () => {
    expect(fieldReadOnlyByHand({ uiReadonlyWhen: 'record.(' }, { status: 'x' })).toBe(true);
    // The control: a faulted readonlyWhen stays open on the client.
    expect(fieldReadOnlyByHand({ readonlyWhen: 'record.(' }, { status: 'x' })).toBe(false);
  });

  // REWORK S1: a projected row that lacks the operand cannot be judged.
  it('a row missing the predicate\'s operand is locked, and judged once the operand is read', () => {
    const def = { uiReadonlyWhen: "record.status != 'draft'" };
    expect(fieldReadOnlyByHand(def, { name: 'projected row' })).toBe(true);
    expect(fieldReadOnlyByHand(def, { name: 'full row', status: 'draft' })).toBe(false);
  });

  // REWORK S1: the host scope binds `current_user` on every surface.
  it('judges a current_user predicate over the host scope it is given', () => {
    const def = { uiReadonlyWhen: "current_user.id != record.owner" };
    const scope = { current_user: { id: 'u1' } };
    expect(fieldReadOnlyByHand(def, { owner: 'u1' }, { scope })).toBe(false);
    expect(fieldReadOnlyByHand(def, { owner: 'u2' }, { scope })).toBe(true);
    // No scope: the root is unbound, the predicate faults, the field locks.
    expect(fieldReadOnlyByHand(def, { owner: 'u1' })).toBe(true);
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

  it('a faulted uiReadonlyWhen locks and is reported under its own key', () => {
    const state = resolveFieldRuleState({ uiReadonlyWhen: 'record.(' }, { status: 'x' }, {});
    expect(state.readonly).toBe(true);
    expect(state.faults?.uiReadonlyWhen).toBeTruthy();
  });
});
