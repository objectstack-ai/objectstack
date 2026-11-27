/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37575: the app's locale list lands after the console has drawn,
 * and only its readers re-render for it.
 *
 * In the provider's main context it gave every `useObjectTranslation` reader a
 * new value: on a list page's first load that was one more pass over about
 * 1,900 components before the rows drew, for an answer only a language menu
 * reads.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useAppContentLanguages, useObjectTranslation } from '../provider';

describe('the app locale list reaches its readers only (objectstack#37575)', () => {
  it('a translation reader is not re-rendered when the list lands; a reader of the list is', async () => {
    const renders = { translation: 0 };
    let answer: (codes: string[]) => void = () => {};
    const loadLocales = () => new Promise<string[]>((resolve) => { answer = resolve; });

    function TranslationReader() {
      renders.translation += 1;
      const { language } = useObjectTranslation();
      return <span>{language}</span>;
    }
    // Memoised, as a component deep in the console is under a parent that
    // does not re-render: only a context it reads can redraw it.
    const Reader = React.memo(TranslationReader);
    function ListReader() {
      const languages = useAppContentLanguages();
      return <span data-testid="app-languages">{languages ? languages.join(',') : 'unknown'}</span>;
    }

    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} loadLocales={loadLocales}>
        <Reader />
        <ListReader />
      </I18nProvider>,
    );
    expect(screen.getByTestId('app-languages')).toHaveTextContent('unknown');
    const before = renders.translation;

    answer(['en', 'zh']);
    await waitFor(() => expect(screen.getByTestId('app-languages')).toHaveTextContent('en,zh-Hans'));
    expect(renders.translation).toBe(before);
  });

  it('outside a provider the list is not known', () => {
    function ListReader() {
      const languages = useAppContentLanguages();
      return <span data-testid="app-languages">{languages === null ? 'unknown' : languages.join(',')}</span>;
    }
    render(<ListReader />);
    expect(screen.getByTestId('app-languages')).toHaveTextContent('unknown');
  });
});
