/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10664 (the census row for `object-data-table`) — the widget issues
 * ONE `find` per mount, that read already carries the lookup `$expand`, and a
 * column change that moves the expansion re-reads.
 *
 * Same shape as `object-map` on the card: the definition sat in a local
 * `useState` fed by its own effect and was listed in the fetch effect's
 * dependencies, so the query ran once before it landed (`computeLookupExpand`
 * returns nothing without a field map) and once after. The widget now reads the
 * definition through the shared `useSettledSchema` and its query waits on it,
 * the objectui#7895 / objectui#7903 gate.
 *
 * The second half is the other direction of the same mismatch: the query reads
 * `schema.columns` (the explicit whitelist decides which relations expand), and
 * the dependency list did not name it. It now keys on the expansion those
 * columns produce, so a relabelled column (same fields) is not a change.
 *
 * Rendered through the real `SchemaRenderer` and this package's registration.
 * The two SETTLES cases are the trap a gate can introduce, pinned: a widget
 * whose definition read throws, or whose adapter has no `getObjectSchema`, must
 * still load its rows.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-data-table`.
import '../index';

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));

const DEFINITION = {
  name: 'opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    account: { type: 'lookup', reference: 'accounts', label: 'Account' },
    owner_dept: { type: 'master_detail', reference: 'departments', label: 'Dept' },
  },
};

function makeDataSource(opts: { hold?: boolean; schema?: 'reject' | 'absent' } = {}) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const sequence: string[] = [];
  const ds: any = {
    sequence,
    release: () => release(),
    find: vi.fn(async () => {
      sequence.push('find');
      return { data: [{ id: 'o1', name: 'Acme' }], total: 1 };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  if (opts.schema !== 'absent') {
    ds.getObjectSchema = vi.fn(async () => {
      if (opts.hold) await held;
      if (opts.schema === 'reject') throw new Error('metadata unavailable');
      sequence.push('schema');
      return DEFINITION;
    });
  }
  return ds;
}

const expands = (ds: any) => ds.find.mock.calls.map((c: any[]) => c[1]?.$expand ?? null);

type HostHandle = { setColumns: (columns: unknown) => void };

/** Holds the widget's `columns` as state and rebuilds the node on every change. */
const Host = React.forwardRef<HostHandle, { ds: any; columns?: unknown }>(function Host({ ds, columns: initial }, ref) {
  const [columns, setColumns] = React.useState<unknown>(initial);
  React.useImperativeHandle(ref, () => ({ setColumns }), []);
  const schema = React.useMemo(
    () => ({ type: 'object-data-table', objectName: 'opportunity', ...(columns ? { columns } : {}) }),
    [columns],
  );
  return (
    <SchemaRendererProvider dataSource={ds}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>
  );
});

describe('object-data-table reads once per mount, expanded, and keys on its expansion (objectui#10664)', () => {
  it('SUBJECT: one `find` per mount, and it carries the lookup `$expand`', async () => {
    const ds = makeDataSource();
    render(<Host ds={ds} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    await settle();

    expect(expands(ds), 'a mount read the table more than once, or the first read went out unexpanded').toEqual([
      ['account', 'owner_dept'],
    ]);
  });

  it('SUBJECT: the query WAITS for the definition, then goes out once', async () => {
    const ds = makeDataSource({ hold: true });
    render(<Host ds={ds} />);
    await settle();
    expect(ds.find, 'the widget queried before its definition settled').not.toHaveBeenCalled();

    await act(async () => { ds.release(); });
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    await settle();

    expect(ds.sequence).toEqual(['schema', 'find']);
  });

  it('SUBJECT: a column change that moves the expansion re-reads, with the new `$expand`', async () => {
    const ds = makeDataSource();
    const host = React.createRef<HostHandle>();
    render(<Host ref={host} ds={ds} columns={[{ field: 'name' }, { field: 'account' }]} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    await settle();
    expect(expands(ds)).toEqual([['account']]);

    await act(async () => {
      host.current!.setColumns([{ field: 'name' }, { field: 'account' }, { field: 'owner_dept' }]);
    });
    await settle();

    expect(expands(ds), 'the new column never reached a read').toEqual([['account'], ['account', 'owner_dept']]);
  });

  it('CONTROL: a relabelled column (same fields) does not re-read', async () => {
    const ds = makeDataSource();
    const host = React.createRef<HostHandle>();
    render(<Host ref={host} ds={ds} columns={[{ field: 'name' }, { field: 'account' }]} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    await settle();
    const atRest = ds.find.mock.calls.length;

    await act(async () => {
      host.current!.setColumns([{ field: 'name', label: 'Deal' }, { field: 'account', label: 'Customer' }]);
    });
    await settle();

    expect(ds.find.mock.calls.length, 'a relabel re-read the table').toBe(atRest);
  });

  it('SETTLES ON A THROWN READ: a failed definition read still loads the rows, unexpanded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource({ schema: 'reject' });
    render(<Host ds={ds} />);
    // objectui#10657 PR 2: with no definition the untyped column is WITHHELD
    // (drawn as the mask, never as text), so the shown row is read by its mask.
    await waitFor(() => expect(document.querySelector('tbody')?.textContent ?? '').toContain('••••••'));
    expect(screen.queryByText('Acme')).toBeNull();
    await settle();

    expect(expands(ds)).toEqual([null]);
  });

  it('SETTLES WITH NO SOURCE: an adapter without `getObjectSchema` still loads the rows', async () => {
    const ds = makeDataSource({ schema: 'absent' });
    render(<Host ds={ds} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    await settle();

    expect(expands(ds)).toEqual([null]);
  });
});
