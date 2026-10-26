// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11158: the Interfaces pillar's nav rail renders a nav item whose
 * `label` is a locale map, and the open leaf's canvas caption and breadcrumb
 * print its text in the designer locale.
 *
 * The spec types a nav item's `label` as `I18nLabel`: a plain string or an
 * inline locale map. `NavTree` rendered the label raw, so a map threw
 * "Objects are not valid as a React child" and the pillar's rail was gone;
 * `resolveSurface` read `String(label)`, so the caption printed
 * `[object Object]`. Both now read the label through `navItemLabelText`, the
 * helper the canvas card and the nav-item inspector already share
 * (objectui#11128, objectui#11148), and `resolveSurface` resolves it once, so
 * the rail, the first-leaf auto-open and the `?surface=` restore carry the
 * same text.
 *
 * The pillar is the real `InterfacesPillar` over a mocked metadata client (the
 * harness of `StudioDesignSurface.surfaceIdentity.test.tsx`). Every nav item
 * of the fixture parses against the spec, so each map is an input the
 * designer must handle. The plain-string item is the control in every case.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';

const PKG = 'com.acme.app';

const NAV = [
  // The first leaf: the pillar auto-opens it when no `?surface=` is given.
  { id: 'nav_home', type: 'page', label: { en: 'Home', 'zh-CN': '首页' }, pageName: 'home' },
  {
    id: 'nav_main',
    type: 'group',
    label: { en: 'Main', 'zh-CN': '主要' },
    children: [
      // The control: a plain-string label renders as authored in any locale.
      { id: 'nav_landing', type: 'page', label: 'Landing', pageName: 'landing' },
      // Nested and not first, so only the `?surface=` restore opens it.
      { id: 'nav_reports', type: 'page', label: { en: 'Reports', 'zh-CN': '报表' }, pageName: 'reports' },
    ],
  },
  // No design surface: a disabled row whose `title` is the label.
  { id: 'nav_docs', type: 'url', label: { en: 'Docs', 'zh-CN': '文档' }, url: 'https://example.com/docs' },
];

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';

type Language = 'en' | 'zh';

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

function renderPillar(language: Language, search = '') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces${search}`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Every `console.error` the render logged that is React refusing a child. */
function invalidChildErrors(): unknown[][] {
  return consoleError.mock.calls.filter((args) =>
    args.some((a) => String(a instanceof Error ? a.message : a).includes('not valid as a React child')),
  );
}

// objectui#12455 — every rail row carries its kind as a tag after the label,
// so a page row is named by its label and "Page".
const TEXT: Record<Language, { home: string; main: string; reports: string; docs: string; page: string }> = {
  en: { home: 'Home', main: 'Main', reports: 'Reports', docs: 'Docs', page: 'Page' },
  zh: { home: '首页', main: '主要', reports: '报表', docs: '文档', page: '页面' },
};

describe('the objectui#11158 fixture is what the spec accepts', () => {
  it('every nav item of the fixture, maps included, parses against NavigationItemSchema', () => {
    for (const item of NAV) expect(NavigationItemSchema.safeParse(item).success).toBe(true);
  });
});

for (const language of ['en', 'zh'] as const) {
  const text = TEXT[language];

  describe(`the Interfaces rail renders locale-map labels under ${language} (objectui#11158)`, () => {
    it('renders every row, maps as their text, the plain string as authored, with no React error', async () => {
      renderPillar(language);

      expect(await screen.findByRole('button', { name: `${text.home} ${text.page}` }, { timeout: 8000 })).toBeEnabled();
      expect(screen.getByRole('button', { name: `Landing ${text.page}` })).toBeEnabled();
      expect(screen.getByRole('button', { name: `${text.reports} ${text.page}` })).toBeEnabled();
      expect(screen.getByText(text.main)).toBeInTheDocument();
      // A row with no design surface is disabled and titled by its label.
      expect(screen.getByTitle(text.docs)).toBeDisabled();

      expect(invalidChildErrors()).toEqual([]);
      expect(document.body.textContent).not.toContain('[object Object]');
    });

    it('the first-leaf auto-open prints the map text in the canvas caption and the breadcrumb', async () => {
      renderPillar(language);

      const caption = await waitFor(() => screen.getByTestId('if-canvas-caption'), { timeout: 8000 });
      expect(caption).toHaveTextContent(text.home);
      expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent(text.home);
      expect(caption.textContent).not.toContain('[object Object]');
      expect(invalidChildErrors()).toEqual([]);
    });

    it('a `?surface=` restore on a map-labelled leaf still opens it, captioned in the designer locale', async () => {
      renderPillar(language, '?surface=page:reports');

      await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent(text.reports), {
        timeout: 8000,
      });
      expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent(text.reports);
      expect(screen.getByTestId('if-canvas-caption')).not.toHaveTextContent(text.home);
      expect(invalidChildErrors()).toEqual([]);
    });
  });
}
