/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The audit log's Action filter offers `sys_audit_log.action`'s declared
 * options (objectui#13175).
 *
 * The filter was a hand-kept list of seven actions. The server declares more
 * and writes rows with them (`read`, `platform_admin_standing_change`,
 * `login_failed`, `account_locked`), so an admin could not narrow the log to
 * a refused sign-in or a lockout although such rows existed.
 *
 * The transport is stubbed at the seams the page reads through:
 *  - the console's metadata cache (`useMetadata().objects`) serves the
 *    `sys_audit_log` document. Its `action` field declares the options, some
 *    labelled apart from their value, and `nightly_purge`, a value no code
 *    names, so an option for it can only come from the served declaration;
 *  - `fetch` answers `/data/sys_audit_log`, honouring `$filter` equality on
 *    `action`;
 *  - the console adapter (`useAdapter`) serves `sys_user` to the actor lookup.
 *
 * Pinned:
 *  - the filter offers "All actions" and then every declared option, by its
 *    declared label, in declared order, and nothing else;
 *  - choosing a declared option sends its value as `action` and lists only its
 *    rows; "All actions" removes the filter;
 *  - a row whose action has no local badge tone shows a neutral badge, and a
 *    toned one keeps its tone;
 *  - with no `sys_audit_log` document served the filter offers only
 *    "All actions", never a list of its own.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { ADAPTER, DECLARED, METADATA } = vi.hoisted(() => {
  const DECLARED = Object.freeze([
    { value: 'create', label: 'create' },
    { value: 'read', label: 'read' },
    { value: 'login_failed', label: 'Sign-in refused' },
    { value: 'account_locked', label: 'Account locked' },
    { value: 'platform_admin_standing_change', label: 'platform_admin_standing_change' },
    { value: 'nightly_purge', label: 'Nightly purge' },
  ]);
  const AUDIT = Object.freeze({
    name: 'sys_audit_log',
    label: 'Audit Log',
    fields: {
      created_at: { type: 'datetime', label: 'Timestamp' },
      action: { type: 'select', label: 'Action', options: DECLARED },
      user_id: { type: 'lookup', reference: 'sys_user', label: 'User' },
    },
  });
  return {
    DECLARED,
    ADAPTER: {
      find: async () => ({ data: [], total: 0 }),
      findOne: async () => null,
      getObjectSchema: async () => undefined,
    },
    // Mutable per test: the served objects.
    METADATA: { objects: [{ name: 'crm_account', label: 'Accounts' }, AUDIT] as readonly unknown[] },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: METADATA.objects }),
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

/** The stored ledger, newest first: one row per action, two refused sign-ins. */
const LEDGER: LedgerRow[] = [
  { id: 'log_1', created_at: '2026-10-20T12:05:00.000Z', action: 'login_failed', object_name: 'sys_user', record_id: 'usr_1', user_id: null },
  { id: 'log_2', created_at: '2026-10-20T12:04:00.000Z', action: 'account_locked', object_name: 'sys_user', record_id: 'usr_1', user_id: null },
  { id: 'log_3', created_at: '2026-10-20T12:03:00.000Z', action: 'login_failed', object_name: 'sys_user', record_id: 'usr_2', user_id: null },
  { id: 'log_4', created_at: '2026-10-20T12:02:00.000Z', action: 'create', object_name: 'crm_account', record_id: 'acc_1', user_id: null },
  { id: 'log_5', created_at: '2026-10-20T12:01:00.000Z', action: 'nightly_purge', object_name: 'crm_account', record_id: 'acc_2', user_id: null },
];

/** Every `/data/sys_audit_log` request, as the parsed query string. */
let requests: URLSearchParams[] = [];

/** The `$filter` of the latest request, parsed, or null when it sent none. */
function lastFilter(): unknown {
  const raw = requests[requests.length - 1]?.get('$filter');
  return raw == null ? null : JSON.parse(raw);
}

const SERVED_OBJECTS = METADATA.objects;

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
  METADATA.objects = SERVED_OBJECTS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input), 'http://console.test').searchParams;
      requests.push(query);
      const filter = JSON.parse(query.get('$filter') ?? '{}') as Partial<Record<'action', string>>;
      const matched = LEDGER.filter((r) => filter.action === undefined || r.action === filter.action);
      return new Response(JSON.stringify({ object: 'sys_audit_log', records: matched, total: matched.length }), { status: 200 });
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

