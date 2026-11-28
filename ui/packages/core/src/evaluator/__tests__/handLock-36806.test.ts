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
  effectiveUiReadonlyWhen,
  fieldHasConditionalHandLock,
  fieldLockPredicates,
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
    expect(fieldReadOnlyByHand(def, { status: 'approved' }, { object: null })).toBe(true);
    expect(fieldReadOnlyByHand(def, { status: 'draft' }, { object: null })).toBe(false);
    const server = { readonlyWhen: "record.status == 'paid'" };
    expect(fieldReadOnlyByHand(server, { status: 'paid' }, { object: null })).toBe(true);
    expect(fieldReadOnlyByHand(server, { status: 'draft' }, { object: null })).toBe(false);
    expect(fieldReadOnlyByHand({ uiReadonly: true }, { status: 'draft' }, { object: null })).toBe(true);
    expect(fieldReadOnlyByHand({}, { status: 'draft' }, { object: null })).toBe(false);
  });

  // REWORK S2: no server judges the hand lock (ADR-0137 D2), so a fault
  // LOCKS the field — unlike `readonlyWhen`, whose fault the server answers.
  it('a uiReadonlyWhen that cannot be evaluated LOCKS the field (fail-closed)', () => {
    expect(fieldReadOnlyByHand({ uiReadonlyWhen: 'record.(' }, { status: 'x' }, { object: null })).toBe(true);
    // The control: a faulted readonlyWhen stays open on the client.
    expect(fieldReadOnlyByHand({ readonlyWhen: 'record.(' }, { status: 'x' }, { object: null })).toBe(false);
  });

  // REWORK S1: a projected row that lacks the operand cannot be judged.
  it('a row missing the predicate\'s operand is locked, and judged once the operand is read', () => {
    const def = { uiReadonlyWhen: "record.status != 'draft'" };
    expect(fieldReadOnlyByHand(def, { name: 'projected row' }, { object: null })).toBe(true);
    expect(fieldReadOnlyByHand(def, { name: 'full row', status: 'draft' }, { object: null })).toBe(false);
  });

  // REWORK S1: the host scope binds `current_user` on every surface.
  it('judges a current_user predicate over the host scope it is given', () => {
    const def = { uiReadonlyWhen: "current_user.id != record.owner" };
    const scope = { current_user: { id: 'u1' } };
    expect(fieldReadOnlyByHand(def, { owner: 'u1' }, { object: null, scope })).toBe(false);
    expect(fieldReadOnlyByHand(def, { owner: 'u2' }, { object: null, scope })).toBe(true);
    // No scope: the root is unbound, the predicate faults, the field locks.
    expect(fieldReadOnlyByHand(def, { owner: 'u1' }, { object: null })).toBe(true);
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

/**
 * #37402 — the object level of the same model: an object's `uiReadonlyWhen`
 * is the hand lock of every field that declares none of its own, and a field's
 * own `uiReadonly: true` / `uiReadonlyWhen` wins over it in both directions
 * (`uiReadonly: false` is not a declaration of its own).
 */
describe('the object-level hand lock folds into the one verdict (#37402)', () => {
  const ORDER = { uiReadonlyWhen: "record.status in ['confirmed', 'done']" };
  const confirmed = { status: 'confirmed', notes: 'x', amount: 1 };
  const draft = { status: 'draft', notes: 'x', amount: 1 };

  it('locks every field that declares no hand lock of its own while TRUE, and only then', () => {
    expect(fieldReadOnlyByHand({}, confirmed, { object: ORDER })).toBe(true);
    expect(fieldReadOnlyByHand(undefined, confirmed, { object: ORDER })).toBe(true);
    expect(fieldReadOnlyByHand({}, draft, { object: ORDER })).toBe(false);
    // The control: the same field and record, with no object lock, stay open.
    expect(fieldReadOnlyByHand({}, confirmed, { object: null })).toBe(false);
    expect(fieldReadOnlyByHand({}, confirmed, { object: {} })).toBe(false);
  });

  it('a field\'s own `uiReadonlyWhen: false` keeps it editable inside a locked record', () => {
    expect(fieldReadOnlyByHand({ uiReadonlyWhen: 'false' }, confirmed, { object: ORDER })).toBe(false);
    expect(fieldReadOnlyByHand({ uiReadonlyWhen: { dialect: 'cel', source: 'false' } }, confirmed, { object: ORDER })).toBe(false);
  });

  it('a field\'s own hand lock also wins the other way: it locks where the object does not', () => {
    const always = { uiReadonlyWhen: "record.status != ''" };
    expect(fieldReadOnlyByHand(always, draft, { object: ORDER })).toBe(true);
    expect(fieldReadOnlyByHand({ uiReadonly: true }, draft, { object: ORDER })).toBe(true);
  });

  // Maintainer ruling on this card (Q1 = B): `uiReadonly: false` is the key's
  // default — a Studio switch turned on and off stores it — so it is NOT the
  // field's own declaration and the field follows the object lock.
  it('an explicit `uiReadonly: false` is NOT a declaration of its own: the field follows the object lock', () => {
    expect(fieldReadOnlyByHand({ uiReadonly: false }, confirmed, { object: ORDER })).toBe(true);
    expect(fieldReadOnlyByHand({ uiReadonly: false }, draft, { object: ORDER })).toBe(false);
    expect(effectiveUiReadonlyWhen({ uiReadonly: false }, ORDER)).toBe(ORDER.uiReadonlyWhen);
    // CONTROL: the one opt-out spelling still opens the field inside the locked record.
    expect(fieldReadOnlyByHand({ uiReadonly: false, uiReadonlyWhen: 'false' }, confirmed, { object: ORDER })).toBe(false);
    expect(fieldReadOnlyByHand({ uiReadonlyWhen: 'false' }, confirmed, { object: ORDER })).toBe(false);
  });

  it('the server lock is not a hand-lock declaration: it does not cancel the object default', () => {
    const server = { readonlyWhen: "record.status == 'paid'" };
    expect(fieldReadOnlyByHand(server, confirmed, { object: ORDER })).toBe(true);
    expect(fieldReadOnlyByHand(server, { status: 'paid' }, { object: ORDER })).toBe(true);
    expect(fieldReadOnlyByHand(server, draft, { object: ORDER })).toBe(false);
  });

  it('fails CLOSED on an object predicate it cannot evaluate, as at the field level', () => {
    expect(fieldReadOnlyByHand({}, draft, { object: { uiReadonlyWhen: 'record.(' } })).toBe(true);
    // A row projected without the operand cannot be judged either.
    expect(fieldReadOnlyByHand({}, { notes: 'x' }, { object: ORDER })).toBe(true);
  });

  it('the fold every hand-off reads: the effective predicate, the predicate list, the conditional flag', () => {
    expect(effectiveUiReadonlyWhen({}, ORDER)).toBe(ORDER.uiReadonlyWhen);
    expect(effectiveUiReadonlyWhen({ uiReadonlyWhen: 'false' }, ORDER)).toBe('false');
    expect(effectiveUiReadonlyWhen({ uiReadonly: true }, ORDER)).toBeUndefined();
    expect(effectiveUiReadonlyWhen({}, null)).toBeUndefined();
    expect(fieldLockPredicates({ readonlyWhen: 'record.a' }, ORDER)).toEqual(['record.a', ORDER.uiReadonlyWhen]);
    expect(fieldLockPredicates({}, null)).toEqual([]);
    expect(fieldHasConditionalHandLock({}, ORDER)).toBe(true);
    expect(fieldHasConditionalHandLock({}, null)).toBe(false);
  });
});
