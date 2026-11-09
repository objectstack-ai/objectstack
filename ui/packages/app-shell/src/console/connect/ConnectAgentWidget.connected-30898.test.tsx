// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Connect an AI Assistant says which assistant is connected, and when it last
 * made a call, under the example requests; with nothing connected it keeps the
 * try-first line.
 *
 *  - §1 nothing connected (no authorized assistant, and only revoked or
 *    expired keys) keeps the try-first line and draws no Connected line;
 *  - §2 an authorized assistant is named, with its last call "in the hour
 *    from" the recorded hour; an assistant with none recorded says no call yet;
 *  - §3 the most recent call wins: a key that called after every assistant is
 *    the one named, as an API key, with its last call as a moment; more than
 *    one connection points to the list at the bottom;
 *  - §4 a failed read is never read as "nothing connected": with the other
 *    read empty it falls back to the try-first line, and with the other read
 *    holding a connection it still names that one;
 *  - §5 the line follows the page's own writes through the real controls:
 *    Revoke on the only assistant (and confirm) turns it back to the try-first
 *    line; Revoke on the only key does the same;
 *  - §6 the combining rule on its own (`combineConnectedReads`).
 *
 * `t` echoes the key with any interpolation values appended, as the sibling
 * suites do, so assertions read which string was asked for and with what.
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
  // The moment as recorded, so the assertions read which timestamp was shown.
  formatDateTime: (value: string) => `at:${value}`,
  formatDate: (value: string) => `on:${value}`,
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
    organizations: [{ id: 'org_here', name: 'Here Inc' }],
  }),
}));

import { notifyDataChanged } from '@object-ui/react';
import { ConnectAgent } from './ConnectAgentWidget';
import { combineConnectedReads, type ConnectedEntry } from './connectedAccess';

type Row = Record<string, unknown>;
type Client = {
  id: string;
  clientId: string;
  name: string | null;
  scopes: string[];
  organizationId: string | null;
  authorizedAt: string | null;
  lastUsedAt: string | null;
};

const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const DESKTOP: Client = {
  id: 'consent_desktop',
  clientId: 'client_desktop',
  name: 'Claude Desktop',
  scopes: ['data:read'],
  organizationId: 'org_here',
  authorizedAt: '2026-11-05T09:00:00.000Z',
  lastUsedAt: '2026-11-06T21:00:00.000Z',
};
const CURSOR: Client = {
  id: 'consent_cursor',
  clientId: 'client_cursor',
  name: 'Cursor',
  scopes: ['data:read'],
  organizationId: 'org_here',
  authorizedAt: '2026-11-06T10:00:00.000Z',
  lastUsedAt: null,
};
const DEAD_KEYS: Row[] = [
  { id: 'k_revoked', name: 'old key', prefix: 'osk_a', created_at: '2026-10-01T10:00:00.000Z', last_used_at: '2026-11-07T08:00:00.000Z', expires_at: FAR_FUTURE, revoked: true },
  { id: 'k_expired', name: 'stale key', prefix: 'osk_b', created_at: '2026-01-01T10:00:00.000Z', last_used_at: '2026-01-15T08:00:00.000Z', expires_at: '2026-02-01T00:00:00.000Z', revoked: false },
];
const LIVE_KEY: Row = {
  id: 'k_live',
  name: 'doubao key',
  prefix: 'osk_c',
  created_at: '2026-11-01T10:00:00.000Z',
  last_used_at: '2026-11-07T08:30:12.000Z',
  expires_at: null,
  revoked: false,
};

