/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The activity panel's landmark is named by the heading it draws — objectui#9998.
 *
 * `RecordActivityTimeline` renders a `<section>` landmark with a visible `<h2>`
 * inside it. The heading read `titleLabel ?? t('detail.activity')`, but the
 * landmark's name was a separate, fixed `aria-label={t('detail.discussion')}`.
 * So the two mounts of the one component disagreed:
 *
 *   - `record:activity` passes no `titleLabel`: a region spoken "Discussion"
 *     under a heading reading "Activity (N)" — a different word, not even a
 *     paraphrase;
 *   - `record:chatter` passes `titleLabel={t('detail.discussion')}` on both of
 *     `RecordChatterPanel`'s paths (sidebar and inline), so its heading and its
 *     landmark happened to agree. That asymmetry is the control: the same
 *     component, one prop apart, named right on one mount and wrong on the
 *     other.
 *
 * The contract is the repo's own, pinned by objectui#4118 in
 * `ReportConfigPanel.panelTitle.test.tsx`:
 *
 *   "A speech-input user says what they see, so the landmark's spoken name must
 *    be the heading, not a paraphrase of it."
 *
 * The section's name and the heading's title are now ONE value (`title`, read
 * once and used for both), rather than two strings kept in step. (Not
 * `aria-labelledby`: the per-instance id it needs comes from `React.useId()`,
 * which differs on every mount, and two instruments elsewhere in the tree
 * byte-compare two mounts' HTML — the component's own comment names them.)
 * The `(N)` count badge beside the title is deliberately NOT part of the
 * name: it is live status (it moves with the filter dropdown), and it is the
 * part of the heading nobody speaks to name the panel — which is exactly why
 * the chatter mount's "Discussion" under "Discussion (N)" was the agreeing
 * control, not a second instance of the defect. So "equals the heading" is
 * asserted below as "equals the heading minus its count", and the count is
 * asserted separately to still be on screen.
 *
 * ── Direction ─────────────────────────────────────────────────────────────
 * Measured on the unfixed tree: the `record:activity` case and the authored
 * `titleLabel` case were RED (the region read "Discussion"); both chatter
 * controls were GREEN before and after.
 *
 * Every case reads the accessibility tree through the real `en` pack — not a
 * `t`-echoing mock and not an attribute — so it holds whichever ARIA mechanism
 * names the section, and fails for any mechanism that names it something the
 * heading does not say.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DiscussionContextProvider, RecordContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { RecordActivityRenderer } from '../renderers/record-activity';
import { RecordChatterRenderer } from '../renderers/record-chatter';

/**
 * Two rows, so the heading's count reads `(2)` and is visibly not the name.
 * `satisfies` rather than an annotation: it keeps the ids `string`, which is
 * what `DiscussionContextProvider` types them as, so no cast is needed.
 */
const ITEMS = [
  { id: 'c-1', type: 'comment', actor: 'Ada', body: 'First', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'c-2', type: 'comment', actor: 'Grace', body: 'Second', createdAt: '2026-01-03T00:00:00.000Z' },
] satisfies FeedItem[];

function mount(node: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1' }}>
        <DiscussionContextProvider items={ITEMS} loading={false}>
          {node}
        </DiscussionContextProvider>
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/**
 * The panel's heading and the landmark that holds it. The region is reached
 * FROM the heading rather than looked up by name, so a wrong name fails as an
 * assertion that prints both strings, not as a "no region named X" miss.
 */
function panel() {
  const heading = screen.getByRole('heading', { level: 2 });
  const region = heading.closest('section');
  if (!region) throw new Error('the panel heading is not inside a <section>');
  return { heading, region };
}

/** The heading's title: its visible text without the trailing `(N)` count. */
const titleOf = (heading: HTMLElement) =>
  (heading.textContent ?? '').replace(/\s*\(\d+\)\s*$/, '').trim();

/**
 * The #4118 invariant, stated once for every mount below: the section is a
 * `region` landmark (it has a name at all), and that name is the heading's
 * title — the words on screen, not a second string.
 */
function expectLandmarkNamedByHeading(expectedTitle: string) {
  const { heading, region } = panel();
  expect(titleOf(heading)).toBe(expectedTitle);
  expect(region).toHaveAccessibleName(titleOf(heading));
  expect(screen.getByRole('region', { name: expectedTitle })).toBe(region);
  // The count is still on screen — excluded from the name, not from the page.
  expect(heading).toHaveTextContent(/\(2\)$/);
}

afterEach(() => cleanup());

describe('the activity panel landmark is named by its heading (objectui#9998)', () => {
  it('record:activity — no titleLabel — is named "Activity", the heading it draws', () => {
    mount(<RecordActivityRenderer schema={{ items: ITEMS } as never} />);
    expectLandmarkNamedByHeading('Activity');
    // The exact symptom the card reported: a region spoken "Discussion".
    expect(screen.queryByRole('region', { name: 'Discussion' })).toBeNull();
  });

  it('record:chatter, inline path — the control — still agrees', () => {
    mount(<RecordChatterRenderer schema={{ position: 'bottom', collapsible: false } as never} />);
    expectLandmarkNamedByHeading('Discussion');
  });

  it('record:chatter, sidebar path — the control — still agrees', () => {
    mount(<RecordChatterRenderer schema={{ position: 'right', collapsible: false } as never} />);
    expectLandmarkNamedByHeading('Discussion');
  });

  it('an authored titleLabel flows into both the heading and the landmark', () => {
    mount(<RecordActivityTimeline items={ITEMS} titleLabel="Deal history" />);
    expectLandmarkNamedByHeading('Deal history');
  });
});
