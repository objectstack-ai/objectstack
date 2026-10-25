/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4520 — the gantt BUCKET vocabulary and the row-label default speak
 * the session language.
 *
 * ── The measured defect ──────────────────────────────────────────────────
 * objectui#4513 threaded `useDisplayLocale()` through every `Intl` call in
 * `renderer.tsx`, so a `zh` session renders `2026年8月` on the month axis and
 * `2026年8月11日` on item dates. Three sibling strings in the same renderer
 * never went through `Intl` at all and stayed English on that same Chinese
 * axis:
 *
 *   week header    `Week ${n}`                          -> `Week 1`
 *   quarter header `Q${q} ${year}`                       -> `Q3 2026`
 *   row label      `schema.rowLabel || 'Items'`          -> `Items`
 *
 * The half-fixed state is the visible one: a Chinese date axis with English
 * bucket labels beside it.
 *
 * ── Why this is a translation card and not a locale-resolver one ──────────
 * No `Intl` call is involved in any of the three. A locale TAG cannot spell
 * `第 1 周`; only a translation can. So these resolve through the package's
 * own channel — `useTimelineTranslation` / `TIMELINE_DEFAULT_TRANSLATIONS`,
 * the `createSafeTranslation` factory `ObjectTimeline` already uses for
 * `timeline.bucket.*` — and the numbers ride the channel's own `{{hole}}`
 * parameter mechanism rather than being concatenated into the string.
 *
 * ── The two channels, and why they can disagree ───────────────────────────
 * They are deliberately different resolvers and this file pins that:
 *
 *   dates      -> `useDisplayLocale()`  : tenant regional default -> UI language -> `en`
 *   vocabulary -> the translate channel : the UI language the user reads
 *
 * A tenant that configured the `en` regional default while the user reads
 * Chinese chrome therefore renders `Aug 2026` beside `第 1 周`. That is the
 * repo's established split, not a defect of this change — `timeline.bucket.*`
 * has behaved this way in `ObjectTimeline` all along — and objectui#4513's
 * precedence pin is about DATES, which this card must not move.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting `renderer.tsx` to its pre-#4520 state turns the three `zh session`
 * vocabulary cases RED and leaves every `en session` case GREEN. The `en` half
 * is the must-not-change pin: the translated `en` values are byte-identical to
 * the retired hardcoded literals, so English rendering must not move by one
 * character.
 *
 * ⚠️ Every case here mounts an `I18nProvider`. Provider-LESS assertions must
 * NOT be added to this file (objectui#4514): `useObjectTranslation()` outside a
 * provider reports the language of react-i18next's GLOBAL instance, which every
 * mounted provider leaves on whatever language it was given, so a provider-less
 * case written after a `zh` case here would resolve `'zh'` and pin test
 * ordering rather than the fallback. The channel's provider-less last resort
 * lives in `timeline-scale-vocabulary-defaults.test.ts`, which mounts nothing
 * and renders nothing.
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { TimelineRenderer } from '../renderer';

/**
 * Explicit local time-of-day rather than bare `YYYY-MM-DD`, which `Date` parses
 * as UTC midnight: a runner west of UTC would render the neighbouring day and
 * the pins would read as vocabulary failures when they were timezone failures.
 */
const AUG_11 = '2026-08-11T00:00:00';
const AUG_12 = '2026-08-12T00:00:00';
const SEP_11 = '2026-09-11T00:00:00';

/** A session: the UI language the user picked, plus the tenant's regional
 *  default (usually absent — the state the card was measured in). */
function renderSession(language: string, node: React.ReactNode, tenantLocale?: string) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale: tenantLocale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

/**
 * A gantt schema pinned to an explicit range, so the axis never depends on
 * today's date. `rowLabel` is left UNSET — the defect is in the default, and an
 * author who supplies one supplies their own string (pinned separately below).
 */
const gantt = (scale: string, minDate: string, maxDate: string) =>
  ({
    type: 'timeline',
    variant: 'gantt',
    scale,
    minDate,
    maxDate,
    items: [{ label: 'Backend', items: [{ title: 'API Design', startDate: minDate, endDate: maxDate }] }],
  }) as any;

afterEach(() => cleanup());

describe('zh session — the gantt bucket vocabulary is Chinese (objectui#4520)', () => {
  it('the week header reads the translated bucket, not `Week n`', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('week', AUG_11, AUG_12)} />);
    expect(container.textContent).toContain('第 1 周');
    expect(container.textContent).not.toContain('Week 1');
  });

  it('the week number rides the channel’s parameter mechanism across several buckets', () => {
    // Three weeks of range: if the number were concatenated rather than
    // interpolated, the second and third buckets would be the giveaway.
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('week', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('第 1 周');
    expect(container.textContent).toContain('第 2 周');
    expect(container.textContent).not.toContain('Week');
  });

  it('the quarter header reads the translated bucket, not `Qn YYYY`', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('quarter', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('2026年第3季度');
    expect(container.textContent).not.toContain('Q3 2026');
  });

  it('the quarter number and the year are separate parameters, not one string', () => {
    // A range crossing a year boundary: `zh` puts the year FIRST, so a value
    // built by concatenating `Q${q} ${year}` cannot produce this ordering at
    // all — this is the case that fails if the interpolation is faked.
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('quarter', '2026-11-15T00:00:00', '2027-02-01T00:00:00')} />);
    expect(container.textContent).toContain('2026年第4季度');
    expect(container.textContent).toContain('2027年第1季度');
  });

  it('the unset row label reads the translated default, not `Items`', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('条目');
    expect(container.textContent).not.toContain('Items');
  });
});

describe('en session — byte-identical to the retired literals (must-not-change)', () => {
  it('the week header still reads `Week 1`', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={gantt('week', AUG_11, AUG_12)} />);
    expect(container.textContent).toContain('Week 1');
  });

  it('the week counter still increments per bucket', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={gantt('week', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('Week 1');
    expect(container.textContent).toContain('Week 2');
  });

  it('the quarter header still reads `Q3 2026`', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={gantt('quarter', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('Q3 2026');
  });

  it('the unset row label still reads `Items`', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('Items');
  });
});

describe('what this card must NOT move (green both sides)', () => {
  it('the year header is a bare number and stays one — zh', () => {
    // `String(getFullYear())` carries no vocabulary at all. Translating it
    // would be inventing a bucket label the card did not ask for.
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('year', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('2026');
  });

  it('an author-supplied rowLabel wins over the translated default — zh', () => {
    // Only the DEFAULT was hardcoded. An author who writes `rowLabel` supplies
    // their own string and no translation may overwrite it.
    const schema = { ...gantt('month', AUG_11, SEP_11), rowLabel: 'Projects' };
    renderSession('zh', <TimelineRenderer schema={schema} />);
    expect(screen.getByText('Projects')).toBeDefined();
  });

  it('the date axis still follows the DATE channel, tenant first (objectui#4513)', () => {
    // The tenant configured `en`; the user reads `zh`. Dates are the tenant's
    // (`Aug 2026`), vocabulary is the user's — two resolvers, by design.
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />, 'en');
    expect(container.textContent).toContain('Aug 2026');
    expect(container.textContent).not.toContain('2026年8月');
  });

  it('non-date, non-bucket rendering is untouched — zh', () => {
    renderSession('zh', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />);
    expect(screen.getByText('Backend')).toBeDefined();
    expect(screen.getByText('API Design')).toBeDefined();
  });
});
