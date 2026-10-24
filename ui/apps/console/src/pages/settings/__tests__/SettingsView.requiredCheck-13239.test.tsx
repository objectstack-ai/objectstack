/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsView — a visible `required` field left empty blocks Save
 * (objectui#13239).
 *
 * The spec declares `required` as "renderer + server-side validation". The
 * settings service judges only the keys a save touches, and the page sends only
 * the keys that were edited, so a required key nobody touched was never judged
 * by anyone: Setup → Email with Host and From email empty saved on a change to
 * From name alone. The renderer half is checked here, before the request.
 *
 * The fixture is the mail manifest's shape: `smtp_host` required and visible
 * only for the `smtp` provider, `from_email` required and always visible,
 * `api_key` required and visible only for the API providers.
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

const SMTP_ONLY = "${data.provider === 'smtp'}";
const API_ONLY = "${data.provider === 'resend' || data.provider === 'postmark'}";

function mailPayload(values: Record<string, { value: unknown; locked?: boolean; lockedReason?: string; source?: string }>) {
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    resolved[k] = { source: 'default', locked: false, ...v };
  }
  return {
    manifest: {
      namespace: 'mail',
      label: 'Email',
      specifiers: [
        { type: 'group', id: 'smtp', label: 'SMTP', required: false, visible: SMTP_ONLY },
        { type: 'text', key: 'smtp_host', label: 'Host', required: true, visible: SMTP_ONLY },
        { type: 'password', key: 'api_key', label: 'API key', required: true, visible: API_ONLY },
        { type: 'email', key: 'from_email', label: 'From email', required: true },
        { type: 'text', key: 'from_name', label: 'From name', required: false },
      ],
    },
    values: resolved,
  };
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/settings/mail']}>
      <Routes>
        <Route path="/settings/:namespace" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The row a key renders, found by the attribute the page focuses it through. */
const rowFor = (key: string) =>
  document.querySelector<HTMLElement>(`[data-settings-key="${key}"]`);
const inputFor = (key: string) => rowFor(key)?.querySelector('input') ?? null;

/** Edit only From name, then press Save. */
async function editFromNameAndSave() {
  await screen.findByText('From name');
  fireEvent.change(inputFor('from_name')!, { target: { value: 'Acme' } });
  fireEvent.click(await screen.findByRole('button', { name: /save/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSettingsNamespace.mockResolvedValue({ values: {} });
});
afterEach(cleanup);

describe('SettingsView — a visible required field left empty blocks Save (objectui#13239)', () => {
  it('(a) Host empty, only From name changed: no request, and Host carries the required message', async () => {
    getSettingsNamespace.mockResolvedValue(
      mailPayload({
        provider: { value: 'smtp' },
        smtp_host: { value: null },
        api_key: { value: null },
        from_email: { value: 'ops@example.com' },
        from_name: { value: 'ObjectStack' },
      }),
    );
    renderView();
    await editFromNameAndSave();

    await waitFor(() => {
      expect(inputFor('smtp_host')!.getAttribute('aria-invalid')).toBe('true');
    });
    expect(saveSettingsNamespace).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();

    const message = rowFor('smtp_host')!.querySelector('[role="alert"]');
    expect(message).toBeTruthy();
    expect(inputFor('smtp_host')!.getAttribute('aria-describedby')).toBe(message!.getAttribute('id'));
    // Focus lands on the first empty required control.
    expect(document.activeElement).toBe(inputFor('smtp_host'));
    // A filled required field is not marked.
    expect(inputFor('from_email')!.getAttribute('aria-invalid')).toBeNull();
  });

  it('(b) Host filled, From email empty: blocked on From email', async () => {
    getSettingsNamespace.mockResolvedValue(
      mailPayload({
        provider: { value: 'smtp' },
        smtp_host: { value: 'smtp.example.com' },
        api_key: { value: null },
        from_email: { value: '   ' },
        from_name: { value: 'ObjectStack' },
      }),
    );
    renderView();
    await editFromNameAndSave();

    await waitFor(() => {
      expect(inputFor('from_email')!.getAttribute('aria-invalid')).toBe('true');
    });
    expect(saveSettingsNamespace).not.toHaveBeenCalled();
    expect(inputFor('smtp_host')!.getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(inputFor('from_email'));
  });

  it('(c) control: every visible required field filled, Save calls the API as before', async () => {
    getSettingsNamespace.mockResolvedValue(
      mailPayload({
        provider: { value: 'smtp' },
        smtp_host: { value: 'smtp.example.com' },
        api_key: { value: null },
        from_email: { value: 'ops@example.com' },
        from_name: { value: 'ObjectStack' },
      }),
    );
    renderView();
    await editFromNameAndSave();

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
    expect(saveSettingsNamespace).toHaveBeenCalledWith('mail', { from_name: 'Acme' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it('(d) control: a required field hidden by `visible` and empty does not block', async () => {
    // `api_key` is required and empty, but hidden for the smtp provider.
    getSettingsNamespace.mockResolvedValue(
      mailPayload({
        provider: { value: 'smtp' },
        smtp_host: { value: 'smtp.example.com' },
        api_key: { value: null },
        from_email: { value: 'ops@example.com' },
        from_name: { value: 'ObjectStack' },
      }),
    );
    renderView();
    await screen.findByText('From name');
    expect(rowFor('api_key')).toBeNull();
    await editFromNameAndSave();

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
  });

  it('an env-locked required field carrying the environment value counts as filled', async () => {
    getSettingsNamespace.mockResolvedValue(
      mailPayload({
        provider: { value: 'smtp' },
        smtp_host: {
          value: 'smtp.env.example.com',
          source: 'env',
          locked: true,
          lockedReason: 'Set via env: OS_MAIL_SMTP_HOST',
        },
        api_key: { value: null },
        from_email: { value: 'ops@example.com' },
        from_name: { value: 'ObjectStack' },
      }),
    );
    renderView();
    await editFromNameAndSave();

    await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
  });

  it('judges the draft over the stored value: clearing a stored Host blocks', async () => {
    getSettingsNamespace.mockResolvedValue(
      mailPayload({
        provider: { value: 'smtp' },
        smtp_host: { value: 'smtp.example.com' },
        api_key: { value: null },
        from_email: { value: 'ops@example.com' },
        from_name: { value: 'ObjectStack' },
      }),
    );
    renderView();
    await screen.findByText('Host');
    fireEvent.change(inputFor('smtp_host')!, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(inputFor('smtp_host')!.getAttribute('aria-invalid')).toBe('true');
    });
    expect(saveSettingsNamespace).not.toHaveBeenCalled();
  });
});
