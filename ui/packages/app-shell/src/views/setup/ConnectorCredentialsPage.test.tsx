// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Integrations → Connector Credentials (ruling A on
 * objectstack#27230) — behaviour, over a stubbed credential door.
 *
 * The properties, in the order an administrator meets them:
 *
 *   1. **the list** — one row per reference, with its status, the connectors
 *      naming it, when and by whom it last changed, and the upstream's reason
 *      for a `rejected` one. A reference an environment variable supplies is
 *      read-only: no input, no Clear.
 *   2. **set** — the masked input starts EMPTY whatever is stored, Save stays
 *      disabled while it is empty, and a save puts exactly `{ value }` on the
 *      wire. The row then shows the entry the door answered, and the typed
 *      value is gone from the page.
 *   3. **clear** — only behind a confirmation, and only for a value stored
 *      here; Cancel sends nothing.
 *   4. **honesty** — a walled posture (`403`) and a runtime without the door
 *      (`404`) are configuration conclusions, never a red failure; a `500` is
 *      a failure, with Try again.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ConnectorCredentialRef } from '@objectstack/spec/contracts';

import { ConnectorCredentialsPage } from './ConnectorCredentialsPage';

const DOOR = '/api/v1/automation/connectors/credential-refs';
/** A stand-in credential the tests type; it must never be rendered back. */
const TYPED = 'dummy-typed-value-0001';

/**
 * `connectorCredentialWalledMessage('group')` (runtime `domains/automation.ts`),
 * transcribed exactly: the page renders what it was sent, unedited.
 */
const POSTURE_REFUSAL =
  "Connector credentials are environment-level, and this environment runs the 'group' tenancy posture, " +
  'where several organizations share it, so this door does not store or list them here. A declarative ' +
  "connector's credentialRef still resolves from a server environment variable of the same name.";

function entry(over: Partial<ConnectorCredentialRef> & { ref: string }): ConnectorCredentialRef {
  return {
    status: 'missing',
    source: null,
    writable: true,
    declared: true,
    connectors: [{ name: 'billing_api', packageId: 'com.acme.billing', state: 'degraded' }],
    ...over,
  };
}

const MISSING = entry({ ref: 'BILLING_API_TOKEN' });
const STORED = entry({
  ref: 'CRM_API_KEY',
  status: 'set',
  source: 'object',
  updatedAt: '2026-10-29T08:00:00.000Z',
  updatedBy: 'ada@acme.test',
  connectors: [{ name: 'crm_api', packageId: 'com.acme.crm', state: 'active' }],
});
const FROM_ENV = entry({ ref: 'MAPS_KEY', status: 'set', source: 'env', writable: false });
const REJECTED = entry({ ref: 'MCP_TOKEN', status: 'rejected', source: 'object', statusReason: '401 Unauthorized: token expired' });

let calls: Array<{ url: string; method: string; body?: unknown }>;
let listing: { status: number; body: unknown };
let writes: Array<{ status: number; body: unknown }>;

const envelope = (data: unknown) => ({ success: true, data });
const errorEnvelope = (code: string, message: string) => ({ success: false, error: { code, message } });
const listed = (refs: ConnectorCredentialRef[]) => ({ status: 200, body: envelope({ credentialRefs: refs, total: refs.length }) });

