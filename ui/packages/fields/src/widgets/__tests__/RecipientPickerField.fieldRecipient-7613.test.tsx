/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecipientPickerField — the `field` recipient kind (objectui#7613).
 *
 * `sys_sharing_rule.recipient_type` carries a sixth value, `field` (maintainer
 * ruling objectstack#14103, executor objectstack#15072): the recipients are
 * whoever a user-valued COLUMN of the shared object names on each matched
 * record, so `recipient_id` stores a field NAME and not a record id. Before
 * this, the kind had no mapping and fell through to the plain text input, so
 * an admin had to know and type the machine name of the column by hand.
 *
 * ⭐ The load-bearing pin in this file is the AGREEMENT: the set this picker
 * offers must be exactly the set the sharing evaluator will honour. The
 * evaluator treats a column that is not user-typed as "grants nobody" and
 * warns once per rule, so a picker offering a wider set produces a rule that
 * looks configured and authorises nobody — the failure mode triage named as
 * worse than the hand-typed name this replaces.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  RecipientPickerField,
  fieldHoldsUsers,
  deriveUserFields,
} from '../RecipientPickerField';

/**
 * An object whose columns cover every verdict at once, so a zero in this file
 * always travels with a same-subject control: three columns the evaluator
 * honours and four it refuses, in one schema.
 */
const ACCOUNT_SCHEMA = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Name' },
    assignees: { type: 'user', label: 'Assignees', multiple: true },
    owner_manager: { type: 'lookup', reference: 'sys_user', label: 'Owner Manager' },
    primary_contact: { type: 'master_detail', reference: 'sys_user', label: 'Primary Contact' },
    account_team: { type: 'lookup', reference: 'sys_team', label: 'Account Team' },
    // The spelling the protocol refuses by name (objectui#6837) — a `lookup`
    // declaring its target as `reference_to` is NOT a user column to the
    // evaluator, so it must not be one here either.
    legacy_owner: { type: 'lookup', reference_to: 'sys_user', label: 'Legacy Owner' },
    notes: { type: 'textarea', label: 'Notes' },
  },
};

const OFFERED = ['Assignees', 'Owner Manager', 'Primary Contact'];
const WITHHELD = ['Name', 'Account Team', 'Legacy Owner', 'Notes'];

function schemaDataSource(schema: any = ACCOUNT_SCHEMA) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(schema),
    find: vi.fn().mockResolvedValue({ data: [] }),
  } as any;
}

function renderFieldPicker(
  dataSource: any,
  {
    value = '',
    objectName = 'account',
    onChange = vi.fn(),
    readonly = false,
  }: { value?: string; objectName?: string; onChange?: any; readonly?: boolean } = {},
) {
  const view = render(
    <RecipientPickerField
      value={value}
      onChange={onChange}
      readonly={readonly}
      field={{ name: 'recipient_id' } as any}
      dataSource={dataSource}
      dependentValues={{ recipient_type: 'field', object_name: objectName }}
    />,
  );
  return { ...view, onChange };
}

