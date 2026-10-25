/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12528 nail 1 — the view's description rides on its tab.
 *
 * It used to take a row of its own above the list toolbar, so the toolbar sat
 * one line lower on every view that had a description. The host now hands it
 * on the tab item (`ViewTabItem.description`, already resolved and already
 * gated on `appearance.showDescription`), and the strip draws it on the ACTIVE
 * tab only: as the view button's tooltip and as the header of its ▾ menu.
 *
 * CONTROL: a view with no description draws neither, and the menu opens on
 * its first action exactly as before.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ViewTabBar } from '../ViewTabBar';
import type { ViewTabItem } from '../ViewTabBar';

afterEach(cleanup);

const DESCRIBED: ViewTabItem = {
  id: 'account.all',
  label: 'All Accounts',
  type: 'grid',
  description: 'Primary account list with revenue & industry summaries',
};
const PLAIN: ViewTabItem = { id: 'account.mine', label: 'My Accounts', type: 'grid' };

function renderBar(views: ViewTabItem[], activeViewId: string) {
  render(
    <ViewTabBar
      views={views}
      activeViewId={activeViewId}
      onViewChange={vi.fn()}
      onRenameView={vi.fn()}
      onManageViews={vi.fn()}
      config={{ reorderable: false, showAddButton: false }}
    />,
  );
}

function openTabMenu(view: ViewTabItem) {
  const trigger = screen.getByLabelText(`View actions for ${view.label}`);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('ViewTabBar — the active view description (objectui#12528)', () => {
  it('is the tooltip of the active tab trigger', () => {
    renderBar([DESCRIBED, PLAIN], DESCRIBED.id);

    expect(screen.getByTestId(`view-tab-${DESCRIBED.id}`)).toHaveAttribute(
      'title',
      DESCRIBED.description,
    );
  });

  it('heads the ▾ menu of the active tab', () => {
    renderBar([DESCRIBED, PLAIN], DESCRIBED.id);
    openTabMenu(DESCRIBED);

    expect(screen.getByTestId(`view-tab-menu-description-${DESCRIBED.id}`)).toHaveTextContent(
      DESCRIBED.description!,
    );
    // The actions are still there, below it.
    expect(screen.getByTestId(`view-tab-menu-rename-${DESCRIBED.id}`)).toBeInTheDocument();
  });

  it('is drawn on the active tab only', () => {
    renderBar([DESCRIBED, PLAIN], PLAIN.id);

    expect(screen.getByTestId(`view-tab-${DESCRIBED.id}`)).not.toHaveAttribute('title');
  });

  it('CONTROL: a view with no description draws no tooltip and no menu header', () => {
    renderBar([PLAIN, DESCRIBED], PLAIN.id);

    expect(screen.getByTestId(`view-tab-${PLAIN.id}`)).not.toHaveAttribute('title');
    openTabMenu(PLAIN);
    expect(screen.queryByTestId(`view-tab-menu-description-${PLAIN.id}`)).toBeNull();
    expect(screen.getByTestId(`view-tab-menu-rename-${PLAIN.id}`)).toBeInTheDocument();
  });
});
