// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29706 — the New package form in a zh console read "Display
 * name" over "Human-readable package name" under the translated title
 * 新建软件包.
 *
 * Studio's landing mounts `PackageFormDialog` closed, before the lazily
 * fetched zh `studio` catalogue is resident. The form (its labels and help
 * lines) was memoised on the locale alone, so the `en` answer of that first
 * render survived the catalogue's arrival, while the title, read on every
 * render, did not. The form is now rebuilt once the catalogue lands.
 *
 * ⛔ No module-scope `loadStudioCatalogue('zh')` here, unlike the sibling
 * suites: the defect only exists while the catalogue is NOT yet resident, so
 * each case asserts that precondition first. The `dom` project runs each file
 * isolated, so no other file can have loaded it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { isStudioCatalogueLoaded, loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { PackageFormDialog } from './PackageFormDialog';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }) as Response),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The landing's shape: mounted closed, opened later by the New package card. */
function mountClosedThenOpen(language: 'zh' | 'en') {
  const i18n = createI18n({ defaultLanguage: language, detectBrowserLanguage: false, resources: { [language]: {} } });
  const dialog = (open: boolean) => (
    <I18nProvider instance={i18n}>
      <PackageFormDialog mode="create" open={open} onOpenChange={vi.fn()} />
    </I18nProvider>
  );
  const view = render(dialog(false));
  return { open: () => view.rerender(dialog(true)) };
}

describe('the New package form after the lazy zh catalogue lands (objectstack#29706)', () => {
  it('a dialog mounted before the zh catalogue is resident reads its labels and help in zh once opened', async () => {
    expect(isStudioCatalogueLoaded('zh'), 'precondition: the zh catalogue is not resident yet').toBe(false);
    const landing = mountClosedThenOpen('zh');
    await act(async () => {
      await loadStudioCatalogue('zh');
    });
    landing.open();
    await screen.findByTestId('package-form');

    expect(screen.getByText('新建软件包')).toBeInTheDocument();
    expect(screen.getByText('显示名称')).toBeInTheDocument();
    expect(screen.getByText('软件包的可读名称。')).toBeInTheDocument();
    // The card's exact complaint, read from the installed spec so it cannot
    // go vacuous when the spec rewords a `.describe()`.
    expect(screen.queryByText('Display name')).toBeNull();
    expect(screen.queryByText(ManifestSchema.shape.name.description!)).toBeNull();
    expect(screen.queryByText(ManifestSchema.shape.description.description!)).toBeNull();
  });

  it('CONTROL — an en console mounted the same way keeps the spec’s own English help', async () => {
    const landing = mountClosedThenOpen('en');
    landing.open();
    await screen.findByTestId('package-form');

    expect(screen.getByText('Display name')).toBeInTheDocument();
    expect(screen.getByText(ManifestSchema.shape.name.description!)).toBeInTheDocument();
  });
});
