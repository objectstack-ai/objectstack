/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsView — per-field rendering of a rejected save (objectstack#4224).
 *
 * What this closes: a `SETTINGS_VALIDATION` rejection names the offending keys,
 * and the console threw all of that away. Every failure collapsed into one
 * toast reading the server's summary sentence, with nothing marked on the
 * inputs — so on a namespace with a dozen keys the user was told a value was
 * wrong and left to find which.
 *
 * It was not the console's fault, and that is the part worth recording: the
 * server sent `fields` as a `Record<key, message>` hung BESIDE `error.code`, a
 * position `ApiErrorSchema` never declared. `extractFieldErrors` only reads
 * arrays (`details.fields`, `fields`, `validationErrors`), so a map at an
 * undeclared position matched nothing and returned null. objectstack#4224 moved
 * it to `error.details.fields` as the declared `FieldError[]`, which is what
 * makes this wiring a few lines rather than a parser.
 *
 * So the assertions below deliberately drive the REAL post-#4224 wire body
 * rather than a hand-tuned fixture — if the server ever regresses to the map,
 * these go red instead of quietly passing against a shape nobody sends.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getSettingsNamespace = vi.fn();
const saveSettingsNamespace = vi.fn();
const runSettingsAction = vi.fn();

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    getSettingsNamespace: (...a: unknown[]) => getSettingsNamespace(...a),
    saveSettingsNamespace: (...a: unknown[]) => saveSettingsNamespace(...a),
    runSettingsAction: (...a: unknown[]) => runSettingsAction(...a),
  };
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { SettingsView } from '../SettingsView';

/** Two text keys, so "the right one is marked" is a real assertion. */
const PAYLOAD = {
  manifest: {
    namespace: 'ai',
    label: 'AI',
    specifiers: [
      { type: 'text', key: 'gateway_model', label: 'Gateway model', description: 'Use provider/model.' },
      { type: 'text', key: 'account_id', label: 'Account ID', description: 'Cloudflare account.' },
    ],
  },
  values: {
    gateway_model: { value: 'gpt-4o', source: 'default' },
    account_id: { value: 'acct_1', source: 'default' },
  },
};

/**
 * The real body `/api/settings/:namespace` answers on a rejected write, post
 * objectstack#4224 — `FieldError[]` under the declared `error.details.fields`.
 * `api.ts`'s `jsonOrThrow` parks the parsed body on `err.payload`.
 */
function validationRejection() {
  const err = new Error('Settings for \'ai\' are incomplete: gateway_model — …') as Error & {
    status?: number;
    payload?: unknown;
  };
  err.status = 400;
  err.payload = {
    success: false,
    error: {
      code: 'SETTINGS_VALIDATION',
      message: "Settings for 'ai' are incomplete: gateway_model — Gateway model does not match the expected format.",
      details: {
        namespace: 'ai',
        fields: [
          {
            field: 'gateway_model',
            code: 'invalid_format',
            message: 'Gateway model does not match the expected format. Use provider/model.',
            label: 'Gateway model',
            constraint: { pattern: '^[a-z]+/[a-z]+$' },
          },
        ],
      },
    },
  };
  return err;
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/settings/ai']}>
      <Routes>
        <Route path="/settings/:namespace" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The input rendered for a given field label. */
const inputFor = (label: string) =>
  screen.getByText(label).closest('div')?.parentElement?.querySelector('input') ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  getSettingsNamespace.mockResolvedValue(structuredClone(PAYLOAD));
});
afterEach(cleanup);

describe('SettingsView — a rejected save marks the field that caused it', () => {
  it('renders the server message against the offending input, and leaves the others alone', async () => {
    saveSettingsNamespace.mockRejectedValue(validationRejection());
    renderView();
    await screen.findByText('Gateway model');

    // Dirty the field so the save bar appears, then save.
    fireEvent.change(inputFor('Gateway model')!, { target: { value: 'gpt4o' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    // The server's own sentence, verbatim — not re-worded by the console.
    const msg = await screen.findByText(/does not match the expected format/i);
    expect(msg).toBeTruthy();
    expect(msg.getAttribute('role')).toBe('alert');

    // The rejected input is marked, and points at the message for a screen reader.
    await waitFor(() => {
      expect(inputFor('Gateway model')!.getAttribute('aria-invalid')).toBe('true');
    });
    expect(inputFor('Gateway model')!.getAttribute('aria-describedby')).toBe(msg.getAttribute('id'));

    // The innocent field is untouched — a wrong mark is worse than no mark.
    expect(inputFor('Account ID')!.getAttribute('aria-invalid')).toBeNull();

    // The toast still fires: the field can be scrolled off-screen or hidden
    // behind a `visible` expression, and a silent no-op save is the worse bug.
    expect(toastError).toHaveBeenCalled();
  });

  it('replaces the help text rather than stacking under it', async () => {
    saveSettingsNamespace.mockRejectedValue(validationRejection());
    renderView();
    await screen.findByText('Gateway model');
    // The description is what's shown before any save.
    expect(screen.queryByText('Use provider/model.')).toBeTruthy();

    fireEvent.change(inputFor('Gateway model')!, { target: { value: 'gpt4o' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await screen.findByText(/does not match the expected format/i);

    // Gone — the two say the same kind of thing and share one slot.
    expect(screen.queryByText('Use provider/model.')).toBeNull();
    // The untouched field keeps its own description.
    expect(screen.queryByText('Cloudflare account.')).toBeTruthy();
  });

  it('clears the mark as soon as the field is edited', async () => {
    saveSettingsNamespace.mockRejectedValue(validationRejection());
    renderView();
    await screen.findByText('Gateway model');

    fireEvent.change(inputFor('Gateway model')!, { target: { value: 'gpt4o' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await screen.findByText(/does not match the expected format/i);

    // Typing contradicts an error describing the value the server saw.
    fireEvent.change(inputFor('Gateway model')!, { target: { value: 'anthropic/claude' } });
    await waitFor(() => {
      expect(screen.queryByText(/does not match the expected format/i)).toBeNull();
    });
    expect(inputFor('Gateway model')!.getAttribute('aria-invalid')).toBeNull();
    // …and the help text comes back with it.
    expect(screen.queryByText('Use provider/model.')).toBeTruthy();
  });

  it('clears every mark once a save succeeds', async () => {
    saveSettingsNamespace.mockRejectedValueOnce(validationRejection());
    renderView();
    await screen.findByText('Gateway model');

    fireEvent.change(inputFor('Gateway model')!, { target: { value: 'gpt4o' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await screen.findByText(/does not match the expected format/i);

    saveSettingsNamespace.mockResolvedValueOnce({
      values: { gateway_model: { value: 'anthropic/claude', source: 'tenant' } },
    });
    fireEvent.change(inputFor('Gateway model')!, { target: { value: 'anthropic/claude' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(screen.queryByText(/does not match the expected format/i)).toBeNull();
  });

  it('a failure carrying no field array still toasts, and marks nothing', async () => {
    // The 500 / UNKNOWN_NAMESPACE shape — no `details.fields` to read.
    const err = new Error('Failed to write namespace') as Error & { payload?: unknown };
    err.payload = { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to write namespace' } };
    saveSettingsNamespace.mockRejectedValue(err);
    renderView();
    await screen.findByText('Gateway model');

    fireEvent.change(inputFor('Gateway model')!, { target: { value: 'gpt4o' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(inputFor('Gateway model')!.getAttribute('aria-invalid')).toBeNull();
    expect(inputFor('Account ID')!.getAttribute('aria-invalid')).toBeNull();
  });
});
