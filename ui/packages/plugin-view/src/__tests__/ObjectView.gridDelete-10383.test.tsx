/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10383 — on the registered `object-view` path (no host list view),
 * the grid's row Delete and bulk Delete really delete.
 *
 * ## The defect this pins
 *
 * `ObjectGrid` hands the row (or the selection) to the consumer's `onDelete` /
 * `onBulkDelete` and performs no delete itself — the consumer owns confirm,
 * delete, toast and refresh. `ObjectView`'s two handlers ignored their argument
 * and only bumped the refresh counter, so a Delete the grid offers by default
 * called `dataSource.delete` zero times and the row came back after the
 * refresh. Measured against the pre-fix source with the REAL `ObjectGrid`:
 * row Delete and bulk Delete, `dataSource.delete` = 0 calls each.
 *
 * ## What "fixed" means here — the console list's behaviour
 *
 * The console's own list (`app-shell` `ObjectView` → `useObjectActions`) is
 * the behaviour matched, and every case below reads one of its steps:
 *  - a row asks "Are you sure you want to delete this record?"; a selection
 *    asks "Delete N selected records? This cannot be undone." once; the
 *    title names the row (or counts the selection) and the confirm button is
 *    a destructive "Delete" (objectui#11695);
 *  - Delete deletes through `dataSource.delete`, one call per record, and the
 *    row is gone after the refresh; Cancel deletes nothing;
 *  - success toasts `{{label}} deleted successfully` /
 *    `Deleted N {{label}} records`; a failure toasts `Failed to delete
 *    {{label}}` (with the error message) or `N deleted, M failed`;
 *  - whether the affordance is offered at all is `ObjectGrid`'s own verdict,
 *    the same one the console list rides: a principal without the delete grant
 *    sees neither the row Delete nor the bulk Delete on this path.
 *
 * Those steps are not re-implemented on this path: both hosts bind to ONE
 * record-delete core (`recordDelete`, `@object-ui/core`).
 *
 * Every case drives the real `ObjectGrid` through `ObjectView`, the way the
 * registered renderer composes them, against an in-memory data source whose
 * `delete` really removes the row — so "the row is gone" is read off the
 * refetched grid, not inferred from a spy.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// Stable stub identity (ObjectGrid carries `perms` in memo dependency arrays).
// `noProvider: true` runs the REAL provider-less hook — the fail-open path a
// standalone `object-view` runs on — and is every case's default; only the
// permission cases swap in the stub.
const { permsStub, permState } = vi.hoisted(() => {
  const permState = { permDelete: true, noProvider: true };
  return {
    permState,
    permsStub: {
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => undefined,
      can: (_obj: string, action: string) =>
        action === 'delete' ? permState.permDelete : true,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => {
      const real = actual.usePermissions();
      return permState.noProvider ? real : permsStub;
    },
  };
});

import { toast } from '@object-ui/components';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { ObjectView } from '../ObjectView';
import { installExplainDouble } from './explainDouble';

const OBJECT = 'test_object';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

let successSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  permState.permDelete = true;
  permState.noProvider = true;
  installExplainDouble();
  successSpy = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id' as never);
  errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
});

