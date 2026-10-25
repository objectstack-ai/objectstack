/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:tabs`' count badge announces itself in the session locale —
 * objectstack#5506.
 *
 * The badge renders DIGITS ONLY, so its `aria-label` is the badge as far as a
 * screen reader is concerned. That label used to be a template literal,
 * `` `${formatTabCount(item.count)} items` `` — hardcoded English *and*
 * English-pluralized by construction (no singular form at all: a related list
 * with one row announced "1 items").
 *
 * It now reads `common.itemCount` / `common.itemCountOne` — the repo's two-key
 * plural convention, NOT an i18next `_one`/`_other` pair, because zh/ja/ko have
 * no separate singular form and `all-locales-key-parity` would read the
 * legitimately-absent `_one` half as a lost key.
 *
 * Direction: the `en` plural case was already green before the change (the
 * English default has to survive); the zh and de cases were red, and the
 * `1 item` singular case was red under **every** locale including `en`, because
 * no singular form existed at all. The provider-less fallback is asserted in
 * `chrome-i18n-no-provider-fallback.test.tsx` — it cannot live in this file, see
 * that file's header for why.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer } from '@object-ui/react';
import type { PublicBlockNodeOf } from '@object-ui/types';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/**
 * Two tabs minimum: the strip is hidden entirely at length 1 (a lone "Details"
 * pill is clutter, not an affordance), and with no strip there is no badge.
 */
const tabsSchema = (items: any[]): PublicBlockNodeOf<'page:tabs'> => ({ type: 'page:tabs', id: 'tabs', properties: { items } });

const textChild = (content: string) => [{ type: 'element:text', properties: { content } }];

function renderTabs(language: string, items: any[]) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SchemaRenderer schema={tabsSchema(items)} />
    </I18nProvider>,
  );
}

const twoTabs = [
  { label: 'Details', value: 'details', count: 5, children: textChild('DETAILS BODY') },
  { label: 'Related', value: 'related', count: 1, children: textChild('RELATED BODY') },
];

afterEach(() => cleanup());

describe('page:tabs count badge — accessible name (objectstack#5506)', () => {
  it('still reads English under an en session', () => {
    const { getByLabelText } = renderTabs('en', twoTabs);

    expect(getByLabelText('5 items')).toBeTruthy();
    // The singular half: `1 items` was the pre-change output in EVERY locale.
    expect(getByLabelText('1 item')).toBeTruthy();
    expect(getByLabelText('1 item').textContent).toBe('1');
  });

  it('reads the zh bundle values under a zh session', () => {
    const { getByLabelText, queryByLabelText } = renderTabs('zh', twoTabs);

    expect(getByLabelText('5 项')).toBeTruthy();
    expect(getByLabelText('1 项')).toBeTruthy();
    expect(queryByLabelText('5 items')).toBeNull();
    expect(queryByLabelText('1 items')).toBeNull();
  });

  /**
   * German is the load-bearing plural case: unlike zh it HAS a distinct
   * singular, so this is where a collapsed one-key scheme would show up.
   */
  it('splits singular and plural under a de session', () => {
    const { getByLabelText } = renderTabs('de', twoTabs);

    expect(getByLabelText('5 Elemente')).toBeTruthy();
    expect(getByLabelText('1 Element')).toBeTruthy();
  });

  it('reads the ja bundle values under a ja session', () => {
    const { getByLabelText } = renderTabs('ja', twoTabs);

    expect(getByLabelText('5 件')).toBeTruthy();
  });
});

describe('page:tabs count badge — formatted counts (objectstack#5506)', () => {
  /**
   * `formatTabCount` shortens >= 1000 to `1.2k`. The accessible name must carry
   * the SAME string the badge shows, so a screen-reader user and a sighted user
   * are told the same thing — and interpolating a formatted (string) value is
   * also what keeps i18next's own plural resolver out of the decision, leaving
   * the two-key scheme in charge.
   */
  it('interpolates the shortened count, matching the visible digits', () => {
    const { getByLabelText } = renderTabs('en', [
      { label: 'Details', value: 'details', count: 1200, children: textChild('A') },
      { label: 'Related', value: 'related', count: 20000, children: textChild('B') },
    ]);

    expect(getByLabelText('1.2k items').textContent).toBe('1.2k');
    expect(getByLabelText('20k items').textContent).toBe('20k');
  });

  it('interpolates the shortened count under a non-English session too', () => {
    const { getByLabelText } = renderTabs('zh', [
      { label: 'Details', value: 'details', count: 1200, children: textChild('A') },
      { label: 'Related', value: 'related', count: 3, children: textChild('B') },
    ]);

    expect(getByLabelText('1.2k 项').textContent).toBe('1.2k');
  });
});
