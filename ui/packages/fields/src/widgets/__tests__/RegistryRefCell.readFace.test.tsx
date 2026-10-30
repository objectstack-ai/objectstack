/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27861 — the READ face of `position-ref` / `permission-ref`.
 *
 * `sys_user_permission_set.permission_set` and `sys_user_position.position`
 * are by-name text columns declaring those widgets. A list or detail cell of
 * either drew the stored api name (`organization_admin_no_bypass`); it now
 * draws the registry label, with the name on `title`, from the catalog the
 * edit widget lists (`listMetadataItems`), read once for every cell.
 *
 * A name the catalog does not hold — or holds without a label — still draws as
 * the name, and so does every state with no answer yet: no data source, a
 * catalog still loading, a catalog that failed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { getCellRenderer, resolveCellRendererType } from '../../index';
import { PermissionRefCell, PositionRefCell } from '../RegistryRefCell';

const PERMISSION_SETS = [
  { name: 'organization_admin_no_bypass', label: 'Organization Admin' },
  { name: 'admin_full_access', label: 'Full Access' },
  // An item whose author wrote no label reads as its name alone.
  { name: 'auditor' },
];
const POSITIONS = [
  { name: 'sales_rep', label: 'Sales Representative' },
  { name: 'sales_manager', label: 'Sales Manager' },
];

function lister(answer: (type: string) => Promise<Array<{ name: string; label?: string }>>) {
  return { listMetadataItems: vi.fn(answer), find: vi.fn() } as any;
}

const FIELD = { name: 'permission_set', type: 'text', label: 'Permission Set', widget: 'permission-ref' } as any;

function mountCells(Cell: typeof PermissionRefCell, values: unknown[], dataSource?: unknown) {
  const cells = values.map((value, i) => (
    <div key={i} data-testid={`cell-${i}`}>
      <Cell value={value} field={FIELD} />
    </div>
  ));
  return render(dataSource ? <SchemaRendererProvider dataSource={dataSource}>{cells}</SchemaRendererProvider> : <>{cells}</>);
}

function cellText(i: number): HTMLElement {
  return screen.getByTestId(`cell-${i}`).firstElementChild as HTMLElement;
}

afterEach(() => cleanup());

describe('objectstack#27861 — the declared widget picks the registry read face', () => {
  it('promotes a textual field declaring `permission-ref` / `position-ref` to its own key and face', () => {
    expect(resolveCellRendererType({ type: 'text', widget: 'permission-ref' })).toBe('permission-ref');
    expect(resolveCellRendererType({ type: 'text', widget: 'position-ref' })).toBe('position-ref');
    expect(getCellRenderer('permission-ref')).toBe(PermissionRefCell);
    expect(getCellRenderer('position-ref')).toBe(PositionRefCell);
    // Control: a non-textual base type keeps its own key.
    expect(resolveCellRendererType({ type: 'select', widget: 'permission-ref' })).toBe('select');
  });
});

describe('objectstack#27861 — `permission-ref` cells draw the set label', () => {
  it("draws each set's label with its api name on title, from ONE catalog read shared by every cell", async () => {
    const ds = lister(async () => PERMISSION_SETS);
    mountCells(PermissionRefCell, ['organization_admin_no_bypass', 'admin_full_access', 'organization_admin_no_bypass'], ds);

    await waitFor(() => expect(cellText(0)).toHaveTextContent('Organization Admin'));
    expect(cellText(0)).toHaveAttribute('title', 'organization_admin_no_bypass');
    expect(cellText(1)).toHaveTextContent('Full Access');
    expect(cellText(1)).toHaveAttribute('title', 'admin_full_access');
    expect(cellText(2)).toHaveTextContent('Organization Admin');

    expect(ds.listMetadataItems).toHaveBeenCalledTimes(1);
    expect(ds.listMetadataItems).toHaveBeenCalledWith('permission');
  });

  it('a cell mounting after the catalog settled draws the label on its first render, with no second read', async () => {
    const ds = lister(async () => PERMISSION_SETS);
    mountCells(PermissionRefCell, ['admin_full_access'], ds);
    await waitFor(() => expect(cellText(0)).toHaveTextContent('Full Access'));
    cleanup();

    mountCells(PermissionRefCell, ['organization_admin_no_bypass'], ds);
    expect(cellText(0)).toHaveTextContent('Organization Admin');
    expect(ds.listMetadataItems).toHaveBeenCalledTimes(1);
  });
});

