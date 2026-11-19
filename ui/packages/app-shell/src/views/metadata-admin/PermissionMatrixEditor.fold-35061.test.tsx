// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35061 (item 2) — the Studio Objects matrix under a narrow pane:
 * below 1000 px only Create / Read / Edit / Delete stay flat; the other six
 * permissions sit behind each row's "More permissions" (which counts the ones
 * on) and open in a row beneath; the bulk strip folds into one "Bulk" menu.
 *
 * jsdom applies no CSS, so both forms are in the DOM here and every control is
 * reachable: the tests pin which form each element belongs to (the classes the
 * pane's container query reads, `permissionMatrixFold.ts`) and that the folded
 * controls write and lock exactly as their flat twins do.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/formula';
import '@objectstack/lint';
import '@objectstack/spec/identity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { t } from './i18n';
import {
  PERM_BULK_COLUMN_WIDTH,
  PERM_FLAT_ONLY_CELL,
  PERM_FLAT_ONLY_FLEX,
  PERM_FOLDED_ONLY,
  PERM_MATRIX_FLAT_KEYS,
  PERM_MATRIX_FOLD_WIDTH,
  PERM_MATRIX_TABLE_FLOOR,
} from './permissionMatrixFold';

type FakeClient = Record<string, (...args: never[]) => unknown>;

let clientImpl: FakeClient;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

const en = (k: string) => t(k, 'en');

function makeClient(): FakeClient {
  return {
    layered: async () => ({
      effective: {
        name: 'project_editor',
        label: 'Project editor',
        // a_project: two of the six folded permissions on (Export, a read scope).
        objects: {
          a_project: { allowRead: true, allowExport: true, readScope: 'own' },
          b_task: { allowRead: true },
        },
        fields: {},
      },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    withPreviewDrafts() {
      return this;
    },
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'a_project', label: 'Project' } }, { item: { name: 'b_task', label: 'Task' } }] : [],
    get: async () => null,
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => payload,
  };
}

async function renderStudio(readOnly = false) {
  clientImpl = makeClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="project_editor"
        packageId="app.a"
        readOnly={readOnly}
        studio={{ tab: 'objects', onTabChange: () => {} }}
      />
    </MemoryRouter>,
  );
  await screen.findByTestId('perm-row-a_project', undefined, { timeout: 5000 });
}

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);
const hasAll = (el: Element, cls: string) => cls.split(' ').every((c) => classesOf(el).includes(c));

const FOLDED_ACTIONS = ['export', 'transfer', 'viewAll', 'modifyAll'] as const;
const box = (scope: HTMLElement, obj: string, action: string) =>
  within(scope).getByRole('checkbox', { name: `${obj} ${en(`perm.action.${action}`)}` });

