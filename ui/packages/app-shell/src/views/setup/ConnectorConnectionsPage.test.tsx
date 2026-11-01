// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Integrations → Connector Connections (ADR-0143 D5, item 7 of
 * objectstack#26702) — behaviour, over stubbed connection, registry and
 * declaration doors.
 *
 *   1. **the status view** — one row per declared `oauth2`
 *      `authorization_code` instance (other auth kinds are not listed), with
 *      this organization's connection status and the server's reason, and a
 *      `degraded` instance's reason beside the connection that caused it.
 *   2. **connect** — the sign-in window opens on the click, is detached from
 *      the page, and is sent to the URL the begin leg answered; the URL is
 *      never rendered. The page re-reads the status until the connect lands,
 *      then closes the window and shows the new status.
 *   3. **refusals** — a blocked window sends nothing; a refused begin closes
 *      the window and shows the server's words; a URL that is not http(s) is
 *      never navigated to.
 *   4. **disconnect** — only behind a confirmation; Cancel sends nothing.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ConnectorConnectionState } from '@objectstack/spec/contracts';

import { ConnectorConnectionsPage } from './ConnectorConnectionsPage';

const META = '/api/v1/meta/connector';
const REGISTRY = '/api/v1/automation/connectors';
const door = (name: string) => `/api/v1/automation/connectors/${name}/connection`;
/** What a begin answers. Its `state` value must never reach the page's text. */
const AUTH_URL = 'https://vendor.example.test/authorize?client_id=c1&state=STATE-NEVER-RENDERED&code_challenge=x';
const REASON = "connector instance 'hubspot' needs to be reconnected for organization 'org_1': the refresh token was refused";

const declared = [
  { name: 'hubspot', label: 'HubSpot', provider: 'mcp', auth: { type: 'oauth2', grant: 'authorization_code' } },
  { name: 'notion', label: 'Notion', provider: 'mcp', auth: { type: 'oauth2', grant: 'authorization_code', clientId: 'n1' } },
  { name: 'stripe', label: 'Stripe', provider: 'openapi', auth: { type: 'bearer', credentialRef: 'STRIPE_KEY' } },
  { name: 'feishu', label: 'Feishu', provider: 'rest', auth: { type: 'oauth2', grant: 'client_credentials', clientId: 'f1' } },
];

const state = (connector: string, over: Partial<ConnectorConnectionState> = {}): ConnectorConnectionState => ({
  connector,
  organizationId: 'org_1',
  status: 'not_connected',
  ...over,
});

const envelope = (data: unknown) => ({ success: true, data });
const errorEnvelope = (code: string, message: string) => ({ success: false, error: { code, message } });

type Answer = { status: number; body: unknown };
let calls: Array<{ url: string; method: string; body?: unknown }>;
let answers: Map<string, Answer[]>;
let fakeWindow: { closed: boolean; opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> } | null;
let openSpy: ReturnType<typeof vi.fn>;

/** Queue answers for `METHOD url`; the last one repeats. */
function answer(method: string, url: string, ...list: Answer[]) {
  answers.set(`${method} ${url}`, list);
}

beforeEach(() => {
  calls = [];
  answers = new Map();
  answer('GET', META, { status: 200, body: { type: 'connector', items: declared } });
  answer('GET', REGISTRY, {
    status: 200,
    body: envelope({
      connectors: [
        { name: 'hubspot', label: 'HubSpot', type: 'api', origin: 'declarative', state: 'degraded', degradedReason: `reconnect required: ${REASON}`, actions: [] },
        { name: 'notion', label: 'Notion', type: 'api', origin: 'declarative', state: 'ready', actions: [] },
      ],
      total: 2,
    }),
  });
  answer('GET', door('hubspot'), { status: 200, body: envelope(state('hubspot', { status: 'reconnect_required', statusReason: REASON, connectedAt: '2026-10-30T08:00:00.000Z', connectedBy: 'ada@acme.test' })) });
  answer('GET', door('notion'), { status: 200, body: envelope(state('notion')) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, body: init?.body });
      const queue = answers.get(`${method} ${url}`);
      const next = queue ? (queue.length > 1 ? queue.shift()! : queue[0]) : { status: 500, body: errorEnvelope('X', `unexpected ${method} ${url}`) };
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body } as unknown as Response;
    }),
  );
  fakeWindow = { closed: false, opener: window, location: { href: 'about:blank' }, close: vi.fn(() => { if (fakeWindow) fakeWindow.closed = true; }) };
  openSpy = vi.fn(() => fakeWindow);
  vi.stubGlobal('open', openSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectorConnectionsPage pollMs={10} />
    </MemoryRouter>,
  );
}

