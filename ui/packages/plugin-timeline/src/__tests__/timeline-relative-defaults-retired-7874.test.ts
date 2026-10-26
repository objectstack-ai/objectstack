/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The five `timeline.relative.*` rows are retired from
 * `TIMELINE_DEFAULT_TRANSLATIONS` as residue (objectui#7874). Same shape as the
 * retirement-pin series in `@object-ui/i18n` (objectui#4392, objectui#4730,
 * objectui#5504, objectui#6310, objectui#7125): the retired rows asserted
 * absent, plus surviving-sibling assertions so a green here cannot be bought by
 * deleting the neighbourhood.
 *
 * ## What was removed — transcribed verbatim, which is what makes it reversible
 *
 * The deletion is safe because it is reversible, and it is reversible because
 * the content is written down HERE — not because "it is in git history
 * somewhere". The five rows, exactly as they stood in
 * `useTimelineTranslation.ts` before this change:
 *
 * ```ts
 * 'timeline.relative.today': 'Today',
 * 'timeline.relative.tomorrow': 'Tomorrow',
 * 'timeline.relative.yesterday': 'Yesterday',
 * 'timeline.relative.inDays': 'In {{n}} days',
 * 'timeline.relative.daysAgo': '{{n}} days ago',
 * ```
 *
 * ## Why they are residue, re-measured on the retiring branch
 *
 * Not inherited from the card — re-run against `origin/main` at `83fe6e741`:
 *
 *   - **No `en` leaf.** `packages/i18n/src/locales/en.ts` defines no
 *     `timeline.relative.*` key, so the provider path could never serve one
 *     either; `timeline.bucket.*` and `timeline.scale.*` are fully defined there.
 *   - **No caller, by PREFIX not by full key.** Searching the prefix
 *     `timeline.relative` over the whole tree — sources, tests, JSON, ignored
 *     build outputs included, `node_modules` excluded — returned exactly the five
 *     declaration lines and nothing else. The prefix is what a dynamically
 *     assembled key (`` t(`timeline.relative.${x}`) ``) would leave behind, and
 *     the tree carries no template-literal `t()` call at all.
 *   - **Positive control on that search.** The same command shape, run for
 *     `timeline.bucket.overdue` / `timeline.scale.week` / `timeline.gantt.rowLabel`,
 *     returned their call sites in `ObjectTimeline.tsx` and `renderer.tsx`. A
 *     search that has not been shown to fire is not a measurement. (That was
 *     read at `83fe6e741`. `timeline.bucket.overdue` has since lost its call
 *     site and then its row and pack key, objectui#11676, so a re-run needs
 *     another `ObjectTimeline.tsx` key, such as `timeline.bucket.today`, as
 *     its control.)
 *   - **The job moved to a formatter, not to other copy.** Day-granularity
 *     relative phrases ("Today", "Tomorrow", "3 days ago") are produced by
 *     `formatRelativeDate` / `formatRelativeDays` in `@object-ui/core`
 *     (`utils/date-display.ts`) through `Intl.RelativeTimeFormat`, which needs no
 *     copy row in any pack. That is what left these five behind.
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Nothing in the repo can see these rows — that is the whole reason they
 * survived, and it is equally true of them coming back:
 *
 *   - `scripts/check-i18n-call-site-keys.mjs`'s `missing-key` class judges CALL
 *     SITES; a table row with no call site is structurally out of its reach.
 *   - `all-locales-key-parity.test.ts` compares the ten packs to EACH OTHER; ten
 *     packs identically lacking a key is full parity, hence green.
 *   - `scripts/check-i18n-dead-keys.mjs` sweeps PACK keys with no call site;
 *     these keys are in no pack to be swept (and it is report-only anyway).
 *   - `defaults-maps-mirror-en-pack.test.tsx` (objectui#4401) would catch a
 *     defaults row the `en` pack does not define — but it gates the detail, list
 *     and designer maps, and `TIMELINE_DEFAULT_TRANSLATIONS` is not among them.
 *
 * They were surfaced only by objectui#7567's census PRINTING its abstention
 * count (5 of 846 factory-table rows). Re-adding them would be silent again, and
 * "the timeline should say Today" is a plausible way for someone to put them
 * back, so the pin is the guard.
 *
 * ## What this file does NOT claim
 *
 * - **It does not forbid relative-date copy.** Wiring the timeline's relative
 *   dates through `t()` is a FEATURE — it needs copy, plural rules and locale
 *   coverage across all ten packs, and the pack keys come first so
 *   `all-locales-key-parity.test.ts` demands the other nine. If that is what you
 *   are doing, delete this file with the card that does it; do not restore rows
 *   that no call site asks for as a shortcut.
 * - **It does not assert anything about the `en` pack.** These keys were never
 *   in it, so their absence there is not this retirement's doing and pinning it
 *   would forbid the feature card above.
 * - **`timeline.bucket.today` / `timeline.bucket.tomorrow` are DIFFERENT keys**
 *   that happen to carry the same two strings, `'Today'` and `'Tomorrow'`. A
 *   sweep by VALUE rather than by key takes them out as collateral, and the
 *   bucket header is a live render (`ObjectTimeline.tsx`). {@link SURVIVING}
 *   pins them for that reason.
 */
import { describe, it, expect } from 'vitest';

import {
  TIMELINE_DEFAULT_TRANSLATIONS,
  translateTimelineDefault,
} from '../useTimelineTranslation';

/** The retired rows, fully qualified, with the exact strings they carried. */
const RETIRED: Readonly<Record<string, string>> = {
  'timeline.relative.today': 'Today',
  'timeline.relative.tomorrow': 'Tomorrow',
  'timeline.relative.yesterday': 'Yesterday',
  'timeline.relative.inDays': 'In {{n}} days',
  'timeline.relative.daysAgo': '{{n}} days ago',
};

/** The family prefix — what a dynamically assembled key would resolve onto. */
const RETIRED_PREFIX = 'timeline.relative.';

/**
 * Rows the deletion swept around, each confirmed live by a `t()` call site
 * rather than by sitting nearby: the two bucket headers that carry the same
 * strings as retired rows (`ObjectTimeline.tsx`), the gantt axis vocabulary
 * (`renderer.tsx`) and the gantt row label (`renderer.tsx`).
 */
const SURVIVING: Readonly<Record<string, string>> = {
  'timeline.bucket.today': 'Today',
  'timeline.bucket.tomorrow': 'Tomorrow',
  'timeline.scale.week': 'Week {{n}}',
  'timeline.gantt.rowLabel': 'Items',
};

describe('the timeline relative-date defaults are retired as residue (objectui#7874)', () => {
  it('reads a table with rows in it', () => {
    // Non-vacuity, #4118 family standard: every assertion below reads the table,
    // so an unresolved import or an emptied table is green without this.
    expect(Object.keys(TIMELINE_DEFAULT_TRANSLATIONS).length).toBeGreaterThan(10);
  });

  it('carries no `timeline.relative.*` row, by key and by prefix', () => {
    const revived = Object.keys(TIMELINE_DEFAULT_TRANSLATIONS).filter(
      (key) => key.startsWith(RETIRED_PREFIX) || key in RETIRED,
    );
    // Named, not counted, and prefix-wide: a row re-added under a NEW leaf of the
    // same family (`timeline.relative.inWeeks`) is the same defect as restoring
    // one of the five.
    expect(
      revived,
      'A `timeline.relative.*` row is back in TIMELINE_DEFAULT_TRANSLATIONS. ' +
        'These rows have no `en` leaf and no call site, so `fallbackT` can never ' +
        'be asked for one — and no i18n gate in this repo can see that, because ' +
        'each of them runs call site -> key, pack -> pack, or pack -> call site ' +
        '(objectui#7874). Relative day phrases come from `formatRelativeDate` in ' +
        '@object-ui/core via Intl.RelativeTimeFormat. If the timeline is genuinely ' +
        'growing translated relative dates, author it as a feature — pack keys in ' +
        'all ten locales plus the call sites that read them — and delete this file ' +
        'with that card.',
    ).toEqual([]);
  });

  it('answers a retired key with the key itself, not with its old string', () => {
    // The behavioural half: `translateTimelineDefault` falls through to the raw
    // key for a row it does not carry. Asserting the OLD VALUE is gone (rather
    // than only that the table lacks the key) is what a half-revert — the row
    // restored under a renamed key — would trip over.
    for (const [key, formerValue] of Object.entries(RETIRED)) {
      expect(translateTimelineDefault(key), key).toBe(key);
      expect(translateTimelineDefault(key), key).not.toBe(formerValue);
    }
  });

  it('leaves the live rows that carry the same strings alone', () => {
    const swept = Object.entries(SURVIVING)
      .filter(([key, value]) => TIMELINE_DEFAULT_TRANSLATIONS[key] !== value)
      .map(([key, value]) => `${key} (expected ${JSON.stringify(value)})`);
    expect(
      swept,
      'A live timeline default is gone or drifted. `timeline.bucket.today` and ' +
        '`timeline.bucket.tomorrow` carry the same two strings the retired rows ' +
        'did — a sweep by VALUE rather than by key is exactly how the wrong rows ' +
        'go, and these two render the bucket headers on every feed timeline.',
    ).toEqual([]);
  });
});
