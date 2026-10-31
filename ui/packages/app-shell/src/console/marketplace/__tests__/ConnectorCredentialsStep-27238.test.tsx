// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The credential step after a marketplace install (ruling A on
 * objectstack#27230), over a stubbed credential door:
 *
 *   1. it offers only the just-installed package's references that an
 *      administrator can still act on — not another package's, not a set one,
 *      not one an environment variable supplies;
 *   2. a value set here closes its row when the door answers `set`; an answer
 *      that is not `set` keeps the row open with its new status;
 *   3. "Skip for now" moves a reference to a skipped list that links to the
 *      Setup page, and sends nothing;
 *   4. where the listing cannot be read, it shows the install answer's
 *      `credentialNote`, or nothing; with nothing to set, it draws nothing.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ConnectorCredentialRef } from '@objectstack/spec/contracts';

import { ConnectorCredentialsStep } from '../ConnectorCredentialsStep';

const PKG = 'com.acme.billing';
const DOOR = '/api/v1/automation/connectors/credential-refs';
const TYPED = 'dummy-typed-value-0002';
const NOTE = 'The connectors of com.acme.billing need BILLING_API_TOKEN; set it in Setup.';

function entry(over: Partial<ConnectorCredentialRef> & { ref: string }): ConnectorCredentialRef {
  return {
    status: 'missing',
    source: null,
    writable: true,
    declared: true,
    connectors: [{ name: 'billing_api', packageId: PKG, state: 'degraded' }],
    ...over,
  };
}

const TOKEN = entry({ ref: 'BILLING_API_TOKEN' });
const SECRET = entry({ ref: 'BILLING_WEBHOOK_SECRET', connectors: [{ name: 'billing_hooks', packageId: PKG }] });
const OTHER_PACKAGE = entry({ ref: 'CRM_API_KEY', connectors: [{ name: 'crm_api', packageId: 'com.acme.crm' }] });
const ALREADY_SET = entry({ ref: 'BILLING_REGION', status: 'set', source: 'object' });
const FROM_ENV = entry({ ref: 'BILLING_ENV_KEY', status: 'rejected', source: 'env', writable: false });

let calls: Array<{ url: string; method: string; body?: unknown }>;
let listing: { status: number; body: unknown };
let writes: Array<{ status: number; body: unknown }>;

const envelope = (data: unknown) => ({ success: true, data });
const listed = (refs: ConnectorCredentialRef[]) => ({ status: 200, body: envelope({ credentialRefs: refs, total: refs.length }) });

beforeEach(() => {
  calls = [];
  writes = [];
  listing = listed([TOKEN, SECRET, OTHER_PACKAGE, ALREADY_SET, FROM_ENV]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const answer = url === DOOR && method === 'GET' ? listing : writes.shift() ?? { status: 500, body: {} };
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStep(props: Partial<React.ComponentProps<typeof ConnectorCredentialsStep>> = {}) {
  return render(
    <MemoryRouter>
      <ConnectorCredentialsStep packageId={PKG} {...props} />
    </MemoryRouter>,
  );
}

const item = (ref: string) => screen.getByTestId(`install-credential-${ref}`);

describe('what the step offers', () => {
  it('only the package\'s references an administrator can still set', async () => {
    renderStep();
    const step = await screen.findByTestId('install-credentials-step');
    expect(within(step).getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByTestId('install-credential-BILLING_API_TOKEN')).toBeInTheDocument();
    expect(screen.getByTestId('install-credential-BILLING_WEBHOOK_SECRET')).toBeInTheDocument();
    for (const ref of ['CRM_API_KEY', 'BILLING_REGION', 'BILLING_ENV_KEY']) {
      expect(screen.queryByTestId(`install-credential-${ref}`)).toBeNull();
    }
    expect(within(item('BILLING_API_TOKEN')).getByText('billing_api')).toBeInTheDocument();
    expect((screen.getByLabelText('New value for BILLING_API_TOKEN') as HTMLInputElement).value).toBe('');
  });

  it('draws nothing when the package needs no credential', async () => {
    listing = listed([OTHER_PACKAGE, ALREADY_SET]);
    const { container } = renderStep();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('where the listing cannot be read, shows the install answer\'s note', async () => {
    listing = { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: 'walled' } } };
    renderStep({ fallbackNote: NOTE });
    expect(await screen.findByTestId('install-credentials-note')).toHaveTextContent(NOTE);
    expect(screen.queryByTestId('install-credentials-step')).toBeNull();
  });

  it('CONTROL: unreadable and no note draws nothing', async () => {
    listing = { status: 404, body: {} };
    const { container } = renderStep();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('setting and skipping', () => {
  it('a value the door answers `set` closes its row; the other stays open', async () => {
    writes.push({ status: 200, body: envelope({ ...TOKEN, status: 'set', source: 'object' }) });
    renderStep();
    await screen.findByTestId('install-credentials-step');

    fireEvent.change(screen.getByLabelText('New value for BILLING_API_TOKEN'), { target: { value: TYPED } });
    fireEvent.click(within(item('BILLING_API_TOKEN')).getByRole('button', { name: 'Save' }));

    const done = await screen.findByTestId('install-credentials-set');
    expect(within(done).getByText('BILLING_API_TOKEN')).toBeInTheDocument();
    expect(screen.queryByTestId('install-credential-BILLING_API_TOKEN')).toBeNull();
    expect(screen.getByTestId('install-credential-BILLING_WEBHOOK_SECRET')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([
      { url: `${DOOR}/BILLING_API_TOKEN`, method: 'PUT', body: { value: TYPED } },
    ]);
    expect(document.body.innerHTML).not.toContain(TYPED);
  });

  it('an answer that is not `set` keeps the row open with the upstream\'s reason', async () => {
    writes.push({
      status: 200,
      body: envelope({ ...TOKEN, status: 'rejected', source: 'object', statusReason: '401 Unauthorized' }),
    });
    renderStep();
    await screen.findByTestId('install-credentials-step');

    fireEvent.change(screen.getByLabelText('New value for BILLING_API_TOKEN'), { target: { value: TYPED } });
    fireEvent.click(within(item('BILLING_API_TOKEN')).getByRole('button', { name: 'Save' }));

    expect(await within(item('BILLING_API_TOKEN')).findByText('The upstream refused it: 401 Unauthorized')).toBeInTheDocument();
    expect(screen.queryByTestId('install-credentials-set')).toBeNull();
  });

  it('Skip for now lists it as skipped, links to the Setup page, and sends nothing', async () => {
    renderStep();
    await screen.findByTestId('install-credentials-step');
    fireEvent.click(within(item('BILLING_WEBHOOK_SECRET')).getByRole('button', { name: 'Skip for now' }));

    const skipped = screen.getByTestId('install-credentials-skipped');
    expect(within(skipped).getByText('BILLING_WEBHOOK_SECRET')).toBeInTheDocument();
    expect(within(skipped).getByRole('link', { name: 'Set them in Connector credentials' })).toHaveAttribute(
      'href',
      '/apps/setup/component/automation/connector-credentials',
    );
    expect(screen.queryByTestId('install-credential-BILLING_WEBHOOK_SECRET')).toBeNull();
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});
