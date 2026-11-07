// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The list under the Connect an Agent setup steps: the AI assistants the
 * signed-in person authorized, and their API keys.
 *
 *  - §1 assistants come from `oauth.authorizedClients.list()`: name (or the
 *    client id when the client declares none), the granted scopes in the
 *    consent page's own words, when authorized, and "in the hour from" the
 *    recorded last use or "not recorded"; the organization only when it is
 *    not the active one; and no Revoke control on an assistant row;
 *  - §2 keys are the person's OWN `sys_api_key` rows: the read filters on the
 *    signed-in user (a platform administrator's unfiltered read answers every
 *    person's keys) and never selects the secret; revoked and expired keys
 *    carry their state and no Revoke;
 *  - §3 Revoke on an active key asks first, naming the key; Cancel writes
 *    nothing; confirming writes `revoked: true` and the list re-reads in place;
 *  - §4 empty, failed and signed-out states.
 *
 * `t` echoes the key with any interpolation values appended, so assertions
 * read which string was asked for and with what.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const vals = opts ? Object.values(opts).filter((v) => typeof v === 'string' || typeof v === 'number') : [];
      return vals.length ? `«${key}|${vals.join('|')}»` : `«${key}»`;
    },
    language: 'en',
  }),
}));

let adapter: unknown = null;
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
}));

let authUser: { id: string } | null = { id: 'user_me' };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: authUser,
    activeOrganization: { id: 'org_here', name: 'Here Inc' },
    organizations: [
      { id: 'org_here', name: 'Here Inc' },
      { id: 'org_other', name: 'Other Ltd' },
    ],
  }),
}));

import { notifyDataChanged } from '@object-ui/react';
import { AuthorizedAccessList } from './AuthorizedAccessList';

type Row = Record<string, unknown>;

const CLIENTS = [
  {
    id: 'consent_1',
    clientId: 'client_cursor',
    name: 'Cursor',
    scopes: ['data:read', 'offline_access'],
    organizationId: 'org_here',
    authorizedAt: '2026-11-06T21:12:21.007Z',
    lastUsedAt: null,
  },
  {
    id: 'consent_2',
    clientId: 'client_desktop',
    name: 'Claude Desktop',
    scopes: ['data:read', 'data:write', 'made:up'],
    organizationId: 'org_other',
    authorizedAt: '2026-11-06T21:12:20.843Z',
    lastUsedAt: '2026-11-06T21:00:00.000Z',
  },
  {
    id: 'consent_3',
    clientId: 'client_nameless',
    name: null,
    scopes: [],
    organizationId: null,
    authorizedAt: null,
    lastUsedAt: null,
  },
];

const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
let keyRows: Row[];
let listMock: ReturnType<typeof vi.fn>;
let findMock: ReturnType<typeof vi.fn>;
let updateMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authUser = { id: 'user_me' };
  keyRows = [
    { id: 'k_active', name: 'ci key', prefix: 'osk_abc', created_at: '2026-11-01T10:00:00.000Z', last_used_at: '2026-11-06T21:12:47.191Z', expires_at: FAR_FUTURE, revoked: false },
    { id: 'k_unused', name: 'spare key', prefix: 'osk_def', created_at: '2026-11-02T10:00:00.000Z', last_used_at: null, expires_at: null, revoked: false },
    { id: 'k_revoked', name: 'old key', prefix: 'osk_ghi', created_at: '2026-10-01T10:00:00.000Z', last_used_at: null, expires_at: FAR_FUTURE, revoked: true },
    { id: 'k_expired', name: 'stale key', prefix: 'osk_jkl', created_at: '2026-01-01T10:00:00.000Z', last_used_at: null, expires_at: '2026-02-01T00:00:00.000Z', revoked: false },
  ];
  listMock = vi.fn(async () => ({ clients: CLIENTS, truncated: false }));
  findMock = vi.fn(async () => ({ data: keyRows.map((r) => ({ ...r })) }));
  updateMock = vi.fn(async (resource: string, id: string, patch: Row) => {
    keyRows = keyRows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    // What the console's mutation bridge does for every adapter write.
    notifyDataChanged({ objectName: resource, recordId: id });
    return keyRows.find((r) => r.id === id);
  });
  adapter = {
    getClient: () => ({ oauth: { authorizedClients: { list: listMock } } }),
    find: findMock,
    update: updateMock,
  };
});

