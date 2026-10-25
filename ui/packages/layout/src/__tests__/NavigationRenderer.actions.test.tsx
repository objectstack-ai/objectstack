/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `type: 'action'` navigation items — the framework#4509 dead-click.
 *
 * The renderer owns two halves of this contract and neither was covered:
 * it must hand the WHOLE item to the host (it never unpacks `actionDef`
 * itself), and it must not render an action item at all when no host handler
 * exists — an enabled-looking button that silently does nothing is the bug.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '../NavigationRenderer';

const actionItem: NavigationItem = {
  id: 'nav_export',
  type: 'action',
  label: 'Export Data',
  icon: 'download',
  actionDef: { actionName: 'export_data', params: { format: 'csv' } },
};

const objectItem: NavigationItem = {
  id: 'nav_accounts',
  type: 'object',
  label: 'Accounts',
  objectName: 'account',
};

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath="/apps/crm" {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('NavigationRenderer — action items', () => {
  it('dispatches the whole item to onAction so the host can read actionDef', () => {
    const onAction = vi.fn();
    renderNav([actionItem], { onAction });

    fireEvent.click(screen.getByText('Export Data'));

    expect(onAction).toHaveBeenCalledTimes(1);
    // The renderer deliberately does NOT unpack actionDef — resolving the name
    // and invoking the action is the host's job, so the host needs the item.
    const [dispatched] = onAction.mock.calls[0];
    expect(dispatched.id).toBe('nav_export');
    expect(dispatched.actionDef).toEqual({ actionName: 'export_data', params: { format: 'csv' } });
  });

  it('renders nothing for an action item when the shell supplies no handler', () => {
    // This is the framework#4509 regression guard: every shipped sidebar
    // omitted `onAction`, so these items rendered, gated, and dead-clicked.
    renderNav([actionItem]);

    expect(screen.queryByText('Export Data')).toBeNull();
  });

  it('hides only the action item — the rest of the tree still renders', () => {
    renderNav([objectItem, actionItem]);

    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.queryByText('Export Data')).toBeNull();
  });
});
