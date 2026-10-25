/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4468 — every date branch threads the ACTIVE locale.
 *
 * ── The measured split ───────────────────────────────────────────────────
 * On a `zh` console the same task row rendered `逾期 6 天` in one column and
 * `In 3 days` in the next, and the datetime column read `8/11/2026 12:00 am`.
 * Not a missing translation: the field labels around it were fully Chinese.
 *
 * The cause is that the date renderers had TWO locale channels and only one
 * of them followed the user's language:
 *
 *   - the OVERDUE phrase resolves through `useFieldTranslate()` → the ACTIVE
 *     UI language → `逾期 6 天`;
 *   - every `Intl` branch (relative past, relative future, the >±7d absolute
 *     fallback) took its tag from `useLocalization().locale` — the TENANT's
 *     regional default (ADR-0053), which is `undefined` on any workspace that
 *     has not configured one. `Intl` with `undefined` reads the MACHINE's
 *     locale, so those branches rendered en-US next to the Chinese one;
 *   - `DateTimeCellRenderer` passed no tag at all, hence `8/11/2026 12:00 am`.
 *
 * The one resolver is `useDisplayLocale()` (tenant locale → active UI
 * language → `'en'`), which `@object-ui/i18n` already owns and whose own
 * docstring claimed `DateCellRenderer` "already formats from this channel" —
 * it did not. `'zh'` is a valid BCP-47 tag, so there is no `'zh'`→`zh-CN`
 * mapping anywhere: `useDisplayLocale()` IS the single mapping point.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting the renderers to `origin/main` and keeping this file turns every
 * `zh session` case RED and leaves every `en session` case GREEN. The `en`
 * cases are green on BOTH sides on purpose — that is the must-not-change
 * half: the English output has to be byte-identical after the change, since
 * `'en'` and the CI machine's `en-US` agree on all of these forms.
 *
 * `已逾期`/`Overdue Nd` is likewise green on both sides: it never used the
 * broken channel, and this file pins that the fix did not disturb it.
 *
 * ⚠️ objectui#8194 amendment. The `date` WIDGET faces in this file (readonly
 * `DateField`, the sub-grid `date` column, a `date`-returning `FormulaField`)
 * used to render `Intl`'s bare numeric default — `8/11/2026` / `2026/8/11` —
 * because they passed NO options bag. They now render `formatDate`'s default
 * face, the one home for the `date` display convention. That moves the `en`
 * output too, so those literals were replaced by `defaultDateFace()` below:
 * this file's subject is WHICH TAG reaches `Intl`, and expressing the
 * expectation through the shared bag keeps that subject measurable without
 * re-asserting the face. The `datetime` CELL cases here are untouched — they
 * were never part of #8194 and already went through `formatDateTime`.
 *
 * ⚠️ objectui#8209 amendment. The readonly `DateTimeField` WIDGET and the
 * sub-grid's `datetime` column were the last two sites still composing two
 * bare `toLocale*` calls; they now go through `formatDateTime`, each on the
 * face of its register (verbose default for the form / detail widget,
 * `'compact'` for the grid cell). Same treatment as above: their literals are
 * expressed through `defaultDateTimeFace()` so this file keeps asking WHICH
 * TAG reaches `Intl` rather than re-asserting a face that
 * `datetime-widget-faces-8209.test.tsx` owns.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DateCellRenderer, DateTimeCellRenderer } from '../index';
import { DateField } from '../widgets/DateField';
import { DateTimeField } from '../widgets/DateTimeField';
import { FormulaField } from '../widgets/FormulaField';
import { GridField } from '../widgets/GridField';

/**
 * `n` days from today, pinned to local noon so a run that starts near
 * midnight can never land the value on the neighbouring day.
 */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/**
 * A fixed instant, built from LOCAL parts so the rendered day/time is the
 * same in every timezone the suite might run in. This is the exact value
 * shape the card captured: `8/11/2026 12:00 am` on an en machine.
 */