const row = (name: string) => screen.getByTestId(`connection-row-${name}`);
const sent = (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url);

describe('the status view', () => {
  it('lists only the instances an administrator connects, with this organization\'s status', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Connector connections' })).toBeInTheDocument();
    await screen.findByTestId('connection-row-hubspot');

    expect(screen.queryByTestId('connection-row-stripe')).toBeNull();
    expect(screen.queryByTestId('connection-row-feishu')).toBeNull();
    expect(within(row('notion')).getByText('Not connected')).toBeInTheDocument();
    expect(within(row('notion')).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(within(row('notion')).queryByRole('button', { name: 'Disconnect' })).toBeNull();

    expect(within(row('hubspot')).getByText('Reconnect required')).toBeInTheDocument();
    expect(screen.getByTestId('connection-reason-hubspot')).toHaveTextContent(REASON);
    expect(within(row('hubspot')).getByText(/by ada@acme\.test$/)).toBeInTheDocument();
    expect(within(row('hubspot')).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('a degraded instance shows the server\'s reason beside the connection that caused it', async () => {
    renderPage();
    const degraded = await screen.findByTestId('connection-degraded-hubspot');
    expect(degraded).toHaveTextContent('Degraded');
    expect(degraded).toHaveTextContent(`reconnect required: ${REASON}`);
    expect(screen.queryByTestId('connection-degraded-notion')).toBeNull();
  });

  it('a refused status read shows the server\'s words and offers no action', async () => {
    answer('GET', door('notion'), { status: 403, body: errorEnvelope('PERMISSION_DENIED', 'Connecting … requires the `manage_connector_connections` capability.') });
    renderPage();
    const refused = await screen.findByTestId('connection-refused-notion');
    expect(refused).toHaveTextContent('manage_connector_connections');
    expect(within(row('notion')).queryByRole('button')).toBeNull();
  });

  it('a failed declaration read is a failure with Try again; no connectable instance is the empty state', async () => {
    answer('GET', META, { status: 500, body: errorEnvelope('INTERNAL_ERROR', 'boom') }, { status: 200, body: { items: [declared[2]] } });
    renderPage();
    expect(await screen.findByText('Could not load connector connections.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('connector-connections-empty')).toBeInTheDocument();
  });
});

describe('connect', () => {
  it('opens a detached window on the click, sends it to the begun URL, and shows the connect once it lands', async () => {
    answer('POST', door('notion'), { status: 200, body: envelope({ connector: 'notion', organizationId: 'org_1', authorizationUrl: AUTH_URL, expiresAt: new Date(Date.now() + 600_000).toISOString() }) });
    renderPage();
    await screen.findByTestId('connection-row-notion');
    answer('GET', door('notion'),
      { status: 200, body: envelope(state('notion')) },
      { status: 200, body: envelope(state('notion', { status: 'connected', connectedAt: '2026-11-01T10:00:00.000Z', connectedBy: 'ada@acme.test', scopes: 'read write' })) });

    fireEvent.click(within(row('notion')).getByRole('button', { name: 'Connect' }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toBe('about:blank');
    await waitFor(() => expect(fakeWindow!.location.href).toBe(AUTH_URL));
    expect(fakeWindow!.opener).toBeNull();
    expect(sent('POST', door('notion'))).toHaveLength(1);
    expect(sent('POST', door('notion'))[0].body).toBeUndefined();

    await waitFor(() => expect(within(row('notion')).getByText('Connected')).toBeInTheDocument());
    expect(fakeWindow!.close).toHaveBeenCalled();
    expect(within(row('notion')).getByText('Scopes: read write')).toBeInTheDocument();
    expect(screen.getByText('Connected notion.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('STATE-NEVER-RENDERED');
  });

  it('a window closed before the connect lands stops waiting and shows the status read then', async () => {
    answer('POST', door('notion'), { status: 200, body: envelope({ connector: 'notion', organizationId: 'org_1', authorizationUrl: AUTH_URL, expiresAt: new Date(Date.now() + 600_000).toISOString() }) });
    renderPage();
    await screen.findByTestId('connection-row-notion');
    fireEvent.click(within(row('notion')).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Finish signing in in the window that opened.')).toBeInTheDocument();
    fakeWindow!.closed = true;
    await waitFor(() => expect(within(row('notion')).getByRole('button', { name: 'Connect' })).toBeEnabled());
    expect(within(row('notion')).getByText('Not connected')).toBeInTheDocument();
  });
});

describe('refusals', () => {
  it('a blocked window sends nothing', async () => {
    openSpy.mockReturnValue(null);
    renderPage();
    await screen.findByTestId('connection-row-notion');
    fireEvent.click(within(row('notion')).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The browser blocked the sign-in window.');
    expect(sent('POST', door('notion'))).toHaveLength(0);
  });

  it('a refused begin closes the window and shows the server\'s words', async () => {
    const refusal = 'This deployment has no fixed public origin for the OAuth redirect, so a connector instance cannot be connected.';
    answer('POST', door('notion'), { status: 503, body: errorEnvelope('SERVICE_UNAVAILABLE', refusal) });
    renderPage();
    await screen.findByTestId('connection-row-notion');
    fireEvent.click(within(row('notion')).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
    expect(fakeWindow!.close).toHaveBeenCalled();
    expect(fakeWindow!.location.href).toBe('about:blank');
  });

  it('an authorization URL that is not http(s) is never navigated to', async () => {
    answer('POST', door('notion'), { status: 200, body: envelope({ connector: 'notion', organizationId: 'org_1', authorizationUrl: 'javascript:alert(1)', expiresAt: '' }) });
    renderPage();
    await screen.findByTestId('connection-row-notion');
    fireEvent.click(within(row('notion')).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('without an authorization URL to open');
    expect(fakeWindow!.location.href).toBe('about:blank');
    expect(fakeWindow!.close).toHaveBeenCalled();
  });
});

describe('disconnect', () => {
  it('is behind a confirmation; Cancel sends nothing, confirming sends DELETE and shows the answer', async () => {
    answer('DELETE', door('hubspot'), { status: 200, body: envelope(state('hubspot')) });
    renderPage();
    await screen.findByTestId('connection-row-hubspot');

    fireEvent.click(within(row('hubspot')).getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(sent('DELETE', door('hubspot'))).toHaveLength(0);

    fireEvent.click(within(row('hubspot')).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(within(row('hubspot')).getByText('Not connected')).toBeInTheDocument());
    expect(sent('DELETE', door('hubspot'))).toHaveLength(1);
    expect(screen.getByText('Disconnected hubspot.')).toBeInTheDocument();
  });

  it('a refused disconnect keeps the dialog open with the server\'s words', async () => {
    answer('DELETE', door('hubspot'), { status: 404, body: errorEnvelope('RESOURCE_NOT_FOUND', "Connector instance 'hubspot' is not connected for organization 'org_1', so there is nothing to revoke.") });
    renderPage();
    await screen.findByTestId('connection-row-hubspot');
    fireEvent.click(within(row('hubspot')).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('nothing to revoke');
  });
});
