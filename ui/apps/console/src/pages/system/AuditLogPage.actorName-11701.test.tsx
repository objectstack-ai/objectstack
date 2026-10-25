/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The audit log names the actor, and the actor filter is a user lookup
 * (objectui#11701).
 *
 * `sys_audit_log.user_id` is objectstack's lookup to `sys_user`. The page used
 * to print it as a truncated raw id and to filter on it with a free-text box,
 * so finding "what did this person change" meant knowing their id first.
 *
 * The transport is stubbed at both seams the page reads through:
 *  - `fetch` answers `/data/sys_audit_log` the way the engine answers
 *    `$expand=user_id`. A user it could read is put in place of the id. A user
 *    it could not read keeps the bare id. `$filter` on `user_id` is honoured,
 *    so a filtered request lists only that user's rows.
 *  - the console adapter (`useAdapter`) serves `sys_user` to the filter's
 *    lookup.
 *
 * Pinned:
 *  - the list fetch asks for the expansion;
 *  - a change by the seeded admin shows "Admin User", with the id on hover;
 *  - a user the engine could not resolve shows the id, never a blank;
 *  - a change no user made reads "System", with the principal on hover;
 *  - the drawer names the actor and keeps the full id;
 *  - choosing the admin in the filter sends `user_id` equal to the admin's id,
 *    and the admin's row is listed;
 *  - removing the chosen user removes the filter.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { ADMIN, OTHER, ADAPTER } = vi.hoisted(() => {
  // OTHER has no ledger rows: the lookup lists more than the one user it is asked for.
  const ADMIN = { id: 'usr_admin_0001', name: 'Admin User', email: 'admin@objectos.ai' };
  const OTHER = { id: 'usr_other_0002', name: 'Olive Other', email: 'olive@example.com' };
  const USERS = [ADMIN, OTHER];
  const ADAPTER = {
    find: vi.fn(async (objectName: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
      if (objectName !== 'sys_user') return { data: [], total: 0 };
      const wanted = params?.$filter?.id?.$in;
      const rows = wanted ? USERS.filter((u) => wanted.includes(u.id)) : USERS;
      return { data: rows.map((u) => ({ ...u })), total: rows.length };
    }),
    findOne: vi.fn(async (objectName: string, id: string) => {
      const row = objectName === 'sys_user' ? USERS.find((u) => u.id === id) : undefined;
      return row ? { ...row } : null;
    }),
    getObjectSchema: vi.fn(async (objectName: string) =>
      objectName === 'sys_user'
        ? { name: 'sys_user', nameField: 'name', fields: { name: { type: 'text', label: 'Name' }, email: { type: 'email', label: 'Email' } } }
        : undefined,
    ),
  };
  return { ADMIN, OTHER, ADAPTER };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

import { AuditLogPage } from './AuditLogPage';

/** The stored ledger: user ids, as `sys_audit_log` holds them. */
const LEDGER = [
  { id: 'log_admin', created_at: '2026-10-06T10:00:00.000Z', action: 'update', object_name: 'account', record_id: 'acc_1', user_id: ADMIN.id, actor: ADMIN.id },
  { id: 'log_gone', created_at: '2026-10-06T09:00:00.000Z', action: 'delete', object_name: 'contact', record_id: 'con_1', user_id: 'usr_gone_0009', actor: 'usr_gone_0009' },
  { id: 'log_system', created_at: '2026-10-06T08:00:00.000Z', action: 'create', object_name: 'invoice', record_id: 'inv_1', user_id: null, actor: 'svc:nightly_sync' },
];

/** What the engine can resolve: the gone user's record no longer exists. */
const READABLE_USERS = new Map([ADMIN, OTHER].map((u) => [u.id, u]));

/** Every `/data/sys_audit_log` request, as the parsed query string. */
let requests: URLSearchParams[] = [];

function stubTransport(): void {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://console.test');
      requests.push(url.searchParams);
      const filter = JSON.parse(url.searchParams.get('$filter') ?? '{}') as { user_id?: string };
      const expand = url.searchParams.get('$expand') === 'user_id';
      const records = LEDGER
        .filter((r) => filter.user_id === undefined || r.user_id === filter.user_id)
        .map((r) => ({
          ...r,
          user_id: expand && r.user_id ? (READABLE_USERS.get(r.user_id) ?? r.user_id) : r.user_id,
        }));
      return new Response(JSON.stringify({ object: 'sys_audit_log', records, total: records.length }), { status: 200 });
    }),
  );
}

