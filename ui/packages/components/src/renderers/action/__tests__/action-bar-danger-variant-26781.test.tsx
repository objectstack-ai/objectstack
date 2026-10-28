/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26781 — a declared `danger` action on `action:bar` draws with
 * the destructive button style and confirms through the destructive button.
 *
 * The producer is `examples/app-todo`'s `DeleteCompletedAction`
 * (`delete_completed`: `locations: ['list_toolbar']`, `variant: 'danger'`,
 * `confirmText`). The list page hands an object's actions to `action:bar` as
 * they are served, and `action:bar` spreads each one onto an `action:button`
 * member with `variant: action.variant || schema.variant`. Before
 * objectstack#26779 the Button primitive had no `danger` variant, so that
 * member drew with no variant style and its confirm stayed neutral; the code
 * path is fixed by `toButtonVariant` / `toRunnerVariant` (`../runner-variant`).
 * `action-variant-confirm-26665.test.tsx` drives `action:button` / icon /
 * group / menu directly; this file drives the declared action through the bar.
 *
 * The two fixtures copy the app-todo literals key for key, `ai` block
 * included, because that is the shape the served metadata carries. The bar
 * copies `objectViewHeaderToolbar.ts`'s list toolbar (`location`, `size`,
 * `variant: 'outline'`), so the bar's own variant is in play. The control,
 * app-todo's `export_csv` from the same toolbar, declares no variant and draws
 * the bar's `outline`, which tells "the member drew its own variant" apart from
 * "every member draws destructive".
 *
 * The confirm is read from the confirm handler's own call, the artefact the
 * host's dialog (`ActionConfirmDialog` in `@object-ui/app-shell`) is drawn
 * from: `destructive: true` is what paints its confirm button destructive.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult, ConfirmationHandler } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports: `action:bar` resolves its members and its
// overflow menu through the ComponentRegistry at render time, and the light
// `dom` project does not load the `@object-ui/components` graph. Module scope,
// not a `beforeAll`, per AGENTS.md §测试纪律.
import '../action-bar';
import '../action-button';
import '../action-menu';

/** `examples/app-todo` `DeleteCompletedAction`, as declared. */
const DELETE_COMPLETED = {
  name: 'delete_completed',
  label: 'Delete Completed',
  objectName: 'todo_task',
  icon: 'trash',
  type: 'script',
  target: 'deleteCompletedTasks',
  locations: ['list_toolbar'],
  variant: 'danger',
  confirmText: 'Permanently delete all completed tasks? This cannot be undone.',
  successMessage: 'Completed tasks deleted!',
  refreshAfter: true,
  ai: {
    exposed: true,
    description:
      'Permanently delete every completed todo task. Destructive and irreversible — only after the user confirms.',
  },
};

/** `examples/app-todo` `ExportToCsvAction`, as declared: the same toolbar, no variant. */
const EXPORT_CSV = {
  name: 'export_csv',
  label: 'Export to CSV',
  objectName: 'todo_task',
  icon: 'download',
  type: 'script',
  target: 'exportTasksToCSV',
  locations: ['list_toolbar'],
  successMessage: 'Export completed!',
  refreshAfter: false,
  ai: {
    exposed: true,
    description: 'Export the current list of todo tasks to a downloadable CSV file.',
  },
};

let script: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let confirm: Mock<ConfirmationHandler>;

beforeEach(() => {
  script = vi.fn(async () => ({ success: true }));
  // A cancel: the question is what is measured, not the run.
  confirm = vi.fn(async () => false);
});

function renderToolbar() {
  const Bar = ComponentRegistry.get('action:bar');
  if (!Bar) throw new Error('action:bar is not registered');
  const schema = {
    type: 'action:bar',
    location: 'list_toolbar',
    actions: [DELETE_COMPLETED, EXPORT_CSV],
    size: 'sm',
    variant: 'outline',
  };
  render(
    <ActionProvider handlers={{ script }} onConfirm={confirm}>
      <Bar schema={schema as never} />
    </ActionProvider>,
  );
  return screen.getByRole('toolbar');
}

describe('action:bar draws and confirms a declared `danger` action destructive (objectstack#26781)', () => {
  it('the app-todo `delete_completed` member draws with the destructive button style', () => {
    const toolbar = renderToolbar();
    const del = within(toolbar).getByRole('button', { name: 'Delete Completed' });
    expect(del.className).toContain('bg-destructive');
    expect(del.className).not.toContain('border-input');
  });

  it('CONTROL: `export_csv` in the same bar declares no variant and draws the bar\'s `outline`', () => {
    const toolbar = renderToolbar();
    const csv = within(toolbar).getByRole('button', { name: 'Export to CSV' });
    expect(csv.className).toContain('border-input');
    expect(csv.className).not.toContain('bg-destructive');
  });

  it('clicking `delete_completed` asks its confirmText through the destructive confirm button', async () => {
    const toolbar = renderToolbar();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Delete Completed' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(script).not.toHaveBeenCalled();
    const [message, options] = confirm.mock.calls[0];
    expect(message).toBe(DELETE_COMPLETED.confirmText);
    expect(options).toEqual({
      title: 'Delete Completed',
      confirmText: 'Delete Completed',
      destructive: true,
    });
  });
});
