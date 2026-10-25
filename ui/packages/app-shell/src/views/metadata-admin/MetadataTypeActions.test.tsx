// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Capture the authenticated fetch so we can assert request bodies. The
// implementation spells out the `(url, init)` parameters it never reads: a
// zero-arity `vi.fn` infers `Mock<() => …>`, whose `mock.calls` is the EMPTY
// tuple — so the `mock.calls[0]` destructurings below were reading elements of
// an empty tuple as far as the compiler was concerned (objectui#4040).
const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => ({ success: true, message: 'done' }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => mockFetch,
}));

// Toasts are the only observable output of the error path.
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

// Stub the param dialog: when open, expose a button that resolves with values —
// lets us drive the collect-params promise without the heavy field renderers.
vi.mock('../ActionParamDialog', () => ({
  ActionParamDialog: ({ state }: any) =>
    state.open ? (
      <button type="button" data-testid="submit-params" onClick={() => state.resolve?.({ reason: 'because' })}>
        submit-params
      </button>
    ) : null,
}));
// Stub the result dialog: surface its open state + data for assertions.
vi.mock('../ActionResultDialog', () => ({
  ActionResultDialog: ({ state }: any) =>
    state.open ? <div data-testid="result-dialog">{JSON.stringify(state.data)}</div> : null,
}));

import { MetadataTypeActions } from './MetadataTypeActions';

beforeEach(() => {
  mockFetch.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe('MetadataTypeActions', () => {
  // [#3142] These actions come off the server's `/meta/types` feed, and this
  // component used to carry a byte-identical copy of `action:bar`'s lenient
  // rule — so a type shipping an action with no `locations` got a button on
  // BOTH the list toolbar and the record header. Placement is declared now,
  // like everywhere else. Nothing pinned the lenient branch before, which is
  // how the two copies drifted from the rest of the repo unnoticed.
  it('renders only actions that declare the requested location', () => {
    const { container } = render(
      <MetadataTypeActions
        location="record_header"
        recordId="ds1"
        entry={{
          actions: [
            { name: 'here', label: 'Here', type: 'api', target: '/x', locations: ['record_header'] },
            { name: 'elsewhere', label: 'Elsewhere', type: 'api', target: '/x', locations: ['list_toolbar'] },
            { name: 'undeclared', label: 'Undeclared', type: 'api', target: '/x' },
          ],
        }}
      />,
    );
    expect(screen.getByTitle('Here')).toBeTruthy();
    expect(screen.queryByTitle('Elsewhere')).toBeNull();
    expect(screen.queryByTitle('Undeclared')).toBeNull();
    expect(container.textContent).not.toContain('Undeclared');
  });

  it('renders nothing when no action declares the requested location', () => {
    const { container } = render(
      <MetadataTypeActions
        location="list_toolbar"
        entry={{ actions: [{ name: 'undeclared', label: 'Undeclared', type: 'api', target: '/x' }] }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('runs an api action without params directly (no dialog)', async () => {
    render(
      <MetadataTypeActions
        location="record_header"
        recordId="ds1"
        entry={{ actions: [{ name: 'test_connection', label: 'Test', type: 'api', target: '/api/v1/datasources/${ctx.recordId}/test', locations: ['record_header'] }] }}
      />,
    );
    fireEvent.click(screen.getByTitle('Test'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/datasources/ds1/test');
    expect(screen.queryByTestId('submit-params')).toBeNull();
  });

  it('collects array params via the dialog and sends them as the body', async () => {
    render(
      <MetadataTypeActions
        location="record_header"
        recordId="ds1"
        entry={{ actions: [{ name: 'sync', label: 'Sync', type: 'api', target: '/api/v1/datasources/${ctx.recordId}/sync', locations: ['record_header'], params: [{ name: 'reason', label: 'Reason', type: 'text' }] as unknown[] }] }}
      />,
    );
    fireEvent.click(screen.getByTitle('Sync'));
    // dialog opens (params present) — no fetch yet
    const submit = await screen.findByTestId('submit-params');
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(submit);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'because' });
  });

  it('shows the result dialog when the action declares resultDialog', async () => {
    render(
      <MetadataTypeActions
        location="record_header"
        recordId="ds1"
        entry={{ actions: [{ name: 'probe', label: 'Probe', type: 'api', target: '/api/v1/x', locations: ['record_header'], resultDialog: { fields: [{ path: 'message' }] } }] }}
      />,
    );
    fireEvent.click(screen.getByTitle('Probe'));
    await waitFor(() => expect(screen.getByTestId('result-dialog')).toBeTruthy());
    expect(screen.getByTestId('result-dialog').textContent).toContain('done');
  });

  // ── framework#3843: the declared `{ success, data }` envelope ──────────────
  // Service route modules (`/api/v1/datasources`, `/api/v1/packages`,
  // `/api/settings`, …) answer `BaseResponseSchema`, so an action's payload
  // arrives under `data`. Both shapes are accepted so this repo is not coupled
  // to the framework's module-by-module merge order.

  it('unwraps the { success, data } envelope before binding the result dialog', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, data: { message: 'connection ok', latencyMs: 7 } }),
    } as never);
    render(
      <MetadataTypeActions
        location="record_header"
        recordId="ds1"
        entry={{ actions: [{ name: 'probe', label: 'Probe', type: 'api', target: '/api/v1/x', locations: ['record_header'], resultDialog: { fields: [{ path: 'message' }] } }] }}
      />,
    );
    fireEvent.click(screen.getByTitle('Probe'));
    await waitFor(() => expect(screen.getByTestId('result-dialog')).toBeTruthy());
    const shown = screen.getByTestId('result-dialog').textContent ?? '';
    expect(shown).toContain('connection ok');
    // The wrapper itself must not reach the dialog's `path` bindings.
    expect(JSON.parse(shown)).toEqual({ message: 'connection ok', latencyMs: 7 });
  });

  it('reads the failure message out of the nested error object, not "[object Object]"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ success: false, error: { code: 'datasource_admin_error', message: 'duplicate name' } }),
    } as never);
    render(
      <MetadataTypeActions
        location="record_header"
        recordId="ds1"
        entry={{ actions: [{ name: 'probe', label: 'Probe', type: 'api', target: '/api/v1/x', locations: ['record_header'] }] }}
      />,
    );
    fireEvent.click(screen.getByTitle('Probe'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const msg = String(toastError.mock.calls[0][0]);
    expect(msg).toContain('duplicate name');
    expect(msg).not.toContain('[object Object]');
  });

  it('still reads a pre-envelope bare-string error — merge order is not a coupling', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ error: 'datasource_admin_unavailable' }),
    } as never);
    render(
      <MetadataTypeActions
        location="record_header"
        recordId="ds1"
        entry={{ actions: [{ name: 'probe', label: 'Probe', type: 'api', target: '/api/v1/x', locations: ['record_header'] }] }}
      />,
    );
    fireEvent.click(screen.getByTitle('Probe'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain('datasource_admin_unavailable');
  });
});