let granted: Client[];
let keyRows: Row[];
let listMock: ReturnType<typeof vi.fn>;
let findMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  authUser = { id: 'user_me' };
  granted = [];
  keyRows = DEAD_KEYS.map((r) => ({ ...r }));
  listMock = vi.fn(async () => ({ clients: [...granted], truncated: false }));
  findMock = vi.fn(async () => ({ data: keyRows.map((r) => ({ ...r })) }));
  adapter = {
    getClient: () => ({
      oauth: {
        authorizedClients: {
          list: listMock,
          withdraw: vi.fn(async (id: string) => {
            granted = granted.filter((c) => c.id !== id);
            return { id };
          }),
        },
      },
    }),
    find: findMock,
    update: vi.fn(async (resource: string, id: string, patch: Row) => {
      keyRows = keyRows.map((r) => (r.id === id ? { ...r, ...patch } : r));
      // What the console's mutation bridge does for every adapter write.
      notifyDataChanged({ objectName: resource, recordId: id });
      return keyRows.find((r) => r.id === id);
    }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/discovery')) {
        return new Response(JSON.stringify({ data: { routes: { mcp: '/api/v1/mcp' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the page and waits until both reads behind the line have answered. */
async function renderPage() {
  render(<ConnectAgent />);
  await screen.findByText('«connectAgent.capabilities.title»');
  await waitFor(() => {
    expect(listMock).toHaveBeenCalled();
    expect(findMock).toHaveBeenCalled();
  });
}

describe('§1 nothing connected', () => {
  it('keeps the try-first line and draws no Connected line', async () => {
    await renderPage();
    expect(await screen.findByText('«connectAgent.capabilities.tryFirst»')).toBeInTheDocument();
    expect(screen.queryByTestId('connected-status')).toBeNull();
  });

  it('reads only the signed-in person\'s keys', async () => {
    await renderPage();
    expect(findMock).toHaveBeenCalledWith(
      'sys_api_key',
      expect.objectContaining({ $filter: { user_id: 'user_me' } }),
    );
  });
});

describe('§2 an authorized assistant', () => {
  it('is named, with its last call in the hour from the recorded hour', async () => {
    granted = [DESKTOP];
    await renderPage();
    const line = await screen.findByTestId('connected-status');
    expect(line).toHaveTextContent('«connectAgent.capabilities.connected|Claude Desktop»');
    expect(line).toHaveTextContent(`«connectAgent.capabilities.lastCallHour|at:${DESKTOP.lastUsedAt}»`);
    expect(screen.queryByText('«connectAgent.capabilities.tryFirst»')).toBeNull();
    expect(line).not.toHaveTextContent('«connectAgent.capabilities.moreConnected»');
  });

  it('says no call yet when none is recorded, and names a nameless one by the fallback', async () => {
    granted = [{ ...CURSOR, name: null }];
    await renderPage();
    const line = await screen.findByTestId('connected-status');
    expect(line).toHaveTextContent('«connectAgent.capabilities.connected|«connectAgent.access.unnamed»»');
    expect(line).toHaveTextContent('«connectAgent.capabilities.noCallYet»');
  });
});

describe('§3 the most recent call wins', () => {
  it('names a key that called after every assistant, as an API key, at its moment', async () => {
    granted = [DESKTOP, CURSOR];
    keyRows = [...DEAD_KEYS, LIVE_KEY].map((r) => ({ ...r }));
    await renderPage();
    const line = await screen.findByTestId('connected-status');
    expect(line).toHaveTextContent('«connectAgent.capabilities.connectedKey|doubao key»');
    expect(line).toHaveTextContent(`«connectAgent.capabilities.lastCallAt|at:${LIVE_KEY.last_used_at}»`);
    // The revoked key called later still, but it is not a connection.
    expect(line).not.toHaveTextContent('old key');
    expect(line).toHaveTextContent('«connectAgent.capabilities.moreConnected»');
  });

  it('names the assistant when its call is the more recent one', async () => {
    granted = [CURSOR, DESKTOP];
    keyRows = [{ ...LIVE_KEY, last_used_at: '2026-11-06T08:00:00.000Z' }];
    await renderPage();
    const line = await screen.findByTestId('connected-status');
    expect(line).toHaveTextContent('«connectAgent.capabilities.connected|Claude Desktop»');
  });
});

describe('§4 a failed read', () => {
  it('with nothing found elsewhere falls back to the try-first line', async () => {
    listMock.mockRejectedValue(new Error('authorization store could not be read'));
    await renderPage();
    expect(await screen.findByText('«connectAgent.capabilities.tryFirst»')).toBeInTheDocument();
    expect(screen.queryByTestId('connected-status')).toBeNull();
  });

  it('with a connection found by the other read still names it', async () => {
    keyRows = [{ ...LIVE_KEY }];
    findMock.mockResolvedValue({ data: keyRows });
    listMock.mockRejectedValue(new Error('authorization store could not be read'));
    await renderPage();
    const line = await screen.findByTestId('connected-status');
    expect(line).toHaveTextContent('«connectAgent.capabilities.connectedKey|doubao key»');
  });
});

describe('§5 the line follows the page\'s own Revoke', () => {
  it('revoking the only assistant turns it back to the try-first line', async () => {
    granted = [DESKTOP];
    await renderPage();
    await screen.findByTestId('connected-status');
    const row = (await screen.findAllByTestId('authorized-assistant'))[0];
    fireEvent.click(within(row).getByText('«connectAgent.access.revoke»'));
    fireEvent.click(await screen.findByRole('button', { name: '«connectAgent.access.revoke»' }));
    await waitFor(() => expect(screen.queryByTestId('connected-status')).toBeNull());
    expect(screen.getByText('«connectAgent.capabilities.tryFirst»')).toBeInTheDocument();
  });

  it('revoking the only key turns it back to the try-first line', async () => {
    keyRows = [{ ...LIVE_KEY }];
    await renderPage();
    await screen.findByTestId('connected-status');
    const row = (await screen.findAllByTestId('api-key-row'))[0];
    fireEvent.click(within(row).getByText('«connectAgent.access.revoke»'));
    fireEvent.click(await screen.findByRole('button', { name: '«connectAgent.access.revoke»' }));
    await waitFor(() => expect(screen.queryByTestId('connected-status')).toBeNull());
  });
});

describe('§6 combineConnectedReads', () => {
  const entry = (over: Partial<ConnectedEntry>): ConnectedEntry => ({
    kind: 'assistant',
    id: 'e',
    name: 'E',
    lastUsedAt: null,
    lastUsedPrecision: 'hour',
    since: null,
    ...over,
  });

  it('is loading while either read is out and nothing is found', () => {
    expect(combineConnectedReads({ state: 'loading' }, { state: 'ready', value: [] })).toEqual({ state: 'loading' });
  });

  it('is unknown when a read failed and the other found nothing', () => {
    expect(combineConnectedReads({ state: 'failed' }, { state: 'ready', value: [] })).toEqual({ state: 'unknown' });
    expect(combineConnectedReads({ state: 'ready', value: [] }, { state: 'failed' })).toEqual({ state: 'unknown' });
  });

  it('is not connected only when both reads answered empty', () => {
    expect(combineConnectedReads({ state: 'ready', value: [] }, { state: 'ready', value: [] })).toEqual({
      state: 'ready',
      connected: false,
      entries: [],
    });
  });

  it('orders by last call, then by newest grant, calls before none', () => {
    const a = entry({ id: 'a', lastUsedAt: null, since: '2026-11-07T00:00:00.000Z' });
    const b = entry({ id: 'b', lastUsedAt: '2026-11-01T00:00:00.000Z' });
    const c = entry({ id: 'c', lastUsedAt: null, since: '2026-11-01T00:00:00.000Z' });
    const d = entry({ id: 'd', kind: 'apiKey', lastUsedAt: '2026-11-03T00:00:00.000Z', lastUsedPrecision: 'moment' });
    const result = combineConnectedReads({ state: 'ready', value: [a, b, c] }, { state: 'ready', value: [d] });
    expect(result.state === 'ready' && result.entries.map((e) => e.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});
