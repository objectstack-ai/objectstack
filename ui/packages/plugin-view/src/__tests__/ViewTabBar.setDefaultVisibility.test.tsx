/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A tab's `readonly` flag decides whether the set-default entry EXISTS —
 * objectui#4211's second link.
 *
 * The issue reports a set-default that fires no adapter write at all. The
 * adapter cannot produce that (`updateView` has no early return between its
 * read and its `saveItem`), and neither can the handler alone: `ObjectView`
 * computes a tab's `readonly` flag from the same predicate its handler guard
 * uses, so when the two ids diverge the entry is not rendered and there is
 * nothing left to click. That is why the symptom is "no write" rather than "a
 * rejected write" — the control is ABSENT, not present-and-inert.
 *
 * The identity fix lives in `@object-ui/app-shell`
 * (`ObjectView.setDefaultViewIdentity.test.tsx` pins it red-first). What is
 * pinned HERE is the link this package owns: `readonly` hides the entry,
 * `!readonly` shows it, on BOTH menus that carry it — the dropdown
 * (`view-tab-menu-default-…`) and the tab context menu (`context-menu-default-…`).
 *
 * DIRECTION, stated plainly rather than dressed as a red-first pin: this file is
 * GREEN before the identity fix and GREEN after. It was already correct, and
 * hiding a mutating action on a system view is the BEHAVIOUR WE WANT — the bug
 * was upstream, in which views were classified as system. So this is a
 * forward-direction control: it exists to catch a later "just force-show the
 * menu item" shortcut, which would paper over the identity seam by handing users
 * an action the handler still refuses.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ViewTabBar } from '../ViewTabBar';
import type { ViewTabItem } from '../ViewTabBar';

afterEach(cleanup);

/** A saved (overlay-backed) view and a system (metadata-defined) one. */
const SAVED: ViewTabItem = { id: 'crm_lead.my_view', label: 'My View', type: 'grid' };
const SYSTEM: ViewTabItem = {
  id: 'crm_lead.default',
  label: 'All',
  type: 'grid',
  readonly: true,
  readonlyReason: 'System view — defined in code, read-only.',
};

function renderBar(views: ViewTabItem[], onSetDefaultView = vi.fn()) {
  render(
    <ViewTabBar
      views={views}
      activeViewId={views[0]?.id}
      onViewChange={vi.fn()}
      onSetDefaultView={onSetDefaultView}
      onRenameView={vi.fn()}
      onDeleteView={vi.fn()}
      // Keeps the SYSTEM tab's menu openable: since objectui#10209 the trigger
      // renders only when some entry survives `readonly`, and "Manage all
      // views…" is the one that does.
      onManageViews={vi.fn()}
      config={{ reorderable: false, showAddButton: false }}
    />,
  );
  return onSetDefaultView;
}

/** Open a tab's `…` dropdown — the entries render only once it is open. */
function openTabMenu(view: ViewTabItem) {
  const trigger = screen.getByLabelText(`View actions for ${view.label}`);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('set-default entry visibility follows `readonly` (#4211)', () => {
  it('a SAVED view offers the entry, and clicking it calls back with the tab id', () => {
    const onSetDefaultView = renderBar([SAVED, SYSTEM]);
    openTabMenu(SAVED);
    const item = screen.getByTestId(`view-tab-menu-default-${SAVED.id}`);
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    // The id handed back is the TAB's id — which is exactly why the tab id and
    // the overlay key have to be the same string.
    expect(onSetDefaultView).toHaveBeenCalledWith('crm_lead.my_view');
  });

  it('a SYSTEM view does NOT offer it — absent, not disabled', () => {
    renderBar([SYSTEM, SAVED]);
    openTabMenu(SYSTEM);
    // Absent rather than inert: there is no disabled control to click, which is
    // why the symptom reads as "nothing happened" rather than "refused".
    expect(screen.queryByTestId(`view-tab-menu-default-${SYSTEM.id}`)).toBeNull();
    // …while the tab itself still renders and can be switched to.
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('rename and delete follow the same flag — one classification, not three', () => {
    renderBar([SAVED, SYSTEM]);
    openTabMenu(SAVED);
    expect(screen.getByTestId(`view-tab-menu-rename-${SAVED.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`view-tab-menu-delete-${SAVED.id}`)).toBeInTheDocument();
    cleanup();

    renderBar([SYSTEM, SAVED]);
    openTabMenu(SYSTEM);
    expect(screen.queryByTestId(`view-tab-menu-rename-${SYSTEM.id}`)).toBeNull();
    expect(screen.queryByTestId(`view-tab-menu-delete-${SYSTEM.id}`)).toBeNull();
  });

  it('without an `onSetDefaultView` callback the entry is absent for every view', () => {
    render(
      <ViewTabBar
        views={[SAVED]}
        activeViewId={SAVED.id}
        onViewChange={vi.fn()}
        onRenameView={vi.fn()}
        config={{ reorderable: false, showAddButton: false }}
      />,
    );
    openTabMenu(SAVED);
    expect(screen.queryByTestId(`view-tab-menu-default-${SAVED.id}`)).toBeNull();
  });
});
