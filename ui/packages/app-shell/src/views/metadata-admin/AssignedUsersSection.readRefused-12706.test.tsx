/**
 * ObjectUI
 * Copyright (c) 2026 ObjectStack. Licensed under the MIT license.
 *
 * A refused holders read is not an empty list (objectui#12706).
 *
 * Measured on a real server: a member opened a permission set's page, the
 * section's own read `GET /api/v1/data/sys_user_permission_set` answered 403,
 * and the section drew "0" and "No users assigned yet" over a set that has a
 * holder. `PositionHoldersSection` beside it said the refusal. This file holds
 * that the section says the refusal in the server's words, draws neither the
 * count nor the empty copy while it does, and draws the empty copy only after
 * a read that succeeded and came back empty. A refused Remove is said too: it
 * used to be swallowed with the row left in place and nothing said.
 *
 * The adapter is a real `ObjectStackAdapter` over a stubbed `fetch`, so the
 * refusal reaches the section through the real client's error stamping; the
 * 403 body below is the one the server sent in that measurement, verbatim.
 */

import * as React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { AssignedUsersSection } from './AssignedUsersSection';

vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: () => null,
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The server's sentence for a refused read or write, as it sent it. */
const REFUSAL = 'You do not have permission to perform this action. Contact your administrator if you need access.';
const refusedBody = (object: string) => ({ error: REFUSAL, code: 'PERMISSION_DENIED', object });

const EMPTY_COPY = /No users assigned yet/i;

/** How the data route answers, per `METHOD object`; unlisted reads answer no rows. */
let answers: Record<string, () => Response> = {};

function makeAdapter() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/api/v1/discovery')) {
      return json(200, { success: true, data: { version: 'v0', routes: {}, capabilities: {} } });
    }
    const data = /\/api\/v1\/data\/([^/?]+)/.exec(url);
    if (data) {
      const answer = answers[`${method} ${data[1]}`];
      if (answer) return answer();
      if (method === 'GET') return json(200, { object: data[1], records: [], total: 0 });
    }
    return json(500, { error: { code: 'UNEXPECTED_REQUEST', message: `${method} ${url}` } });
  });
  return new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
}

function renderSection() {
  render(
    <AdapterCtx.Provider value={makeAdapter() as never}>
      <AssignedUsersSection permissionSetName="crm_sales_user" />
    </AdapterCtx.Provider>,
  );
}

/** The section's header line: its title, then the count when one is drawn. */
const headerText = () => screen.getByText('Assigned Users').parentElement?.textContent ?? '';

beforeEach(() => {
  answers = {};
});
afterEach(() => {
  cleanup();
});

describe('AssignedUsersSection — a refused read is said, not drawn as empty (objectui#12706)', () => {
  it('a 403 holders read shows the refusal, and neither "No users assigned yet" nor a count', async () => {
    answers['GET sys_user_permission_set'] = () => json(403, refusedBody('sys_user_permission_set'));

    renderSection();

    const said = await screen.findByTestId('assigned-users-read-failed');
    expect(said).toHaveAttribute('role', 'alert');
    expect(said.textContent).toBe(REFUSAL);
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(headerText()).toBe('Assigned Users');
  });

  it('CONTROL — a 200 empty read shows the empty copy and the count, and no refusal', async () => {
    renderSection();

    await waitFor(() => expect(screen.getByText(EMPTY_COPY)).toBeTruthy());
    expect(screen.queryByTestId('assigned-users-read-failed')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(headerText()).toBe('Assigned Users0');
  });

  it('a refused Remove says so in the server\'s words, and the row stays', async () => {
    answers['GET sys_user_permission_set'] = () =>
      json(200, {
        object: 'sys_user_permission_set',
        records: [{ id: 'grant_1', permission_set: 'crm_sales_user', user_id: 'u_direct' }],
        total: 1,
      });
    answers['GET sys_user'] = () =>
      json(200, { object: 'sys_user', records: [{ id: 'u_direct', name: 'Direct Dana', email: 'dana@example.com' }], total: 1 });
    answers['DELETE sys_user_permission_set'] = () => json(403, refusedBody('sys_user_permission_set'));

    renderSection();
    await waitFor(() => expect(screen.getByText('Direct Dana')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Remove'));
    // Remove confirms first (objectui#13408); the delete follows the confirm.
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(REFUSAL);
    expect(screen.getByText('Direct Dana')).toBeTruthy();
  });
});
