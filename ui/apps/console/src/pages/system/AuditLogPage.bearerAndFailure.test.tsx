// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Audit Log — the ledger read and its failure state.
 *
 *   - The `/data/sys_audit_log` read goes through the console's authenticated
 *     fetch, so a session held by its bearer token alone reads the ledger like
 *     every other console page; with no token stored it goes out cookie-only,
 *     as before.
 *   - A read that failed is not "no audit records": the empty state is drawn
 *     only for a read that answered with no rows.
 *   - The failure text is the refusal's own sentence when the envelope carries
 *     one, and the page's own "Failed to load audit log" otherwise — never the
 *     raw response body or a bare machine code.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TokenStorage } from '@object-ui/auth';

const { ADAPTER } = vi.hoisted(() => ({
  ADAPTER: {
    find: async () => ({ data: [], total: 0 }),
    findOne: async () => null,
    getObjectSchema: async () => undefined,
  },
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

import { AuditLogPage } from './AuditLogPage';

const TOKEN = 'stored-session-token';
/** The REST seam's anonymous-deny body, verbatim. */
const ANONYMOUS_DENY = {
  error: 'UNAUTHENTICATED',
  code: 'UNAUTHENTICATED',
  message: 'Authentication is required to access this endpoint.',
};
const ROW = { id: 'a1', created_at: '2026-11-24T10:00:00.000Z', action: 'create', object_name: 'account', record_id: 'r1' };

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Sent = { credentials: RequestCredentials | undefined; authorization: string | null };
let sent: Sent[] = [];

/** A ledger that answers only a request carrying the bearer, as a server with no session cookie does. */
function serveBearerOnly() {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      sent.push({ credentials: init?.credentials, authorization });
      return authorization === `Bearer ${TOKEN}`
        ? reply({ object: 'sys_audit_log', records: [ROW], total: 1 })
        : reply(ANONYMOUS_DENY, 401);
    }),
  );
}

function serve(response: () => Response) {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ credentials: init?.credentials, authorization: new Headers(init?.headers).get('Authorization') });
      return response();
    }),
  );
}

const renderPage = () => render(<MemoryRouter><AuditLogPage /></MemoryRouter>);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  TokenStorage.clear();
});

describe('Audit Log — the ledger read carries the stored bearer token', () => {
  it('with a token stored, the read sends `Authorization: Bearer <token>` and lists the ledger', async () => {
    TokenStorage.set(TOKEN);
    serveBearerOnly();
    renderPage();
    expect(await screen.findByText('account')).toBeInTheDocument();
    expect(sent[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent[0].credentials).toBe('include');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('with no token stored, the read goes out cookie-only, as before', async () => {
    serve(() => reply({ object: 'sys_audit_log', records: [ROW], total: 1 }));
    renderPage();
    expect(await screen.findByText('account')).toBeInTheDocument();
    expect(sent[0].authorization).toBeNull();
    expect(sent[0].credentials).toBe('include');
  });
});

describe('Audit Log — a failed read is not the empty state', () => {
  it('a 401 shows the page\'s own failure sentence, not the raw body, and no "No audit entries"', async () => {
    serve(() => reply(ANONYMOUS_DENY, 401));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load audit log');
    expect(alert.textContent).not.toMatch(/HTTP 401/);
    expect(alert.textContent).not.toMatch(/\{/);
    expect(alert.textContent).not.toMatch(/UNAUTHENTICATED/);
    expect(screen.queryByText('No audit entries')).toBeNull();
  });

  it('a refusal in the declared envelope shows its own sentence', async () => {
    serve(() => reply({ success: false, error: { code: 'PERMISSION_DENIED', message: 'You cannot read the audit log.' } }, 403));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You cannot read the audit log.');
    expect(screen.queryByText('No audit entries')).toBeNull();
  });

  it('a read that answered with no rows still draws the empty state', async () => {
    serve(() => reply({ object: 'sys_audit_log', records: [], total: 0 }));
    renderPage();
    expect(await screen.findByText('No audit entries')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
