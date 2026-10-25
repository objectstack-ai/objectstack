/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9327 — the import-job history table formatted its timestamps in the
 * MACHINE's locale.
 *
 * `formatImportJobTime` in `../ImportWizard` ended with a bare
 * `d.toLocaleString()`. An omitted tag is not "the user's locale" — it is the
 * **machine's**, which is neither of this renderer's two locale channels. The
 * contract is stated in `useDisplayLocale`'s own doc comment, quoted verbatim:
 *
 *   > The one thing a caller must not do is reach past this hook for the raw
 *   > tenant locale and hand `Intl` the `undefined` it gets on an unconfigured
 *   > workspace — `undefined` means "the MACHINE's locale", which is neither
 *   > channel. Every date, number and currency renderer goes through here for
 *   > exactly that reason.
 *
 * ── Why this pin asserts FIELD ORDER, not separators ──────────────────────
 * On a number the machine locale moves separators; on a date it moves **field
 * order**, and both orders are legal and mutually ambiguous for the first
 * twelve days of every month. The fixture is deliberately inside that window:
 * 4 March 2026 renders `04/03/2026` under `en-GB` and `3/4/2026` under the
 * runner's `en-US`, and an import-history reader — who is reasoning about
 * *which run was which* — has no unit marker to catch the misreading.
 *
 * ── Directions, MEASURED on this runner rather than presumed ──────────────
 * node v22.22.2; the root vitest config pins `process.env.TZ = 'UTC'`;
 * `Intl.DateTimeFormat().resolvedOptions().locale` is `en-US`. For
 * `new Date('2026-03-04T12:00:00').toLocaleString(tag)`:
 *
 *     undefined → '3/4/2026, 12:00:00 PM'    (the defect: the MACHINE)
 *     en-US     → '3/4/2026, 12:00:00 PM'
 *     en-GB     → '04/03/2026, 12:00:00'     day-first — the flipped order
 *     de        → '4.3.2026, 12:00:00'
 *
 * So the `en-US` case below is **GREEN ON BOTH SIDES** — the runner's machine
 * locale agrees with it byte for byte. It is the must-not-change pin AND the
 * firing contrast partner for the `en-GB` case: the two tags must produce
 * *different* output, or a green run could not tell "reads the locale" from
 * "reads nothing and the machine happened to agree". The `en-GB` and `de`
 * cases are the genuinely red ones. `de` additionally rules out a hardcoded
 * `'en-GB'` repair, which the first two cases alone would not catch.
 *
 * Every expectation spells its tag's output literally; none is computed from a
 * bare `toLocale*` call against the runner (that would assert nothing).
 *
 * ── Reaching the panel at all ─────────────────────────────────────────────
 * `ImportHistoryPanel` is module-private and is mounted only by `ImportWizard`
 * behind the `import-history-toggle` button, which the wizard renders only
 * while `step === 'upload'` and only when the data source actually implements
 * `listImportJobs`. So the fixture source implements exactly that one method:
 * `undoImportJob` and `cancelImportJob` are deliberately absent so the row
 * carries no action buttons whose labels could satisfy an assertion on the
 * time cell's behalf. The assertion reads the ROW's `textContent` (not the
 * container: the dialog is portalled out of it), and the fixture's numbers
 * (`total`/`processed`/counts) are single digits that cannot collide with a
 * rendered date.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';

import { ImportWizard } from '../ImportWizard';

const FIELDS = [{ name: 'name', label: 'Name', type: 'text' }];

/**
 * A local-parts ISO string (no `Z`, no offset) so `new Date` reads it as LOCAL
 * time and the rendered day cannot drift across a boundary. 4 March is inside
 * the twelve-day window where `en-GB` and `en-US` are mutually ambiguous.
 */
const COMPLETED_AT = '2026-03-04T12:00:00';

/** One finished job. `completedAt` is what the cell prefers over `createdAt`. */
const JOB = {
  jobId: 'job-1',
  object: 'account',
  status: 'succeeded',
  total: 3,
  processed: 3,
  created: 2,
  updated: 1,
  skipped: 0,
  errors: 0,
  createdAt: '2026-01-02T03:04:05',
  completedAt: COMPLETED_AT,
};

/** Implements `listImportJobs` and nothing else — see the header note. */
const HISTORY_DATA_SOURCE = {
  listImportJobs: async () => [JOB],
};

/** A session: the UI language the user picked, plus the tenant's regional default. */
function renderSession(language: string, tenantLocale?: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <ImportWizard
          objectName="account"
          fields={FIELDS}
          dataSource={HISTORY_DATA_SOURCE}
          open
          onOpenChange={() => {}}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** Open the history panel the way a user does, and return the job row's text. */
async function openHistoryRow(): Promise<string> {
  fireEvent.click(screen.getByTestId('import-history-toggle'));
  const row = await screen.findByTestId('import-history-row-job-1');
  return row.textContent ?? '';
}

afterEach(() => cleanup());

describe('import-job history time follows the display locale (objectui#9327)', () => {
  it('a tenant on en-GB gets the day-first order, not the machine order', async () => {
    renderSession('en', 'en-GB');
    const row = await openHistoryRow();

    expect(row).toContain('04/03/2026');
    // The defect itself: the machine's month-first order must not survive.
    expect(row).not.toContain('3/4/2026');
  });

  /**
   * PIN — green on both sides, and the contrast partner of the case above.
   * The runner's machine locale IS `en-US`, so this asserts the American
   * output is unchanged by the fix; it is NOT evidence that the fix works.
   * Its value is that it differs from the `en-GB` case byte for byte.
   */
  it('a tenant on en-US keeps the month-first order (must-not-change)', async () => {
    renderSession('en', 'en-US');
    const row = await openHistoryRow();

    expect(row).toContain('3/4/2026');
    expect(row).not.toContain('04/03/2026');
  });

  /**
   * The second channel. With no tenant locale configured, `useDisplayLocale`
   * falls through to the ACTIVE UI language — so this case also fails a repair
   * that hardcodes one tag instead of reading the hook.
   */
  it('with no tenant locale the active UI language formats the cell', async () => {
    renderSession('de');
    const row = await openHistoryRow();

    expect(row).toContain('4.3.2026');
    expect(row).not.toContain('3/4/2026');
    expect(row).not.toContain('04/03/2026');
  });

  /**
   * Precedence: `useDisplayLocale()` is `tenantLocale || uiLanguage || 'en'`,
   * so an explicitly configured tenant outranks the language switcher.
   */
  it('an explicit tenant locale outranks the active UI language', async () => {
    renderSession('de', 'en-GB');
    const row = await openHistoryRow();

    expect(row).toContain('04/03/2026');
    expect(row).not.toContain('4.3.2026');
    expect(row).not.toContain('3/4/2026');
  });
});
