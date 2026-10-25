/**
 * objectui#12365 — the remediation overlay routes `PASSWORD_RESET_REQUIRED`
 * (an administrator-forced password change, objectstack#23287 ruling C′) to
 * the change-password form, the way it routes `PASSWORD_EXPIRED`, and does
 * not tell the user their password "has expired" when it has not.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

type Gate = { code: string; message: string };
let gate: Gate | null = null;

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    remediationRequired: gate,
    setRemediationRequired: vi.fn(),
    changePassword: vi.fn(),
    enrollTotp: vi.fn(),
    verifyTotp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { RemediationOverlay } from '../RemediationOverlay';

function renderWith(next: Gate) {
  gate = next;
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RemediationOverlay />
    </I18nProvider>,
  );
}

describe('RemediationOverlay — PASSWORD_RESET_REQUIRED (objectui#12365)', () => {
  it('shows the change-password form for a forced reset, under a reset title', () => {
    renderWith({ code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' });
    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm new password')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'You must change your password' })).toBeTruthy();
    expect(screen.queryByText('Your password has expired')).toBeNull();
    // Not the MFA enrolment form.
    expect(screen.queryByText('Set up two-factor authentication')).toBeNull();
  });

  it('keeps the expiry title for PASSWORD_EXPIRED', () => {
    renderWith({ code: 'PASSWORD_EXPIRED', message: '' });
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your password has expired' })).toBeTruthy();
  });
});
