/**
 * The forced-reset screen (`PASSWORD_RESET_REQUIRED`, an administrator's
 * forced password change) asks for a password different from the temporary
 * one: the server refuses the current password as the new one while the forced
 * change is outstanding (`PASSWORD_REUSE`, whatever the history depth), so the
 * screen says so in the user's language and sends no change that cannot
 * complete. An expiry (`PASSWORD_EXPIRED`) is not a forced reset and keeps its
 * behaviour: the server, not this screen, judges reuse there.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

type Gate = { code: string; message: string };
let gate: Gate | null = null;
const changePassword = vi.fn(async () => {});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    remediationRequired: gate,
    setRemediationRequired: vi.fn(),
    changePassword,
    enrollTotp: vi.fn(),
    verifyTotp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { RemediationOverlay } from '../RemediationOverlay';

function renderWith(next: Gate, language: string) {
  gate = next;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RemediationOverlay />
    </I18nProvider>,
  );
}

function submit(current: string, next: string, labels: { current: string; next: string; confirm: string }) {
  fireEvent.change(screen.getByLabelText(labels.current), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(labels.next), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(labels.confirm), { target: { value: next } });
  fireEvent.submit(screen.getByLabelText(labels.next).closest('form') as HTMLFormElement);
}

// A forced reset names the field for the password an administrator issued;
// an expiry keeps "Current password".
const EN = { current: 'Temporary password', next: 'New password', confirm: 'Confirm new password' };
const EN_EXPIRED = { ...EN, current: 'Current password' };
const ZH = { current: '临时密码', next: '新密码', confirm: '确认新密码' };
const FORCED: Gate = { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' };

beforeEach(() => {
  changePassword.mockClear();
});
afterEach(cleanup);

describe('RemediationOverlay — a forced reset asks for a new password', () => {
  it('refuses the temporary password as the new one, in English, and sends nothing', async () => {
    renderWith(FORCED, 'en');
    submit('Temp0rary!Issued', 'Temp0rary!Issued', EN);
    expect(
      await screen.findByText('Choose a new password that is different from your temporary password.'),
    ).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('says it in the user’s language (zh-CN)', async () => {
    renderWith(FORCED, 'zh');
    submit('Temp0rary!Issued', 'Temp0rary!Issued', ZH);
    expect(await screen.findByText('请设置一个与临时密码不同的新密码。')).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('sends a different new password on to the server', async () => {
    renderWith(FORCED, 'en');
    submit('Temp0rary!Issued', 'Ch0sen!ByThe-User', EN);
    await vi.waitFor(() => expect(changePassword).toHaveBeenCalledWith('Temp0rary!Issued', 'Ch0sen!ByThe-User'));
    expect(screen.queryByText('Choose a new password that is different from your temporary password.')).toBeNull();
  });

  it('leaves an expiry to the server: the same password is sent on', async () => {
    renderWith({ code: 'PASSWORD_EXPIRED', message: '' }, 'en');
    submit('Same!Passw0rd-1', 'Same!Passw0rd-1', EN_EXPIRED);
    await vi.waitFor(() => expect(changePassword).toHaveBeenCalledWith('Same!Passw0rd-1', 'Same!Passw0rd-1'));
    expect(screen.queryByText('Choose a new password that is different from your temporary password.')).toBeNull();
  });
});
