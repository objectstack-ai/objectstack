/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4513 — every date the timeline renders follows the ACTIVE locale.
 *
 * ── The measured defect ──────────────────────────────────────────────────
 * `renderer.tsx` handed `Intl` a literal `'en-US'` at four sites and nothing
 * at all at a fifth, so a fully Chinese timeline widget rendered an English
 * axis. The five, as the #4468 census recorded them:
 *
 *   :71  hour header  `toLocaleString('en-US', { month, day, hour })`
 *   :77  day header   `toLocaleDateString('en-US', { month, day })`
 *   :108 month header `toLocaleDateString('en-US', { month, year })`
 *   :157 short item   `toLocaleDateString()`      ← the omission, not a literal
 *   :160 long item    `toLocaleDateString('en-US', { year, month, day })`
 *
 * `:157` is the same defect spelled the other way: a bare call means "the
 * MACHINE's locale", so it agreed with the other four only by the accident of
 * an en-US runner, and would have rendered a third locale on anyone's laptop.
 *
 * ── The fix ──────────────────────────────────────────────────────────────
 * All five resolve through `useDisplayLocale()` (tenant regional default →
 * active UI language → `'en'`), the one channel `@object-ui/fields` was
 * converged onto in objectui#4468 / PR #4512. `'zh'` is a well-formed BCP-47
 * subtag, so `Intl` takes it verbatim — there is no mapping table here or
 * anywhere else. The two date helpers are module-level functions, so the
 * locale is read once in `TimelineRenderer` and threaded down.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting `renderer.tsx` to `origin/main` and keeping this file turns every
 * `zh session` case RED and leaves every `en session` case GREEN. The `en`
 * cases are green on BOTH sides deliberately — they are the must-not-change
 * half: `'en'` and the retired `'en-US'` produce byte-identical output at all
 * five sites, so English rendering must not move by one character.
 *
 * The locale-free headers (the week / quarter / year buckets) and the non-date
 * rendering (titles, descriptions, row labels) are likewise green on both
 * sides: they never went through `Intl`, and this file pins that the change
 * did not disturb them. Their two English spellings were later routed through
 * the package's TRANSLATE channel by objectui#4520 — a different channel from
 * the one this card owns — so those two expected strings have moved once,
 * deliberately; see the case itself.
 *
 * The provider-LESS last resort is deliberately not measured here — see
 * `timeline-date-locale-fallback.test.tsx` for why it cannot be.
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { TimelineRenderer } from '../renderer';

/**
 * Dates are spelled with an explicit local time-of-day rather than as bare
 * `YYYY-MM-DD`, which `Date` parses as UTC midnight: a runner west of UTC
 * would otherwise render the neighbouring day and the pins would read as
 * locale failures when they were timezone failures.
 */
const AUG_11_09 = '2026-08-11T09:00:00';
const AUG_11_10 = '2026-08-11T10:00:00';
const AUG_11 = '2026-08-11T00:00:00';
const AUG_12 = '2026-08-12T00:00:00';
const SEP_11 = '2026-09-11T00:00:00';

/**
 * A session: the UI language the user picked, plus the tenant's regional
 * default (usually absent — the state the card was measured in).
 *
 * `persistLanguage={false}` keeps each case on its own language instead of
 * inheriting whatever the previous one wrote to `localStorage`.
 */
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

/** A gantt schema pinned to an explicit range, so the axis never depends on
 *  today's date. */
const gantt = (scale: string, minDate: string, maxDate: string) =>
  ({
    type: 'timeline',
    variant: 'gantt',
    scale,
    minDate,
    maxDate,
    rowLabel: 'Projects',
    items: [{ label: 'Backend', items: [{ title: 'API Design', startDate: minDate, endDate: maxDate }] }],
  }) as any;

/** A vertical schema whose single item carries one date, formatted by
 *  `dateFormat`. */
const vertical = (dateFormat: string, time: string) =>
  ({
    type: 'timeline',
    variant: 'vertical',
    dateFormat,
    items: [{ time, title: 'Beta Release', description: 'Released beta version to testers' }],
  }) as any;

afterEach(() => cleanup());

describe('zh session — every date site renders Chinese (objectui#4513)', () => {
  it('site :71 — the hour-granularity gantt header', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('hour', AUG_11_09, AUG_11_10)} />);
    expect(container.textContent).toContain('8月11日 9时');
    expect(container.textContent).not.toContain('Aug 11, 9 AM');
  });

  it('site :77 — the day gantt header', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('day', AUG_11, AUG_12)} />);
    expect(container.textContent).toContain('8月11日');
    expect(container.textContent).not.toContain('Aug 11');
  });

  it('site :108 — the month gantt header (the renderer default scale)', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('2026年8月');
    expect(container.textContent).toContain('2026年9月');
    expect(container.textContent).not.toContain('Aug 2026');
  });

  it("site :157 — the `short` item date, the bare call that read the MACHINE's locale", () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={vertical('short', AUG_11)} />);
    expect(container.textContent).toContain('2026/8/11');
    expect(container.textContent).not.toContain('8/11/2026');
  });

  it('site :160 — the `long` item date', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={vertical('long', AUG_11)} />);
    expect(container.textContent).toContain('2026年8月11日');
    expect(container.textContent).not.toContain('August 11, 2026');
  });

  it('the horizontal variant formats its item dates through the same channel', () => {
    const schema = {
      type: 'timeline',
      variant: 'horizontal',
      dateFormat: 'long',
      items: [{ time: AUG_11, title: 'Q3' }],
    } as any;
    const { container } = renderSession('zh', <TimelineRenderer schema={schema} />);
    expect(container.textContent).toContain('2026年8月11日');
    expect(container.textContent).not.toContain('August 11, 2026');
  });

  it('the gantt bar tooltip — a date site that renders into an attribute, not text', () => {
    renderSession('zh', <TimelineRenderer schema={{ ...gantt('month', AUG_11, SEP_11), dateFormat: 'long' }} />);
    const bar = document.querySelector('[title*="API Design"]');
    expect(bar?.getAttribute('title')).toContain('2026年8月11日');
    expect(bar?.getAttribute('title')).not.toContain('August 11, 2026');
  });
});

