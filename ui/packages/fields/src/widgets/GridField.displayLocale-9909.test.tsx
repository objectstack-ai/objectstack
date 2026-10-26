/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `GridField`'s number faces read the DECLARED session locale, never the
 * machine's (objectui#9909).
 *
 * The escalation site of that card: `displayText(c, value, locale)` already
 * held the declared locale and spent it on the temporal branch, while the
 * numeric branch one statement below dropped it — so one grid row read a date
 * in the session's convention beside an amount grouped the machine's way. The
 * two `total` cells did the same inside the component, where
 * `useDisplayLocale()` was already in scope.
 *
 * ## Why every surface is measured as a DIFFERENCE
 *
 * A literal expectation measures the runner, not the code: on a `de-DE`
 * machine a broken surface and a repaired one print the same bytes. Each
 * surface renders the SAME rows twice — under a declared `de-DE` tenant locale
 * and a declared `en` one — and must read differently. Only the tenant locale
 * moves between the two mounts; the UI language is `en` on both, so the `Intl`
 * tag is the only thing that can make them differ. The runtime tripwire then
 * checks the argument every locale-taking call actually received.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
import { GridField } from './GridField';

afterEach(() => cleanup());

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

function textUnder(locale: string, node: React.ReactNode): string {
  render(session(locale, node));
  const text = document.body.textContent ?? '';
  cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

const columns = [
  { name: 'description', label: 'Description', type: 'text' as const },
  { name: 'qty', label: 'Qty', type: 'number' as const },
  { name: 'amount', label: 'Amount', type: 'currency' as const },
];
const rows = [
  { description: 'Widget', qty: 1234.5, amount: 98765.25 },
  { description: 'Gadget', qty: 1, amount: 1000 },
];
const field = { columns, totalField: 'amount' } as never;

interface Surface {
  name: string;
  node: React.ReactNode;
  de: RegExp;
  en: RegExp;
}

const SURFACES: Surface[] = [
  {
    // The read-only table's total cell. (Its number cells read through
    // `displayText` too since objectui#12915; that file pins them.)
    name: 'read-only grid — total',
    node: <GridField value={rows} onChange={() => {}} field={field} readonly />,
    de: /Total ?99\.765,25/,
    en: /Total ?99,765\.25/,
  },
  {
    // The editable grid's `line-items-total` cell.
    name: 'editable grid — total',
    node: <GridField value={rows} onChange={() => {}} field={field} />,
    de: /99\.765,25/,
    en: /99,765\.25/,
  },
  {
    // The list form-factor renders every cell through `displayText` — the
    // numeric and the currency branch both. No currency is configured in this
    // session, so the amount carries no symbol: the literal `¥` default these
    // patterns used to expect is gone (objectui#10355).
    name: 'list mode — cells',
    node: <GridField value={rows} onChange={() => {}} field={field} displayMode="list" onRowExpand={() => {}} />,
    de: /1\.234,5.*98\.765,25/,
    en: /1,234\.5.*98,765\.25/,
  },
];

describe('GridField number faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', ({ node, de }) => {
    const text = textUnder('de-DE', node);
    expect(text, `got: ${text}`).toMatch(de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', ({ node, en }) => {
    const text = textUnder('en', node);
    expect(text, `got: ${text}`).toMatch(en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', ({ node }) => {
    expect(textUnder('de-DE', node)).not.toBe(textUnder('en', node));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', ({ node }) => {
    const calls = recordLocaleArguments(() => {
      render(session('de-DE', node));
    });
    cleanup();
    // `some(=== 'de-DE')`, not `length > 0`: i18next's own plural machinery
    // makes locale-taking calls too, and only the surface passes the tenant tag.
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
