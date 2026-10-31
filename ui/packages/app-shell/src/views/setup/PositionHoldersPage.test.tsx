// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → People & organization → Position holders (ADR-0146 D7): pick a
 * position from the registry's catalog, then list, add and remove its holders
 * through the section the position's item page renders. The picked position
 * lives in the URL; a refused write is shown in the server's own words, the
 * delegated-administration gate's included; a failed catalog read is a
 * failure, never "no positions".
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

let pickRecords: ((records: any[]) => void) | null = null;
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: (props: { onSelectRecords: (records: any[]) => void }) => {
    pickRecords = props.onSelectRecords;
    return null;
  },
}));

const positions = [
  { name: 'auditor', label: 'Auditor', description: 'Reads the books.' },
  { name: 'sales_rep', label: 'Sales rep' },
];
const users = [
  { id: 'u_1', name: 'Ada Auditor', email: 'ada@example.com' },
  { id: 'u_2', name: 'Bob Builder', email: 'bob@example.com' },
];
let assignments: Array<{ id: string; user_id: string; position: string }> = [];

const adapter = {
  find: vi.fn(async (object: string, query: any) => {
    if (object === 'sys_user_position') {
      return { data: assignments.filter((a) => a.position === query?.$filter?.position) };
    }
    if (object === 'sys_user') {
      const ids: string[] = query?.$filter?.id?.$in ?? [];
      return { data: users.filter((u) => ids.includes(u.id)) };
    }
    return { data: [] };
  }),
  create: vi.fn(async (_object: string, row: { user_id: string; position: string }) => {
    const created = { id: `up_${assignments.length + 10}`, ...row };
    assignments.push(created);
    return created;
  }),
  delete: vi.fn(async (_object: string, id: string) => {
    assignments = assignments.filter((a) => a.id !== id);
    return {};
  }),
};

let typeStatus: 'ready' | 'error' = 'ready';
const metadata = {
  objects: [],
  ensureType: vi.fn(async (type: string) => (type === 'position' && typeStatus === 'ready' ? positions : [])),
  getTypeStatus: vi.fn(() => typeStatus),
  refresh: vi.fn(async () => {}),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => metadata,
}));

import { PositionHoldersPage } from './PositionHoldersPage';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/component/security/position-holders${search}`]}>
      <PositionHoldersPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  assignments = [{ id: 'up_1', user_id: 'u_1', position: 'auditor' }];
  typeStatus = 'ready';
  pickRecords = null;
  adapter.find.mockClear();
  adapter.create.mockClear();
  adapter.delete.mockClear();
  metadata.ensureType.mockClear();
  metadata.refresh.mockClear();
});

afterEach(cleanup);

describe('Setup → Position holders', () => {
  it('lists the catalog positions and asks for a pick before reading any holder', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Positions' });
    expect(within(list).getByRole('button', { name: /Auditor/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Sales rep/ })).toBeInTheDocument();
    expect(screen.getByTestId('setup-position-holders-pick')).toBeInTheDocument();
    expect(metadata.ensureType).toHaveBeenCalledWith('position');
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('picking a position puts it in the URL and lists its holders', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Auditor/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('?position=auditor');
    expect(await screen.findByText('Ada Auditor')).toBeInTheDocument();
    expect(screen.getByText('Reads the books.')).toBeInTheDocument();
    expect(adapter.find).toHaveBeenCalledWith('sys_user_position', { $filter: { position: 'auditor' }, $top: 1000 });
  });

  it('adds a holder by name and the list reads it back', async () => {
    renderPage('?position=auditor');
    await screen.findByText('Ada Auditor');
    pickRecords!([{ id: 'u_2' }]);
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('sys_user_position', { user_id: 'u_2', position: 'auditor' }),
    );
    expect(await screen.findByText('Bob Builder')).toBeInTheDocument();
  });

  it('removes a holder after the confirm and the list reads it gone', async () => {
    renderPage('?position=auditor');
    await screen.findByText('Ada Auditor');
    fireEvent.click(screen.getByLabelText('Remove'));
    fireEvent.click(await screen.findByTestId('position-holder-remove-confirm'));
    await waitFor(() => expect(adapter.delete).toHaveBeenCalledWith('sys_user_position', 'up_1'));
    await waitFor(() => expect(screen.queryByText('Ada Auditor')).toBeNull());
    expect(screen.getByText('Nobody holds this position yet.')).toBeInTheDocument();
  });

  it("shows a delegated administrator's out-of-scope refusal verbatim", async () => {
    // The delegated-administration gate's refusal as the server throws it; the
    // console shows its sentence without the `[Security] ` machine prefix, as
    // every write refusal is read (`extractWriteErrorMessage`).
    const sentence = "Outside your delegated scope: assigning position 'auditor' — business unit 'bu_east' is outside the delegated subtree.";
    const refusal = Object.assign(new Error(`[Security] ${sentence}`), {
      code: 'DELEGATION_SCOPE_VIOLATION',
      httpStatus: 403,
    });
    adapter.create.mockRejectedValueOnce(refusal);
    renderPage('?position=auditor');
    await screen.findByText('Ada Auditor');
    pickRecords!([{ id: 'u_2' }]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(sentence);
    expect(screen.queryByText('Bob Builder')).toBeNull();
  });

  it('says a failed catalog read failed, never "no positions", and retries past the cache', async () => {
    typeStatus = 'error';
    renderPage('?position=auditor');
    expect(await screen.findByTestId('setup-position-holders-load-failed')).toHaveTextContent(
      'Could not read the positions.',
    );
    expect(screen.queryByTestId('setup-position-holders-empty')).toBeNull();
    expect(adapter.find).not.toHaveBeenCalled();

    typeStatus = 'ready';
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(metadata.refresh).toHaveBeenCalledWith('position');
    expect(await screen.findByText('Ada Auditor')).toBeInTheDocument();
  });

  it('says a URL naming no catalog position is not in the list, and reads no holder for it', async () => {
    renderPage('?position=ghost');
    expect(await screen.findByTestId('setup-position-holders-not-found')).toHaveTextContent(
      '"ghost" is not in this list.',
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('filters the list by label or name', async () => {
    renderPage();
    const filter = await screen.findByRole('textbox', { name: 'Filter positions' });
    fireEvent.change(filter, { target: { value: 'sales_' } });
    const list = screen.getByRole('list', { name: 'Positions' });
    expect(within(list).queryByRole('button', { name: /Auditor/ })).toBeNull();
    expect(within(list).getByRole('button', { name: /Sales rep/ })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches the filter.')).toBeInTheDocument();
  });
});