const FIXED_INSTANT = new Date(2026, 7, 11, 0, 0, 0).toISOString();

/**
 * The `date` DEFAULT face in `locale` — `formatDate`'s bag, spelled out.
 *
 * Every `date` surface in this file renders through `formatDate`'s default
 * style since objectui#8194, and that face DROPS the year inside the current
 * year on purpose. So the expected string cannot be a literal here: `Aug 11`
 * and `Aug 11, 2026` are the same call in different calendar years, and a
 * hard-coded literal would turn this locale-channel file red on a January 1st
 * for a reason that has nothing to do with locales.
 *
 * This is the idiom the "absolute fallback beyond the ±7-day window" case
 * below already used for the same reason; #8194 only widened its reach. The
 * year-dropping decision itself is pinned VERBATIM, against a frozen clock,
 * in `fields-date-widget-convention-8194.test.tsx` — that claim belongs
 * there, this file's claim is that the tag reaching `Intl` is the session's.
 */
function defaultDateFace(value: string | Date, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * `formatDateTime`'s DEFAULT (verbose) face — what the readonly `datetime`
 * WIDGET renders since objectui#8209. Same idiom as `defaultDateFace` above
 * and for the same reason, with one difference worth stating: this face keeps
 * the year in EVERY year (the year-drop is `formatDate`'s date-only cell rule
 * per objectui#7620, and the #8209 ruling declines to extend it to
 * `datetime`), so there is no current-year branch here.
 */
function defaultDateTimeFace(value: string | Date, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A session: the UI language the user picked, plus the tenant's regional
 * default (usually absent — the state the card was measured in).
 *
 * `persistLanguage={false}` keeps each case on its own language instead of
 * inheriting whatever the previous one wrote to `localStorage`.
 */
function renderSession(
  language: string,
  node: React.ReactNode,
  tenantLocale?: string,
) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale: tenantLocale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

const dateField = (name: string) => ({ type: 'date', name }) as any;

afterEach(() => cleanup());

describe('zh session — every date branch renders Chinese (objectui#4468)', () => {
  it('future-relative: the branch the card caught as "In 3 days"', () => {
    renderSession('zh', <DateCellRenderer value={daysFromNow(3)} field={dateField('end_date')} />);
    expect(screen.getByText('3天后')).toBeInTheDocument();
    expect(screen.queryByText('In 3 days')).not.toBeInTheDocument();
  });

  it('past-relative, non-due: the branch the card caught as "6 days ago"', () => {
    renderSession('zh', <DateCellRenderer value={daysFromNow(-6)} field={dateField('start_date')} />);
    expect(screen.getByText('6天前')).toBeInTheDocument();
    expect(screen.queryByText('6 days ago')).not.toBeInTheDocument();
  });

  it('near-today: today / tomorrow / yesterday', () => {
    renderSession('zh', <DateCellRenderer value={daysFromNow(0)} field={dateField('start_date')} />);
    expect(screen.getByText('今天')).toBeInTheDocument();
    cleanup();

    renderSession('zh', <DateCellRenderer value={daysFromNow(1)} field={dateField('start_date')} />);
    expect(screen.getByText('明天')).toBeInTheDocument();
    cleanup();

    renderSession('zh', <DateCellRenderer value={daysFromNow(-1)} field={dateField('start_date')} />);
    expect(screen.getByText('昨天')).toBeInTheDocument();
  });

  it('absolute fallback beyond the ±7-day window', () => {
    const value = daysFromNow(30);
    // The formatter drops the year when it is the current one, so the
    // expectation is built the same way rather than hardcoding a month that
    // depends on the day this suite runs.
    const d = new Date(value);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    const expected = d.toLocaleDateString('zh', {
      year: sameYear ? undefined : 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const enForm = d.toLocaleDateString('en', {
      year: sameYear ? undefined : 'numeric',
      month: 'short',
      day: 'numeric',
    });

    renderSession('zh', <DateCellRenderer value={value} field={dateField('start_date')} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(enForm)).not.toBeInTheDocument();
  });

  it('absolute datetime: the branch the card caught as "8/11/2026 12:00 am"', () => {
    const { container } = renderSession(
      'zh',
      <DateTimeCellRenderer value={FIXED_INSTANT} field={{ type: 'datetime', name: 'created_at' } as any} />,
    );
    expect(container.textContent).toContain('2026/8/11');
    expect(container.textContent).toContain('上午12:00');
    expect(container.textContent).not.toContain('8/11/2026');
    expect(container.textContent).not.toContain('12:00 am');
  });

  it('read-only DateField / DateTimeField widgets', () => {
    const { container } = renderSession(
      'zh',
      <DateField value={FIXED_INSTANT} onChange={() => {}} field={dateField('start_date')} readonly />,
    );
    // Since objectui#8194 this widget renders `formatDate`'s default face, so
    // the zh form is `8月11日` in the current year and `2026年8月11日` after —
    // both Chinese, which is the claim. The `en` form is asserted absent so
    // the case cannot pass on a machine-locale render.
    expect(container.textContent).toContain(defaultDateFace(FIXED_INSTANT, 'zh'));
    expect(container.textContent).not.toContain(defaultDateFace(FIXED_INSTANT, 'en'));
    cleanup();

    // Since objectui#8209 this widget renders `formatDateTime`'s default face
    // (the form / detail register), so the zh form carries the Chinese year /
    // month / day markers rather than reading `2026/8/11 00:00:00`. The `en`
    // form is asserted absent so the case still cannot pass on a machine-locale
    // render — which is this file's whole subject.
    const dt = renderSession(
      'zh',
      <DateTimeField
        value={FIXED_INSTANT}
        onChange={() => {}}
        field={{ type: 'datetime', name: 'created_at' } as any}
        readonly
      />,
    );
    expect(dt.container.textContent).toContain(defaultDateTimeFace(FIXED_INSTANT, 'zh'));
    expect(dt.container.textContent).not.toContain(defaultDateTimeFace(FIXED_INSTANT, 'en'));
  });

  /**
   * The sub-grid (`GridField`) read-only face. Its cases live here rather than
   * beside the rest of `widgets/GridField.test.tsx`: mounting an `I18nProvider`
   * in that file changes what its later PROVIDER-LESS renders resolve, and one
   * of them asserts a translated `aria-label`.
   */
  it('the sub-grid read-only table', () => {
    const temporalField = {
      columns: [
        { name: 'merchant', label: 'Merchant', type: 'text' as const },
        { name: 'incurred_on', label: 'Incurred On', type: 'date' as const },
      ],
    } as any;
    renderSession(
      'zh',
      <GridField
        value={[{ merchant: 'Chipotle', incurred_on: '2026-06-17T00:00:00.000Z' }]}
        onChange={() => {}}
        field={temporalField}
        readonly
      />,
    );
    const table = screen.getByTestId('line-items-readonly');
    expect(table.textContent).toContain(defaultDateFace('2026-06-17T00:00:00.000Z', 'zh'));
    expect(table.textContent).not.toContain(defaultDateFace('2026-06-17T00:00:00.000Z', 'en'));
  });

  it('a formula field returning a date', () => {
    const { container } = renderSession(
      'zh',
      <FormulaField
        value={FIXED_INSTANT}
        onChange={() => {}}
        field={{ type: 'formula', name: 'computed_on', returnType: 'date' }}
      />,
    );
    expect(container.textContent).toContain(defaultDateFace(FIXED_INSTANT, 'zh'));
    expect(container.textContent).not.toContain(defaultDateFace(FIXED_INSTANT, 'en'));
  });
});

describe('en session — output is byte-identical (must-not-change)', () => {
  it('future-relative', () => {
    renderSession('en', <DateCellRenderer value={daysFromNow(3)} field={dateField('end_date')} />);
    expect(screen.getByText('In 3 days')).toBeInTheDocument();
  });

  it('past-relative, non-due', () => {
    renderSession('en', <DateCellRenderer value={daysFromNow(-6)} field={dateField('start_date')} />);
    expect(screen.getByText('6 days ago')).toBeInTheDocument();
  });

  it('near-today', () => {
    renderSession('en', <DateCellRenderer value={daysFromNow(0)} field={dateField('start_date')} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
    cleanup();

    renderSession('en', <DateCellRenderer value={daysFromNow(1)} field={dateField('start_date')} />);
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    cleanup();

    renderSession('en', <DateCellRenderer value={daysFromNow(-1)} field={dateField('start_date')} />);
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('absolute datetime', () => {
    const { container } = renderSession(
      'en',
      <DateTimeCellRenderer value={FIXED_INSTANT} field={{ type: 'datetime', name: 'created_at' } as any} />,
    );
    expect(container.textContent).toContain('8/11/2026');
    expect(container.textContent).toContain('12:00 am');
  });

  /**
   * ⚠️ This case is NO LONGER byte-identical across objectui#8194 — the widget
   * moved from `Intl`'s bare numeric default (`8/11/2026`) onto `formatDate`'s
   * default face (`Aug 11` in the current year). It stays in this describe
   * block because what it measures is unchanged: the `en` session renders the
   * `en` face. The move itself is pinned in
   * `fields-date-widget-convention-8194.test.tsx`.
   */
  it('read-only DateField', () => {
    const { container } = renderSession(
      'en',
      <DateField value={FIXED_INSTANT} onChange={() => {}} field={dateField('start_date')} readonly />,
    );
    expect(container.textContent).toContain(defaultDateFace(FIXED_INSTANT, 'en'));
    expect(container.textContent).not.toContain(defaultDateFace(FIXED_INSTANT, 'zh'));
  });
});

describe('the already-localized overdue branch is undisturbed (green both sides)', () => {
  it('resolves through the translate fn, not through Intl — zh', () => {
    // Declared (objectui#11815): overdue is declared-only, the name guesses nothing.
    renderSession('zh', <DateCellRenderer value={daysFromNow(-6)} field={{ ...dateField('due_date'), dueLike: true }} />);
    const el = screen.getByText('逾期 6 天');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/text-red-600/);
  });

  it('resolves through the translate fn, not through Intl — en', () => {
    renderSession('en', <DateCellRenderer value={daysFromNow(-6)} field={{ ...dateField('due_date'), dueLike: true }} />);
    expect(screen.getByText('Overdue 6d')).toBeInTheDocument();
  });
});

describe('channel precedence is unchanged (green both sides)', () => {
  /**
   * `useDisplayLocale()` puts the TENANT locale above the UI language: an org
   * that configured `en` means it, even for a user reading Chinese chrome.
   * This is the one case the old code got right, and it must survive.
   */
  it('an explicit tenant locale outranks the active UI language', () => {
    renderSession('zh', <DateCellRenderer value={daysFromNow(3)} field={dateField('end_date')} />, 'en');
    expect(screen.getByText('In 3 days')).toBeInTheDocument();
    expect(screen.queryByText('3天后')).not.toBeInTheDocument();
  });

  /**
   * The third step of the precedence — the provider-less `'en'` last resort —
   * is pinned in `DateCellRenderer.test.tsx`, deliberately NOT here.
   *
   * It USED to be unmeasurable in this file: `useObjectTranslation()` outside
   * a provider reports `i18n.language` from react-i18next's GLOBAL instance,
   * and every `I18nProvider` mounted above left that global on its own
   * instance. So a provider-less render placed after these cases resolved
   * `'zh'` — the state react-i18next was in, not the fallback under test.
   *
   * objectui#4514 closed that: `installI18nGlobalReset()` in
   * `vitest.setup.base.ts` restores the global after every test. The split
   * below is now organisation, not a workaround.
   *
   * `DateCellRenderer.test.tsx` mounts no provider at all, so its
   * `6 days ago` / `Overdue 6d` / `Tomorrow` cases ARE that pin, and they hold
   * for the real reason.
   */
});
