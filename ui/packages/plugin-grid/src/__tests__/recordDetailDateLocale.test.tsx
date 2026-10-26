/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4541 — ObjectGrid's record-detail date fallback rendered the
 * MACHINE's locale.
 *
 * `renderRecordDetail` → `renderFieldValue` is type-aware first: when the
 * object schema gives the key a `type` with a registered cell renderer, that
 * renderer draws the value. Everything else falls through to an *inference*
 * fallback, whose date branch did:
 *
 *     if (typeof value === 'string' && !isNaN(Date.parse(value)) &&
 *         (key.includes('date') || key.includes('_at') || key.includes('time')))
 *       return (span)...{formatDate(value)}...(/span);
 *
 * with no `options` at all. `formatDate` then hands `Intl` an `undefined` tag,
 * and `undefined` is not "the user's locale" — it is the **machine's**, which
 * is neither of the repo's two locale channels. So on a `zh` console this one
 * cell rendered `Mar 15, 2024` while every neighbouring date cell (#4468 /
 * PR #4512, and the two mobile-card `'short'` cells in #4272 / PR #4544)
 * rendered the Chinese form.
 *
 * This was the **third** `formatDate` site in the file and was deliberately
 * out of #4272's ruled scope ("ONLY the two date-cell call sites"): the two it
 * named both pass `'short'` and shift by a constant −121 line offset, which
 * this site does not fit. #4544 filed it here rather than fixing it.
 *
 * The component already reads `useDisplayLocale()` at component level (landed
 * in PR #4544 for the two `'short'` cells), and `renderRecordDetail` is a
 * plain arrow declared in the component body — it already closes over
 * `tenantCurrency` from the same scope two branches below. So the fix is pure
 * consumption: one call site gaining `{ locale: displayLocale }`, no plumbing,
 * no dependency array (the function is not memoized).
 *
 * ── Reaching the branch at all (the #4544 naming lesson, restated) ────────
 * PR #4544's grid suite had to name its columns like dates because the card
 * view's `classify()` routes by `dateKeys` substrings. The record-detail path
 * has the *same* shape of trap in a different place, and BOTH halves matter:
 *
 *   1. The fixture passes `data: { provider: 'value', items: ROWS }` and NO
 *      `dataSource`, so `objectSchema` stays null and `fieldDef` is undefined
 *      for every key. That is what skips the `getCellRenderer` branch and
 *      drives the value into the inference fallback where this bug lives.
 *      Give the field a schema `type: 'date'` instead and DateCellRenderer
 *      draws it — a different, already-fixed path — and this suite would pin
 *      nothing.
 *   2. The keys must be *named* like dates. `close_date` (matches `date`) and
 *      `signed_at` (matches `_at`) cover two of the branch's three spellings;
 *      a key such as `closed_on` would fall past the branch to the plain
 *      `String()` tail and render no date at all.
 *
 * Both fixture keys are deliberately non-system (`created_at` / `updated_at`
 * and friends are `SYSTEM_MANAGED_FIELD_NAMES`, which would divert them into
 * the muted meta section that renders through `String()`, not `formatDate`).
 * Neither key is a grid column: the value therefore appears ONLY in the detail
 * panel, so no table cell can satisfy these assertions on another path's
 * behalf.
 *
 * ── Why assertions are scoped to the panel, not the container ─────────────
 * The overlay renders through a portal, so it is not inside the `container`
 * that `render()` returns; and a container-wide `toContain` could in principle
 * be satisfied by an ordinary grid cell rendering the same date through the
 * already-localized `DateCellRenderer`. Reading
 * `getByTestId('record-detail-panel').textContent` pins the assertion to the
 * one render path this card is about.
 *
 * ── Directions (measured on the runner, not presumed) ─────────────────────
 * node v22.22.2, TZ=UTC, machine locale `en-US`. For `formatDate`'s default
 * branch (`{year:'numeric',month:'short',day:'numeric'}`):
 *
 *     undefined → 'Mar 15, 2024'   en → 'Mar 15, 2024'
 *     zh        → '2024年3月15日'   de → '15. März 2024'
 *
 * `en` and the machine's `en-US` are IDENTICAL here, so the `en` case below is
 * **GREEN ON BOTH SIDES** — it is the byte-identical must-not-change PIN, NOT
 * red evidence that the fix works. The `zh` and `de` cases are the genuinely
 * red ones. Every expectation spells its tag explicitly; none is computed from
 * a bare `toLocale*` call against the runner (the objectui#4513 trap).
 *
 * Predicted before running, and matched: **2 red, 1 green-both-sides**.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

/**
 * Local-parts ISO strings (no `Z`, no offset): `new Date` reads these as LOCAL
 * time, so the rendered day is 15 / 4 in every timezone rather than drifting
 * across a boundary the way a bare `'2024-03-15'` (UTC midnight) would.
 * 2024 is a non-current year on purpose — `formatDate`'s default branch DROPS
 * the year when it matches the current one, so this keeps the expectation
 * stable in whatever calendar year the suite runs.
 */
const ROWS = [
  {
    id: '1',
    name: 'Alice',
    // Two of the branch's three key spellings: `…date…` and `…_at…`.
    close_date: '2024-03-15T12:00:00',
    signed_at: '2024-07-04T09:30:00',
  },
];

/** A session: the UI language the user picked, plus the tenant's regional default. */
function renderSession(language: string, tenantLocale?: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <ActionProvider>
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: 'contacts',
              // `close_date` / `signed_at` are intentionally NOT columns — they
              // reach the DOM only through the record-detail panel.
              columns: [{ field: 'name', label: 'Name' }],
              data: { provider: 'value', items: ROWS },
              navigation: { mode: 'drawer' },
            } as never}
          />
        </ActionProvider>
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** Open the record-detail overlay the way a user does: click a row. */
async function openDetail(): Promise<string> {
  fireEvent.click(await screen.findByText('Alice'));
  await waitFor(() => expect(screen.getByTestId('record-detail-panel')).toBeInTheDocument());
  return screen.getByTestId('record-detail-panel').textContent ?? '';
}

afterEach(() => cleanup());

describe('ObjectGrid record detail — the date fallback follows the display locale (objectui#4541)', () => {
  it('zh session renders the Chinese date form at the fallback site', async () => {
    renderSession('zh');
    const panel = await openDetail();

    expect(panel).toContain('2024年3月15日');
    expect(panel).toContain('2024年7月4日');
    // The defect itself: the machine's English form must not survive.
    expect(panel).not.toContain('Mar 15, 2024');
    expect(panel).not.toContain('Jul 4, 2024');
  });

  /**
   * PIN — green on both sides. The runner's machine locale is `en-US` and it
   * agrees with `en` byte for byte on this branch, so this case asserts the
   * English output is unchanged by the fix. It is NOT evidence the fix works.
   */
  it('en session output is byte-identical (must-not-change)', async () => {
    renderSession('en');
    const panel = await openDetail();

    expect(panel).toContain('Mar 15, 2024');
    expect(panel).toContain('Jul 4, 2024');
  });

  /**
   * `useDisplayLocale()` is `tenantLocale || uiLanguage || 'en'` — the TENANT's
   * configured regional default outranks the active UI language. `de` is
   * chosen because `15. März 2024` matches neither the machine's
   * `Mar 15, 2024` nor `zh`'s `2024年3月15日`, so this case is genuinely red
   * before the fix instead of passing by coincidence.
   */
  it('an explicit tenant locale outranks the active UI language', async () => {
    renderSession('zh', 'de');
    const panel = await openDetail();

    expect(panel).toContain('15. März 2024');
    expect(panel).toContain('4. Juli 2024');
    expect(panel).not.toContain('2024年3月15日');
    expect(panel).not.toContain('Mar 15, 2024');
  });
});
