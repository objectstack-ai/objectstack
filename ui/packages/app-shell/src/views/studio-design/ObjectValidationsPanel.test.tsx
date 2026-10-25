/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ObjectValidationsPanel } from './ObjectValidationsPanel';

const draft = {
  fields: {
    name: { type: 'text', label: '名称' },
    amount: { type: 'number', label: '金额' },
    status: { type: 'select', label: '状态' },
  },
  validations: [
    { type: 'script', name: 'no_negative', message: '金额不能为负', condition: 'record.amount < 0', severity: 'error' },
    { type: 'state_machine', name: 'status_flow', message: '非法状态转移', field: 'status', transitions: {} },
  ],
};

describe('ObjectValidationsPanel', () => {
  it('default-selects the first rule so the detail pane is never a dead pick-one empty state', () => {
    render(<ObjectValidationsPanel draft={draft} onPatch={() => {}} />);
    // The first rule ("no_negative", a script rule) should already be open —
    // its message input is visible without clicking anything.
    expect(screen.getByDisplayValue('金额不能为负')).toBeTruthy();
  });

  it('lists every rule with its type badge', () => {
    render(<ObjectValidationsPanel draft={draft} onPatch={() => {}} />);
    expect(screen.getByText('no_negative')).toBeTruthy();
    expect(screen.getByText('status_flow')).toBeTruthy();
    expect(screen.getByText('state_machine')).toBeTruthy();
  });

  it('adds a script rule from the New menu WITHOUT writing it until it has a condition (objectui#11820)', () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draft} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('New'));
    // The per-type list sits under Advanced since objectui#11861.
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    // Target the menu <button> (the Type picker shows the same text — its
    // trigger is role "combobox", not "button").
    fireEvent.click(screen.getByRole('button', { name: 'Script — CEL fail condition' }));
    // An empty condition 422s the whole draft save (spec ExpressionInputSchema),
    // and the old `'false'` placeholder saved a rule that never fires — so a new
    // guarded rule is listed and open, and nothing reaches the draft yet.
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText('validation_3')).toBeTruthy();
    expect(screen.getByTestId('rule-unsaved')).toBeTruthy();
  });

  it('adds a non-script rule type from the New menu with a valid skeleton', () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draft} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'State machine — allowed transitions' }));
    const patch = onPatch.mock.calls[0][0];
    const added = patch.validations[patch.validations.length - 1];
    // Seeded valid: a required `field` (first field) + an (empty) transitions map.
    // A type with no guard has nothing to wait for, so it is written at once.
    expect(added).toMatchObject({ type: 'state_machine', name: 'validation_3', field: 'name' });
    expect(added.transitions).toEqual({});
    // objectui#11820 — and it starts on Create + Update.
    expect(added.events).toEqual(['insert', 'update']);
  });

  it('edits a script rule message via onPatch without touching other rules', () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draft} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('no_negative'));
    const msg = screen.getByDisplayValue('金额不能为负');
    fireEvent.change(msg, { target: { value: '金额必须 ≥ 0' } });
    const patch = onPatch.mock.calls[0][0];
    expect(patch.validations[0].message).toBe('金额必须 ≥ 0');
    expect(patch.validations[1]).toEqual(draft.validations[1]);
  });

  it('makes non-script rules editable (metadata-driven, no longer read-only)', () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draft} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('status_flow'));
    // The state-machine rule's message is an editable input (not a read-only note).
    const msg = screen.getByDisplayValue('非法状态转移');
    fireEvent.change(msg, { target: { value: '状态流转不允许' } });
    const patch = onPatch.mock.calls[0][0];
    expect(patch.validations[1].message).toBe('状态流转不允许');
    expect(patch.validations[1].type).toBe('state_machine');
  });

  it('converts a rule to another type, reseeding type-specific fields', async () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draft} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('no_negative'));
    // The Type picker (the shared Select, objectui#11865) holds the current
    // type; switching it converts the rule.
    const typePicker = screen.getByTestId('rule-type');
    expect(typePicker).toHaveTextContent('Script — CEL fail condition');
    fireEvent.keyDown(typePicker, { key: 'ArrowDown' });
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'Format — regex / built-in format' }),
    );
    const patch = onPatch.mock.calls[0][0];
    expect(patch.validations[0]).toMatchObject({ type: 'format', name: 'no_negative', message: '金额不能为负' });
    // format has no `condition`; the reseed drops it.
    expect(patch.validations[0].condition).toBeUndefined();
  });

  it('deletes a rule', () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draft} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('no_negative'));
    fireEvent.click(screen.getByTestId('rule-delete'));
    const patch = onPatch.mock.calls[0][0];
    expect(patch.validations).toHaveLength(1);
    expect(patch.validations[0].name).toBe('status_flow');
  });

  it('hides authoring affordances when disabled (read-only package)', () => {
    render(<ObjectValidationsPanel draft={draft} onPatch={() => {}} disabled />);
    expect(screen.queryByText('New')).toBeNull();
    expect(screen.queryByTestId('rule-delete')).toBeNull();
  });
});