async function openBulkMenu(obj: string) {
  const trigger = screen.getByTestId(`perm-bulk-menu-${obj}`);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

describe('the fold rule (objectstack#35061)', () => {
  it('every class string names the fold width, and the flat four are the CRUD columns', () => {
    for (const cls of [PERM_FLAT_ONLY_CELL, PERM_FOLDED_ONLY, PERM_FLAT_ONLY_FLEX, PERM_MATRIX_TABLE_FLOOR, PERM_BULK_COLUMN_WIDTH]) {
      expect(cls).toContain(`@min-[${PERM_MATRIX_FOLD_WIDTH}px]:`);
    }
    expect(PERM_MATRIX_FOLD_WIDTH).toBe(1000);
    expect([...PERM_MATRIX_FLAT_KEYS]).toEqual(['allowCreate', 'allowRead', 'allowEdit', 'allowDelete']);
  });
});

describe('the Studio Objects matrix, folded under 1000 px (objectstack#35061)', () => {
  it('draws only the four CRUD columns in both forms; the other six and the More column belong to one form each', async () => {
    await renderStudio();
    const table = screen.getByTestId('perm-studio-matrix');
    // The 1304 px floor is the flat form's alone.
    expect(hasAll(table, PERM_MATRIX_TABLE_FLOOR)).toBe(true);
    expect(classesOf(table)).not.toContain('min-w-[1304px]');

    const headers = Array.from(table.querySelectorAll('thead th'));
    const flatOnly = headers.filter((th) => th.getAttribute('data-perm-fold') === 'flat-only');
    expect(flatOnly).toHaveLength(6);
    for (const th of flatOnly) expect(hasAll(th, PERM_FLAT_ONLY_CELL)).toBe(true);
    for (const key of ['create', 'read', 'edit', 'delete']) {
      const th = headers.find((h) => h.getAttribute('title') === en(`perm.action.${key}`));
      expect(th).toBeDefined();
      expect(th!.getAttribute('data-perm-fold')).toBeNull();
      expect(classesOf(th!)).not.toContain('hidden');
    }
    const more = screen.getByTestId('perm-more-col');
    expect(more).toHaveTextContent(en('perm.more.col'));
    expect(hasAll(more, PERM_FOLDED_ONLY)).toBe(true);

    const row = screen.getByTestId('perm-row-a_project');
    const rowFlatOnly = Array.from(row.querySelectorAll('td[data-perm-fold="flat-only"]'));
    expect(rowFlatOnly).toHaveLength(6);
    for (const td of rowFlatOnly) expect(hasAll(td, PERM_FLAT_ONLY_CELL)).toBe(true);
  });

  it('the row button counts the folded permissions that are on, and opens them in a row beneath', async () => {
    await renderStudio();
    const toggle = screen.getByTestId('perm-more-toggle-a_project');
    expect(toggle).toHaveTextContent(en('perm.more.count').replace('{count}', '2'));
    expect(screen.getByTestId('perm-more-toggle-b_task')).toHaveTextContent(en('perm.more.count').replace('{count}', '0'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('perm-more-row-a_project')).toBeNull();

    fireEvent.click(toggle);
    const moreRow = await screen.findByTestId('perm-more-row-a_project');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(hasAll(moreRow, PERM_FOLDED_ONLY)).toBe(true);
    // Directly under its object row.
    expect(screen.getByTestId('perm-row-a_project').nextElementSibling).toBe(moreRow);
    // The six: four boxes, two scope pickers.
    for (const a of FOLDED_ACTIONS) expect(box(moreRow, 'a_project', a)).toBeInTheDocument();
    expect(within(moreRow).getAllByRole('checkbox')).toHaveLength(4);
    expect(within(moreRow).getByTestId('perm-scope-read-a_project')).toHaveTextContent(en('perm.scope.value.own'));
    expect(within(moreRow).getByTestId('perm-scope-write-a_project')).toBeInTheDocument();
    expect(box(moreRow, 'a_project', 'export')).toBeChecked();
  });

  it('a folded box writes the same grant as its flat twin, and the count follows', async () => {
    await renderStudio();
    fireEvent.click(screen.getByTestId('perm-more-toggle-b_task'));
    const moreRow = await screen.findByTestId('perm-more-row-b_task');
    const row = screen.getByTestId('perm-row-b_task');
    expect(box(row, 'b_task', 'transfer')).not.toBeChecked();
    fireEvent.click(box(moreRow, 'b_task', 'transfer'));
    await waitFor(() => expect(box(row, 'b_task', 'transfer')).toBeChecked());
    expect(box(moreRow, 'b_task', 'transfer')).toBeChecked();
    expect(screen.getByTestId('perm-more-toggle-b_task')).toHaveTextContent(en('perm.more.count').replace('{count}', '1'));
  });

  it('the strip is the flat form, the Bulk menu the folded one; the menu holds the strip four, in order, and writes what they write', async () => {
    await renderStudio();
    expect(hasAll(screen.getByTestId('perm-bulk-b_task'), PERM_FLAT_ONLY_FLEX)).toBe(true);
    const trigger = screen.getByTestId('perm-bulk-menu-b_task');
    expect(hasAll(trigger, PERM_FOLDED_ONLY)).toBe(true);
    expect(trigger).toHaveTextContent(en('perm.col.bulk'));

    const menu = await openBulkMenu('b_task');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      en('perm.bulk.all'),
      en('perm.bulk.read'),
      en('perm.bulk.none'),
      en('perm.bulk.crud'),
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: en('perm.bulk.crud') }));
    const row = screen.getByTestId('perm-row-b_task');
    await waitFor(() => {
      for (const a of ['create', 'read', 'edit', 'delete']) expect(box(row, 'b_task', a)).toBeChecked();
    });
  });

  it('on a read-only set the folded controls are locked exactly as their flat twins, and the folded row still opens to show them', async () => {
    await renderStudio(true);
    expect(screen.getByTestId('perm-bulk-menu-a_project')).toBeDisabled();
    const toggle = screen.getByTestId('perm-more-toggle-a_project');
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    const moreRow = await screen.findByTestId('perm-more-row-a_project');
    const row = screen.getByTestId('perm-row-a_project');
    for (const a of FOLDED_ACTIONS) {
      expect(box(moreRow, 'a_project', a)).toBeDisabled();
      expect(box(row, 'a_project', a)).toBeDisabled();
    }
    expect(within(moreRow).getByTestId('perm-scope-read-a_project')).toBeDisabled();
    expect(within(row).getByTestId('perm-scope-read-a_project')).toBeDisabled();
  });
});
