/**
 * The password-change screen translates a wrong current or temporary password
 * (objectstack#27869).
 *
 * The server refuses it with the code `INVALID_PASSWORD` and the English
 * message "Invalid password", and the screen used to show that message as it
 * came, so a French user read English. The code is now mapped to a translated
 * sentence; any other refusal keeps the server's message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

type Gate = { code: string; message: string };
let gate: Gate | null = null;
let refusal: Error & { code?: string } = new Error('Invalid password');
const changePassword = vi.fn(async () => { throw refusal; });

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

function submit(labels: { current: string; next: string; confirm: string }) {
  fireEvent.change(screen.getByLabelText(labels.current), { target: { value: 'Wr0ng!Temporary' } });
  fireEvent.change(screen.getByLabelText(labels.next), { target: { value: 'Ch0sen!ByThe-User' } });
  fireEvent.change(screen.getByLabelText(labels.confirm), { target: { value: 'Ch0sen!ByThe-User' } });
  fireEvent.submit(screen.getByLabelText(labels.next).closest('form') as HTMLFormElement);
}

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

const EN = { current: 'Temporary password', next: 'New password', confirm: 'Confirm new password' };
const FR = {
  current: 'Mot de passe temporaire',
  next: 'Nouveau mot de passe',
  confirm: 'Confirmer le nouveau mot de passe',
};
const FORCED: Gate = { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' };

beforeEach(() => {
  changePassword.mockClear();
});
afterEach(cleanup);

describe('RemediationOverlay — a wrong password reads in the user’s language (#27869)', () => {
  it('fr: INVALID_PASSWORD shows the French sentence, not the server’s English', async () => {
    refusal = coded('INVALID_PASSWORD', 'Invalid password');
    renderWith(FORCED, 'fr');
    submit(FR);
    expect(await screen.findByText('Le mot de passe saisi est incorrect. Vérifiez-le et réessayez.')).toBeTruthy();
    expect(screen.queryByText('Invalid password')).toBeNull();
  });

  it('en: INVALID_PASSWORD shows the English sentence', async () => {
    refusal = coded('INVALID_PASSWORD', 'Invalid password');
    renderWith(FORCED, 'en');
    submit(EN);
    expect(await screen.findByText('The password you entered is incorrect. Check it and try again.')).toBeTruthy();
  });

  it('CONTROL: another code keeps the server’s message', async () => {
    refusal = coded('PASSWORD_REUSE', 'Choose a password you have not used recently.');
    renderWith(FORCED, 'en');
    submit(EN);
    expect(await screen.findByText('Choose a password you have not used recently.')).toBeTruthy();
  });
});
