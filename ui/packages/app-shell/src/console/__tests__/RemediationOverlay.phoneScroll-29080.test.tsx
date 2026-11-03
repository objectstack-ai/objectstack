/**
 * The remediation overlay at phone width (objectstack#29080).
 *
 * The authenticator step (QR code, backup codes, code field) is taller than a
 * phone screen once the keyboard is up. Measured at 375 x 812 the card's top
 * sat 138 px above the screen and Verify under the keyboard, and nothing
 * scrolled. The overlay now scrolls and centres its card inside a `min-h-full`
 * column, and below `sm` its controls are 44 px touch targets. jsdom lays
 * nothing out, so the classes that carry each rule are read.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    remediationRequired: { code: 'MFA_REQUIRED', message: 'Set up an authenticator app.' },
    setRemediationRequired: vi.fn(),
    changePassword: vi.fn(),
    enrollTotp: vi.fn(),
    verifyTotp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { RemediationOverlay } from '../RemediationOverlay';

afterEach(cleanup);

const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('RemediationOverlay at phone width (objectstack#29080)', () => {
  it('scrolls, so a card taller than the screen keeps its top and its submit reachable', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <RemediationOverlay />
      </I18nProvider>,
    );
    const card = screen.getByTestId('remediation-card');
    const column = card.parentElement;
    const overlay = column?.parentElement ?? null;

    expect(tokens(overlay)).toEqual(expect.arrayContaining(['fixed', 'inset-0', 'overflow-y-auto']));
    // A centred flex overlay clips a tall card at both ends; the column is at
    // least the overlay's height and centres the card inside the scroll.
    expect(tokens(overlay)).not.toContain('items-center');
    expect(tokens(column)).toEqual(expect.arrayContaining(['flex', 'min-h-full', 'items-center']));

    expect(tokens(card)).toEqual(
      expect.arrayContaining([
        'max-sm:[&_button]:min-h-[44px]',
        'max-sm:[&_input]:min-h-[44px]',
        'max-sm:[&_summary]:leading-[44px]',
      ]),
    );
    // The password step is drawn inside the card.
    expect(card.querySelector('#rem-pw')).not.toBeNull();
  });
});
