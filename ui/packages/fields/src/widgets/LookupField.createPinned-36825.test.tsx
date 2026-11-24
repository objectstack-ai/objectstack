/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The lookup popover's quick-create and "show all results" stay whole and
 * clickable whatever room the popover gets (objectstack#36825).
 *
 * ## The defect
 *
 * Both rows were the last children of the option list's scroll container. The
 * popover is held to the room Radix reports on the side it opens to, and when
 * that room is short of the list's natural height the list is what shrinks, so
 * the rows at its end were the first thing cut: measured in a dialog on a
 * 450px-high window, the list ended 3px into the create row. Inside a modal
 * form the list could not be scrolled to it either, because the popover is
 * portalled out of the dialog's DOM and the dialog's scroll lock cancels every
 * wheel and touch move outside it.
 *
 * ## What holds it now
 *
 * - the two rows sit in a footer pinned under the list, outside its scroll
 *   container, so the list gives way and they do not;
 * - the popover is `modal`, its own scroll-lock layer, so its list scrolls
 *   inside a modal form.
 *
 * jsdom and happy-dom do no layout, so these pins hold the structure that
 * makes the geometry true; the geometry itself was measured in a browser
 * (the readings are on the pull request).
 *
 * ## The rows
 *
 * - a long list (the clipped case): create and "show all" are in the footer,
 *   not in the listbox;
 * - CONTROL, a short list with room to spare: the footer is drawn the same
 *   way, so the placement does not depend on the list's length;
 * - no create grant and nothing more to show: no footer at all;
 * - no matching option: the empty state keeps its centred create button and
 *   draws no footer;
 * - ↑/↓ still reach the last option and `aria-activedescendant` names an
 *   option inside the listbox;
 * - while the popover is open the page behind it is hidden from assistive
 *   technology, the observable half of `modal`.
 */
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { LookupField } from './LookupField';

afterEach(cleanup);

const TARGET = 'crm_account';

const field = {
  name: 'account',
  label: 'Account',
  reference: TARGET,
  reference_field: 'name',
} as any;

function makeDataSource(shown: number, total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `acc_${i + 1}`, name: `Account ${String(i + 1).padStart(2, '0')}` }));
  return {
    find: vi.fn().mockImplementation(async (_object: string, params: any) => {
      const q = String(params?.$search ?? '').trim();
      const hit = q ? rows.filter((r) => r.name.includes(q)) : rows;
      return { data: hit.slice(0, shown), total: hit.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const deniedCreate: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u-reader',
  tenantId: null,
  hasAnyQueue: false,
  objectsUsingQueues: [],
  positions: ['reader'],
  permissionSets: ['reader'],
  objects: { [TARGET]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
  fields: {},
};

async function openPicker(shown: number, total: number, wrap?: (node: React.ReactElement) => React.ReactElement) {
  const ds = makeDataSource(shown, total);
  const widget = <LookupField field={field} value={undefined} onChange={vi.fn()} readonly={false} dataSource={ds as any} />;
  const utils = render(
    <div>
      <button type="button">Outside the field</button>
      {wrap ? wrap(widget) : widget}
    </div>,
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger-account'));
  });
  const popover = await screen.findByTestId('lookup-popover');
  if (shown > 0) await waitFor(() => expect(within(popover).getAllByRole('option')).toHaveLength(shown));
  return { ...utils, popover, listbox: within(popover).getByRole('listbox') };
}

describe('LookupField popover pins quick-create and "show all" under the list (objectstack#36825)', () => {
  it('a long list (the clipped case): create and "show all" sit in the footer, outside the listbox', async () => {
    const { popover, listbox } = await openPicker(25, 60);
    const footer = within(popover).getByTestId('lookup-panel-footer');
    const create = within(footer).getByTestId('lookup-create-new');
    const showAll = within(footer).getByTestId('show-all-results');
    expect(create).toHaveTextContent(/Create new/);
    expect(showAll).toHaveTextContent(/60/);
    expect(listbox).not.toContainElement(create);
    expect(listbox).not.toContainElement(showAll);
    // The footer follows the list, a sibling of its scroll container's box.
    expect(listbox.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer).not.toContainElement(listbox);
  });

  it('CONTROL — a short list with room to spare draws the same footer', async () => {
    const { popover, listbox } = await openPicker(3, 3);
    const footer = within(popover).getByTestId('lookup-panel-footer');
    const create = within(footer).getByTestId('lookup-create-new');
    expect(listbox).not.toContainElement(create);
    // Nothing more to show: no "show all", anywhere.
    expect(within(popover).queryByTestId('show-all-results')).toBeNull();
  });

  it('no create grant and nothing more to show: no footer', async () => {
    const { popover } = await openPicker(3, 3, (node) => (
      <MePermissionsProvider initialPermissions={deniedCreate}>{node}</MePermissionsProvider>
    ));
    expect(within(popover).queryByTestId('lookup-panel-footer')).toBeNull();
    expect(within(popover).queryByText(/Create new/)).toBeNull();
  });

  it('no create grant, more to show: the footer holds "show all" alone', async () => {
    const { popover } = await openPicker(25, 60, (node) => (
      <MePermissionsProvider initialPermissions={deniedCreate}>{node}</MePermissionsProvider>
    ));
    const footer = within(popover).getByTestId('lookup-panel-footer');
    expect(within(footer).getByTestId('show-all-results')).toBeInTheDocument();
    expect(within(popover).queryByTestId('lookup-create-new')).toBeNull();
  });

  it('no matching option: the empty state keeps its centred create button and draws no footer', async () => {
    const { popover, listbox } = await openPicker(25, 60);
    const input = within(popover).getByRole('combobox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'nothing matches this' } });
    });
    await waitFor(() => expect(within(popover).getByText('No options found')).toBeInTheDocument());
    expect(within(listbox).getByRole('button', { name: /Create/ })).toBeInTheDocument();
    expect(within(popover).queryByTestId('lookup-panel-footer')).toBeNull();
  });

  it('↑/↓ still reach the last option and aria-activedescendant names an option in the listbox', async () => {
    const { popover, listbox } = await openPicker(25, 60);
    const input = within(popover).getByRole('combobox');
    for (let i = 0; i < 30; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    const option = document.getElementById(active!);
    expect(listbox).toContainElement(option);
    expect(option).toHaveTextContent('Account 25');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)).toHaveTextContent('Account 24');
  });

  it('while open, the page behind the popover is hidden from assistive technology (the popover is modal)', async () => {
    const { container, popover } = await openPicker(3, 3);
    expect(container).toHaveAttribute('aria-hidden', 'true');
    expect(popover.closest('[aria-hidden="true"]')).toBeNull();
  });
});
