/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsView — a value that misses the format its specifier type declares
 * blocks Save (objectui#13287).
 *
 * ADR-0007 declares `email` / `url` / `phone` as "format validation" and
 * `color` as a "hex string", and the settings service refuses a miss at the
 * save door (objectstack#24882). The page judged nothing before the request:
 * Setup → Branding saved Logo URL `not a url` and answered "Settings saved".
 * The check rides the same Save path as the `required` one (objectui#13239):
 * no request, the row marked through the field-error slot, focus on the first.
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

const SHOW_LEGACY = '${data.show_legacy === true}';

type Resolved = { value: unknown; locked?: boolean; lockedReason?: string; source?: string };

/**
 * Branding's shape (`logo_url`, `accent_color`) plus the Company/Email format
 * rows (`support_email`, `support_phone`), an optional `website`, a url hidden
 * by `visible`, and a url locked by the environment.
 */
function brandingPayload(overrides: Record<string, Resolved> = {}) {
  const values: Record<string, Resolved> = {
    logo_url: { value: 'https://cdn.example.com/logo.png' },
    accent_color: { value: '#1a2b3c' },
    support_email: { value: 'ops@example.com' },
    support_phone: { value: '+1 (555) 010-0100' },
    website: { value: null },
    show_legacy: { value: false },
    legacy_url: { value: 'not a url' },
    env_url: {
      value: 'not a url',
      source: 'env',
      locked: true,
      lockedReason: 'Set via env: OS_BRANDING_ENV_URL',
    },
    product_name: { value: 'Acme' },
    ...overrides,
  };
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) resolved[k] = { source: 'default', locked: false, ...v };
  return {
    manifest: {
      namespace: 'branding',
      label: 'Branding',
      specifiers: [
        { type: 'text', key: 'product_name', label: 'Product name' },
        { type: 'url', key: 'logo_url', label: 'Logo URL' },
        { type: 'color', key: 'accent_color', label: 'Accent color' },
        { type: 'email', key: 'support_email', label: 'Support email' },
        { type: 'phone', key: 'support_phone', label: 'Support phone' },
        { type: 'url', key: 'website', label: 'Website' },
        { type: 'url', key: 'legacy_url', label: 'Legacy URL', visible: SHOW_LEGACY },
        { type: 'url', key: 'env_url', label: 'Env URL' },
      ],
    },
    values: resolved,
  };
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/settings/branding']}>
      <Routes>
        <Route path="/settings/:namespace" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rowFor = (key: string) =>
  document.querySelector<HTMLElement>(`[data-settings-key="${key}"]`);
/** The row's text box: the last input, which for `color` is the hex text field beside the picker. */
const textInputFor = (key: string) => {
  const inputs = rowFor(key)?.querySelectorAll('input') ?? [];
  return inputs.length ? inputs[inputs.length - 1] : null;
};
const alertIn = (key: string) => rowFor(key)?.querySelector('[role="alert"]') ?? null;

async function typeAndSave(key: string, value: string) {
  await screen.findByText('Product name');
  fireEvent.change(textInputFor(key)!, { target: { value } });
  fireEvent.click(await screen.findByRole('button', { name: /save/i }));
}

async function expectBlockedOn(key: string) {
  await waitFor(() => expect(alertIn(key)).toBeTruthy());
  expect(saveSettingsNamespace).not.toHaveBeenCalled();
  expect(toastSuccess).not.toHaveBeenCalled();
}

async function expectSaved() {
  await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  expect(document.querySelector('[role="alert"]')).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSettingsNamespace.mockResolvedValue({ values: {} });
});
afterEach(cleanup);

describe('SettingsView — a value that misses its declared format blocks Save (objectui#13287)', () => {
  it('(a) Logo URL `not a url` blocks: no request, the row marked, focus on it', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload());
    renderView();
    await typeAndSave('logo_url', 'not a url');

    await expectBlockedOn('logo_url');
    expect(textInputFor('logo_url')!.getAttribute('aria-invalid')).toBe('true');
    expect(textInputFor('logo_url')!.getAttribute('aria-describedby')).toBe(
      alertIn('logo_url')!.getAttribute('id'),
    );
    expect(document.activeElement).toBe(textInputFor('logo_url'));
    // One toast, the blocked-save toast the required check raises.
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it.each(['https://cdn.example.com/brand.svg', '/logo.png', '  /logo.png  '])(
    '(a) Logo URL %j saves',
    async (value) => {
      getSettingsNamespace.mockResolvedValue(brandingPayload());
      renderView();
      await typeAndSave('logo_url', value);
      await expectSaved();
      expect(saveSettingsNamespace).toHaveBeenCalledWith('branding', { logo_url: value.trim() });
    },
  );

  it('(b) an email with a dotless domain blocks', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload());
    renderView();
    await typeAndSave('support_email', 'no-reply@localhost');
    await expectBlockedOn('support_email');
    expect(document.activeElement).toBe(textInputFor('support_email'));
  });

  it('(b) a valid email saves', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload());
    renderView();
    await typeAndSave('support_email', 'no-reply@mail.example.com');
    await expectSaved();
  });

  it.each(['red', '#12'])('(c) the color %j blocks', async (value) => {
    getSettingsNamespace.mockResolvedValue(brandingPayload());
    renderView();
    await typeAndSave('accent_color', value);
    await expectBlockedOn('accent_color');
  });

  it('(c) the color `#1a2b3c` saves', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload({ accent_color: { value: '#000' } }));
    renderView();
    await typeAndSave('accent_color', '#1a2b3c');
    await expectSaved();
  });

  it('a phone number with letters blocks; a valid one saves', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload());
    renderView();
    await typeAndSave('support_phone', 'call me');
    await expectBlockedOn('support_phone');

    cleanup();
    vi.clearAllMocks();
    saveSettingsNamespace.mockResolvedValue({ values: {} });
    renderView();
    await typeAndSave('support_phone', '+44 20 7946 0958');
    await expectSaved();
  });

  it('each format names what it expects, one message per format', async () => {
    getSettingsNamespace.mockResolvedValue(
      brandingPayload({
        accent_color: { value: 'red' },
        support_email: { value: 'ops@localhost' },
        support_phone: { value: 'n/a' },
      }),
    );
    renderView();
    await typeAndSave('logo_url', 'not a url');

    await expectBlockedOn('logo_url');
    const messages = ['logo_url', 'support_email', 'support_phone', 'accent_color'].map(
      (key) => alertIn(key)?.textContent ?? '',
    );
    // Every row marked, each with its own format's message.
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(4);
    // Focus goes to the first in manifest order.
    expect(document.activeElement).toBe(textInputFor('logo_url'));
  });

  it('(d) control: an empty optional url field does not block', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload({ website: { value: '' } }));
    renderView();
    await typeAndSave('product_name', 'Acme Cloud');
    await expectSaved();
  });

  it('(e) control: a hidden malformed url and an env-locked malformed url do not block', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload());
    renderView();
    await screen.findByText('Product name');
    expect(rowFor('legacy_url')).toBeNull();
    expect(rowFor('env_url')).toBeTruthy();
    await typeAndSave('product_name', 'Acme Cloud');
    await expectSaved();
  });

  it('a stored malformed value on a visible row blocks a save that edits another row', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload({ logo_url: { value: 'not a url' } }));
    renderView();
    await typeAndSave('product_name', 'Acme Cloud');
    await expectBlockedOn('logo_url');
  });

  it('editing the marked row clears its message, as for a server refusal', async () => {
    getSettingsNamespace.mockResolvedValue(brandingPayload());
    renderView();
    await typeAndSave('logo_url', 'not a url');
    await expectBlockedOn('logo_url');
    fireEvent.change(textInputFor('logo_url')!, { target: { value: 'https://x.example.com/l.png' } });
    await waitFor(() => expect(alertIn('logo_url')).toBeNull());
  });
});
