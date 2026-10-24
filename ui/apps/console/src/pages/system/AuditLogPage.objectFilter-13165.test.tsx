/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The audit log's Object filter is picked from the served objects, never typed
 * (objectui#13165).
 *
 * The filter was a free-text box under the placeholder "e.g. account", sent as
 * an exact `object_name` match. In an app whose objects carry a prefix the
 * placeholder's own example matched nothing: `account` listed 0 rows where
 * `crm_account` listed 11. Finding any object meant knowing its API name.
 *
 * The transport is stubbed at the seams the page reads through:
 *  - the console's metadata cache (`useMetadata().objects`) serves the
 *    objects. `nightly_widget` is a name no code names, so an option for it
 *    can only come from the served list, never from a list in the page.
 *    `sys_audit_log` is served too, as on a real console: its `action` field's
 *    declared options are what the Action filter offers (objectui#13175);
 *  - `fetch` answers `/data/sys_audit_log`, honouring `$filter` equality on
 *    `object_name`, `action` and `user_id`, and `$top` / `$skip`;
 *  - the console adapter (`useAdapter`) serves `sys_user` to the actor lookup.
 *
 * Pinned:
 *  - the filter is a combobox named by its "Object" label; it offers every
 *    served object by `Label (name)`, sorted, and no free-text box remains;
 *  - typing `account`, the card's own example, into the picker's search finds
 *    the Accounts object;
 *  - choosing Accounts sends `object_name` equal to `crm_account`, the API
 *    name, and lists only its rows;
 *  - choosing it again, or "Clear filters", removes the filter and lists every
 *    row again;
 *  - the Action and Actor filters join the object filter, and paging keeps it
 *    and restarts at the first page when the object changes.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { ADAPTER, ADMIN, OBJECTS } = vi.hoisted(() => {
  const ADMIN = { id: 'usr_admin_0001', name: 'Admin User', email: 'admin@objectos.ai' };
  return {
    ADMIN,
    ADAPTER: {
      find: async (objectName: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
        if (objectName !== 'sys_user') return { data: [], total: 0 };
        const wanted = params?.$filter?.id?.$in;
        const rows = wanted ? [ADMIN].filter((u) => wanted.includes(u.id)) : [ADMIN];
        return { data: rows.map((u) => ({ ...u })), total: rows.length };
      },
      findOne: async (objectName: string, id: string) =>
        objectName === 'sys_user' && id === ADMIN.id ? { ...ADMIN } : null,
      getObjectSchema: async (objectName: string) =>
        objectName === 'sys_user'
          ? { name: 'sys_user', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } }
          : undefined,
    },
    // Served out of label order, and one object with no label.
    OBJECTS: Object.freeze([
      { name: 'crm_contact', label: 'Contacts' },
      { name: 'nightly_widget' },
      { name: 'crm_account', label: 'Accounts' },
      {
        name: 'sys_audit_log',
        label: 'Audit Log',
        fields: {
          action: {
            type: 'select',
            label: 'Action',
            options: [
              { label: 'create', value: 'create' },
              { label: 'update', value: 'update' },
            ],
          },
        },
      },
    ]),
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: OBJECTS }),
}));

// Imported after the mocks so the page picks them up.
import { AuditLogPage } from './AuditLogPage';

interface LedgerRow {
  id: string;
  created_at: string;
  action: string;
  object_name: string;
  record_id: string;
  user_id: string | null;
}

/**
 * The stored ledger, newest first: two contact rows, then 55 account rows, so
 * the unfiltered first page holds both objects and the account rows alone fill
 * more than one page of 50.
 */
const LEDGER: LedgerRow[] = [
  { id: 'log_con_1', created_at: '2026-10-20T12:00:00.000Z', action: 'update', object_name: 'crm_contact', record_id: 'con_1', user_id: null },
  { id: 'log_con_2', created_at: '2026-10-20T11:59:00.000Z', action: 'create', object_name: 'crm_contact', record_id: 'con_2', user_id: null },
  ...Array.from({ length: 55 }, (_, i): LedgerRow => ({
    id: `log_acc_${i}`,
    created_at: new Date(Date.UTC(2026, 9, 20, 11, 0) - i * 60_000).toISOString(),
    action: i % 2 === 0 ? 'update' : 'create',
    object_name: 'crm_account',
    record_id: `acc_${i}`,
    user_id: i < 3 ? ADMIN.id : null,
  })),
];

/** Every `/data/sys_audit_log` request, as the parsed query string. */
let requests: URLSearchParams[] = [];

/** The `$filter` of the latest request, parsed, or null when it sent none. */
function lastFilter(): unknown {
  const raw = requests[requests.length - 1]?.get('$filter');
  return raw == null ? null : JSON.parse(raw);
}

beforeAll(() => {
  // Radix Select drives its trigger off pointer events, which happy-dom does
  // not implement: the shim the console's other Select-driving tests install.
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: { button?: number; ctrlKey?: boolean; pointerType?: string } & EventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = MockPointerEvent;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.scrollIntoView = vi.fn();
});

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input), 'http://console.test').searchParams;
      requests.push(query);
      const filter = JSON.parse(query.get('$filter') ?? '{}') as Partial<Record<'object_name' | 'action' | 'user_id', string>>;
      const top = Number(query.get('$top') ?? '1000');
      const skip = Number(query.get('$skip') ?? '0');
      const matched = LEDGER.filter(
        (r) =>
          (filter.object_name === undefined || r.object_name === filter.object_name) &&
          (filter.action === undefined || r.action === filter.action) &&
          (filter.user_id === undefined || r.user_id === filter.user_id),
      );
      const records = matched.slice(skip, skip + top);
      return new Response(JSON.stringify({ object: 'sys_audit_log', records, total: matched.length }), { status: 200 });
    }),
  );
});

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

