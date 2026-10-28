// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26805 — a non-403 refusal from `POST /api/v1/security/explain`
 * must show the server's message, not blank the panel.
 *
 * The door answers in the ADR-0112 envelope, `{ success: false, error: { code,
 * message } }`. The panel used to read `data.message || data.error`; on that
 * envelope `data.error` is the OBJECT, which reached `setError`, rendered as a
 * React child and unmounted the whole sheet — no alert, no form. The panel now
 * asks the shared envelope reader (`readEnvelopeFailureText`, pinned in
 * `utils/apiErrorEnvelope.test.ts`); this file pins that THIS call site asks it,
 * for each status band the door sends, and that the panel's older readings
 * (a flat `{ message }`, a non-JSON body, the 403 sentence) are unchanged.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchSpy = vi.fn();

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => fetchSpy,
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ find: vi.fn(async () => []) }),
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({ list: async () => [] }),
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: () => null,
}));

import { AccessExplainPanel } from './AccessExplainPanel';

afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
});

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: STATUS_TEXT[status] ?? '',
  json: async () => body,
});

/** A body exactly as `sendError` writes it. */
const envelope = (code: string, message: string) => ({ success: false, error: { code, message } });

async function explain(object: string) {
  render(<AccessExplainPanel open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByLabelText('Object'), { target: { value: object } });
  fireEvent.click(screen.getByRole('button', { name: /explain$/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  return screen.getByRole('alert').textContent ?? '';
}

/** The sheet is still there: its form survived the refusal. */
function expectPanelMounted() {
  expect(screen.getByLabelText('Object')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /explain$/i })).toBeInTheDocument();
  expect(screen.queryByTestId('explain-verdict')).not.toBeInTheDocument();
}

describe('AccessExplainPanel — a refusal in the nested envelope shows its message', () => {
  it.each([
    [404, 'OBJECT_NOT_FOUND', "Object 'crm_leed' not found"],
    [400, 'VALIDATION_FAILED', "operation must be one of 'read', 'create', 'update', 'delete'"],
    [500, 'INTERNAL_ERROR', 'Internal server error'],
  ])('%i %s — the alert carries the server message and the panel stays mounted', async (status, code, message) => {
    fetchSpy.mockResolvedValue(jsonResponse(status, envelope(code, message)));
    const alert = await explain('crm_leed');

    expect(alert).toContain(message);
    expect(alert).toContain(code);
    expect(alert).not.toContain('[object Object]');
    expectPanelMounted();
  });
});

describe('AccessExplainPanel — the readings that predate the envelope', () => {
  it('a flat `{ message }` body still shows its message', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(404, { message: 'Unknown object x' }));
    const alert = await explain('x');

    expect(alert).toContain('Unknown object x');
    expectPanelMounted();
  });

  it('a non-JSON 500 falls back to the HTTP status line', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });
    const alert = await explain('crm_lead');

    expect(alert).toContain('HTTP 500 Internal Server Error');
    expectPanelMounted();
  });

  it('a 403 in the nested envelope keeps the friendly delegated-scope sentence', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(403, envelope('PERMISSION_DENIED', '[Security] Access denied: …')));
    const alert = await explain('crm_lead');

    expect(alert).toMatch(/manage_users|delegated admin scope/i);
    expect(alert).not.toContain('PERMISSION_DENIED');
    expectPanelMounted();
  });
});

describe('AccessExplainPanel — a thrown failure reaches the alert as a string', () => {
  it('a rejected request shows its Error message', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    const alert = await explain('crm_lead');

    expect(alert).toContain('Failed to fetch');
    expectPanelMounted();
  });

  it('a non-Error rejection still leaves the panel mounted with an alert', async () => {
    fetchSpy.mockRejectedValue({ message: { code: 'NETWORK' } });
    await explain('crm_lead');

    expectPanelMounted();
  });
});
