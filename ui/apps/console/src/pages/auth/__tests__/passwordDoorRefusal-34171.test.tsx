/**
 * objectstack#34171 — a cloud-managed runtime refuses the reset-password and
 * set-password doors with 409 `RESOURCE_CONFLICT`, because no local password is
 * set or reset there for anyone. The console's two pages show that refusal in
 * the session's language, pointing at the identity provider's button, through
 * app-shell's `passwordDoorRefusalMessages`. Any other refusal keeps the
 * server's text. Only `useAuth` and the toast are replaced; the pages, the
 * refusal map and the zh pack are real.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';

let authState: Record<string, unknown>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authState,
}));

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

const { ResetPasswordPage } = await import('../ResetPasswordPage');
const { SetPasswordPage } = await import('../SetPasswordPage');

registerBuiltInLocales();

const zh = builtInLocales['zh-Hans'].auth;
const SERVER_TEXT = 'This environment is cloud-managed: no local password is set or reset here.';

function coded(code: string, message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = code;
  return err;
}

function renderAt(path: string, page: React.ReactElement) {
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
    </I18nProvider>,
  );
}

async function fillAndSubmit(labels: { newPassword: string; confirmPassword: string; submit: string }) {
  await userEvent.type(await screen.findByLabelText(labels.newPassword), 'new-password-1');
  await userEvent.type(screen.getByLabelText(labels.confirmPassword), 'new-password-1');
  await userEvent.click(screen.getByRole('button', { name: labels.submit }));
}

/** The description of the one error toast the page raised. */
async function toastDescription(): Promise<unknown> {
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  return (vi.mocked(toast.error).mock.calls[0][1] as { description?: unknown } | undefined)?.description;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ResetPasswordPage — a cloud-managed refusal is localized (objectstack#34171)', () => {
  async function refusedWith(err: Error): Promise<unknown> {
    authState = { resetPassword: vi.fn().mockRejectedValue(err) };
    renderAt('/reset-password?token=tok', <ResetPasswordPage />);
    await fillAndSubmit(zh.resetPassword);
    return toastDescription();
  }

  it('RESOURCE_CONFLICT shows the localized reset sentence, not the server text', async () => {
    expect(await refusedWith(coded('RESOURCE_CONFLICT', SERVER_TEXT))).toBe(zh.login.errors.managedPasswordReset);
  });

  it('CONTROL: another refusal keeps its server message', async () => {
    expect(await refusedWith(coded('INVALID_TOKEN', 'Invalid token'))).toBe('Invalid token');
  });
});

describe('SetPasswordPage — a cloud-managed refusal is localized (objectstack#34171)', () => {
  async function refusedWith(err: Error): Promise<unknown> {
    authState = {
      user: { id: 'u1', name: 'Dana', email: 'dana@example.com' },
      isLoading: false,
      setInitialPassword: vi.fn().mockRejectedValue(err),
    };
    renderAt('/set-password', <SetPasswordPage />);
    await fillAndSubmit(zh.setPassword);
    return toastDescription();
  }

  it('RESOURCE_CONFLICT shows the localized reset sentence, not the server text', async () => {
    expect(await refusedWith(coded('RESOURCE_CONFLICT', SERVER_TEXT))).toBe(zh.login.errors.managedPasswordReset);
  });

  it('CONTROL: another refusal keeps its server message', async () => {
    expect(await refusedWith(coded('CREDENTIAL_ACCOUNT_EXISTS', 'A password is already set'))).toBe(
      'A password is already set',
    );
  });
});
