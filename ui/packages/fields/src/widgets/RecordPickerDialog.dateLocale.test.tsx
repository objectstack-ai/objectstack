/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4272 — the lookup picker's MongoDB `$date` fallback rendered in the
 * MACHINE's locale.
 *
 * `renderCellContent`'s plain-text fallback runs whenever a column has no
 * usable field descriptor / cell renderer — the shape a string-authored
 * `lookupColumns` entry against an object with no `fieldsMeta` produces. For
 * an expanded Mongo value it did:
 *
 *     if (val.$date) return new Date(val.$date).toLocaleDateString();
 *
 * with no tag at all. `undefined` is not "the user's locale", it is the
 * machine's — so this cell rendered the machine's form on a `zh` console while
 * every neighbouring date cell (fixed in PR #4512) rendered the Chinese one.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * The `zh` case goes red against unfixed code, and so does the precedence
 * case: `de` differs from BOTH the `en` form and the `zh` form, so it cannot
 * pass by coincidence.
 *
 * ⚠️ objectui#8194 amendment. This fallback now calls `formatDate` (default
 * style) rather than a bare `toLocaleDateString`, so the FACE moved in every
 * locale — `8/11/2026` → `Aug 11`, `2026/8/11` → `8月11日`, `11.8.2026` →
 * `11. Aug.`. The `en` case is therefore no longer byte-identical across that
 * change; what it still measures, and all this file ever claimed, is that the
 * tag reaching `Intl` is the SESSION's and not the machine's.
 *
 * The expectations are built through `defaultDateFace()` rather than typed as
 * literals because that face DROPS the year inside the current year: the same
 * call renders `Aug 11` this year and `Aug 11, 2026` next January, and a
 * literal would turn this locale file red for a reason that has nothing to do
 * with locales. The year-dropping decision itself is pinned verbatim, against
 * a frozen clock, in `__tests__/fields-date-widget-convention-8194.test.tsx`.
 *
 * This file mounts providers; the pure-function cases for the same card are
 * kept in `__tests__/date-formatter-residue-4272.test.ts` (objectui#4514).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { RecordPickerDialog } from './RecordPickerDialog';

/** The exact expanded-Mongo shape the picker receives from the server. */
const SIGNED_ON = new Date(2026, 7, 11, 0, 0, 0).toISOString();
const records = [
  { id: 'r1', name: 'Northwind', signed_on: { $date: SIGNED_ON } },
];

/**
 * The `date` DEFAULT face in `locale` — `formatDate`'s bag, spelled out, so
 * these cases keep measuring the TAG rather than re-asserting the face. Mirrors
 * the helper of the same name in `__tests__/date-locale-channel.test.tsx`.
 */
function defaultDateFace(locale: string): string {
  const d = new Date(SIGNED_ON);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function makeDataSource() {
  return { find: vi.fn(async () => ({ data: records, total: records.length })) } as any;
}

/**
 * A session: the UI language the user picked plus the tenant's regional
 * default (usually absent). Mirrors `date-locale-channel.test.tsx`'s harness
 * so both halves of this card describe a session the same way.
 */
function renderSession(language: string, tenantLocale?: string) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <RecordPickerDialog
          open
          onOpenChange={() => {}}
          onSelect={() => {}}
          dataSource={makeDataSource()}
          objectName="accounts"
          // Deliberately no `type` and no `fieldsMeta`/`cellRenderer`: this is
          // what drives BOTH columns through the plain-text fallback where the
          // `$date` branch lives. `name` is carried purely as a render anchor —
          // the picker table shows only the columns it is given, so waiting on
          // a field that is not a column would wait forever.
          columns={[
            { field: 'name', label: 'Name' },
            { field: 'signed_on', label: 'Signed On' },
          ]}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/**
 * The dialog renders through a Radix portal, so its table is NOT inside the
 * `container` `render()` returns — it is mounted at the document body. Reading
 * `container.textContent` here would assert against an empty string, which
 * passes every `not.toContain` for the wrong reason.
 */
function bodyText(): string {
  return document.body.textContent ?? '';
}

afterEach(() => cleanup());

describe('RecordPickerDialog — the $date fallback follows the display locale (objectui#4272)', () => {
  it('zh session renders the Chinese date form', async () => {
    renderSession('zh');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    expect(bodyText()).toContain(defaultDateFace('zh'));
    expect(bodyText()).not.toContain(defaultDateFace('en'));
  });

  it('en session renders the English date form', async () => {
    renderSession('en');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    expect(bodyText()).toContain(defaultDateFace('en'));
    expect(bodyText()).not.toContain(defaultDateFace('zh'));
  });

  /**
   * `useDisplayLocale()` puts the TENANT's configured regional default above
   * the active UI language. `de` is chosen because its form (`11. Aug.`)
   * matches neither the `en` form (`Aug 11`) nor `zh`'s (`8月11日`), so this
   * case is genuinely red before the fix instead of passing by accident.
   */
  it('an explicit tenant locale outranks the active UI language', async () => {
    renderSession('zh', 'de');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    expect(bodyText()).toContain(defaultDateFace('de'));
    expect(bodyText()).not.toContain(defaultDateFace('zh'));
    expect(bodyText()).not.toContain(defaultDateFace('en'));
  });
});
