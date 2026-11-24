/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * On a phone the lookup's candidate panel opens in a bottom drawer, not the
 * anchored popover (objectstack#36832).
 *
 * ## The defect
 *
 * On a phone a create or edit form is a full-screen modal dialog, and the
 * lookup's popover is portalled outside that dialog's DOM. The dialog's
 * scroll lock therefore cancelled every touch move on the popover: the list
 * could not be scrolled by touch, and with the keyboard up the popover flipped
 * above the field into the few rows of room left there. Measured in a phone
 * emulation (390x844, touch): 40 of 40 touch moves on the list cancelled,
 * `scrollTop` 0 before and after.
 *
 * ## What holds it now
 *
 * Below the phone breakpoint the panel is a bottom drawer: its own modal layer,
 * so its list scrolls by touch; the search row at the top, the list in the
 * middle taking the height left, and quick-create and "show all results" in
 * the footer pinned under it, gated exactly as in the popover.
 *
 * jsdom and happy-dom do no layout and no touch scrolling, so these pins hold
 * the face and its structure; the touch scrolling itself was measured in a
 * browser (the readings are on the pull request).
 *
 * ## The rows
 *
 * - phone width: the trigger opens the drawer, and no popover;
 * - CONTROL, desktop width: the trigger opens the popover, and no drawer;
 * - in the drawer the search row, the listbox and the footer are there, and
 *   create and "show all" sit in the footer, outside the listbox;
 * - a user without create on the target sees no create row in the drawer;
 * - picking a candidate in the drawer fills the field and closes the drawer;
 * - the search box is not focused when the drawer opens, so the on-screen
 *   keyboard does not cover the list until the user asks to type.
 */
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { LookupField } from './LookupField';

const TARGET = 'crm_account';

const field = {
  name: 'account',
  label: 'Account',
  reference: TARGET,
  reference_field: 'name',
} as any;

const realInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const realMatchMedia = window.matchMedia;

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

beforeEach(() => setViewportWidth(390));

afterEach(() => {
  cleanup();
  if (realInnerWidth) Object.defineProperty(window, 'innerWidth', realInnerWidth);
  window.matchMedia = realMatchMedia;
});

function makeDataSource(shown: number, total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `acc_${i + 1}`, name: `Account ${String(i + 1).padStart(2, '0')}` }));
  return {
    find: vi.fn().mockImplementation(async () => ({ data: rows.slice(0, shown), total })),
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

async function open(opts: { perms?: MePermissionsAuthenticatedResponse; onChange?: (v: unknown) => void } = {}) {
  const ds = makeDataSource(25, 60);
  const widget = (
    <LookupField field={field} value={undefined} onChange={opts.onChange ?? vi.fn()} readonly={false} dataSource={ds as any} />
  );
  render(opts.perms ? <MePermissionsProvider initialPermissions={opts.perms}>{widget}</MePermissionsProvider> : widget);
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger-account'));
  });
}

describe('LookupField opens its candidate panel in a bottom drawer on a phone (objectstack#36832)', () => {
  it('phone width: the trigger opens the drawer, and no popover', async () => {
    await open();
    expect(await screen.findByTestId('lookup-drawer')).toBeInTheDocument();
    expect(screen.queryByTestId('lookup-popover')).toBeNull();
  });

  it('CONTROL — desktop width: the trigger opens the popover, and no drawer', async () => {
    setViewportWidth(1280);
    await open();
    expect(await screen.findByTestId('lookup-popover')).toBeInTheDocument();
    expect(screen.queryByTestId('lookup-drawer')).toBeNull();
  });

  it('the drawer holds the search row, the listbox and the pinned footer, create and "show all" outside the listbox', async () => {
    await open();
    const drawer = await screen.findByTestId('lookup-drawer');
    await waitFor(() => expect(within(drawer).getAllByRole('option')).toHaveLength(25));
    const listbox = within(drawer).getByRole('listbox');
    expect(within(drawer).getByRole('combobox')).toHaveAttribute('aria-controls', listbox.id);
    const footer = within(drawer).getByTestId('lookup-panel-footer');
    const create = within(footer).getByTestId('lookup-create-new');
    const showAll = within(footer).getByTestId('show-all-results');
    expect(listbox).not.toContainElement(create);
    expect(listbox).not.toContainElement(showAll);
    expect(listbox.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The drawer is titled with the field's label.
    expect(within(drawer).getByText('Account', { selector: 'h2' })).toBeInTheDocument();
  });

  it('a user without create on the target sees no create row in the drawer', async () => {
    await open({ perms: deniedCreate });
    const drawer = await screen.findByTestId('lookup-drawer');
    await waitFor(() => expect(within(drawer).getAllByRole('option')).toHaveLength(25));
    expect(within(drawer).queryByTestId('lookup-create-new')).toBeNull();
    expect(within(drawer).queryByText(/Create new/)).toBeNull();
    // "show all" still has somewhere to go, so the footer stays for it.
    expect(within(within(drawer).getByTestId('lookup-panel-footer')).getByTestId('show-all-results')).toBeInTheDocument();
  });

  it('picking a candidate in the drawer fills the field and closes the drawer', async () => {
    const onChange = vi.fn();
    await open({ onChange });
    const drawer = await screen.findByTestId('lookup-drawer');
    await waitFor(() => expect(within(drawer).getAllByRole('option')).toHaveLength(25));
    const last = within(drawer).getAllByRole('option')[24];
    await act(async () => {
      fireEvent.click(last);
    });
    expect(onChange).toHaveBeenCalledWith('acc_25');
    // Closed: gone, or (while vaul plays its exit) marked closed.
    await waitFor(() => {
      const after = screen.queryByTestId('lookup-drawer');
      expect(after === null || after.getAttribute('data-state') === 'closed').toBe(true);
    });
  });

  it('the search box is not focused when the drawer opens', async () => {
    await open();
    const drawer = await screen.findByTestId('lookup-drawer');
    await waitFor(() => expect(within(drawer).getAllByRole('option')).toHaveLength(25));
    expect(within(drawer).getByRole('combobox')).not.toHaveFocus();
  });
});
