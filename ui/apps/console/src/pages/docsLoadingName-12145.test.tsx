/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12145 — the docs portal's loading spinner is named from the pack.
 *
 * Five docs pages (`DocsIndex`, `AppDocsIndex`, `BookPage`, `DocsSlug`,
 * `DocPage`) drew the same spinner with `aria-label="Loading documentation"`,
 * so a screen reader under `zh` heard English. Each now reads
 * `help.loadingDocumentation`. The portal index stands in for the five: same
 * line, same key.
 *
 * The spinner is a lucide `<svg>`, and testing-library's role table gives an
 * `<svg>` no implicit role, so it is found by its accessible name through
 * `getByLabelText` — the name is what a screen reader announces.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

vi.mock('./use-book-data', () => ({
  useBookData: () => ({ books: [], docs: [], state: 'loading', error: null }),
}));

import DocsIndex from './DocsIndex';

afterEach(cleanup);

function renderIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter>
        <DocsIndex />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('the docs portal names its loading spinner from the pack (objectui#12145)', () => {
  it('under en, the spinner is named by the en pack', async () => {
    renderIn('en');
    expect(await screen.findByLabelText(en.help.loadingDocumentation)).toBeInTheDocument();
  });

  it('under zh, the spinner is named by the zh pack, not by the English words', async () => {
    // The pin is only a pin if the two packs disagree.
    expect(zh.help.loadingDocumentation).not.toBe(en.help.loadingDocumentation);
    renderIn('zh');
    expect(await screen.findByLabelText(zh.help.loadingDocumentation)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.help.loadingDocumentation)).toBeNull();
  });
});
