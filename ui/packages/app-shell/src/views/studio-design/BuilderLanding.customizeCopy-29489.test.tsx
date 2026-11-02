// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29489 — the Studio landing teaches the customization route that
 * is open, not the package-less overlay objectstack ADR-0146 D11 closed.
 *
 * A package-less write onto an item a read-only package ships answers 403
 * NOT_OVERRIDABLE and names the base's `.custom` pair. The landing's page
 * description and its read-only section hint used to send the user there
 * ("customize them with an environment overlay"). They now name Customize and
 * New similar, saved in the package's `.custom` customization package.
 *
 * Read off the real `BuilderLanding`, rendered in English and in Chinese with a
 * read-only package listed, so both strings are on the page. The expected
 * words are the tables' own: the Customize and New similar action labels.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { t } from '../metadata-admin/i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';
// The landing's rows live in `@object-ui/i18n`'s `studio` namespace, whose `zh`
// catalogue is fetched on demand: resident before any case.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packages.list) };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding } from './BuilderLanding';

const READ_ONLY = { id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' };

type Locale = 'en-US' | 'zh-CN';
const LOCALES: ReadonlyArray<readonly [Locale, 'en' | 'zh']> = [
  ['en-US', 'en'],
  ['zh-CN', 'zh'],
];

/** The retired route, in both languages the tables speak. */
const ENVIRONMENT_OVERLAY = /environment overlay|环境覆盖/iu;

afterEach(() => {
  cleanup();
  packages.list = [];
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

/** The row for `key` in `locale`, which must exist: `t` echoes a missing key. */
function row(key: string, locale: Locale): string {
  const text = t(key, locale);
  expect(text, `no ${locale} row for ${key}`).not.toBe(key);
  return text;
}

async function renderLanding(lang: 'en' | 'zh') {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = { features: { installLocal: false, marketplace: false } };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
    }),
  );
  await initRuntimeConfig();
  packages.list = [READ_ONLY];
  const landing = (
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
      </Routes>
    </MemoryRouter>
  );
  if (lang === 'en') return render(landing);
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  return render(<I18nProvider instance={zh}>{landing}</I18nProvider>);
}

/** The page description: the paragraph right under the title row. */
function descriptionElement(): HTMLElement {
  const titleRow = screen.getByRole('heading', { level: 1 }).parentElement;
  const description = titleRow?.nextElementSibling;
  if (!(description instanceof HTMLElement)) throw new Error('no description under the landing title');
  return description;
}

describe('Studio landing: a read-only package is customized in its .custom package (objectstack#29489)', () => {
  for (const [locale, lang] of LOCALES) {
    it(`${locale}: the description and the read-only hint name Customize, New similar and the .custom package, never an overlay`, async () => {
      await renderLanding(lang);
      await screen.findByText('Showcase');

      const customize = row('engine.studio.customize.action', locale);
      const newSimilar = row('engine.studio.auto.newSimilar.action', locale);
      const shown = [
        descriptionElement().textContent ?? '',
        screen.getByTestId('studio-landing-readonly-hint').textContent ?? '',
      ];

      // The rendered text is the table's row, so the landing reads these keys.
      expect(shown).toEqual([
        row('engine.studio.landing.description', locale),
        row('engine.studio.landing.readonlyHint', locale),
      ]);
      for (const text of shown) {
        expect(text).not.toMatch(ENVIRONMENT_OVERLAY);
        expect(text).toContain('.custom');
        expect(text).toContain(customize);
        expect(text).toContain(newSimilar);
      }
    });
  }
});
