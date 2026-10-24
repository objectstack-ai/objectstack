/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11097 — the dashboard's refresh button speaks the session language.
 *
 * `DashboardRenderer` and `DashboardGridLayout` each hard-coded "Refresh All",
 * "Refreshing…" and the accessible name "Refresh dashboard". Since the console
 * began wiring `onRefresh` (objectui#11093) the button shows on every console
 * dashboard, so a zh-CN session read English chrome on all of them.
 *
 * The button now reads the pack keys `dashboard.refreshAll`,
 * `dashboard.refreshDashboard` and `dashboard.refreshing`, on BOTH surfaces.
 * Each is mounted and read on its own, so a surface that goes back to a literal
 * fails under its own name.
 *
 * The expected strings are read out of the `en` and `zh` packs rather than typed
 * here, so rewording a translation does not break this file. What it does pin is
 * that the zh session renders the zh pack's value and that this value is not the
 * English one: a hard-coded English literal cannot satisfy both.
 */
import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardGridLayout } from '../DashboardGridLayout';
import { DashboardRenderer } from '../DashboardRenderer';

beforeEach(() => {
  // The provider persists the last language; keep one case from leaking into the next.
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
});

// Module constants: `I18nProvider` rebuilds its i18next instance whenever the
// `config` object changes identity, so an inline literal would re-boot it on
// every render.
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

interface SurfaceProps {
  schema: DashboardComponentSchema;
  onRefresh?: () => void;
}

/** The two components under test, each named, so a failure says which one. */
const SURFACES: ReadonlyArray<readonly [string, React.ComponentType<SurfaceProps>]> = [
  ['DashboardRenderer', DashboardRenderer],
  ['DashboardGridLayout', DashboardGridLayout],
];

const schema = { type: 'dashboard', name: 'ops', widgets: [] } as unknown as DashboardComponentSchema;

/** The three strings the button can show, as one pack carries them. */
const copyOf = (pack: {
  dashboard: { refreshAll: string; refreshing: string; refreshDashboard: string };
}) => ({
  idle: pack.dashboard.refreshAll,
  busy: pack.dashboard.refreshing,
  name: pack.dashboard.refreshDashboard,
});
const EN_COPY = copyOf(en);
const ZH_COPY = copyOf(zh);

/** Mount `Surface` inside a session in `config`'s language and hand back the refresh button. */
async function mountButton(
  Surface: React.ComponentType<SurfaceProps>,
  config: typeof ZH,
  accessibleName: string,
): Promise<HTMLElement> {
  render(
    <I18nProvider config={config} persistLanguage={false}>
      <Surface schema={schema} onRefresh={() => {}} />
    </I18nProvider>,
  );
  return screen.findByRole('button', { name: accessibleName });
}

describe('the dashboard refresh button names itself in the session language (objectui#11097)', () => {
  it('control: the zh pack carries three real translations, none of them the English value', () => {
    // Without this, a zh value that is an English copy would let every case
    // below pass on a component that never translated anything.
    expect(ZH_COPY.idle).not.toBe(EN_COPY.idle);
    expect(ZH_COPY.busy).not.toBe(EN_COPY.busy);
    expect(ZH_COPY.name).not.toBe(EN_COPY.name);
  });

  describe.each(SURFACES)('%s', (_name, Surface) => {
    it('zh: idle label and accessible name come from the zh pack', async () => {
      const button = await mountButton(Surface, ZH, ZH_COPY.name);
      expect(button).toHaveTextContent(ZH_COPY.idle);
      expect(button).not.toHaveTextContent(EN_COPY.idle);
      expect(button.getAttribute('aria-label')).toBe(ZH_COPY.name);
      expect(screen.queryByRole('button', { name: EN_COPY.name })).toBeNull();
    });

    it('zh: the refreshing state reads from the zh pack, then returns to the idle label', async () => {
      const button = await mountButton(Surface, ZH, ZH_COPY.name);
      await act(async () => {
        fireEvent.click(button);
      });
      // The click lit the refreshing state: the label swapped and the button is disabled.
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent(ZH_COPY.busy);
      expect(button).not.toHaveTextContent(EN_COPY.busy);
      // The accessible name does not follow the state.
      expect(button.getAttribute('aria-label')).toBe(ZH_COPY.name);
      // The indicator clears itself after a short delay (`useDashboardAutoRefresh`).
      await waitFor(() => expect(button).toHaveTextContent(ZH_COPY.idle), { timeout: 3000 });
      expect(button).not.toBeDisabled();
    });

    it('en control: both states and the accessible name are the en pack values', async () => {
      const button = await mountButton(Surface, EN, EN_COPY.name);
      expect(button).toHaveTextContent(EN_COPY.idle);
      expect(button.getAttribute('aria-label')).toBe(EN_COPY.name);
      await act(async () => {
        fireEvent.click(button);
      });
      expect(button).toHaveTextContent(EN_COPY.busy);
      await waitFor(() => expect(button).toHaveTextContent(EN_COPY.idle), { timeout: 3000 });
    });
  });
});
