/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The browse-all record picker draws only the columns the user may read —
 * objectui#10373.
 *
 * Under the renderer-side FLS rulings (objectui#7215 / objectui#7230, applied
 * by the objectui#7429 sweep) field-level security gates the OUTPUT.
 * `RelatedList` gates both its `$expand` and the columns it draws
 * (`keepReadableColumns`); this picker gated only its `$expand`
 * (objectui#10223), so a column the policy denies was still headed and
 * rendered in every row, and a denied RELATION column, left out of `$expand`,
 * arrived as a bare key that the lookup cell renderer then resolved with a
 * read of its own.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub):
 *
 *  - a column the loaded policy denies is neither headed nor rendered, nor
 *    handed to a `renderGrid` slot; a denied relation column is not resolved
 *    row by row either;
 *  - the readable columns still render (the pin reads a FILTER);
 *  - with no policy loaded (no provider: `isLoaded` is false) nothing is
 *    filtered;
 *  - the display column is filtered like any other drawn column (the
 *    `keepReadableColumns` shape, no title exemption); the id column never is,
 *    and choosing a row still commits its id, even when the policy denies both;
 *  - a policy that leaves no column to draw draws the id column instead, so
 *    every row stays selectable;
 *  - a `titleFormat` naming a denied field does not render it in the display
 *    column;
 *  - a policy answer that changes after mount re-derives the drawn columns in
 *    the same mounted picker (`perms` is in the memo's dependencies).
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig } from '@object-ui/types';
import { RecordPickerDialog } from './RecordPickerDialog';
import type { RecordPickerGridSlotProps } from './RecordPickerDialog';
import { getCellRenderer } from '../index';

const ACCOUNT_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  code: { type: 'text', label: 'Code' },
  secret: { type: 'text', label: 'Secret' },
  region: { type: 'lookup', label: 'Region', reference: 'region' },
};

/**
 * A backend that does NOT strip denied keys (ObjectStack's `FieldMasker`
 * would) — the case this gate defends. It honours `$expand`.
 */
function makeBackend(prefix: string) {
  const regions: Record<string, { id: string; name: string }> = {};
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < 3; i++) {
    const regionId = `${prefix}_region_${i}`;
    regions[regionId] = { id: regionId, name: `Region ${i}` };
    rows.push({ id: `${prefix}_acct_${i}`, name: `Account ${i}`, code: `C-${i}`, secret: `S-${i}`, region: regionId });
  }
  const find = vi.fn(async (objectName: string, params?: Record<string, any>) => {
    if (objectName !== 'account') return { data: [], total: 0 };
    const expand: string[] = Array.isArray(params?.$expand) ? params!.$expand : [];
    const data = rows.map((r) => {
      const row = { ...r };
      if (expand.includes('region')) row.region = regions[r.region];
      return row;
    });
    return { data, total: rows.length };
  });
  const findOne = vi.fn(async (objectName: string, id: string) =>
    objectName === 'region' ? regions[id] ?? null : null,
  );
  return { find, findOne } as any;
}

type Backend = ReturnType<typeof makeBackend>;

function perRowReads(ds: Backend): number {
  const finds = ds.find.mock.calls.filter(([objectName]: [string]) => objectName !== 'account').length;
  return finds + ds.findOne.mock.calls.length;
}

/** A policy denying the named `account` fields to `viewer`. */
function policyDenying(...fields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object: 'account',
      roles: {
        viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
      },
    } as ObjectPermissionConfig,
  ];
}