beforeEach(stubTransport);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** The table row for one audit entry, found by its object name cell. */
async function rowOf(objectName: string): Promise<HTMLElement> {
  const cell = await screen.findByRole('cell', { name: objectName });
  return cell.closest('tr') as HTMLElement;
}

/** The actor cell of a row: the fifth column (Timestamp, Action, Object, Record, Actor, IP). */
function actorCell(row: HTMLElement): HTMLElement {
  return within(row).getAllByRole('cell')[4];
}

describe('AuditLogPage — the actor is named (objectui#11701)', () => {
  it('asks for the actor on the list fetch itself', async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    await rowOf('account');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((q) => q.get('$expand') === 'user_id')).toBe(true);
  });

  it("shows the seeded admin's name in the actor column, with the id on hover", async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    const cell = actorCell(await rowOf('account'));
    expect(cell).toHaveTextContent('Admin User');
    expect(cell).not.toHaveTextContent(ADMIN.id);
    expect(within(cell).getByText('Admin User')).toHaveAttribute('title', ADMIN.id);
  });

  it('shows the id of a user the engine could not resolve, never a blank', async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    const cell = actorCell(await rowOf('contact'));
    expect(cell).toHaveTextContent('usr_gone_0009');
    expect(within(cell).getByText('usr_gone_0009')).toHaveAttribute('title', 'usr_gone_0009');
  });

  it('reads "System" for a change no user made, with the principal on hover', async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    const cell = actorCell(await rowOf('invoice'));
    expect(within(cell).getByText('System')).toHaveAttribute('title', 'svc:nightly_sync');
  });

  it('names the actor in the drawer and keeps the full id', async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    fireEvent.click(await rowOf('account'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Admin User')).toBeInTheDocument();
    expect(within(drawer).getByText(ADMIN.id)).toBeInTheDocument();
  });
});

describe('AuditLogPage — the actor filter is a user lookup (objectui#11701)', () => {
  /** Open the actor lookup and pick a user by name. */
  async function chooseActor(name: string): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId('lookup-trigger-user_id'));
    });
    const option = await screen.findByRole('option', { name: new RegExp(name) });
    // The lookup lists the user directory, not only the user being chosen.
    expect(screen.getByRole('option', { name: new RegExp(OTHER.name) })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(option);
    });
    await settle();
  }

  it("choosing the admin sends user_id equal to the admin's id, and lists the admin's row", async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    await rowOf('contact');
    await chooseActor('Admin User');

    await waitFor(() =>
      expect(JSON.parse(requests[requests.length - 1].get('$filter') ?? '{}')).toEqual({ user_id: ADMIN.id }),
    );
    expect(requests[requests.length - 1].get('$expand')).toBe('user_id');
    expect(actorCell(await rowOf('account'))).toHaveTextContent('Admin User');
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'contact' })).toBeNull());
    expect(screen.queryByRole('cell', { name: 'invoice' })).toBeNull();
    // The lookup names who is chosen.
    expect(screen.getByRole('button', { name: 'Remove Admin User' })).toBeInTheDocument();
  });

  it('removing the chosen user removes the filter', async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    await rowOf('contact');
    await chooseActor('Admin User');
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'contact' })).toBeNull());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Admin User' }));
    });
    await settle();

    await waitFor(() => expect(requests[requests.length - 1].get('$filter')).toBeNull());
    expect(await screen.findByRole('cell', { name: 'contact' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Admin User' })).toBeNull();
  });
});
