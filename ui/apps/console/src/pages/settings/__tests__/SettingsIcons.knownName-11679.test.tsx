/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The settings pages resolve manifest icons through the ONE icon helper —
 * `getLazyIcon` from `@object-ui/components` — and so get its known-name
 * check (objectui#11679).
 *
 * The console used to carry its own `getIcon`, which handed ANY name to
 * lucide's `DynamicIcon`. `DynamicIcon` looks the name up in an effect and,
 * for a name it does not have, `console.error`s
 * `[lucide-react]: Name in Lucide DynamicIcon not found` and renders its
 * fallback bare — without the `className` the call site passed. The name that
 * did it on the settings hub and on the company page was `Building2`: a real
 * Lucide icon, the spelling `lucide-react` exports, which that copy's
 * tokeniser turned into `building2` because it lacked the letter-to-digit
 * boundary objectui#9414 gave `toKebabIconName`.
 *
 * So there are two facts to pin, and they are different facts:
 *
 *   - an UNKNOWN name (`box-open`, a Font Awesome name) renders the static
 *     `Database` fallback, with the call site's classes, and logs nothing;
 *   - the MEASURED name (`Building2`) is not unknown at all: it resolves to
 *     its own glyph, on the hub card and on the namespace page.
 *
 * Everything runs over a stubbed `fetch` against the REAL `./api` module and
 * the REAL `getLazyIcon` — mocking the helper would assert nothing about it.
 */

import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsHub } from '../SettingsHub';
import { SettingsView } from '../SettingsView';

/** An icon name Lucide does not have — server metadata borrowing another library's name. */
const UNKNOWN_ICON = 'box-open';

const fetchMock = vi.fn();
let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  vi.unstubAllGlobals();
});

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

/**
 * `DynamicIcon` reports an unknown name from a promise rejection inside an
 * effect, so it lands after the render that mounted it. One macrotask drains
 * that microtask queue; without this the silence below would be measured too
 * early to mean anything.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * What the console said about icons.
 *
 * `console.error` is the channel lucide reports an unknown `DynamicIcon` name
 * on, so it is held silent WHOLE — any call at all is returned. `console.warn`
 * is not: the i18n layer warns there for every manifest-authored namespace the
 * bundle has no key for, which has nothing to do with icons, so only a warning
 * that names lucide or one of the icon names under test is returned.
 */
function iconNoise(): string[] {
  const text = (args: unknown[]) => args.map(String).join(' ');
  const errors = errorSpy.mock.calls.map(text);
  const warnings = warnSpy.mock.calls
    .map(text)
    .filter((line) => /lucide|DynamicIcon|box-open|building-?2/i.test(line));
  return [...errors, ...warnings];
}

/**
 * Wait until the icon beside `label` is `Building2`'s own glyph.
 *
 * `getLazyIcon('Building2')` is lucide's `DynamicIcon` (a `forwardRef`, which
 * React's act warning names `ForwardRef`). It mounts on its `Database`
 * fallback and calls its `setIconData` from a promise its mount effect starts,
 * so the glyph arrives in a state update the test never caused. This waits
 * with RTL's `waitFor`, not `vi.waitFor`, on purpose (objectui#11690): RTL
 * keeps `IS_REACT_ACT_ENVIRONMENT` off while it waits, the same way
 * `findByText` does, so that update is not an act() violation. `vi.waitFor`
 * left the flag on, and whether the update landed inside `findByText`'s
 * act-free window or after it was a scheduling race. When it lost, React
 * logged "An update to ForwardRef inside a test was not wrapped in act(...)"
 * through the `console.error` that `iconNoise()` holds silent, and the test
 * failed on some runs and not others. Once this returns, the glyph has
 * committed and `DynamicIcon` updates no more.
 */
async function waitForBuildingGlyph(label: string) {
  await waitFor(() => expect(svgNear(label)?.getAttribute('class')).toContain('lucide-building-2'), {
    timeout: 5000,
  });
}

/** The `<svg>` inside the element whose text is `label`, walking up to the card. */
function svgNear(label: string, container: HTMLElement = document.body): SVGElement | null {
  let node: HTMLElement | null = screen.getByText(label);
  while (node && node !== container) {
    const svg = node.querySelector('svg');
    if (svg) return svg;
    node = node.parentElement;
  }
  return null;
}

/**
 * An explicit `en` provider, as `SettingsView.crypto-unavailable.test.tsx`
 * mounts: without one `react-i18next` warns that it has no instance, and the
 * silence this file asserts is the WHOLE console, not a filtered slice of it.
 */
function withI18n(ui: ReactElement) {
  return <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>{ui}</I18nProvider>;
}

function renderHub() {
  return render(
    withI18n(
      <MemoryRouter>
        <SettingsHub />
      </MemoryRouter>,
    ),
  );
}

function renderView(namespace: string) {
  return render(
    withI18n(
      <MemoryRouter initialEntries={[`/settings/${namespace}`]}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('settings icons go through the known-name check (objectui#11679)', () => {
  it('an unknown icon name renders the Database fallback with no console error', async () => {
    fetchMock.mockResolvedValue(
      ok({
        success: true,
        data: {
          manifests: [
            { namespace: 'legacy', version: 1, label: 'Legacy', icon: UNKNOWN_ICON, category: 'Workspace', specifiers: [] },
          ],
        },
      }),
    );
    renderHub();
    expect(await screen.findByText('Legacy')).toBeTruthy();
    await settle();

    const svg = svgNear('Legacy');
    expect(svg?.getAttribute('class')).toContain('lucide-database');
    // The call site's classes reached the glyph: this is the helper's static
    // fallback, not `DynamicIcon`'s, which renders its fallback with no props.
    expect(svg?.getAttribute('class')).toContain('h-6');
    expect(iconNoise()).toEqual([]);
  });

  it('an unknown icon on a namespace page and on an action button logs nothing either', async () => {
    fetchMock.mockResolvedValue(
      ok({
        success: true,
        data: {
          manifest: {
            namespace: 'legacy',
            version: 1,
            label: 'Legacy',
            icon: UNKNOWN_ICON,
            specifiers: [{ type: 'action_button', id: 'probe', label: 'Probe', icon: UNKNOWN_ICON }],
          },
          values: {},
        },
      }),
    );
    renderView('legacy');
    expect(await screen.findByText('Legacy')).toBeTruthy();
    await settle();

    const button = screen.getByRole('button', { name: 'Probe' });
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('lucide-database');
    expect(svgNear('Legacy')?.getAttribute('class')).toContain('lucide-database');
    expect(iconNoise()).toEqual([]);
  });

  it('`Building2` — the name behind the warning — resolves to its own glyph on the hub and the company page', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        success: true,
        data: {
          manifests: [
            { namespace: 'company', version: 1, label: 'Company', icon: 'Building2', category: 'Workspace', specifiers: [] },
          ],
        },
      }),
    );
    const hub = renderHub();
    expect(await screen.findByText('Company')).toBeTruthy();
    await waitForBuildingGlyph('Company');
    hub.unmount();

    fetchMock.mockResolvedValueOnce(
      ok({
        success: true,
        data: {
          manifest: { namespace: 'company', version: 1, label: 'Company', icon: 'Building2', specifiers: [] },
          values: {},
        },
      }),
    );
    renderView('company');
    expect(await screen.findByText('Company')).toBeTruthy();
    await waitForBuildingGlyph('Company');
    await settle();
    expect(iconNoise()).toEqual([]);
  });
});
