/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unit tests for `resolveKanbanCardFields` — the card-field resolution that
 * defaults a kanban board's card fields to the object's `highlightFields`
 * semantic role (ADR-0085) when no view-level `cardFields` are configured.
 */
import { describe, it, expect } from 'vitest';
import { resolveKanbanCardFields } from './ObjectKanban';

const objectDef = {
  name: 'deal',
  highlightFields: ['amount', 'stage', 'owner'],
  fields: {
    id: { type: 'text' },
    amount: { type: 'currency' },
    stage: { type: 'picklist' },
    owner: { type: 'lookup' },
    notes: { type: 'textarea' },
  },
};

describe('resolveKanbanCardFields', () => {
  it('uses the view-level cardFields when configured (author choice wins)', () => {
    expect(resolveKanbanCardFields(['amount', 'notes'], objectDef)).toEqual([
      'amount',
      'notes',
    ]);
  });

  it("ignores the object's highlightFields when the view declares cardFields", () => {
    // Even though highlightFields is present, the explicit view config wins.
    const result = resolveKanbanCardFields(['notes'], objectDef);
    expect(result).toEqual(['notes']);
    expect(result).not.toContain('stage');
  });

  it('defaults to the object highlightFields when no view cardFields are given (ADR-0085)', () => {
    expect(resolveKanbanCardFields(undefined, objectDef)).toEqual([
      'amount',
      'stage',
      'owner',
    ]);
  });

  it('treats an empty cardFields array as "no view config" and falls back to highlightFields', () => {
    expect(resolveKanbanCardFields([], objectDef)).toEqual([
      'amount',
      'stage',
      'owner',
    ]);
  });

  it('drops highlight entries that reference a field the object no longer declares', () => {
    const stale = {
      highlightFields: ['amount', 'ghost_field', 'stage'],
      fields: { amount: { type: 'currency' }, stage: { type: 'picklist' } },
    };
    expect(resolveKanbanCardFields(undefined, stale)).toEqual(['amount', 'stage']);
  });

  it('returns [] when neither view cardFields nor object highlightFields exist', () => {
    expect(resolveKanbanCardFields(undefined, { fields: { amount: {} } })).toEqual(
      [],
    );
    expect(resolveKanbanCardFields([], null)).toEqual([]);
    expect(resolveKanbanCardFields(undefined, undefined)).toEqual([]);
  });

  it('ignores a non-array highlightFields value', () => {
    // `highlightFields` is typed `unknown`, so a malformed string value is a
    // valid input to guard against — no cast needed.
    const malformed = { highlightFields: 'amount', fields: { amount: {} } };
    expect(resolveKanbanCardFields(undefined, malformed)).toEqual([]);
  });
});
