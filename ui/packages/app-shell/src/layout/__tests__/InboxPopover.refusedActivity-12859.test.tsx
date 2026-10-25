/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12859 — a refused `sys_activity` read shows ONE neutral sentence on
 * both surfaces off a record page: Home's activity card and the header bell's
 * Activity tab. The bell used to draw "An unexpected error occurred." for it,
 * and Home borrowed the record panel's "…on this record", where there is no
 * record.
 *
 * The feed already marks the refusal (`refused`, set by `isRefusedFeedRead`,
 * objectui#12843); these pins hand the real `InboxPopover` and the real
 * `HomeActivity` a reading under the real catalogue, in two languages, and
 * read the sentence back. The real-hook path into the bell (a 403 from the
 * adapter through `AppHeader`) is pinned in `AppHeader.inboxVariant.test.tsx`.
 *
 *   - refused ⇒ the bell and Home show the same sentence, with a lock, and it
 *     is not the record panel's sentence rendered beside them;
 *   - CONTROL: an error that is not a refusal ⇒ the generic failure on both.
 *
 * Direction, written before the run: with the bell's branch reading
 * `activity.status === 'error'` alone again, the refused cells go RED (the
 * bell shows the generic failure) and the CONTROL cells stay GREEN.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { RecordActivityTimeline } from '@object-ui/plugin-detail';
import { withRoster } from '../../hooks/__tests__/activityRoster';
import { HomeActivity } from '../../console/home/HomeRail';
import { InboxPopover } from '../InboxPopover';
import type { ActivityFeedReading } from '../../hooks/sharedUserFeeds';

type Lang = 'en' | 'zh-CN';

const NEUTRAL: Record<Lang, string> = {
  en: "You don't have permission to view activity.",
  'zh-CN': '您没有查看动态的权限。',
};
const GENERIC: Record<Lang, string> = {
  en: 'An unexpected error occurred.',
  'zh-CN': '发生未知错误。',
};

const REFUSED: ActivityFeedReading = { value: [], status: 'error', readable: true, refused: true };
const FAILED: ActivityFeedReading = { value: [], status: 'error', readable: true };

function HomeCard({ activity }: { activity: ActivityFeedReading }) {
  const { t } = useObjectTranslation();
  return <HomeActivity activity={activity} onViewAll={() => {}} t={t} />;
}

function renderSurfaces(lang: Lang, activity: ActivityFeedReading) {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  expect(i18n.language).toBe(lang);
  const Roster = withRoster();
  render(
    <MemoryRouter>
      <I18nProvider instance={i18n} persistLanguage={false}>
        <Roster>
          <div data-testid="bell">
            <InboxPopover
              notifications={[]}
              unreadCount={0}
              pendingApprovalsCount={0}
              activity={activity}
              onMarkAllRead={() => {}}
              onMarkRead={() => {}}
            />
          </div>
          <HomeCard activity={activity} />
          <div data-testid="record-panel">
            <RecordActivityTimeline items={[]} activityDenied />
          </div>
        </Roster>
      </I18nProvider>
    </MemoryRouter>,
  );
}

/** Open the bell and select the Activity tab, its last trigger. */
function openActivityTab() {
  fireEvent.click(screen.getByTestId('bell').querySelector('button') as HTMLButtonElement);
  const tabs = screen.getAllByRole('tab');
  // Radix tabs activate on a primary-button mouse down.
  act(() => {
    fireEvent.mouseDown(tabs[tabs.length - 1], { button: 0, ctrlKey: false });
  });
}

afterEach(() => {
  cleanup();
});

describe.each<Lang>(['en', 'zh-CN'])('a refused activity read off a record page, in %s (objectui#12859)', (lang) => {
  it("the bell's Activity tab shows the neutral sentence with a lock, not the generic failure", () => {
    renderSurfaces(lang, REFUSED);
    openActivityTab();

    const notice = screen.getByTestId('inbox-activity-access-denied');
    expect(notice).toHaveTextContent(NEUTRAL[lang]);
    expect(notice.querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('inbox-activity-unanswered')).not.toHaveTextContent(GENERIC[lang]);
  });

  it('Home shows the same sentence as the bell, and neither shows the record panel sentence', () => {
    renderSurfaces(lang, REFUSED);
    openActivityTab();

    const bell = screen.getByTestId('inbox-activity-access-denied').textContent;
    const home = screen.getByTestId('home-activity-access-denied').textContent;
    expect(home).toBe(bell);
    expect(home).toBe(NEUTRAL[lang]);

    // CONTROL: the record panel keeps its own, record-specific sentence.
    const record = screen
      .getByTestId('record-panel')
      .querySelector('[data-denied-source="activity"]')?.textContent;
    expect(record).toBeTruthy();
    expect(record).not.toBe(home);
  });

  it('CONTROL: an error that is not a refusal keeps the generic failure on both surfaces', () => {
    renderSurfaces(lang, FAILED);
    openActivityTab();

    expect(screen.getByTestId('inbox-activity-unanswered')).toHaveTextContent(GENERIC[lang]);
    expect(screen.queryByTestId('inbox-activity-access-denied')).not.toBeInTheDocument();
    expect(screen.getByTestId('home-activity-unanswered')).toHaveTextContent(GENERIC[lang]);
    expect(screen.queryByTestId('home-activity-access-denied')).not.toBeInTheDocument();
  });
});
