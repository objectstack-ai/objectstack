// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Home's "Connect an AI Assistant" card: shown to a signed-in person who has
 * connected nothing, hidden once they have connected one or hidden it.
 *
 *  - §1 nothing connected (no authorized assistant; only a revoked or expired
 *    key): the card is shown, and its button opens Connect an AI Assistant;
 *  - §2 an authorized assistant, or a key that still works: no card;
 *  - §3 while the read is out, or when it fails: no card;
 *  - §4 the close button hides it for this person on this browser, also in a
 *    later mount (which reads nothing), and not for another person;
 *  - §5 MCP turned off (the Account app carries no page): no card, no read;
 *  - §6 connecting while it is shown (a key minted on this page) takes it away.
 *
 * Rendered with the real router, the real data bus and the real hook; only
 * the adapter, the person and the served apps are stubbed. `t` echoes the key.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
}));

const SHELL = vi.hoisted(() => ({
  adapter: null as unknown,
  user: { id: 'user_me' } as { id: string } | null,
  apps: [] as unknown[],
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => SHELL.adapter,
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: SHELL.user }),
}));
vi.mock('../../../providers/MetadataProvider.js', () => ({
  useMetadata: () => ({ apps: SHELL.apps }),
}));

import { notifyDataChanged } from '@object-ui/react';
import { ConnectAssistantCard } from '../ConnectAssistantCard';
import { connectAssistantCardKey } from '../connectAssistantCardGate';

const ACCOUNT_APP = {
  name: 'account',
  navigation: [
    { type: 'group', id: 'grp_account_ai_assistant', children: [{ type: 'page', id: 'nav_connect_agent', pageName: 'connect_agent' }] },
  ],
};
const ASSISTANT = {
  id: 'consent_1',
  clientId: 'client_desktop',
  name: 'Claude Desktop',
  scopes: [],
  organizationId: null,
  authorizedAt: '2026-11-07T10:00:00.000Z',
  lastUsedAt: null,
};
const LIVE_KEY = { id: 'k_live', name: 'doubao key', created_at: '2026-11-07T10:00:00.000Z', last_used_at: null, expires_at: null, revoked: false };
const DEAD_KEYS = [
  { id: 'k_revoked', name: 'old', created_at: null, last_used_at: null, expires_at: null, revoked: true },
  { id: 'k_expired', name: 'stale', created_at: null, last_used_at: null, expires_at: '2026-01-01T00:00:00.000Z', revoked: false },
];

let granted: unknown[];
let keyRows: Record<string, unknown>[];
let list: ReturnType<typeof vi.fn>;
let find: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  granted = [];
  keyRows = DEAD_KEYS.map((k) => ({ ...k }));
  list = vi.fn(async () => ({ clients: [...granted], truncated: false }));
  find = vi.fn(async () => ({ data: keyRows.map((k) => ({ ...k })) }));
  SHELL.user = { id: 'user_me' };
  SHELL.apps = [ACCOUNT_APP];
  SHELL.adapter = { getClient: () => ({ oauth: { authorizedClients: { list } } }), find };
});

afterEach(() => {
  cleanup();
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<ConnectAssistantCard />} />
        <Route path="/apps/account/page/connect_agent" element={<div data-testid="connect-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function settled() {
  await waitFor(() => {
    expect(list).toHaveBeenCalled();
    expect(find).toHaveBeenCalled();
  });
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe('§1 nothing connected', () => {
  it('shows the card, and its button opens Connect an AI Assistant', async () => {
    renderHome();
    const card = await screen.findByTestId('home-connect-assistant');
    expect(card).toHaveTextContent('«home.connectAssistant.title»');
    expect(card).toHaveTextContent('«home.connectAssistant.body»');
    fireEvent.click(screen.getByTestId('home-connect-assistant-open'));
    expect(await screen.findByTestId('connect-page')).toBeInTheDocument();
  });

  it('reads only the signed-in person\'s keys', async () => {
    renderHome();
    await screen.findByTestId('home-connect-assistant');
    expect(find).toHaveBeenCalledWith('sys_api_key', expect.objectContaining({ $filter: { user_id: 'user_me' } }));
  });
});

describe('§2 connected', () => {
  it('an authorized assistant: no card', async () => {
    granted = [ASSISTANT];
    renderHome();
    await settled();
    expect(screen.queryByTestId('home-connect-assistant')).toBeNull();
  });

  it('a key that still works: no card', async () => {
    keyRows = [{ ...LIVE_KEY }];
    renderHome();
    await settled();
    expect(screen.queryByTestId('home-connect-assistant')).toBeNull();
  });
});

describe('§3 not known', () => {
  it('while the read is out: no card', async () => {
    list.mockReturnValue(new Promise(() => {}));
    renderHome();
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(screen.queryByTestId('home-connect-assistant')).toBeNull();
  });

  it('a failed read: no card', async () => {
    list.mockRejectedValue(new Error('down'));
    renderHome();
    await settled();
    expect(screen.queryByTestId('home-connect-assistant')).toBeNull();
  });
});

describe('§4 hidden by the person', () => {
  it('stays hidden for them on this browser, reading nothing, but not for another person', async () => {
    renderHome();
    fireEvent.click(await screen.findByTestId('home-connect-assistant-dismiss'));
    expect(screen.queryByTestId('home-connect-assistant')).toBeNull();
    expect(localStorage.getItem(connectAssistantCardKey('user_me'))).not.toBeNull();
    cleanup();

    list.mockClear();
    find.mockClear();
    renderHome();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId('home-connect-assistant')).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    cleanup();

    SHELL.user = { id: 'user_other' };
    renderHome();
    expect(await screen.findByTestId('home-connect-assistant')).toBeInTheDocument();
  });
});

describe('§5 MCP turned off', () => {
  it('the Account app carries no page: no card and no read', async () => {
    SHELL.apps = [{ name: 'account', navigation: [] }];
    renderHome();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId('home-connect-assistant')).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});

describe('§6 connecting while it is shown', () => {
  it('a key minted elsewhere on the page takes the card away', async () => {
    renderHome();
    await screen.findByTestId('home-connect-assistant');
    keyRows = [{ ...LIVE_KEY }];
    act(() => notifyDataChanged({ objectName: 'sys_api_key' }));
    await waitFor(() => expect(screen.queryByTestId('home-connect-assistant')).toBeNull());
  });
});
