/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36011 — a customized view of a read-only package
 * (`ViewTabItem.customized`) is marked "customized" in Manage views, and its
 * `…` menu offers "Restore factory version", which hands the view's id to the
 * host (`onRestoreFactory`; the host confirms and removes the override). A
 * view without a customization offers no restore and carries no mark; a host
 * that wires no `onRestoreFactory` offers it nowhere; a `readonly` row ignores
 * the flag.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ViewTabItem } from '../ViewTabBar';
import { ManageViewsDialog } from '../ManageViewsDialog';

afterEach(cleanup);

/** A factory view of a read-only package, customized (a pin written into its pair). */
const CUSTOMIZED: ViewTabItem = {
  id: 'showcase_task.default', label: 'All Tasks', type: 'grid', isPinned: true, definitionReadonly: true, customized: true,
};
/** A factory view of the same package nobody changed. */
const FACTORY: ViewTabItem = { id: 'showcase_task.in_progress', label: 'In progress', type: 'grid', definitionReadonly: true };
/** A view defined in code (read-only row): the flag is ignored. */
const SYSTEM: ViewTabItem = { id: 'showcase_task.system', label: 'System', type: 'grid', readonly: true, customized: true };

function renderDialog(extra: Record<string, unknown> = {}) {
  const onRestoreFactory = vi.fn();
  render(
    <ManageViewsDialog
      open
      onOpenChange={vi.fn()}
      views={[CUSTOMIZED, FACTORY, SYSTEM]}
      activeViewId={CUSTOMIZED.id}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onSetDefault={vi.fn()}
      onSetPinned={vi.fn()}
      onReorder={vi.fn()}
      onAddView={vi.fn()}
      onConfigView={vi.fn()}
      onRestoreFactory={onRestoreFactory}
      {...extra}
    />,
  );
  return { onRestoreFactory };
}

async function openMenu(id: string) {
  const trigger = screen.getByTestId(`manage-views-actions-${id}`);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
}

describe('Manage views: restore the factory version of a customized view (objectstack#36011)', () => {
  it('a customized row is marked and offers "Restore factory version", which hands its id to the host', async () => {
    const { onRestoreFactory } = renderDialog();

    expect(screen.getByTestId(`manage-views-customized-${CUSTOMIZED.id}`)).toHaveTextContent('customized');
    await openMenu(CUSTOMIZED.id);
    const entry = screen.getByTestId(`manage-views-action-restore-${CUSTOMIZED.id}`);
    expect(entry).toHaveTextContent('Restore factory version');
    fireEvent.click(entry);
    expect(onRestoreFactory).toHaveBeenCalledTimes(1);
    expect(onRestoreFactory).toHaveBeenCalledWith(CUSTOMIZED.id);
  });

  it('the ruling\'s offers stay on the customized row: rename, view config, pin; no Delete', async () => {
    renderDialog();
    await openMenu(CUSTOMIZED.id);
    const entries = ['rename', 'config', 'default', 'pin', 'restore', 'delete']
      .filter((key) => screen.queryByTestId(`manage-views-action-${key}-${CUSTOMIZED.id}`) !== null);
    expect(entries).toEqual(['rename', 'config', 'default', 'pin', 'restore']);
  });

  it('a view without a customization has no mark and offers no restore', async () => {
    renderDialog();
    expect(screen.queryByTestId(`manage-views-customized-${FACTORY.id}`)).toBeNull();
    await openMenu(FACTORY.id);
    expect(screen.queryByTestId(`manage-views-action-restore-${FACTORY.id}`)).toBeNull();
  });

  it('a read-only row ignores the flag: no mark, no menu', () => {
    renderDialog();
    expect(screen.queryByTestId(`manage-views-customized-${SYSTEM.id}`)).toBeNull();
    expect(screen.queryByTestId(`manage-views-actions-${SYSTEM.id}`)).toBeNull();
  });

  it('a host that wires no restore offers it nowhere, and keeps the mark', async () => {
    renderDialog({ onRestoreFactory: undefined });
    expect(screen.getByTestId(`manage-views-customized-${CUSTOMIZED.id}`)).toBeTruthy();
    await openMenu(CUSTOMIZED.id);
    expect(screen.queryByTestId(`manage-views-action-restore-${CUSTOMIZED.id}`)).toBeNull();
  });
});