afterEach(() => {
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * An in-memory data source: `find` answers the CURRENT store, `delete` removes
 * the row — unless its id is listed in `failIds`, which rejects instead.
 */
function makeDataSource(failIds: string[] = []) {
  let store = [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
    { id: 'r3', name: 'Carol' },
  ];
  const ds = {
    find: vi.fn(async () => ({ data: store.map((r) => ({ ...r })), total: store.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(async (_object: string, id: string) => {
      if (failIds.includes(id)) throw new Error(`refused ${id}`);
      store = store.filter((r) => r.id !== id);
      return true;
    }),
    // Declared by the contract as optional; the console does not use it, so
    // neither does this path. Present here so a call would be observable.
    bulkDelete: vi.fn(async () => 0),
    getObjectSchema: vi.fn(async () => ({
      name: OBJECT,
      label: 'Test object',
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    })),
  };
  return ds;
}

function renderView(ds: ReturnType<typeof makeDataSource>, extra: Record<string, unknown> = {}) {
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectView
          schema={{
            type: 'object-view',
            objectName: OBJECT,
            table: { columns: ['name'] },
            ...extra,
          } as unknown as ObjectViewSchema}
          dataSource={ds as unknown as DataSource}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Wait for the rows, and for the object-schema-derived affordances to settle. */
async function settled() {
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  await waitFor(() =>
    expect(document.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(3),
  );
}

/** Open the row kebab of the row showing `label`; returns its Delete entry, or null. */
async function openRowMenu(label: string): Promise<HTMLElement | null> {
  const row = screen.getByText(label).closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return null;
  await userEvent.click(trigger);
  return screen.queryByTestId('row-action-builtin-delete');
}

/**
 * What the row kebab of `label` offers. Read by ROW, not by index, and only
 * after the menu opened — so "no Delete" is a reading of an open menu that
 * still offers Edit, never of a menu that did not open.
 */
async function rowMenuEntries(label: string): Promise<{ edit: boolean; delete: boolean }> {
  const row = screen.getByText(label).closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return { edit: false, delete: false };
  await userEvent.click(trigger);
  await screen.findByTestId('row-action-builtin-edit');
  const answer = {
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
  };
  await userEvent.keyboard('{Escape}');
  return answer;
}

/** Tick the rows showing `labels` (checkbox 0 is the header's select-all). */
function selectRows(labels: string[]) {
  for (const label of labels) {
    const row = screen.getByText(label).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
  }
}

async function confirmDialog(): Promise<HTMLElement> {
  return screen.findByRole('alertdialog');
}

describe('objectui#10383 — row Delete on the registered object-view path', () => {
  it('confirms, calls dataSource.delete for the row, and the row is gone after the refresh', async () => {
    const ds = makeDataSource();
    renderView(ds);
    await settled();

    const deleteItem = await openRowMenu('Alice');
    expect(deleteItem, 'the row kebab offers no Delete — the harness is not reaching the subject').not.toBeNull();
    await userEvent.click(deleteItem!);

    const dialog = await confirmDialog();
    expect(within(dialog).getByText('Are you sure you want to delete this record?')).toBeInTheDocument();
    // objectui#11695 — the title names the row and its object; the confirm is
    // a destructive Delete, not the generic "Confirm Action" / "Continue".
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Delete Test object "Alice"?');
    expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toContain('bg-destructive');
    expect(within(dialog).queryByRole('button', { name: 'Continue' })).toBeNull();
    // Nothing is deleted before the user answers.
    expect(ds.delete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(ds.delete).toHaveBeenCalledTimes(1));
    expect(ds.delete).toHaveBeenCalledWith(OBJECT, 'r1');
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(successSpy).toHaveBeenCalledWith('Test object deleted successfully');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('Cancel deletes nothing and the row stays', async () => {
    const ds = makeDataSource();
    renderView(ds);
    await settled();

    await userEvent.click((await openRowMenu('Alice'))!);
    const dialog = await confirmDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(ds.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(successSpy).not.toHaveBeenCalled();
  });

  it('a refused delete toasts the failure with its message, and the row stays', async () => {
    const ds = makeDataSource(['r1']);
    renderView(ds);
    await settled();

    await userEvent.click((await openRowMenu('Alice'))!);
    await userEvent.click(within(await confirmDialog()).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    expect(ds.delete).toHaveBeenCalledWith(OBJECT, 'r1');
    expect(errorSpy).toHaveBeenCalledWith('Failed to delete Test object', { description: 'refused r1' });
    expect(successSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

describe('objectui#10383 — bulk Delete on the registered object-view path', () => {
  it('confirms once for the selection, calls dataSource.delete per record, and the rows are gone', async () => {
    const ds = makeDataSource();
    renderView(ds);
    await settled();

    selectRows(['Alice', 'Bob']);
    fireEvent.click(await screen.findByTestId('bulk-action-delete'));

    const dialog = await confirmDialog();
    expect(
      within(dialog).getByText('Delete 2 selected records? This cannot be undone.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Delete 2 Test object records?');
    expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toContain('bg-destructive');
    expect(ds.delete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(ds.delete).toHaveBeenCalledTimes(2));
    expect(ds.delete).toHaveBeenCalledWith(OBJECT, 'r1');
    expect(ds.delete).toHaveBeenCalledWith(OBJECT, 'r2');
    expect(ds.bulkDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(successSpy).toHaveBeenCalledWith('Deleted 2 Test object records');
  });

  it('a partial failure reports "N deleted, M failed" and still refreshes', async () => {
    const ds = makeDataSource(['r2']);
    renderView(ds);
    await settled();

    selectRows(['Alice', 'Bob']);
    fireEvent.click(await screen.findByTestId('bulk-action-delete'));
    await userEvent.click(within(await confirmDialog()).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('1 deleted, 1 failed'));
    expect(ds.delete).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(successSpy).not.toHaveBeenCalled();
  });
});

describe('objectui#10383 — the affordance follows the same gate as the console list', () => {
  // Selection is authored ON in both cases, so the bulk bar's reading does not
  // depend on the implicit selection that a bulk Delete itself switches on.
  const SELECTABLE = { table: { columns: ['name'], selection: { type: 'multiple' } } };

  it('a principal WITH the delete grant is offered row Delete and bulk Delete (control)', async () => {
    permState.noProvider = false;
    permState.permDelete = true;
    renderView(makeDataSource(), SELECTABLE);
    await settled();

    expect(await rowMenuEntries('Bob')).toEqual({ edit: true, delete: true });
    selectRows(['Alice']);
    expect(await screen.findByTestId('bulk-action-delete')).toBeInTheDocument();
  });

  it('a principal WITHOUT the delete grant is offered neither', async () => {
    permState.noProvider = false;
    permState.permDelete = false;
    renderView(makeDataSource(), SELECTABLE);
    await settled();

    expect(await rowMenuEntries('Bob')).toEqual({ edit: true, delete: false });
    selectRows(['Alice']);
    expect(screen.queryByTestId('bulk-action-delete')).not.toBeInTheDocument();
  });
});

/**
 * objectui#11695 in a zh session: under a real `I18nProvider` this host's
 * translator is the session's, so the title and the Delete label come from the
 * zh pack — read here by KEY, so the pin is the keys and the named row, not
 * today's wording.
 */
describe('objectui#11695 — the row Delete names the row in zh', () => {
  const ZH = builtInLocales.zh as unknown as {
    objectActions: { deleteConfirmTitle: string; deleteConfirmButton: string };
  };

  it('shows the zh title naming the row and the zh destructive Delete, and deletes on it', async () => {
    const ds = makeDataSource();
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <ActionProvider>
          <SchemaRendererProvider dataSource={ds}>
            <ObjectView
              schema={{
                type: 'object-view',
                objectName: OBJECT,
                table: { columns: ['name'] },
              } as unknown as ObjectViewSchema}
              dataSource={ds as unknown as DataSource}
            />
          </SchemaRendererProvider>
        </ActionProvider>
      </I18nProvider>,
    );
    await settled();

    const deleteItem = await openRowMenu('Alice');
    expect(deleteItem, 'the row kebab offers no Delete — the harness is not reaching the subject').not.toBeNull();
    await userEvent.click(deleteItem!);

    const dialog = await confirmDialog();
    const title = ZH.objectActions.deleteConfirmTitle
      .replace('{{label}}', 'Test object')
      .replace('{{name}}', 'Alice');
    await waitFor(() => expect(within(dialog).getByRole('heading')).toHaveTextContent(title));
    const confirm = within(dialog).getByRole('button', { name: ZH.objectActions.deleteConfirmButton });
    expect(confirm.className).toContain('bg-destructive');

    await userEvent.click(confirm);
    await waitFor(() => expect(ds.delete).toHaveBeenCalledWith(OBJECT, 'r1'));
  });
});
