/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { stateMachineNextValues, isFieldInlineEditable } from './inline-edit-options';

// Mirrors examples/app-showcase task.object.ts — the state machine that rejected
// done → in_review live (done only transitions to in_progress).
const taskSchema = {
  validations: [
    {
      type: 'state_machine',
      field: 'status',
      transitions: {
        backlog: ['todo'],
        todo: ['in_progress', 'backlog'],
        in_progress: ['in_review', 'todo'],
        in_review: ['done', 'in_progress'],
        done: ['in_progress'],
      },
    },
  ],
};

describe('stateMachineNextValues', () => {
  it('returns the current value plus its allowed transitions', () => {
    const r = stateMachineNextValues(taskSchema, 'status', 'in_review');
    expect(r).not.toBeNull();
    expect([...(r as Set<string>)].sort()).toEqual(['done', 'in_progress', 'in_review']);
  });

  it('constrains a near-terminal state to itself + its one valid move', () => {
    // The exact live bug: from `done` the only valid move is `in_progress`,
    // so `in_review` must NOT be offered.
    const r = stateMachineNextValues(taskSchema, 'status', 'done');
    expect([...(r as Set<string>)].sort()).toEqual(['done', 'in_progress']);
    expect((r as Set<string>).has('in_review')).toBe(false);
  });

  it('always includes the current value so it stays selectable', () => {
    const r = stateMachineNextValues(taskSchema, 'status', 'backlog');
    expect((r as Set<string>).has('backlog')).toBe(true);
    expect((r as Set<string>).has('todo')).toBe(true);
  });

  it('returns null (unconstrained) for a field with no state machine', () => {
    expect(stateMachineNextValues(taskSchema, 'priority', 'medium')).toBeNull();
  });

  it('returns null when the current state is undeclared (lenient, mirrors the engine)', () => {
    expect(stateMachineNextValues(taskSchema, 'status', 'archived')).toBeNull();
  });

  it('returns only the current value for a terminal state (no outgoing edges)', () => {
    const terminal = {
      validations: [{ type: 'state_machine', field: 'status', transitions: { done: [] } }],
    };
    const r = stateMachineNextValues(terminal, 'status', 'done');
    expect([...(r as Set<string>)]).toEqual(['done']);
  });

  it('returns null for missing/empty schema or validations', () => {
    expect(stateMachineNextValues(null, 'status', 'done')).toBeNull();
    expect(stateMachineNextValues({}, 'status', 'done')).toBeNull();
    expect(stateMachineNextValues({ validations: [] }, 'status', 'done')).toBeNull();
  });

  it('coerces non-string transition values to strings', () => {
    const numeric = {
      validations: [{ type: 'state_machine', field: 'level', transitions: { 1: [2, 3] } }],
    };
    const r = stateMachineNextValues(numeric, 'level', 1);
    expect([...(r as Set<string>)].sort()).toEqual(['1', '2', '3']);
  });
});

describe('isFieldInlineEditable', () => {
  it('blocks computed / system-generated types (would open a text box for a derived value)', () => {
    for (const type of ['formula', 'summary', 'rollup', 'autonumber', 'auto_number']) {
      expect(isFieldInlineEditable({ type })).toBe(false);
    }
  });

  it('blocks binary / attachment types (no inline text control)', () => {
    for (const type of ['file', 'image', 'avatar', 'video', 'audio', 'signature']) {
      expect(isFieldInlineEditable({ type })).toBe(false);
    }
  });

  it('keeps a markdown cell read-only — the detail row editor (objectui#11541) is not a grid one', () => {
    // The detail page routes `markdown` to a multi-line textarea through its own
    // carve-out from the shared exclusion; the cell has no room for one.
    expect(isFieldInlineEditable({ type: 'markdown' })).toBe(false);
  });

  it('blocks an explicitly readonly field regardless of type', () => {
    expect(isFieldInlineEditable({ type: 'text', readonly: true })).toBe(false);
    expect(isFieldInlineEditable({ type: 'select', readonly: true })).toBe(false);
  });

  it('allows ordinary editable types', () => {
    for (const type of ['text', 'number', 'select', 'boolean', 'date', 'multiselect', 'currency']) {
      expect(isFieldInlineEditable({ type })).toBe(true);
    }
  });

  it('treats relational / structured types as editable (text fallback today, not a hard lock)', () => {
    for (const type of ['lookup', 'master_detail', 'user', 'json', 'address']) {
      expect(isFieldInlineEditable({ type })).toBe(true);
    }
  });

  it('treats a null/unknown field as editable so the grid flag still governs', () => {
    expect(isFieldInlineEditable(null)).toBe(true);
    expect(isFieldInlineEditable(undefined)).toBe(true);
    expect(isFieldInlineEditable({})).toBe(true);
  });
});
