/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `CommentThread`'s >= 7d timestamp reads the DISPLAY locale, never the UI
 * language (objectui#10375).
 *
 * `formatAbsoluteDate` used to take the tag `useCollaborationTranslation()`
 * reports, which is the UI language, so a regional display locale (`de-CH`
 * under an English UI) never reached the date. The component now reads
 * `useDisplayLocale()` and hands that in.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control. A thread that still passed `language` renders the English
 * form under `de-CH` and goes red.
 *
 * The provider-less reading lives in `comment-thread-no-provider-fallback.test.tsx`
 * and cannot live here: this file mounts `I18nProvider`, which registers
 * react-i18next's module-global instance (that file's header says why).
 */

import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { CommentThread, type Comment } from '../CommentThread';

const alice = { id: 'u_alice', name: 'Alice Chen' };

/** Noon UTC, so the calendar date is the same in every zone (the suite pins `TZ=UTC`). */
const OLD = '2020-03-04T12:00:00.000Z';

const comment = (id: string, createdAt: string): Comment => ({
  id,
  author: alice,
  content: `Comment ${id}.`,
  mentions: [],
  createdAt,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderThread(locale: string, overrides: Partial<ComponentProps<typeof CommentThread>> = {}) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <CommentThread
          threadId="t_1"
          comments={[comment('old', OLD)]}
          currentUser={alice}
          onAddComment={() => {}}
          {...overrides}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** The timestamp beside the author's name on comment `id`. */
function timestampOf(id: string): string {
  const header = document.querySelector(`[data-comment-id="${id}"]`);
  const spans = Array.from(header?.querySelectorAll('span') ?? []);
  const author = spans.findIndex((n) => n.textContent === alice.name);
  return spans[author + 1]?.textContent ?? '';
}

/** The old comment's date, under an ENGLISH UI with `locale` as the display locale. */
function oldDate(locale: string): string {
  renderThread(locale);
  const text = timestampOf('old');
  cleanup();
  return text;
}

describe('CommentThread — the >= 7d date follows the display locale (objectui#10375)', () => {
  it('formats as de-CH under an English UI with a de-CH display locale', () => {
    const text = oldDate('de-CH');
    expect(text, `got: ${text}`).toBe('4.3.2020');
    expect(text).toBe(new Date(OLD).toLocaleDateString('de-CH'));
  });

  it('control: formats as en-US under an en-US display locale', () => {
    const text = oldDate('en-US');
    expect(text, `got: ${text}`).toBe('3/4/2020');
    expect(text).toBe(new Date(OLD).toLocaleDateString('en-US'));
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', () => {
    expect(oldDate('de-CH')).not.toBe(oldDate('en-US'));
  });

  it('the date formatter receives the declared tag and nothing else', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    renderThread('de-CH');
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls, `saw: ${JSON.stringify(spy.mock.calls)}`).toEqual(
      spy.mock.calls.map(() => ['de-CH']),
    );
  });

  /**
   * The relative buckets are WORDS, so they stay on `t` and the UI language:
   * a three-day-old comment under an English UI reads the English bucket even
   * with a `de-CH` display locale — not a date, and not German.
   */
  it('leaves the relative buckets on the UI language', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    renderThread('de-CH', { comments: [comment('recent', threeDaysAgo)] });
    expect(timestampOf('recent')).toBe('3d ago');
  });

  /**
   * The declared fallback `machineLocaleCensus-9909.test.ts` keeps as its lit
   * control, reached through the new channel: a structurally malformed display
   * locale makes `toLocaleDateString` throw `RangeError`, and the inner catch
   * restores the runtime's own date instead of letting the raw ISO string reach
   * the reader.
   */
  it('falls back to the runtime locale on a malformed display locale, never to raw ISO', () => {
    const { container } = renderThread('de_CH');
    expect(timestampOf('old')).toBe(new Date(OLD).toLocaleDateString());
    expect(container.textContent).not.toContain(OLD);
    expect(screen.getByText('Send')).toBeTruthy();
  });
});
