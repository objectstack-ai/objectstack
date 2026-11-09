/**
 * The enrollment screen says, in the user's language, that two-factor is off
 * on the deployment when the server answers 404 (objectstack#30295).
 *
 * `POST /two-factor/enable` is mounted only while two-factor is on, so a 404
 * means no password the user types can succeed. The screen used to show the
 * client's English `Two-factor enable failed (404)`. A 404 now reads as a
 * translated sentence saying who can turn it on; a wrong password reads as the
 * password screen's sentence; any other refusal keeps the server's message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

let refusal: Error & { code?: string; status?: number } = new Error('Two-factor enable failed (404)');
const enrollTotp = vi.fn(async () => { throw refusal; });

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    remediationRequired: { code: 'MFA_REQUIRED', message: '' },
    setRemediationRequired: vi.fn(),
    changePassword: vi.fn(),
    enrollTotp,
    verifyTotp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { RemediationOverlay } from '../RemediationOverlay';

const refused = (message: string, extra: { code?: string; status?: number }) =>
  Object.assign(new Error(message), extra);

function submitPassword(language: string, label: string) {
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RemediationOverlay />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByLabelText(label), { target: { value: 'admin123' } });
  fireEvent.submit(screen.getByLabelText(label).closest('form') as HTMLFormElement);
}

beforeEach(() => {
  enrollTotp.mockClear();
});
afterEach(cleanup);

describe('RemediationOverlay — an enrollment refusal reads in the user’s language (#30295)', () => {
  it('zh: a 404 says two-factor is off and who can turn it on, not “failed (404)”', async () => {
    refusal = refused('Two-factor enable failed (404)', { status: 404 });
    submitPassword('zh', '确认您的密码');
    expect(
      await screen.findByText('此部署未开启双重验证，暂时无法绑定身份验证器。请联系管理员在“设置 → 认证”中开启后再试。'),
    ).toBeTruthy();
    expect(screen.queryByText('Two-factor enable failed (404)')).toBeNull();
    expect(enrollTotp).toHaveBeenCalledTimes(1);
  });

  it('en: a 404 shows the English sentence', async () => {
    refusal = refused('Two-factor enable failed (404)', { status: 404 });
    submitPassword('en', 'Confirm your password');
    expect(
      await screen.findByText(
        'Two-factor authentication is turned off on this deployment, so an authenticator app cannot be set up yet. Ask an administrator to turn it on in Setup → Authentication, then try again.',
      ),
    ).toBeTruthy();
  });

  it('zh: INVALID_PASSWORD shows the password screen’s sentence', async () => {
    refusal = refused('Invalid password', { status: 400, code: 'INVALID_PASSWORD' });
    submitPassword('zh', '确认您的密码');
    expect(await screen.findByText('你输入的密码不正确，请检查后重试。')).toBeTruthy();
  });

  it('CONTROL: another refusal keeps the server’s message', async () => {
    refusal = refused('Too many requests. Please try again later.', { status: 429 });
    submitPassword('en', 'Confirm your password');
    expect(await screen.findByText('Too many requests. Please try again later.')).toBeTruthy();
  });
});
