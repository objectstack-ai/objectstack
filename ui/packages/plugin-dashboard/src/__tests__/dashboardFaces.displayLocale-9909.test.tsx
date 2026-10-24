/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard's number and date faces read the DECLARED session locale,
 * never the machine's (objectui#9909).
 *
 * Three surfaces: the record-count badge beside "Refresh All", and two
 * branches of `renderFieldValue` — the helper behind every dashboard table
 * cell and the record-detail drawer. ⚠️ The last two are the half a source
 * census CANNOT see: `renderFieldValue` was handed the display locale and
 * spent it on its percent branch, while its currency and date branches called
 * `formatCurrency(value, code)` / `formatDate(value, fmt)` — argument lists that
 * merely OMIT the tag, which those helpers read as "follow the runtime", i.e.
 * the machine. Found by reading, pinned here by the runtime tripwire.
 *
 * Each surface is read twice — under a declared `de-DE` locale and a declared
 * `en` one — and must read differently: a literal would measure the runner.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
import { DashboardRenderer } from '../DashboardRenderer';
import { renderFieldValue, type FieldMeta } from '../recordFields';

afterEach(() => cleanup());

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

const CURRENCY: FieldMeta = { name: 'amount', label: 'Amount', format: '$0,0.00' };
// `type: 'date'` is what puts this field on the date-format branch: a `format`
// is read as a date pattern only on a date / datetime field (objectui#10220).
const DATE: FieldMeta = { name: 'closed_at', label: 'Closed', type: 'date', format: 'YYYY-MM-DD' };
/** 2020-03-04 — a past year, so the date face keeps its year in both locales. */
const STORED = '2020-03-04T12:00:00.000Z';

interface Surface {
  name: string;
  /** The tree for a session in `locale` — a component reads it from context, a helper is handed it. */
  node: (locale: string) => React.ReactNode;
  de: RegExp;
  en: RegExp;
}

const SURFACES: Surface[] = [
  {
    name: 'DashboardRenderer — record-count badge',
    node: () => (
      <DashboardRenderer schema={{ type: 'dashboard', name: 'd', widgets: [] } as never} recordCount={12345} onRefresh={() => {}} />
    ),
    de: /12\.345 records/,
    en: /12,345 records/,
  },
  {
    name: 'renderFieldValue — currency branch',
    node: (locale) => <>{renderFieldValue(1234.5, CURRENCY, undefined, locale)}</>,
    de: /1\.234,50/,
    en: /1,234\.50/,
  },
  {
    name: 'renderFieldValue — date-format branch',
    node: (locale) => <>{renderFieldValue(STORED, DATE, undefined, locale)}</>,
    de: /4\. März 2020/,
    en: /Mar 4, 2020/,
  },
];

function textUnder(locale: string, surface: Surface): string {
  render(session(locale, surface.node(locale)));
  const text = document.body.textContent ?? '';
  cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

describe('dashboard number and date faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', (surface) => {
    const text = textUnder('de-DE', surface);
    expect(text, `got: ${text}`).toMatch(surface.de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', (surface) => {
    const text = textUnder('en', surface);
    expect(text, `got: ${text}`).toMatch(surface.en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', (surface) => {
    expect(textUnder('de-DE', surface)).not.toBe(textUnder('en', surface));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', (surface) => {
    const calls = recordLocaleArguments(() => {
      render(session('de-DE', surface.node('de-DE')));
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