function Picker({
  ds,
  columns,
  onSelect = () => {},
  renderGrid,
  titleFormat,
}: {
  ds: Backend;
  columns?: string[];
  onSelect?: (v: unknown) => void;
  renderGrid?: (p: RecordPickerGridSlotProps) => React.ReactNode;
  titleFormat?: string;
}) {
  return (
    <SchemaRendererContext.Provider value={{ dataSource: ds } as any}>
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName="account"
        columns={columns}
        onSelect={onSelect}
        cellRenderer={getCellRenderer}
        fieldsMeta={ACCOUNT_FIELDS}
        renderGrid={renderGrid}
        objectSchema={titleFormat ? { name: 'account', fields: ACCOUNT_FIELDS, titleFormat } : undefined}
      />
    </SchemaRendererContext.Provider>
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function cells(field: string): string[] {
  return Array.from(document.querySelectorAll(`[data-lookup-cell="${field}"]`)).map(
    (el) => el.textContent ?? '',
  );
}

function headers(): string[] {
  return screen.getAllByRole('columnheader').map((el) => el.textContent ?? '');
}

const ALL = ['name', 'code', 'secret', 'region'];

afterEach(() => {
  cleanup();
});

describe('RecordPickerDialog — the picker draws only readable columns (objectui#10373)', () => {
  it('a column the loaded policy denies is neither headed nor rendered; the readable ones still are', async () => {
    const ds = makeBackend('deny');
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policyDenying('secret')}>
        <Picker ds={ds} columns={ALL} />
      </PermissionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-deny_acct_0')).toBeInTheDocument());
    await settle();

    expect(cells('secret')).toEqual([]);
    expect(headers()).toEqual(['Name', 'Code', 'Region']);
    expect(cells('code')).toEqual(['C-0', 'C-1', 'C-2']);
    expect(cells('region')[0]).toBe('Region 0');
  });

  it('a denied relation column is neither rendered nor resolved row by row', async () => {
    const ds = makeBackend('rel');
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policyDenying('region')}>
        <Picker ds={ds} columns={ALL} />
      </PermissionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-rel_acct_0')).toBeInTheDocument());
    await settle();

    expect(ds.find.mock.calls.find(([o]: [string]) => o === 'account')![1].$expand).toBeUndefined();
    expect(cells('region')).toEqual([]);
    expect(perRowReads(ds)).toBe(0);
    expect(cells('secret')).toEqual(['S-0', 'S-1', 'S-2']);
  });

  it('a `renderGrid` slot is handed the readable columns', async () => {
    const ds = makeBackend('slot');
    const renderGrid = vi.fn((p: RecordPickerGridSlotProps) => <div data-testid="slot">{p.records.length}</div>);
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policyDenying('secret')}>
        <Picker ds={ds} columns={ALL} renderGrid={renderGrid} />
      </PermissionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('slot')).toHaveTextContent('3'));

    const last = renderGrid.mock.calls[renderGrid.mock.calls.length - 1][0];
    expect(last.columns.map((c) => c.field)).toEqual(['name', 'code', 'region']);
  });

  it('control: with no policy loaded (no provider) nothing is filtered', async () => {
    const ds = makeBackend('none');
    render(<Picker ds={ds} columns={ALL} />);
    await waitFor(() => expect(screen.getByTestId('record-row-none_acct_0')).toBeInTheDocument());
    await settle();

    expect(headers()).toEqual(['Name', 'Code', 'Secret', 'Region']);
    expect(cells('secret')).toEqual(['S-0', 'S-1', 'S-2']);
  });

  it('a denied display column is not drawn; the id column never is filtered, and a row click still selects', async () => {
    const ds = makeBackend('title');
    const onSelect = vi.fn();
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policyDenying('id', 'name', 'code')}>
        <Picker ds={ds} columns={['id', 'name', 'code', 'secret']} onSelect={onSelect} />
      </PermissionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-title_acct_1')).toBeInTheDocument());
    await settle();

    expect(headers()).toEqual(['Id', 'Secret']);
    expect(cells('name')).toEqual([]);
    expect(cells('code')).toEqual([]);
    expect(cells('id')).toEqual(['title_acct_0', 'title_acct_1', 'title_acct_2']);
    expect(document.body.textContent).not.toContain('Account 1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-row-title_acct_1'));
    });
    expect(onSelect).toHaveBeenCalledWith('title_acct_1');
  });

  it('a policy that leaves no column to draw draws the id column, and a row click still selects', async () => {
    const ds = makeBackend('only');
    const onSelect = vi.fn();
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policyDenying('name')}>
        {/* No `columns`: the picker draws only its display column. */}
        <Picker ds={ds} onSelect={onSelect} />
      </PermissionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-only_acct_2')).toBeInTheDocument());
    await settle();

    expect(headers()).toEqual(['Id']);
    expect(cells('name')).toEqual([]);
    expect(cells('id')).toEqual(['only_acct_0', 'only_acct_1', 'only_acct_2']);
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-row-only_acct_2'));
    });
    expect(onSelect).toHaveBeenCalledWith('only_acct_2');
  });

  it('a `titleFormat` naming a denied field does not render it in the display column', async () => {
    const ds = makeBackend('tf');
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policyDenying('secret')}>
        <Picker ds={ds} columns={['name', 'code']} titleFormat="{name} - {secret}" />
      </PermissionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('record-row-tf_acct_0')).toBeInTheDocument());
    await settle();

    expect(cells('name')).toEqual(['Account 0', 'Account 1', 'Account 2']);
    expect(document.body.textContent).not.toContain('S-0');
  });

  it('control: with no policy loaded, the same `titleFormat` renders every field it names', async () => {
    const ds = makeBackend('tfnone');
    render(<Picker ds={ds} columns={['name', 'code']} titleFormat="{name} - {secret}" />);
    await waitFor(() => expect(screen.getByTestId('record-row-tfnone_acct_0')).toBeInTheDocument());
    await settle();

    expect(cells('name')).toEqual(['Account 0 - S-0', 'Account 1 - S-1', 'Account 2 - S-2']);
  });

  it('a policy answer that changes after mount re-derives the drawn columns in place', async () => {
    const ds = makeBackend('late');
    function Host() {
      const [policy, setPolicy] = React.useState<ObjectPermissionConfig[]>([]);
      return (
        <>
          <button type="button" data-testid="deny-secret" onClick={() => setPolicy(policyDenying('secret'))} />
          <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policy}>
            <Picker ds={ds} columns={ALL} />
          </PermissionProvider>
        </>
      );
    }
    render(<Host />);
    await waitFor(() => expect(screen.getByTestId('record-row-late_acct_0')).toBeInTheDocument());
    await settle();
    expect(cells('secret')).toEqual(['S-0', 'S-1', 'S-2']);
    const table = screen.getByRole('grid');

    await act(async () => {
      fireEvent.click(screen.getByTestId('deny-secret'));
    });
    await settle();

    // The same mounted table, not a remount.
    expect(screen.getByRole('grid')).toBe(table);
    expect(cells('secret')).toEqual([]);
    expect(headers()).toEqual(['Name', 'Code', 'Region']);
  });
});
