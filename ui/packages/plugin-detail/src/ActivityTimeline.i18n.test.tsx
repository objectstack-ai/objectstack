/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ActivityTimeline`'s empty state speaks the session locale — objectui#7142.
 *
 * The title was the raw English literal `"No activity recorded"`, written
 * straight into the JSX. It was not a `t()` call and not an inline
 * `defaultValue`, so it never reached the pack system at all and a zh session
 * read English. Measured before the fix by rendering `activities={[]}` under a
 * zh `I18nProvider`: the card came out `"Activity(0)No activity recorded"`,
 * while its sibling `RecordActivityTimeline` rendered `"活动(0)全部动态暂无活动记录"`
 * from the same packs.
 *
 * The call site now reads `detail.noActivity` — the key the sibling already
 * uses (`RecordActivityTimeline.tsx`), reused rather than forked. That reuse is
 * a measured decision, not an assumption: the `en` pack value for the key is
 * `'No activity recorded'`, **byte-identical** to the literal being replaced,
 * so both surfaces were already saying the same words in English and a second
 * key would have forked one sentence across ten packs for no copy difference.
 *
 * `zh` and `ar` are the load-bearing assertions. An `en`-only test would have
 * been green *before* the fix too — the literal and the `en` pack value are the
 * same string — so English proves nothing here. Non-Latin locales are what
 * discriminate the pack lookup from the hardcoded literal.
 *
 * The provider-less case is asserted alongside them because
 * `useDetailTranslation` is a `createSafeTranslation` hook: a host with no
 * `I18nProvider` must get the English default from
 * `DETAIL_DEFAULT_TRANSLATIONS`, never the raw key `detail.noActivity` in the
 * empty box. No inline `defaultValue` is used anywhere here (objectui#3517) —
 * the key resolves from the packs or from that defaults map.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { ActivityEntry } from '@object-ui/types';
import { ActivityTimeline } from './ActivityTimeline';

afterEach(() => cleanup());

/** The pack values for `detail.noActivity`, read from the packs themselves. */
const EN = 'No activity recorded';
const ZH = '暂无活动记录';
const AR = 'لا يوجد نشاط مسجل';
const RAW_KEY = 'detail.noActivity';

function renderEmptyIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActivityTimeline activities={[]} />
    </I18nProvider>,
  );
}

describe('ActivityTimeline empty state — locale resolution (objectui#7142)', () => {
  it('reads the zh pack value under a zh session', () => {
    renderEmptyIn('zh');

    expect(screen.getByText(ZH)).toBeTruthy();
    // The regression itself: English must not survive into a zh session.
    expect(screen.queryByText(EN)).toBeNull();
  });

  it('reads the ar pack value under an ar session', () => {
    renderEmptyIn('ar');

    expect(screen.getByText(AR)).toBeTruthy();
    expect(screen.queryByText(EN)).toBeNull();
  });

  it('still reads English under an en session', () => {
    renderEmptyIn('en');

    expect(screen.getByText(EN)).toBeTruthy();
  });

  it('falls back to the English default with no provider mounted', () => {
    render(<ActivityTimeline activities={[]} />);

    expect(screen.getByText(EN)).toBeTruthy();
  });

  it('never renders the raw key, provider or not', () => {
    renderEmptyIn('zh');
    expect(screen.queryByText(RAW_KEY)).toBeNull();
    cleanup();

    render(<ActivityTimeline activities={[]} />);
    expect(screen.queryByText(RAW_KEY)).toBeNull();
  });

  it('translates the empty state reached by filtering, not just by an empty list', () => {
    // The other route to this box: a non-empty timeline filtered down to a type
    // that has no entries. Same call site, but it is the only one a host reaches
    // with `activities` actually populated.
    const activities: ActivityEntry[] = [
      {
        id: 'a1',
        type: 'comment',
        user: 'Ada',
        timestamp: '2026-01-02T00:00:00.000Z',
      } as ActivityEntry,
    ];

    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ActivityTimeline activities={activities} filterable defaultFilter="delete" />
      </I18nProvider>,
    );

    expect(screen.getByText(ZH)).toBeTruthy();
    expect(screen.queryByText(EN)).toBeNull();
  });
});
