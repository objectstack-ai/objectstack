// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Profile — the password card draws a refusal's localized sentence, not the
 * server's English one.
 *
 * A cloud-managed runtime, an SSO-only account and a pending SSO person are
 * refused a local password with 409 `RESOURCE_CONFLICT`. The set-password and
 * reset-password pages map that code through `passwordDoorRefusalMessages`
 * (app-shell); the profile page's password card set the server's `message`
 * instead, which is English in every language. These cases render the REAL
 * page and the REAL map; only the page's data hooks are stubbed, as in the
 * sibling profile suites. The translator echoes each call site's
 * `defaultValue` and is a spy, so a case can name the pack key it read.
 *
 * CONTROL: another code (a wrong current password) and a rejection with no
 * code keep the server's own message.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { ADAPTER, translate, auth } = vi.hoisted(() => ({
  ADAPTER: { findOne: async () => ({ id: 'usr_1' }), update: async () => ({}) },
  translate: vi.fn((key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
      String(options?.[name] ?? ''),
    ),
  ),
  auth: {
    hasPassword: true,
    changePassword: async (_current: string, _next: string): Promise<void> => {},
    setInitialPassword: async (_next: string): Promise<void> => {},
  },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
    updateUser: async () => {},
    isLoading: false,
    changePassword: (current: string, next: string) => auth.changePassword(current, next),
    setInitialPassword: (next: string) => auth.setInitialPassword(next),
    hasLocalPassword: async () => auth.hasPassword,
  }),
}));

vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpload: () => ({ upload: async () => ({ url: '' }) }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: translate, language: 'en', offerableLanguages: ['en'] }),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({ isLoaded: true, checkField: () => true }),
}));

// Imported after the mocks so the page picks them up.
const { ProfilePage } = await import('../ProfilePage');

const SERVER_TEXT = 'This environment is cloud-managed: no local password is set or reset here.';
const LOCALIZED =
  "This deployment signs you in through its identity provider, so no password is set or reset here. Sign in with the identity provider's button on the sign-in page.";

function refusal(message: string, code?: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  if (code) err.code = code;
  err.status = 409;
  return err;
}

afterEach(() => {
  cleanup();
  translate.mockClear();
  auth.hasPassword = true;
  auth.changePassword = async () => {};
  auth.setInitialPassword = async () => {};
});

async function submit(kind: 'change' | 'set'): Promise<HTMLElement> {
  render(<ProfilePage />);
  const action = kind === 'change' ? 'Change password' : 'Set password';
  const button = await screen.findByRole('button', { name: action });
  await waitFor(() => expect(button).toBeEnabled());
  if (kind === 'change') {
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password-1' } });
  }
  fireEvent.change(document.getElementById('new-password')!, { target: { value: 'new-password-1' } });
  fireEvent.change(document.getElementById('confirm-password')!, { target: { value: 'new-password-1' } });
  fireEvent.click(button);
  return button;
}

describe('profile password card — RESOURCE_CONFLICT draws the password-door sentence', () => {
  it('set-password: the localized sentence, read from the password-door pack key', async () => {
    auth.hasPassword = false;
    auth.setInitialPassword = async () => { throw refusal(SERVER_TEXT, 'RESOURCE_CONFLICT'); };
    await submit('set');
    expect(await screen.findByText(LOCALIZED)).toBeInTheDocument();
    expect(screen.queryByText(SERVER_TEXT)).not.toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('auth.login.errors.managedPasswordReset', expect.anything());
  });

  it('change-password: the localized sentence too', async () => {
    auth.changePassword = async () => { throw refusal(SERVER_TEXT, 'RESOURCE_CONFLICT'); };
    await submit('change');
    expect(await screen.findByText(LOCALIZED)).toBeInTheDocument();
    expect(screen.queryByText(SERVER_TEXT)).not.toBeInTheDocument();
  });

  it('CONTROL: another code (a wrong current password) keeps the server message', async () => {
    auth.changePassword = async () => { throw refusal('Invalid password', 'INVALID_PASSWORD'); };
    await submit('change');
    expect(await screen.findByText('Invalid password')).toBeInTheDocument();
    expect(screen.queryByText(LOCALIZED)).not.toBeInTheDocument();
  });

  it('CONTROL: a rejection without a code keeps its message', async () => {
    auth.hasPassword = false;
    auth.setInitialPassword = async () => { throw new Error('Set password failed with status 500'); };
    await submit('set');
    expect(await screen.findByText('Set password failed with status 500')).toBeInTheDocument();
    expect(screen.queryByText(LOCALIZED)).not.toBeInTheDocument();
  });
});
