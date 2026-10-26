/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordComments`' relative timestamps speak the session locale — objectui#7163.
 *
 * The component was already wired to the packs (11 `t('detail.…')` references),
 * but its module-local `formatTimestamp` returned four hardcoded English
 * strings, so a zh session read translated comment chrome with an English
 * `5m ago` sitting inside it. Exactly the shape objectui#7142/#7149 fixed one
 * file over, in `ActivityTimeline`.
 *
 * The fix adds no key to any pack: `detail.justNow` / `minutesAgo` / `hoursAgo`
 * / `daysAgo` are already present in all ten (verified by reading the pack
 * OBJECTS, never a dotted-key grep — the packs are nested, so a grep for
 * `detail.justNow` returns a false zero against the `en` pack that defines it;
 * positive control `detail.back` = 10/10, negative control
 * `detail.zzzAbsentControl7163` = 0/10), and each `en` value is
 * **byte-identical** to the literal it replaces.
 *
 * That byte-identity is why **zh and ar are the load-bearing assertions**. An
 * `en`-only test is green *before* the fix too — the literal and the `en` pack
 * value are the same string — so English cannot discriminate a pack lookup from
 * a hardcoded literal. It is kept anyway, as a no-copy-change guard.
 *
 * The provider-less leg is asserted separately because `useDetailTranslation`
 * is a `createSafeTranslation` hook: a host with no `I18nProvider` must get the
 * English default from `DETAIL_DEFAULT_TRANSLATIONS`, and — the part that fails
 * silently — must **interpolate** `{{count}}`, never render it raw. No inline
 * `defaultValue` is used anywhere (objectui#3517).
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { CommentEntry } from '@object-ui/types';
import { RecordComments } from './RecordComments';

afterEach(() => cleanup());

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** One comment per relative-time branch the helper can take. */
function comments(): CommentEntry[] {
  return [
    { id: 'c0', author: 'Ada', text: 'zero', createdAt: ago(0) },
    { id: 'c1', author: 'Grace', text: 'five minutes', createdAt: ago(5 * MIN) },
    { id: 'c2', author: 'Alan', text: 'three hours', createdAt: ago(3 * 60 * MIN) },
    { id: 'c3', author: 'Edsger', text: 'two days', createdAt: ago(2 * 24 * 60 * MIN) },
  ];
}

function renderIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordComments comments={comments()} />
    </I18nProvider>,
  );
}

/** Pack values read out of the pack objects, not transcribed from the card. */
const EN = { just: 'just now', min: '5m ago', hour: '3h ago', day: '2d ago' };
const ZH = { just: '刚刚', min: '5分钟前', hour: '3小时前', day: '2天前' };
// The three counts are three `ar` CLDR categories since objectui#11445 made the
// `detail.*Ago` keys count families: 5 and 3 are `few` (plural noun), 2 is
// `two` (the dual). The single forms they replaced read «منذ 5 دقيقة»,
// «منذ 3 ساعة» and «منذ 2 يوم».
const AR = { just: 'الآن', min: 'منذ 5 دقائق', hour: 'منذ 3 ساعات', day: 'منذ يومين (2)' };

describe('RecordComments relative timestamps — locale resolution (objectui#7163)', () => {
  it('reads all four branches from the zh pack under a zh session', () => {
    renderIn('zh');

    expect(screen.getByText(ZH.just)).toBeTruthy();
    expect(screen.getByText(ZH.min)).toBeTruthy();
    expect(screen.getByText(ZH.hour)).toBeTruthy();
    expect(screen.getByText(ZH.day)).toBeTruthy();
  });

  it('leaves no English relative time behind in a zh session', () => {
    // The defect itself. Separated from the assertion above because a partial
    // conversion passes that one and fails this one.
    renderIn('zh');

    expect(screen.queryByText(EN.just)).toBeNull();
    expect(screen.queryByText(EN.min)).toBeNull();
    expect(screen.queryByText(EN.hour)).toBeNull();
    expect(screen.queryByText(EN.day)).toBeNull();
  });

  it('reads all four branches from the ar pack under an ar session', () => {
    renderIn('ar');

    expect(screen.getByText(AR.just)).toBeTruthy();
    expect(screen.getByText(AR.min)).toBeTruthy();
    expect(screen.getByText(AR.hour)).toBeTruthy();
    expect(screen.getByText(AR.day)).toBeTruthy();
  });

  it('interpolates {{count}} on the provider path rather than rendering it raw', () => {
    renderIn('zh');

    expect(screen.queryByText('{{count}}分钟前')).toBeNull();
    expect(screen.queryByText(/\{\{count\}\}/)).toBeNull();
  });

  it('still reads English under an en session', () => {
    // Green by construction before the fix too — each `en` pack value is
    // byte-identical to the literal it replaced. Kept as the guard that this
    // was a lookup swap and NOT a copy change.
    renderIn('en');

    expect(screen.getByText(EN.just)).toBeTruthy();
    expect(screen.getByText(EN.min)).toBeTruthy();
    expect(screen.getByText(EN.hour)).toBeTruthy();
    expect(screen.getByText(EN.day)).toBeTruthy();
  });

  it('falls back to the English defaults map with no provider mounted', () => {
    render(<RecordComments comments={comments()} />);

    expect(screen.getByText(EN.just)).toBeTruthy();
    expect(screen.getByText(EN.min)).toBeTruthy();
    expect(screen.getByText(EN.hour)).toBeTruthy();
    expect(screen.getByText(EN.day)).toBeTruthy();
  });

  it('interpolates {{count}} on the provider-LESS path too', () => {
    // `interpolateFallback` fills only the `{{name}}` spelling with no inner
    // spaces (objectui#3512 / #6219). This is the leg where a wrong spelling
    // renders a raw `{{count}}` silently.
    render(<RecordComments comments={comments()} />);

    expect(screen.queryByText(/\{\{count\}\}/)).toBeNull();
    expect(screen.queryByText('{{count}}m ago')).toBeNull();
  });

  it('never renders a raw key, provider or not', () => {
    renderIn('zh');
    for (const k of ['detail.justNow', 'detail.minutesAgo', 'detail.hoursAgo', 'detail.daysAgo']) {
      expect(screen.queryByText(k)).toBeNull();
    }
    cleanup();

    render(<RecordComments comments={comments()} />);
    for (const k of ['detail.justNow', 'detail.minutesAgo', 'detail.hoursAgo', 'detail.daysAgo']) {
      expect(screen.queryByText(k)).toBeNull();
    }
  });
});