afterEach(() => {
  cleanup();
});

async function renderSettled() {
  render(<AuthorizedAccessList />);
  await screen.findAllByTestId('authorized-assistant');
  await screen.findAllByTestId('api-key-row');
}

function assistantRow(name: string): HTMLElement {
  const row = screen.getAllByTestId('authorized-assistant').find((el) => el.textContent?.includes(name));
  if (!row) throw new Error(`no assistant row for ${name}`);
  return row;
}

function keyRow(name: string): HTMLElement {
  const row = screen.getAllByTestId('api-key-row').find((el) => el.textContent?.includes(name));
  if (!row) throw new Error(`no key row for ${name}`);
  return row;
}

describe('§1 authorized assistants', () => {
  it('lists each grant with its name, scopes in consent words, when authorized and last used', async () => {
    await renderSettled();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('authorized-assistant')).toHaveLength(3);

    const desktop = assistantRow('Claude Desktop');
    expect(within(desktop).getByText(/«oauth\.consent\.scope\.dataRead»/)).toBeInTheDocument();
    expect(within(desktop).getByText(/«oauth\.consent\.scope\.dataWrite»/)).toBeInTheDocument();
    // A scope the page cannot name is shown as unrecognised, never dropped.
    expect(within(desktop).getByText('«oauth.consent.scope.unrecognised|made:up»')).toBeInTheDocument();
    expect(within(desktop).getByText(/^«connectAgent\.access\.authorized\|/)).toBeInTheDocument();
    // An hour-coarse use reads as "in the hour from", never as a moment.
    expect(within(desktop).getByText(/^«connectAgent\.access\.lastUsedHour\|/)).toBeInTheDocument();

    const cursor = assistantRow('Cursor');
    expect(within(cursor).getByText('«connectAgent.access.notRecorded»')).toBeInTheDocument();
    expect(within(cursor).getByText('«oauth.consent.scope.offlineAccess»')).toBeInTheDocument();
  });

  it('names the organization only when it is not the active one', async () => {
    await renderSettled();
    expect(within(assistantRow('Claude Desktop')).getByText('«connectAgent.access.inOrganization|Other Ltd»')).toBeInTheDocument();
    expect(within(assistantRow('Cursor')).queryByText(/inOrganization/)).toBeNull();
  });

  it('shows the client id beside the fallback when the client declares no name', async () => {
    await renderSettled();
    const nameless = assistantRow('client_nameless');
    expect(within(nameless).getByText('«connectAgent.access.unnamed»')).toBeInTheDocument();
  });

  it('offers no Revoke on any assistant row, and says withdrawing is not available here yet', async () => {
    await renderSettled();
    for (const row of screen.getAllByTestId('authorized-assistant')) {
      expect(within(row).queryByRole('button')).toBeNull();
    }
    expect(screen.getByText('«connectAgent.access.withdrawLater»')).toBeInTheDocument();
    expect(screen.queryByText(/connectAgent\.access\.truncated/)).toBeNull();
  });

  it('says when the server answered only the newest grants', async () => {
    listMock.mockResolvedValueOnce({ clients: CLIENTS, truncated: true });
    await renderSettled();
    expect(screen.getByText('«connectAgent.access.truncated»')).toBeInTheDocument();
  });
});

