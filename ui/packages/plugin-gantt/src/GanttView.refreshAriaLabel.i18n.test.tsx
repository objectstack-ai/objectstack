/**
 * The Gantt toolbar's refresh button gets a LOCALIZED accessible name
 * (objectui#3546).
 *
 * The button renders only an icon, so `aria-label` is the entire accessible
 * name — a screen-reader user has nothing else to go on. `gantt.toolbar.refresh`
 * was in `GANTT_DEFAULT_TRANSLATIONS` but in none of the ten packs.
 *
 * ## What was actually broken here, and why this test is `zh`-shaped
 *
 * #3546 filed this site as "screen-reader users hear the raw key". It does not
 * reproduce, and the reason is in `useGanttTranslation`: it deliberately does
 * NOT use `createSafeTranslation` (which probes one testKey and then serves
 * defaults for everything) and instead falls back **per key**. A key the host
 * misses therefore lands on the bundled English default, not on the raw key —
 * so the pre-fix accessible name was "Refresh", in English, in all ten
 * languages.
 *
 * That makes an `en` assertion useless as a regression guard: "Refresh" was
 * the answer before the backfill and after it. The `zh` case is the one that
 * was red before and green now, so it is the one that pins the fix. The `en`
 * case is kept only to prove the button is reachable and labelled at all.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nProvider } from '@object-ui/i18n';
import { GanttView, type GanttTask } from './GanttView';
import { GANTT_DEFAULT_TRANSLATIONS } from './useGanttTranslation';

const TASKS = (): GanttTask[] => [
  {
    id: 'a',
    title: 'Task A',
    start: new Date('2024-06-03T00:00:00.000Z'),
    end: new Date('2024-06-13T00:00:00.000Z'),
    progress: 0,
  },
];

function renderWithLocale(lang: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={TASKS()}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-12-30T00:00:00.000Z')}
          onRefresh={vi.fn()}
        />
      </div>
    </I18nProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  // The provider persists the last language (objectstack#5406); without this
  // the `zh` case would leak into the `en` one.
  window.localStorage.clear();
});

describe('Gantt refresh button accessible name (objectui#3546)', () => {
  it('is labelled in English under an en provider — never the raw key', () => {
    const { getByTestId } = renderWithLocale('en');
    const label = getByTestId('gantt-refresh').getAttribute('aria-label');
    expect(label).toBe('Refresh');
    expect(label).not.toBe('gantt.toolbar.refresh');
  });

  it('is labelled in Chinese under a zh provider (the pre-fix failure)', () => {
    const { getByTestId } = renderWithLocale('zh');
    const label = getByTestId('gantt-refresh').getAttribute('aria-label');
    // Before the pack backfill this read 'Refresh': every pack missed the key,
    // so `useGanttTranslation`'s per-key fallback served the bundled English
    // default to a Chinese session.
    expect(label).toBe('刷新');
    expect(label).not.toBe(GANTT_DEFAULT_TRANSLATIONS['gantt.toolbar.refresh']);
  });
});
