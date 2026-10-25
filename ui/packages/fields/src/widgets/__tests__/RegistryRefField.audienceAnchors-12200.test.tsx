/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `position-ref` is a grant picker, and a grant cannot name an audience anchor
 * (objectui#12200). `everyone` and `guest` (ADR-0090 D5/D9) are held
 * implicitly by every authenticated or anonymous principal, the server refuses
 * a `sys_user_position` row that names one, and yet the position registry
 * lists both beside the assignable positions. These pins hold:
 *
 *  - the picker leaves out exactly the spec's `AUDIENCE_ANCHOR_POSITIONS`;
 *  - a registry that lists nothing BUT anchors offers no picker;
 *  - a stored anchor still shows, by its label beside its name, unflagged, and
 *    is not offered when the row holds another value;
 *  - `permission-ref` filters nothing: a permission set named like an anchor is
 *    an ordinary set.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec';
import { PositionRefField, PermissionRefField } from '../RegistryRefField';

/** The assignable positions, by label beside name, as the picker reads them. */
const ASSIGNABLE = ['auditor', 'Sales Manager (sales_manager)', 'Sales Representative (sales_rep)'];

const POSITIONS = [
  { name: 'sales_rep', label: 'Sales Representative' },
  { name: 'sales_manager', label: 'Sales Manager' },
  { name: 'auditor' },
  // The anchors, as the registry serves them: listed beside the positions.
  { name: 'everyone', label: 'Everyone' },
  { name: 'guest', label: 'Guest' },
];

function lister(items: Array<{ name: string; label?: string }>) {
  return { listMetadataItems: vi.fn(async () => items), find: vi.fn() } as any;
}

function mount(
  Widget: typeof PositionRefField,
  { dataSource, value = '', readonly = false }: { dataSource: unknown; value?: string; readonly?: boolean },
) {
  const onChange = vi.fn();
  render(
    <Widget
      value={value}
      onChange={onChange}
      readonly={readonly}
      field={{ name: 'position', type: 'text', label: 'Position' } as any}
      dataSource={dataSource}
      id="f-position"
    />,
  );
  return { onChange };
}

/** The option texts of the open picker, in order. */
async function openOptions(): Promise<string[]> {
  fireEvent.click(await screen.findByRole('combobox'));
  await screen.findAllByRole('option');
  return screen.getAllByRole('option').map((option) => option.textContent ?? '');
}

afterEach(() => cleanup());

describe('position-ref leaves the audience anchors out of what it offers (objectui#12200)', () => {
  it('offers the assignable positions and no anchor', async () => {
    // The names the card asks for are the ones the spec publishes.
    expect([...AUDIENCE_ANCHOR_POSITIONS].sort()).toEqual(['everyone', 'guest']);

    mount(PositionRefField, { dataSource: lister(POSITIONS) });

    expect(await openOptions()).toEqual(ASSIGNABLE);
    for (const anchor of AUDIENCE_ANCHOR_POSITIONS) {
      expect(screen.queryByText(new RegExp(`\\(${anchor}\\)$`))).toBeNull();
    }
  });

  it('a registry that lists only the anchors offers no picker: the typed-name box', async () => {
    const ds = lister(POSITIONS.slice(3));
    mount(PositionRefField, { dataSource: ds });

    await waitFor(() => expect(ds.listMetadataItems).toHaveBeenCalledWith('position'));
    const box = await screen.findByRole('textbox');
    await waitFor(() => expect(box).toBeEnabled());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByTestId('registry-ref-position-load-failed')).toBeNull();
  });
});

describe('a stored anchor still shows, and is not offered as a fresh choice (objectui#12200)', () => {
  it('shows a stored `everyone` by its label beside its name, unflagged, and writes nothing', async () => {
    const { onChange } = mount(PositionRefField, { dataSource: lister(POSITIONS), value: 'everyone' });

    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveTextContent('Everyone (everyone)');
    // The registry lists it, so it is not "not found".
    expect(trigger).not.toHaveAttribute('data-not-found');
    expect(onChange).not.toHaveBeenCalled();

    // Its own option, as the row's value; the other anchor is not offered.
    expect(await openOptions()).toEqual(['Everyone (everyone)', ...ASSIGNABLE]);
  });

  it('read-only: a stored anchor reads as its label beside its name', async () => {
    mount(PositionRefField, { dataSource: lister(POSITIONS), value: 'guest', readonly: true });

    const shown = await screen.findByText('Guest (guest)');
    expect(shown).not.toHaveAttribute('data-not-found');
  });
});

describe('permission-ref filters nothing (objectui#12200)', () => {
  it('lists, and writes, a permission set named like an anchor', async () => {
    const sets = lister([
      { name: 'everyone', label: 'Everyone Baseline' },
      { name: 'guest' },
      { name: 'sales_user', label: 'Sales User' },
    ]);
    const { onChange } = mount(PermissionRefField, { dataSource: sets });

    expect(await openOptions()).toEqual(['Everyone Baseline (everyone)', 'guest', 'Sales User (sales_user)']);
    fireEvent.click(screen.getByText('Everyone Baseline (everyone)'));
    expect(onChange).toHaveBeenCalledWith('everyone');
  });
});
