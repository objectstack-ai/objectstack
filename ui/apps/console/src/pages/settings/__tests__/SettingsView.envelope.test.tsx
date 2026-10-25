/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The two screens objectui#3366 took down, driven end to end over a stubbed
 * `fetch` — the REAL `./api` module, not a mock of it.
 *
 * The unit tests next door (`../api.envelope.test.ts`) pin the unwrap itself.
 * This file exists because the unwrap is only interesting for what it stops
 * happening on screen, and both symptoms were screen-level:
 *
 *   - `SettingsView` — `Object.entries(payload.values)` on an envelope threw
 *     "Cannot convert undefined or null to object" out of a `useMemo`, which
 *     the error boundary turned into a blank page for all 11 namespaces.
 *   - `SettingsHub` — the same wrong body flowed through `r.manifests ?? []`
 *     and rendered the empty state, telling an admin that no plugin had
 *     registered any settings while the server was answering 11 manifests.
 *
 * Mocking `./api` would assert nothing about either: the bug WAS `./api`.
 *
 * ## Deliberately still provider-less after objectui#4024
 *
 * #4024 routed `SettingsView`'s framing copy through the bundle, and the
 * sibling `SettingsView.crypto-unavailable.test.tsx` had to gain an
 * `I18nProvider` because its assertions are English sentences. This file did
 * not, and that is a decision rather than an oversight: everything it asserts
 * on screen is either manifest-authored CONTENT (`Timezone`, `Branding` — which
 * comes off the payload, not the pack) or the hub's key literal
 * `console.settingsHub.empty`, which it pins precisely BECAUSE `t()` with no
 * provider returns the key. Adding a provider here would delete that pin, which
 * is the one assertion in the file that is about i18n at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';
import { SettingsHub } from '../SettingsHub';

/** The `/api/settings/localization` payload, as the service produces it. */
const LOCALIZATION = {
  manifest: {
    namespace: 'localization',
    version: 1,
    label: 'Localization',
    description: 'Language, timezone and formats.',
    specifiers: [
      { type: 'text', key: 'timezone', label: 'Timezone', description: 'IANA zone id.' },
      { type: 'text', key: 'language', label: 'Language' },
    ],
  },
  values: {
    timezone: { value: 'Asia/Shanghai', source: 'env', locked: true, lockedReason: 'locked-by-env' },
    language: { value: 'zh-CN', source: 'default', locked: false },
  },
};

const MANIFESTS = [
  { namespace: 'localization', version: 1, label: 'Localization', category: 'Platform', specifiers: [] },
  { namespace: 'branding', version: 1, label: 'Branding', category: 'Platform', specifiers: [] },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/settings/localization']}>
      <Routes>
        <Route path="/settings/:namespace" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsView against a framework#3843 server', () => {
  it('renders the namespace instead of throwing out of the values useMemo', async () => {
    fetchMock.mockResolvedValue(ok({ success: true, data: LOCALIZATION }));
    renderView();

    // The page itself, and both fields with their resolved values.
    expect(await screen.findByText('Localization')).toBeTruthy();
    expect(screen.getByText('Timezone')).toBeTruthy();
    expect(screen.getByDisplayValue('Asia/Shanghai')).toBeTruthy();
    expect(screen.getByDisplayValue('zh-CN')).toBeTruthy();

    // Provenance survives the hop too — `source: 'env'` is why this one is locked.
    expect((screen.getByDisplayValue('Asia/Shanghai') as HTMLInputElement).disabled).toBe(true);
  });

  it('renders the same page from a pre-#3843 server answering the bare payload', async () => {
    fetchMock.mockResolvedValue(ok(LOCALIZATION));
    renderView();
    expect(await screen.findByText('Localization')).toBeTruthy();
    expect(screen.getByDisplayValue('Asia/Shanghai')).toBeTruthy();
  });

  it('shows a readable error card when the body is a shape it cannot read', async () => {
    // Not a white screen and not a wrong page: the view has an error state, and
    // the client now fails into it by name rather than crashing the render.
    fetchMock.mockResolvedValue(ok({ success: true }));
    renderView();
    expect(await screen.findByText(/Malformed response from GET \/api\/settings\/localization/)).toBeTruthy();
  });
});

describe('SettingsHub against a framework#3843 server', () => {
  it('lists the registered manifests instead of the "nothing is registered" empty state', async () => {
    fetchMock.mockResolvedValue(ok({ success: true, data: { manifests: MANIFESTS } }));
    render(
      <MemoryRouter>
        <SettingsHub />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Localization')).toBeTruthy();
    expect(screen.getByText('Branding')).toBeTruthy();
    // The empty-state copy that sent readers hunting a plugin registration bug.
    expect(screen.queryByText(/console\.settingsHub\.empty/)).toBeNull();
  });

  it('a genuinely empty registry still renders the empty state', async () => {
    // The fix must not turn "no manifests" into an error — only "unreadable body" is one.
    fetchMock.mockResolvedValue(ok({ success: true, data: { manifests: [] } }));
    render(
      <MemoryRouter>
        <SettingsHub />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByText(/console\.settingsHub\.empty/)).toBeTruthy());
  });
});