describe('§2 API keys', () => {
  it("reads only the signed-in person's own keys, and never the secret", async () => {
    await renderSettled();
    expect(findMock).toHaveBeenCalledTimes(1);
    const [resource, params] = findMock.mock.calls[0] as [string, Row];
    expect(resource).toBe('sys_api_key');
    expect(params.$filter).toEqual({ user_id: 'user_me' });
    expect(params.$select).toEqual(['id', 'name', 'prefix', 'created_at', 'last_used_at', 'expires_at', 'revoked']);
    expect(params.$select).not.toContain('key');
    expect(params.$select).not.toContain('key_hash');
  });

  it('shows created, last used or never used, and the revoked and expired states', async () => {
    await renderSettled();
    expect(within(keyRow('ci key')).getByText(/^«connectAgent\.access\.keyLastUsed\|/)).toBeInTheDocument();
    expect(within(keyRow('ci key')).getByText(/^«connectAgent\.access\.created\|/)).toBeInTheDocument();
    expect(within(keyRow('spare key')).getByText('«connectAgent.access.neverUsed»')).toBeInTheDocument();
    expect(within(keyRow('old key')).getByText('«connectAgent.access.revoked»')).toBeInTheDocument();
    expect(within(keyRow('stale key')).getByText('«connectAgent.access.expired»')).toBeInTheDocument();

    expect(within(keyRow('ci key')).getByRole('button', { name: '«connectAgent.access.revoke»' })).toBeInTheDocument();
    expect(within(keyRow('spare key')).getByRole('button', { name: '«connectAgent.access.revoke»' })).toBeInTheDocument();
    expect(within(keyRow('old key')).queryByRole('button')).toBeNull();
    expect(within(keyRow('stale key')).queryByRole('button')).toBeNull();
  });
});

describe('§3 revoking a key', () => {
  it('asks first, naming the key; Cancel writes nothing', async () => {
    await renderSettled();
    fireEvent.click(within(keyRow('ci key')).getByRole('button', { name: '«connectAgent.access.revoke»' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('«connectAgent.access.revokeTitle|ci key»')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '«common.cancel»' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('confirming writes revoked: true and re-reads the list in place', async () => {
    await renderSettled();
    fireEvent.click(within(keyRow('ci key')).getByRole('button', { name: '«connectAgent.access.revoke»' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '«connectAgent.access.revoke»' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('sys_api_key', 'k_active', { revoked: true }));
    await waitFor(() => expect(findMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(keyRow('ci key')).getByText('«connectAgent.access.revoked»')).toBeInTheDocument(),
    );
    expect(within(keyRow('ci key')).queryByRole('button')).toBeNull();
    // The assistants are not re-read by a key write.
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

describe('§4 empty, failed and signed-out states', () => {
  it('says so when there is nothing to list', async () => {
    listMock.mockResolvedValueOnce({ clients: [], truncated: false });
    findMock.mockResolvedValueOnce({ data: [] });
    render(<AuthorizedAccessList />);
    expect(await screen.findByText('«connectAgent.access.assistantsEmpty»')).toBeInTheDocument();
    expect(await screen.findByText('«connectAgent.access.keysEmpty»')).toBeInTheDocument();
  });

  it('names a failed read instead of showing an empty list', async () => {
    listMock.mockRejectedValueOnce(new Error('boom'));
    findMock.mockRejectedValueOnce(new Error('nope'));
    render(<AuthorizedAccessList />);
    expect(await screen.findByText('«connectAgent.access.loadFailed|boom»')).toBeInTheDocument();
    expect(await screen.findByText('«connectAgent.access.loadFailed|nope»')).toBeInTheDocument();
    expect(screen.queryByText('«connectAgent.access.assistantsEmpty»')).toBeNull();
  });

  it('renders nothing and reads nothing without a signed-in person or an adapter', () => {
    authUser = null;
    const { container, unmount } = render(<AuthorizedAccessList />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    authUser = { id: 'user_me' };
    adapter = null;
    const second = render(<AuthorizedAccessList />);
    expect(second.container).toBeEmptyDOMElement();
    expect(listMock).not.toHaveBeenCalled();
    expect(findMock).not.toHaveBeenCalled();
  });
});