describe('en session — output is byte-identical to the retired en-US (must-not-change)', () => {
  it('site :71 — the hour-granularity gantt header', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={gantt('hour', AUG_11_09, AUG_11_10)} />);
    expect(container.textContent).toContain('Aug 11, 9 AM');
  });

  it('site :77 — the day gantt header', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={gantt('day', AUG_11, AUG_12)} />);
    expect(container.textContent).toContain('Aug 11');
    expect(container.textContent).toContain('Aug 12');
  });

  it('site :108 — the month gantt header', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />);
    expect(container.textContent).toContain('Aug 2026');
    expect(container.textContent).toContain('Sep 2026');
  });

  it('site :157 — the `short` item date', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={vertical('short', AUG_11)} />);
    expect(container.textContent).toContain('8/11/2026');
  });

  it('site :160 — the `long` item date', () => {
    const { container } = renderSession('en', <TimelineRenderer schema={vertical('long', AUG_11)} />);
    expect(container.textContent).toContain('August 11, 2026');
  });
});

describe('non-date rendering is undisturbed (green both sides)', () => {
  it('the locale-free header vocabularies do not go through `Intl` — zh', () => {
    // `Week n` / `Qn YYYY` / `YYYY` never went through `Intl`, so threading a
    // locale must not touch them — which is what this case pins, on both sides
    // of #4513.
    //
    // ⚠️ AUTHORIZED PIN MOVE (objectui#4520). The first two expectations read
    // `Week 1` / `Q3 2026` when #4513 wrote them: that card was scoped to the
    // five `Intl` sites, so it deliberately pinned the two bucket labels
    // STAYING English to keep its own scope honest, and filed the English as
    // objectui#4520. #4520 then routed them through the package's translate
    // channel, so the expected strings — and only they — move here. What the
    // case asserts is unchanged: threading a LOCALE did not touch them, and a
    // locale tag is still not what spells them. The `year` header below stays
    // exactly as it was; `String(getFullYear())` is a bare number with no
    // vocabulary in it, so no channel has anything to say about it.
    const week = renderSession('zh', <TimelineRenderer schema={gantt('week', AUG_11, AUG_12)} />);
    expect(week.container.textContent).toContain('第 1 周');
    cleanup();

    const quarter = renderSession('zh', <TimelineRenderer schema={gantt('quarter', AUG_11, SEP_11)} />);
    expect(quarter.container.textContent).toContain('2026年第3季度');
    cleanup();

    const year = renderSession('zh', <TimelineRenderer schema={gantt('year', AUG_11, SEP_11)} />);
    expect(year.container.textContent).toContain('2026');
  });

  it('the `iso` date format is not a locale format and must not become one', () => {
    // `dateFormat: 'iso'` returns `toISOString().split('T')[0]`. It is a
    // machine format by definition; a zh session must still see the ISO day.
    const { container } = renderSession('zh', <TimelineRenderer schema={vertical('iso', AUG_11)} />);
    expect(container.textContent).toContain('2026-08-11');
  });

  it('titles, descriptions and row labels are untouched — zh', () => {
    // `getByText` throws when the node is absent, so it carries the assertion;
    // `toBeDefined()` is the package's spelling for it (jest-dom's matchers are
    // loaded by the repo-root `vitest.setup.dom-light.tsx` at runtime but not
    // declared to `tsc -p tsconfig.test.json`, so no test here uses them). That
    // used to read `vitest.setup.ts`, this package's own one-line copy, which
    // objectui#3240 deleted along with the config that was its only loader.
    renderSession('zh', <TimelineRenderer schema={vertical('short', AUG_11)} />);
    expect(screen.getByText('Beta Release')).toBeDefined();
    expect(screen.getByText('Released beta version to testers')).toBeDefined();
    cleanup();

    renderSession('zh', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />);
    expect(screen.getByText('Projects')).toBeDefined();
    expect(screen.getByText('Backend')).toBeDefined();
  });
});

describe('channel precedence is the resolver’s, not this renderer’s (green both sides)', () => {
  /**
   * `useDisplayLocale()` puts the TENANT locale above the UI language: an org
   * that configured `en` means it, even for a user reading Chinese chrome.
   * Pinned here so a future "simplification" that reads the UI language
   * directly is caught — the point of the card is one resolver, not one hook
   * call.
   */
  it('an explicit tenant locale outranks the active UI language', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={vertical('long', AUG_11)} />, 'en');
    expect(container.textContent).toContain('August 11, 2026');
    expect(container.textContent).not.toContain('2026年8月11日');
  });

  it('the tenant locale reaches the gantt axis too, not only the item dates', () => {
    const { container } = renderSession('zh', <TimelineRenderer schema={gantt('month', AUG_11, SEP_11)} />, 'en');
    expect(container.textContent).toContain('Aug 2026');
    expect(container.textContent).not.toContain('2026年8月');
  });
});