function renderPage(): void {
  render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
}

/** The Action filter's trigger: the select beside the filter bar's "Action" label. */
function actionTrigger(): HTMLElement {
  const trigger = screen.getByText('Action', { selector: 'label' }).parentElement?.querySelector<HTMLElement>('[role="combobox"]');
  expect(trigger, 'the Action select is rendered').toBeTruthy();
  return trigger!;
}

/** Open the Action filter and read its options, in order. */
async function openActionFilter(): Promise<string[]> {
  await act(async () => {
    fireEvent.pointerDown(actionTrigger(), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  await screen.findByRole('option', { name: 'All actions' });
  return screen.getAllByRole('option').map((o) => o.textContent ?? '');
}

/** Pick an action by its option label. */
async function chooseAction(label: string): Promise<void> {
  await openActionFilter();
  await act(async () => {
    fireEvent.click(screen.getByRole('option', { name: label }));
  });
  await settle();
}

/** The badges in the Action column, by row: their text and their classes. */
function actionBadges(): Array<{ text: string; classes: string[] }> {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelectorAll('td')[1]?.firstElementChild as HTMLElement | null)
    .filter((badge): badge is HTMLElement => badge != null)
    .map((badge) => ({ text: badge.textContent ?? '', classes: [...badge.classList] }));
}

describe('AuditLogPage — the action filter offers the declared actions (objectui#13175)', () => {
  it('offers "All actions" and then every declared option by its label, in declared order, and nothing else', async () => {
    renderPage();
    await settle();

    expect(actionTrigger()).toHaveTextContent('All actions');
    const offered = await openActionFilter();

    expect(offered).toEqual(['All actions', ...DECLARED.map((o) => o.label)]);
    // Actions the old hand-kept list offered and this server does not declare are absent.
    for (const undeclared of ['update', 'delete', 'login', 'logout', 'config_change', 'import']) {
      expect(offered).not.toContain(undeclared);
    }
  });

  it('choosing a declared option sends its value and lists only its rows; "All actions" removes the filter', async () => {
    renderPage();
    await waitFor(() => expect(actionBadges()).toHaveLength(LEDGER.length));

    await chooseAction('Sign-in refused');

    await waitFor(() => expect(lastFilter()).toEqual({ action: 'login_failed' }));
    await waitFor(() => expect(actionBadges().map((b) => b.text)).toEqual(['login_failed', 'login_failed']));
    expect(actionTrigger()).toHaveTextContent('Sign-in refused');
    expect(screen.getByRole('button', { name: /Clear filters \(1\)/ })).toBeInTheDocument();

    await chooseAction('Nightly purge');
    await waitFor(() => expect(lastFilter()).toEqual({ action: 'nightly_purge' }));
    await waitFor(() => expect(actionBadges().map((b) => b.text)).toEqual(['nightly_purge']));

    await chooseAction('All actions');
    await waitFor(() => expect(lastFilter()).toBeNull());
    await waitFor(() => expect(actionBadges()).toHaveLength(LEDGER.length));
  });

  it('a row whose action has no local tone shows the neutral badge, and a toned one keeps its tone', async () => {
    renderPage();
    await waitFor(() => expect(actionBadges()).toHaveLength(LEDGER.length));

    const toned = ['bg-primary', 'bg-secondary', 'bg-destructive'];
    for (const badge of actionBadges()) {
      if (badge.text === 'create') {
        expect(badge.classes).toContain('bg-primary');
        continue;
      }
      // login_failed, account_locked, nightly_purge: no local tone.
      expect(badge.classes, badge.text).toContain('text-foreground');
      for (const tone of toned) expect(badge.classes, badge.text).not.toContain(tone);
    }
  });

  it('with no sys_audit_log document served, offers only "All actions"', async () => {
    METADATA.objects = [{ name: 'crm_account', label: 'Accounts' }];
    renderPage();
    await settle();

    expect(await openActionFilter()).toEqual(['All actions']);
  });
});
