/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A menu opens only when something in it renders, and a separator is drawn
 * only between two groups that both rendered (objectui#10209).
 *
 * Before the fix, both components asked a different question in the guard
 * than in the entries beneath it:
 *  - `ManageViewsDialog`'s row trigger rendered whenever a CALLBACK was wired,
 *    while every entry was also gated on `!isReadonly`, so a read-only row
 *    (with the console's props — no `onDuplicate`) opened an empty menu;
 *  - `ViewTabBar`'s separators stated their own condition, so a read-only
 *    tab's dropdown opened on a leading separator above "Manage all views…",
 *    and its trigger had the same callback-shaped guard, so a read-only tab
 *    with no `onManageViews` opened an empty dropdown.
 *
 * The reverse control: an editable view still gets every entry.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ViewTabBar } from '../ViewTabBar';
import type { ViewTabItem } from '../ViewTabBar';
import { ManageViewsDialog } from '../ManageViewsDialog';

afterEach(cleanup);

const READONLY: ViewTabItem = {
  id: 'crm_lead.all',
  label: 'All',
  type: 'grid',
  readonly: true,
  isDefault: true,
};
const EDITABLE: ViewTabItem = { id: 'crm_lead.mine', label: 'Mine', type: 'grid' };

function open(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

/** The direct children of the open menu, as `menuitem` / `separator` roles. */
function menuShape(): string[] {
  const menu = screen.getByRole('menu');
  return Array.from(menu.children).map((el) => el.getAttribute('role') ?? el.tagName);
}

// --- ManageViewsDialog -------------------------------------------------------

/** The console's prop set: every callback except `onDuplicate` (objectui#1520). */
function renderDialog(views: ViewTabItem[], extra: Record<string, unknown> = {}) {
  render(
    <ManageViewsDialog
      open
      onOpenChange={vi.fn()}
      views={views}
      activeViewId={views[0]?.id}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onSetDefault={vi.fn()}
      onSetPinned={vi.fn()}
      onReorder={vi.fn()}
      onAddView={vi.fn()}
      onConfigView={vi.fn()}
      {...extra}
    />,
  );
}

describe('ManageViewsDialog row menu (#10209)', () => {
  it('a read-only row with the console props renders NO `…` trigger', () => {
    renderDialog([READONLY]);
    expect(screen.getByTestId(`manage-views-row-${READONLY.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`manage-views-actions-${READONLY.id}`)).toBeNull();
  });

  it('a read-only row still offers Duplicate when the host wires it — and nothing else', () => {
    renderDialog([READONLY], { onDuplicate: vi.fn() });
    open(screen.getByTestId(`manage-views-actions-${READONLY.id}`));
    expect(menuShape()).toEqual(['menuitem']);
    expect(screen.getByTestId(`manage-views-action-duplicate-${READONLY.id}`)).toBeInTheDocument();
  });

  it('reverse control: an editable row keeps all six entries, one separator above Delete', () => {
    renderDialog([EDITABLE], { onDuplicate: vi.fn() });
    open(screen.getByTestId(`manage-views-actions-${EDITABLE.id}`));
    expect(menuShape()).toEqual([
      'menuitem', 'menuitem', 'menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem',
    ]);
    for (const key of ['rename', 'duplicate', 'config', 'default', 'pin', 'delete']) {
      expect(screen.getByTestId(`manage-views-action-${key}-${EDITABLE.id}`)).toBeInTheDocument();
    }
  });

  it('Delete alone opens without a leading separator (no rename without `onRename`)', () => {
    render(
      <ManageViewsDialog open onOpenChange={vi.fn()} views={[EDITABLE]} onDelete={vi.fn()} />,
    );
    open(screen.getByTestId(`manage-views-actions-${EDITABLE.id}`));
    expect(menuShape()).toEqual(['menuitem']);
    expect(screen.getByTestId(`manage-views-action-delete-${EDITABLE.id}`)).toBeInTheDocument();
  });
});

// --- ViewTabBar --------------------------------------------------------------

/** The console's admin prop set. */
function renderBar(views: ViewTabItem[], extra: Record<string, unknown> = {}) {
  render(
    <ViewTabBar
      views={views}
      activeViewId={views[0]?.id}
      onViewChange={vi.fn()}
      config={{ reorderable: false, showAddButton: false }}
      onRenameView={vi.fn()}
      onDeleteView={vi.fn()}
      onPinView={vi.fn()}
      onSetDefaultView={vi.fn()}
      onConfigView={vi.fn()}
      onManageViews={vi.fn()}
      {...extra}
    />,
  );
}

describe('ViewTabBar tab dropdown (#10209)', () => {
  it('a read-only tab opens on "Manage all views…" — no leading separator', () => {
    renderBar([READONLY]);
    open(screen.getByTestId(`view-tab-actions-${READONLY.id}`));
    expect(menuShape()).toEqual(['menuitem']);
    expect(screen.getByTestId(`view-tab-menu-manage-${READONLY.id}`)).toBeInTheDocument();
  });

  it('a read-only tab with no `onManageViews` renders NO trigger', () => {
    renderBar([READONLY], { onManageViews: undefined });
    expect(screen.queryByTestId(`view-tab-actions-${READONLY.id}`)).toBeNull();
  });

  it('reverse control: an editable tab keeps every entry, separators between groups', () => {
    renderBar([EDITABLE]);
    open(screen.getByTestId(`view-tab-actions-${EDITABLE.id}`));
    expect(menuShape()).toEqual([
      'menuitem', 'menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem', 'separator', 'menuitem',
    ]);
    for (const key of ['config', 'rename', 'default', 'pin', 'delete', 'manage']) {
      expect(screen.getByTestId(`view-tab-menu-${key}-${EDITABLE.id}`)).toBeInTheDocument();
    }
  });
});

describe('ViewTabBar tab context menu (#10209)', () => {
  function rightClick(label: string) {
    fireEvent.contextMenu(screen.getByText(label));
  }

  it('a read-only tab opens on "Manage all views…" — no leading separator', () => {
    renderBar([READONLY]);
    rightClick(READONLY.label);
    expect(menuShape()).toEqual(['menuitem']);
    expect(
      within(screen.getByRole('menu')).getByTestId(`context-menu-manage-${READONLY.id}`),
    ).toBeInTheDocument();
  });

  it('a read-only tab with no `onManageViews` opens no context menu at all', () => {
    renderBar([READONLY], { onManageViews: undefined });
    rightClick(READONLY.label);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('reverse control: an editable tab keeps every entry, separators between groups', () => {
    renderBar([EDITABLE]);
    rightClick(EDITABLE.label);
    expect(menuShape()).toEqual([
      'menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem', 'separator', 'menuitem',
    ]);
  });
});
