/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11362 — `AppSchemaRenderer`'s mobile tab bar (`mobileNavMode:
 * 'bottom_nav'`) draws only the entries its sidebar draws.
 *
 * The bar used to flatten the navigation tree, drop separators and keep the
 * first five entries with no guard at all, so an author's `visible` rule and
 * `requiredPermissions` gate did nothing on it, and an `action` entry became a
 * link to nowhere. objectui#11211 moved the bar's hrefs onto the sidebar's
 * `resolveHref`; this is the other half of "the bar answers differently from
 * the sidebar": which entries are drawn at all.
 *
 * The bar now asks `passesNavItemGuards`, the one per-item guard the sidebar,
 * the area derivation and Favorites already share, with the same evaluator,
 * permission checker, capability checker and doc-target checker the sidebar
 * gets. The five-tab cap applies after the guard, so a hidden entry does not
 * take a slot, and a gated group takes its children with it, as it does in
 * the sidebar. An `action` entry is drawn the sidebar's way, as a button that
 * hands the whole item to `onAction`, and is left off the bar when the host
 * wires no `onAction`, which is when the sidebar hides it too.
 *
 * Every row asserts the bar against the sidebar row the same entry draws, so
 * the claim is "the two agree", not only "the bar hides it". The control is a
 * visible, permitted entry: a plain one, and one whose `requiredPermissions`
 * the checker grants, so "drawn" is shown to go through the permission check
 * rather than around it.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { AppSchemaRenderer } from '../AppSchemaRenderer';

const BASE = '/apps/crm';

const CONTROL: NavigationItem = { id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'account' };
const PERMITTED: NavigationItem = {
  id: 'nav_contacts',
  type: 'object',
  label: 'Contacts',
  objectName: 'contact',
  requiredPermissions: ['crm.read'],
};
const HIDDEN: NavigationItem = { id: 'nav_secret', type: 'object', label: 'Secret', objectName: 'secret', visible: false };
const DENIED: NavigationItem = {
  id: 'nav_secret2',
  type: 'object',
  label: 'Secret Two',
  objectName: 'secret2',
  requiredPermissions: ['crm.admin'],
};
const ACTION: NavigationItem = {
  id: 'nav_quick',
  type: 'action',
  label: 'Quick Create',
  actionDef: { actionName: 'quick_create' },
};

/** Grants `crm.read` and nothing else, so `crm.admin` is a permission the caller lacks. */
const checkPermission = (perms: string[]) => perms.every((p) => p === 'crm.read');

function renderShell(navigation: NavigationItem[], onAction?: (item: NavigationItem) => void) {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <AppSchemaRenderer
        schema={{ type: 'app', name: 'crm', title: 'CRM', navigation }}
        basePath={BASE}
        mobileNavMode="bottom_nav"
        checkPermission={checkPermission}
        onAction={onAction}
      >
        <div />
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
  const bar = container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
  /** Every tab the bar draws, link or button, by its text. */
  const tabs = () => (bar ? Array.from(bar.querySelectorAll('a, button')).map((el) => el.textContent) : []);
  const tab = (label: string) => {
    const hit = bar ? Array.from(bar.querySelectorAll('a, button')).filter((el) => el.textContent === label) : [];
    expect(hit.length).toBeLessThanOrEqual(1);
    return hit[0] ?? null;
  };
  /** The sidebar's row for the same entry: the element with that text outside the bar. */
  const sidebarRow = (label: string) => {
    const hit = Array.from(container.querySelectorAll('a, button')).filter(
      (el) => el.textContent === label && !(bar && bar.contains(el)),
    );
    expect(hit.length).toBeLessThanOrEqual(1);
    return hit[0] ?? null;
  };
  return { bar, tabs, tab, sidebarRow };
}

describe('objectui#11362 — the mobile tab bar draws only what the sidebar draws (the card\'s table)', () => {
  const entries = [CONTROL, PERMITTED, HIDDEN, DENIED, ACTION];

  it('control: a visible, permitted entry is drawn on both, as a link', () => {
    const { tab, sidebarRow } = renderShell(entries);
    for (const label of ['Accounts', 'Contacts']) {
      expect(tab(label)?.tagName).toBe('A');
      expect(sidebarRow(label)?.tagName).toBe('A');
    }
  });

  it('a `visible: false` entry is drawn on neither', () => {
    const { tab, sidebarRow } = renderShell(entries);
    expect(sidebarRow('Secret')).toBeNull();
    expect(tab('Secret')).toBeNull();
  });

  it('an entry whose `requiredPermissions` the caller lacks is drawn on neither', () => {
    const { tab, sidebarRow } = renderShell(entries);
    expect(sidebarRow('Secret Two')).toBeNull();
    expect(tab('Secret Two')).toBeNull();
  });

  it('an `action` entry with no `onAction` is drawn on neither, not as a dead link', () => {
    const { tab, sidebarRow, tabs } = renderShell(entries);
    expect(sidebarRow('Quick Create')).toBeNull();
    expect(tab('Quick Create')).toBeNull();
    expect(tabs()).toEqual(['Accounts', 'Contacts']);
  });

  it('an `action` entry with `onAction` is drawn on both as a button that hands the whole item to `onAction`', () => {
    const onAction = vi.fn();
    const { tab, sidebarRow } = renderShell(entries, onAction);
    expect(sidebarRow('Quick Create')?.tagName).toBe('BUTTON');
    const button = tab('Quick Create');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
    fireEvent.click(button!);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(ACTION);
  });
});

describe('objectui#11362 — the guard runs before the five-tab cap, and a gated group takes its children', () => {
  it('six entries with one hidden: the hidden one takes no slot, and the sixth is drawn', () => {
    const six: NavigationItem[] = [
      { id: 'n1', type: 'object', label: 'One', objectName: 'one' },
      { id: 'n2', type: 'object', label: 'Two', objectName: 'two', visible: false },
      { id: 'n3', type: 'object', label: 'Three', objectName: 'three' },
      { id: 'n4', type: 'object', label: 'Four', objectName: 'four' },
      { id: 'n5', type: 'object', label: 'Five', objectName: 'five' },
      { id: 'n6', type: 'object', label: 'Six', objectName: 'six' },
    ];
    const { tabs } = renderShell(six);
    expect(tabs()).toEqual(['One', 'Three', 'Four', 'Five', 'Six']);
  });

  it('a group the caller may not see takes its children off the bar, as it does in the sidebar; control: an open group\'s child is drawn', () => {
    const navigation: NavigationItem[] = [
      {
        id: 'grp_admin',
        type: 'group',
        label: 'Admin',
        requiredPermissions: ['crm.admin'],
        children: [{ id: 'n_users', type: 'object', label: 'Users', objectName: 'sys_user' }],
      },
      {
        id: 'grp_sales',
        type: 'group',
        label: 'Sales',
        children: [{ id: 'n_deals', type: 'object', label: 'Deals', objectName: 'deal' }],
      },
    ];
    const { tab, sidebarRow } = renderShell(navigation);
    expect(sidebarRow('Users')).toBeNull();
    expect(tab('Users')).toBeNull();
    expect(sidebarRow('Deals')?.tagName).toBe('A');
    expect(tab('Deals')?.tagName).toBe('A');
  });
});