beforeEach(() => {
  calls = [];
  writes = [];
  listing = listed([MISSING, STORED, FROM_ENV, REJECTED]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const answer = url === DOOR && method === 'GET' ? listing : writes.shift() ?? { status: 500, body: errorEnvelope('X', 'unexpected') };
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectorCredentialsPage />
    </MemoryRouter>,
  );
}

const row = (ref: string) => screen.getByTestId(`credential-row-${ref}`);
const input = (ref: string) => screen.getByLabelText(`New value for ${ref}`) as HTMLInputElement;

describe('the list', () => {
  it('draws one row per reference with its status, connectors and last change', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Connector credentials' })).toBeInTheDocument();
    await screen.findByTestId('credential-row-BILLING_API_TOKEN');

    expect(within(row('BILLING_API_TOKEN')).getByText('Missing')).toBeInTheDocument();
    expect(within(row('BILLING_API_TOKEN')).getByText('billing_api')).toBeInTheDocument();
    expect(within(row('CRM_API_KEY')).getByText('Set')).toBeInTheDocument();
    expect(within(row('CRM_API_KEY')).getByText(/by ada@acme\.test$/)).toBeInTheDocument();
    expect(within(row('MCP_TOKEN')).getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByTestId('credential-reason-MCP_TOKEN')).toHaveTextContent('401 Unauthorized: token expired');
  });

  it('an environment-supplied reference is read-only: no input and no Clear', async () => {
    renderPage();
    await screen.findByTestId('credential-env-MAPS_KEY');
    expect(within(row('MAPS_KEY')).getByText('From the server environment')).toBeInTheDocument();
    expect(screen.queryByLabelText('New value for MAPS_KEY')).toBeNull();
    expect(within(row('MAPS_KEY')).queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('every input is masked and starts empty, a stored value included', async () => {
    renderPage();
    await screen.findByTestId('credential-row-CRM_API_KEY');
    for (const ref of ['BILLING_API_TOKEN', 'CRM_API_KEY', 'MCP_TOKEN']) {
      expect(input(ref).type).toBe('password');
      expect(input(ref).value).toBe('');
    }
    expect(input('CRM_API_KEY').placeholder).toBe('Enter a new value to replace it');
    expect(input('BILLING_API_TOKEN').placeholder).toBe('Enter the value');
  });

  it('a reference nothing declares any more says so, and offers only Clear', async () => {
    listing = listed([entry({ ref: 'OLD_TOKEN', status: 'set', source: 'object', declared: false, connectors: [] })]);
    renderPage();
    await screen.findByTestId('credential-row-OLD_TOKEN');
    expect(within(row('OLD_TOKEN')).getByText('No installed app declares it any more.')).toBeInTheDocument();
    expect(screen.queryByLabelText('New value for OLD_TOKEN')).toBeNull();
    expect(within(row('OLD_TOKEN')).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('an empty list is an empty state', async () => {
    listing = listed([]);
    renderPage();
    expect(await screen.findByTestId('connector-credentials-empty')).toHaveTextContent('No connector credentials');
  });
});

describe('setting a value', () => {
  it('Save is disabled while the input is empty, and nothing is sent', async () => {
    renderPage();
    await screen.findByTestId('credential-row-BILLING_API_TOKEN');
    const save = within(row('BILLING_API_TOKEN')).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.submit(screen.getByTestId('credential-form-BILLING_API_TOKEN'));
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('PUTs exactly { value }, shows the entry the door answered, and drops the typed value', async () => {
    writes.push({ status: 200, body: envelope({ ...MISSING, status: 'set', source: 'object', updatedBy: 'ada@acme.test', updatedAt: '2026-10-30T09:00:00.000Z' }) });
    renderPage();
    await screen.findByTestId('credential-row-BILLING_API_TOKEN');

    fireEvent.change(input('BILLING_API_TOKEN'), { target: { value: TYPED } });
    fireEvent.click(within(row('BILLING_API_TOKEN')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(within(row('BILLING_API_TOKEN')).getByText('Set')).toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([
      { url: `${DOOR}/BILLING_API_TOKEN`, method: 'PUT', body: { value: TYPED } },
    ]);
    expect(input('BILLING_API_TOKEN').value).toBe('');
    expect(screen.getByText('Saved BILLING_API_TOKEN. The connectors that use it reconnect with it now.')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TYPED);
  });

  it('a refusal shows the server sentence under the input, and the row is unchanged', async () => {
    const message = "Credential 'BILLING_API_TOKEN' is not declared by any installed connector.";
    writes.push({ status: 404, body: errorEnvelope('NOT_FOUND', message) });
    renderPage();
    await screen.findByTestId('credential-row-BILLING_API_TOKEN');

    fireEvent.change(input('BILLING_API_TOKEN'), { target: { value: TYPED } });
    fireEvent.click(within(row('BILLING_API_TOKEN')).getByRole('button', { name: 'Save' }));

    expect(await within(row('BILLING_API_TOKEN')).findByRole('alert')).toHaveTextContent(message);
    expect(within(row('BILLING_API_TOKEN')).getByText('Missing')).toBeInTheDocument();
  });
});

describe('clearing a value', () => {
  it('asks first; Cancel sends nothing', async () => {
    renderPage();
    await screen.findByTestId('credential-row-CRM_API_KEY');
    fireEvent.click(within(row('CRM_API_KEY')).getByRole('button', { name: 'Clear' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Clear CRM_API_KEY?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('confirming DELETEs it and shows the entry the door answered', async () => {
    writes.push({ status: 200, body: envelope({ ...STORED, status: 'missing', source: null, updatedAt: undefined, updatedBy: undefined }) });
    renderPage();
    await screen.findByTestId('credential-row-CRM_API_KEY');
    fireEvent.click(within(row('CRM_API_KEY')).getByRole('button', { name: 'Clear' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear credential' }));

    await waitFor(() => expect(within(row('CRM_API_KEY')).getByText('Missing')).toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([{ url: `${DOOR}/CRM_API_KEY`, method: 'DELETE', body: undefined }]);
    expect(screen.getByText('Cleared CRM_API_KEY.')).toBeInTheDocument();
    // Nothing is stored here any more, so there is nothing left to clear.
    expect(within(row('CRM_API_KEY')).queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});

describe('honesty', () => {
  it('a walled posture (403) is the server sentence as a notice, not an error', async () => {
    listing = { status: 403, body: errorEnvelope('PERMISSION_DENIED', POSTURE_REFUSAL) };
    renderPage();
    const notice = await screen.findByTestId('connector-credentials-unavailable');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent(POSTURE_REFUSAL);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a runtime without the door (404) says it does not manage credentials, not an error', async () => {
    listing = { status: 404, body: errorEnvelope('NOT_FOUND', 'no route') };
    renderPage();
    expect(await screen.findByTestId('connector-credentials-not-served')).toHaveTextContent(
      'This server does not manage connector credentials',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a 500 is a failure with its message, and Try again reads the door again', async () => {
    listing = { status: 500, body: errorEnvelope('INTERNAL', 'the store is down') };
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load connector credentials.');
    expect(alert).toHaveTextContent('the store is down');

    listing = listed([MISSING]);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('credential-row-BILLING_API_TOKEN')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });
});