/** The Object filter's trigger, named by its visible "Object" label. */
function objectTrigger(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Object' });
}

/** Open the Object filter's list. */
async function openObjectPicker(): Promise<void> {
  await act(async () => {
    fireEvent.click(objectTrigger());
  });
}

/** Pick an object by its option label. */
async function chooseObject(option: string): Promise<void> {
  await openObjectPicker();
  const item = await screen.findByRole('option', { name: option });
  await act(async () => {
    fireEvent.click(item);
  });
  await settle();
}

/** The object names of the listed rows, one per row. */
function listedObjects(): string[] {
  return screen
    .queryAllByRole('cell')
    .map((cell) => cell.textContent ?? '')
    .filter((text) => text === 'crm_account' || text === 'crm_contact');
}

function renderPage(): void {
  render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
}

describe('AuditLogPage — the object filter is picked, never typed (objectui#13165)', () => {
  it('offers every served object by its label and API name, sorted, and no free-text box remains', async () => {
    renderPage();
    await settle();

    expect(screen.queryByPlaceholderText('e.g. account')).toBeNull();
    expect(objectTrigger()).toHaveTextContent('Any object');

    await openObjectPicker();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Accounts (crm_account)', 'Audit Log (sys_audit_log)', 'Contacts (crm_contact)', 'nightly_widget']);
  });

  it("finds the Accounts object when the admin types the card's own example, `account`", async () => {
    renderPage();
    await settle();
    await openObjectPicker();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Search objects…'), { target: { value: 'account' } });
    });

    expect(screen.getByRole('option', { name: 'Accounts (crm_account)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Contacts (crm_contact)' })).toBeNull();
  });

  it('choosing Accounts sends object_name equal to crm_account and lists only its rows', async () => {
    renderPage();
    await waitFor(() => expect(listedObjects()).toContain('crm_contact'));

    await chooseObject('Accounts (crm_account)');

    await waitFor(() => expect(lastFilter()).toEqual({ object_name: 'crm_account' }));
    await waitFor(() => expect(listedObjects()).not.toContain('crm_contact'));
    expect(listedObjects()).toHaveLength(50);
    expect(new Set(listedObjects())).toEqual(new Set(['crm_account']));
    // The trigger names what is chosen, and the bar counts it.
    expect(objectTrigger()).toHaveTextContent('Accounts (crm_account)');
    expect(screen.getByRole('button', { name: /Clear filters \(1\)/ })).toBeInTheDocument();
  });

  it('choosing the chosen object again removes the filter and lists every object again', async () => {
    renderPage();
    await chooseObject('Accounts (crm_account)');
    await waitFor(() => expect(listedObjects()).not.toContain('crm_contact'));

    await chooseObject('Accounts (crm_account)');

    await waitFor(() => expect(lastFilter()).toBeNull());
    await waitFor(() => expect(listedObjects()).toContain('crm_contact'));
    expect(objectTrigger()).toHaveTextContent('Any object');
  });

  it('"Clear filters" removes the object filter and lists every object again', async () => {
    renderPage();
    await chooseObject('Contacts (crm_contact)');
    await waitFor(() => expect(listedObjects()).not.toContain('crm_account'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    });
    await settle();

    await waitFor(() => expect(lastFilter()).toBeNull());
    await waitFor(() => expect(listedObjects()).toContain('crm_account'));
    expect(objectTrigger()).toHaveTextContent('Any object');
  });

  it('the action filter joins the object filter', async () => {
    renderPage();
    await settle();

    // The Action select's trigger, found by what it reads.
    const actionTrigger = screen.getAllByRole('combobox').find((el) => el.textContent?.includes('All actions'));
    expect(actionTrigger, 'the action select is rendered').toBeTruthy();
    fireEvent.pointerDown(actionTrigger!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'update' }));
    });
    await settle();
    await chooseObject('Accounts (crm_account)');

    await waitFor(() => expect(lastFilter()).toEqual({ action: 'update', object_name: 'crm_account' }));
    expect(screen.getByRole('button', { name: /Clear filters \(2\)/ })).toBeInTheDocument();
  });

  it('the actor filter joins the object filter', async () => {
    renderPage();
    await settle();
    await chooseObject('Accounts (crm_account)');

    await act(async () => {
      fireEvent.click(screen.getByTestId('lookup-trigger-user_id'));
    });
    const admin = await screen.findByRole('option', { name: new RegExp(ADMIN.name) });
    await act(async () => {
      fireEvent.click(admin);
    });
    await settle();

    await waitFor(() => expect(lastFilter()).toEqual({ object_name: 'crm_account', user_id: ADMIN.id }));
    await waitFor(() => expect(listedObjects()).toHaveLength(3));
  });

  it('paging keeps the object filter, and a new object starts again at the first page', async () => {
    renderPage();
    await chooseObject('Accounts (crm_account)');
    await waitFor(() => expect(listedObjects()).toHaveLength(50));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    });
    await settle();

    await waitFor(() => expect(requests[requests.length - 1].get('$skip')).toBe('50'));
    expect(lastFilter()).toEqual({ object_name: 'crm_account' });
    await waitFor(() => expect(listedObjects()).toHaveLength(5));
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();

    await chooseObject('Contacts (crm_contact)');

    await waitFor(() => expect(lastFilter()).toEqual({ object_name: 'crm_contact' }));
    expect(requests[requests.length - 1].get('$skip')).toBe('0');
    await waitFor(() => expect(listedObjects()).toEqual(['crm_contact', 'crm_contact']));
  });
});
