// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The account app's Mobile App page (objectstack#29314): the QR code encodes
 * `objectos://connect?server=<the published public base URL>` and the same
 * link is on the page as copyable text; a loopback or private address, or no
 * published address, shows the `OS_AUTH_URL` remedy and no code.
 *
 * `t` echoes the KEY with any `address` / `setting` option appended, so the
 * assertions read which string the page asked for and with which value. The
 * QR assertion compares the image against `qrcode`'s own SVG for the expected
 * link, so it pins the payload that was actually encoded.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toString as renderQrSvg } from 'qrcode';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { address?: string; setting?: string }) =>
      `«${key}${opts?.address ? `|${opts.address}` : ''}${opts?.setting ? `|${opts.setting}` : ''}»`,
    language: 'en',
  }),
}));

let getAuthConfig: ReturnType<typeof vi.fn>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ getAuthConfig }),
}));

import { MobileAppPage } from './MobileAppPage';
import { builtInLocales } from '@object-ui/i18n/locales';
import { getAppComponent } from '../../services/componentRegistry';
// The registry check below loads every built-in page, which reaches the
// metadata admin's dynamic `@objectstack/lint` import: pay that load at
// collection, never inside a test's clocked window.
import '@objectstack/lint';
import '../../services/builtinComponents';

function serving(features: Record<string, unknown> | undefined) {
  getAuthConfig = vi.fn(async () => ({ features }));
}

async function expectedQrSrc(link: string): Promise<string> {
  const svg = await renderQrSvg(link, { type: 'svg', margin: 1 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

beforeEach(() => {
  serving({});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MobileAppPage: a public base URL renders the code and the copyable link', () => {
  it('the QR code and the link carry the published URL, sub-path included', async () => {
    serving({ publicBaseUrl: 'https://acme.example/os' });
    render(<MobileAppPage />);
    const link = 'objectos://connect?server=https%3A%2F%2Facme.example%2Fos';

    expect(await screen.findByTestId('mobile-app-link')).toHaveTextContent(link);
    const qr = await screen.findByTestId('mobile-app-qr');
    expect(qr).toHaveAttribute('src', await expectedQrSrc(link));
    expect(qr).toHaveAttribute('alt', '«mobileApp.qrAlt»');
    expect(screen.getByTestId('mobile-app-privacy')).toHaveTextContent('«mobileApp.privacy»');
    expect(screen.queryByTestId('mobile-app-refusal')).not.toBeInTheDocument();
  });

  it('a credential, query or fragment in the configured URL never reaches the code or the link', async () => {
    serving({ publicBaseUrl: 'https://ops:s3cret@acme.example/os/?token=abc#x' });
    render(<MobileAppPage />);
    const link = 'objectos://connect?server=https%3A%2F%2Facme.example%2Fos';

    expect(await screen.findByTestId('mobile-app-link')).toHaveTextContent(link);
    expect(await screen.findByTestId('mobile-app-qr')).toHaveAttribute('src', await expectedQrSrc(link));
    expect(document.body.textContent).not.toMatch(/s3cret|token/);
  });

  it('Copy link writes exactly the connect link to the clipboard', async () => {
    serving({ publicBaseUrl: 'https://os.acme.example' });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MobileAppPage />);

    fireEvent.click(await screen.findByRole('button', { name: /mobileApp\.copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('objectos://connect?server=https%3A%2F%2Fos.acme.example'));
    expect(await screen.findByRole('status')).toHaveTextContent('«mobileApp.copied»');
  });
});

describe('MobileAppPage: no code for an address a phone cannot reach', () => {
  it.each(['http://localhost:3000', 'http://192.168.1.20'])('%s: the remedy names OS_AUTH_URL and no code renders', async (address) => {
    serving({ publicBaseUrl: address });
    render(<MobileAppPage />);

    const refusal = await screen.findByTestId('mobile-app-refusal');
    expect(refusal).toHaveTextContent('«mobileApp.unreachableTitle»');
    expect(refusal).toHaveTextContent(`«mobileApp.unreachableBody|${address}|OS_AUTH_URL»`);
    expect(screen.queryByTestId('mobile-app-qr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-app-link')).not.toBeInTheDocument();
  });

  it('a public host on plain http: the HTTPS remedy names the address and OS_AUTH_URL, and no code renders', async () => {
    serving({ publicBaseUrl: 'http://os.acme.example/os' });
    render(<MobileAppPage />);

    const refusal = await screen.findByTestId('mobile-app-refusal');
    expect(refusal).toHaveTextContent('«mobileApp.insecureTitle»');
    expect(refusal).toHaveTextContent('«mobileApp.insecureBody|http://os.acme.example/os|OS_AUTH_URL»');
    expect(screen.queryByTestId('mobile-app-qr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-app-link')).not.toBeInTheDocument();
  });

  it('a credential in the configured address is shown nowhere on a refusal', async () => {
    serving({ publicBaseUrl: 'http://ops:s3cret@192.168.1.20/os' });
    render(<MobileAppPage />);

    const refusal = await screen.findByTestId('mobile-app-refusal');
    expect(refusal).toHaveTextContent('«mobileApp.unreachableBody|http://192.168.1.20/os|OS_AUTH_URL»');
    expect(document.body.textContent).not.toContain('s3cret');
  });

  it('no published address: the unpublished remedy, and the browser address is never encoded', async () => {
    serving({});
    render(<MobileAppPage />);

    const refusal = await screen.findByTestId('mobile-app-refusal');
    expect(refusal).toHaveTextContent('«mobileApp.unpublishedTitle»');
    // The server does not serve the key: no setting can fix that, so none is named.
    expect(refusal).toHaveTextContent('«mobileApp.unpublishedBody»');
    expect(refusal).not.toHaveTextContent('OS_AUTH_URL');
    expect(screen.queryByTestId('mobile-app-qr')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(window.location.host);
  });

  it('a config read that fails says so', async () => {
    getAuthConfig = vi.fn(async () => {
      throw new Error('offline');
    });
    render(<MobileAppPage />);
    expect(await screen.findByTestId('mobile-app-load-failed')).toHaveTextContent('«mobileApp.loadFailed»');
  });
});

describe('the mobileApp pack keys', () => {
  it('every built-in locale carries every key the English pack declares, placeholders kept', () => {
    const en = (builtInLocales as Record<string, { mobileApp?: Record<string, string> }>).en.mobileApp!;
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const [locale, pack] of Object.entries(builtInLocales as Record<string, { mobileApp?: Record<string, string> }>)) {
      expect(Object.keys(pack.mobileApp ?? {}).sort(), locale).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(placeholders(pack.mobileApp![key]), `${locale}.mobileApp.${key}`).toEqual(placeholders(en[key]));
      }
    }
  });
});

describe('the account:mobile_app registration', () => {
  // The platform-objects half of this pairing pins that the account app's
  // `nav_account_mobile_app` entry, right after Profile, names this ref.
  it('the ref the account app navigates to resolves to this page', async () => {
    serving({ publicBaseUrl: 'https://os.acme.example' });
    const entry = getAppComponent('account:mobile_app');
    expect(entry).toMatchObject({ ref: 'account:mobile_app', source: '@object-ui/app-shell' });
    const Registered = entry!.component;
    render(<Registered />);
    expect(await screen.findByTestId('mobile-app-page')).toBeInTheDocument();
    expect(await screen.findByTestId('mobile-app-link')).toHaveTextContent('objectos://connect?server=https%3A%2F%2Fos.acme.example');
  });
});