describe('RecipientPickerField — the `field` kind offers the object\'s user columns', () => {
  it('reads the object named by the sibling object_name, not a target object', async () => {
    const ds = schemaDataSource();
    renderFieldPicker(ds);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    expect(ds.getObjectSchema).toHaveBeenCalledWith('account');
    // The five record-picking kinds query a target object; this one has none.
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('offers exactly the user-valued columns and withholds the rest', async () => {
    const ds = schemaDataSource();
    renderFieldPicker(ds);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('combobox'));
    // Same-subject control for the four zeros below: the three offered labels
    // are rendered by the very same open list.
    for (const label of OFFERED) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    for (const label of WITHHELD) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('stores the field NAME, never a record id', async () => {
    const ds = schemaDataSource();
    const { onChange } = renderFieldPicker(ds);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Owner Manager'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('owner_manager'));
  });

  it('accepts an array-shaped `fields` declaration as well as a name-keyed map', () => {
    const asArray = deriveUserFields({
      fields: [
        { name: 'assignees', type: 'user', label: 'Assignees' },
        { name: 'name', type: 'text', label: 'Name' },
      ],
    });
    expect(asArray.map((f) => f.name)).toEqual(['assignees']);
    // Control: the map shape of the SAME two columns answers identically.
    expect(
      deriveUserFields({
        fields: { assignees: { type: 'user', label: 'Assignees' }, name: { type: 'text' } },
      }).map((f) => f.name),
    ).toEqual(['assignees']);
  });

  it('offers a hidden user column, because the evaluator honours one', () => {
    const derived = deriveUserFields({
      fields: {
        assignees: { type: 'user', label: 'Assignees', hidden: true },
        name: { type: 'text', label: 'Name', hidden: true },
      },
    });
    // Withholding it would break the agreement in the other direction: an
    // authorable, working configuration the picker refuses to offer.
    expect(derived.map((f) => f.name)).toEqual(['assignees']);
  });
});

describe('RecipientPickerField — the picker filter agrees with the evaluator', () => {
  it('honours exactly the two spellings of a user-valued column', () => {
    expect(fieldHoldsUsers({ type: 'user' })).toBe(true);
    expect(fieldHoldsUsers({ type: 'lookup', reference: 'sys_user' })).toBe(true);
    expect(fieldHoldsUsers({ type: 'master_detail', reference: 'sys_user' })).toBe(true);
  });

  it('refuses everything else, including a lookup to another object', () => {
    expect(fieldHoldsUsers({ type: 'text' })).toBe(false);
    expect(fieldHoldsUsers({ type: 'lookup', reference: 'sys_team' })).toBe(false);
    expect(fieldHoldsUsers({ type: 'master_detail', reference: 'account' })).toBe(false);
    expect(fieldHoldsUsers({ type: 'lookup' })).toBe(false);
    expect(fieldHoldsUsers(null)).toBe(false);
    expect(fieldHoldsUsers('user')).toBe(false);
  });

  it('reads `reference` only — `reference_to` is a spelling the protocol refuses', () => {
    expect(fieldHoldsUsers({ type: 'lookup', reference_to: 'sys_user' })).toBe(false);
    // Control in the same breath: the accepted spelling on the same shape.
    expect(fieldHoldsUsers({ type: 'lookup', reference: 'sys_user' })).toBe(true);
  });
});

describe('RecipientPickerField — what the `field` kind says when it cannot offer a list', () => {
  it('asks for the shared object before anything else when object_name is unset', async () => {
    const ds = schemaDataSource();
    renderFieldPicker(ds, { objectName: '' });
    expect(await screen.findByText('Select an object first.')).toBeInTheDocument();
    expect(ds.getObjectSchema).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('says the object has no user columns rather than "No matches"', async () => {
    const ds = schemaDataSource({ name: 'invoice', fields: { total: { type: 'number' } } });
    renderFieldPicker(ds);
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('No user fields on this object')).toBeInTheDocument();
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
  });

  it('keeps the stored name visible and marks it when it is not a user column', async () => {
    const ds = schemaDataSource();
    renderFieldPicker(ds, { value: 'account_team' });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());

    // Marked, not silently dropped: the evaluator grants NOBODY for it, and a
    // control that just looked empty would hide a rule that still names it.
    expect(await screen.findByText('account_team — not a user field')).toBeInTheDocument();
  });

  it('degrades to the plain text input when the data source cannot list columns', async () => {
    // No `getObjectSchema` — the "nothing breaks" promise the header makes.
    const ds = { find: vi.fn().mockResolvedValue({ data: [] }) } as any;
    const onChange = vi.fn();
    render(
      <RecipientPickerField
        value="assignees"
        onChange={onChange}
        field={{ name: 'recipient_id' } as any}
        dataSource={ds}
        dependentValues={{ recipient_type: 'field', object_name: 'account' }}
      />,
    );
    const box = screen.getByRole('textbox') as HTMLInputElement;
    expect(box.value).toBe('assignees');
    fireEvent.change(box, { target: { value: 'owner_manager' } });
    expect(onChange).toHaveBeenCalledWith('owner_manager');
  });

  it('renders the column label, not the raw name, when readonly', async () => {
    const ds = schemaDataSource();
    renderFieldPicker(ds, { value: 'assignees', readonly: true });
    expect(await screen.findByText('Assignees')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