describe('objectstack#27861 — `position-ref` cells draw the position label', () => {
  it("draws each position's label with its api name on title, reading the `position` registry", async () => {
    const ds = lister(async () => POSITIONS);
    mountCells(PositionRefCell, ['sales_manager', 'sales_rep'], ds);

    await waitFor(() => expect(cellText(0)).toHaveTextContent('Sales Manager'));
    expect(cellText(0)).toHaveAttribute('title', 'sales_manager');
    expect(cellText(1)).toHaveTextContent('Sales Representative');
    expect(cellText(1)).toHaveAttribute('title', 'sales_rep');
    expect(ds.listMetadataItems).toHaveBeenCalledTimes(1);
    expect(ds.listMetadataItems).toHaveBeenCalledWith('position');
  });
});

describe('objectstack#27861 — THE FALLBACK: a name the catalog cannot label draws as the name', () => {
  it('a name the catalog does not list renders the name itself, beside a listed one that resolves', async () => {
    const ds = lister(async () => PERMISSION_SETS);
    mountCells(PermissionRefCell, ['retired_set', 'admin_full_access', 'auditor'], ds);

    // The listed sibling resolving proves the catalog answered before the
    // unknown name is judged.
    await waitFor(() => expect(cellText(1)).toHaveTextContent('Full Access'));
    expect(cellText(0)).toHaveTextContent(/^retired_set$/);
    expect(cellText(0)).toHaveAttribute('title', 'retired_set');
    // Listed without a label: the name alone, too.
    expect(cellText(2)).toHaveTextContent(/^auditor$/);
  });

  it('with no data source that can list a registry, the cell draws the name', () => {
    mountCells(PermissionRefCell, ['admin_full_access']);
    expect(cellText(0)).toHaveTextContent(/^admin_full_access$/);
    expect(cellText(0)).toHaveAttribute('title', 'admin_full_access');
  });

  it('while the catalog loads the cell draws the name', () => {
    const ds = lister(() => new Promise(() => {}));
    mountCells(PermissionRefCell, ['admin_full_access'], ds);
    expect(cellText(0)).toHaveTextContent(/^admin_full_access$/);
  });

  it('a failed catalog draws the name, and is not kept: the next cell asks again', async () => {
    let fail = true;
    const ds = lister(async () => {
      if (fail) throw new Error('403');
      return PERMISSION_SETS;
    });
    mountCells(PermissionRefCell, ['admin_full_access'], ds);
    await waitFor(() => expect(ds.listMetadataItems).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(cellText(0)).toHaveTextContent(/^admin_full_access$/);
    cleanup();

    fail = false;
    mountCells(PermissionRefCell, ['admin_full_access'], ds);
    await waitFor(() => expect(cellText(0)).toHaveTextContent('Full Access'));
    expect(ds.listMetadataItems).toHaveBeenCalledTimes(2);
  });

  it('an empty value draws the shared No-value glyph and reads nothing', () => {
    const ds = lister(async () => PERMISSION_SETS);
    mountCells(PermissionRefCell, [null, ''], ds);
    expect(cellText(0)).toHaveAttribute('data-slot', 'empty-value');
    expect(cellText(1)).toHaveAttribute('data-slot', 'empty-value');
    expect(ds.listMetadataItems).not.toHaveBeenCalled();
  });
});
