/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `element:number` "no object named" notice speaks the session language
 * (objectui#10951).
 *
 * The notice is renderer chrome, so it reads the locale packs through
 * `useObjectTranslation` (`element.number.noObject`) rather than carrying an
 * English literal. Two locales, chosen for what each can decide: `zh`, a
 * non-Latin pack where a value equal to `en` would be decidable evidence of an
 * untranslated string, and `de`, where the German words are named outright.
 * Values are literals, not read back from the pack, so the pin cannot agree
 * with an empty pack by construction.
 *
 * Its own FILE: `createI18n` installs its instance as react-i18next's
 * module-global default and it survives `cleanup()`, so the provider-less
 * English leg (`elementNumber.noObjectState-10951.test.tsx`) must not share a
 * file with these renders.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const NO_OBJECT = { type: 'element:number', id: 'n', properties: { aggregate: 'count' } };
const NOTICE_ID = 'element-number-no-object';

function renderIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SchemaRenderer schema={NO_OBJECT as never} />
    </I18nProvider>,
  );
}

describe('element:number "no object named" notice — localized (objectui#10951)', () => {
  it('renders the Chinese sentence under zh', async () => {
    renderIn('zh');
    // `waitFor`, not `findBy`: a lazily loaded catalogue may land after the
    // first paint, and the element exists (in English) before it does.
    await waitFor(() =>
      expect(screen.getByTestId(NOTICE_ID).textContent).toBe('未指定对象：请设置 dataSource.object。'),
    );
  });

  it('renders the German sentence under de', async () => {
    renderIn('de');
    await waitFor(() =>
      expect(screen.getByTestId(NOTICE_ID).textContent).toBe(
        'Kein Objekt angegeben: Legen Sie dataSource.object fest.',
      ),
    );
  });
});
