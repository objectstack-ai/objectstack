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
    expect(screen.getByLabelText('Temporary password')).toBeTruthy();
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

/**
 * objectstack#27521 rows 12 and 22 — a forced reset's body and its first
 * field are the console's own words, in the user's language: the body says
 * what happened instead of repeating the title in the server's language, and
 * the field is named for the temporary password the user holds. An expiry
 * keeps the server's sentence and "Current password".
 */
describe('RemediationOverlay — a forced reset speaks in the console’s words (objectstack#27521)', () => {
  const SERVER_SENTENCE = 'You must change your password before continuing.';

  function renderIn(language: string, next: Gate) {
    gate = next;
    return render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <RemediationOverlay />
      </I18nProvider>,
    );
  }

  it('says why in its own body and names the temporary password, not the server sentence', () => {
    renderIn('en', { code: 'PASSWORD_RESET_REQUIRED', message: SERVER_SENTENCE });
    expect(screen.getByText(/An administrator set a temporary password for you/)).toBeTruthy();
    expect(screen.queryByText(SERVER_SENTENCE)).toBeNull();
    expect(screen.getByLabelText('Temporary password')).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it('reads in the user’s language (fr): title, body and fields together', async () => {
    renderIn('fr', { code: 'PASSWORD_RESET_REQUIRED', message: SERVER_SENTENCE });
    expect(await screen.findByRole('heading', { name: 'Vous devez changer votre mot de passe' })).toBeTruthy();
    expect(screen.getByText(/Un administrateur vous a attribué un mot de passe temporaire/)).toBeTruthy();
    expect(screen.queryByText(SERVER_SENTENCE)).toBeNull();
    expect(screen.getByLabelText('Mot de passe temporaire')).toBeTruthy();
  });

  it('CONTROL: an expiry keeps the server sentence and "Current password"', () => {
    renderIn('en', { code: 'PASSWORD_EXPIRED', message: 'Your password is older than 90 days.' });
    expect(screen.getByText('Your password is older than 90 days.')).toBeTruthy();
    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(screen.queryByLabelText('Temporary password')).toBeNull();
  });
});
