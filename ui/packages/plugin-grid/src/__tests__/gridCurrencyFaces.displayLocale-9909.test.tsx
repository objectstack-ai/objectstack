/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGrid's inferred currency faces read the DECLARED session locale, never
 * the machine's (objectui#9909).
 *
 * Two surfaces, both the half a source census CANNOT see: the calls pass an
 * argument list that merely OMITS the tag, and `formatCurrency` /
 * `formatCompactCurrency` read an omitted tag as "follow the runtime".
 *
 *  - the record-detail panel's inference fallback for a currency-named key —
 *    the sibling of the date branch objectui#4541 repaired one statement
 *    above (`recordDetailDateLocale.test.tsx`, whose fixture shape this file
 *    reuses: no schema type, so the value reaches the inference fallback);
 *  - the mobile card's amount line, beside the date and percent cells
 *    objectui#4272 and objectui#4553 already put on the display locale.
 *
 * Each surface is read twice — under a declared `de-DE` tenant locale and a
 * declared `en` one, the UI language `en` on both — and must read differently.
 * The runtime tripwire then checks the argument every locale-taking call
 * received.
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

function session(locale: string, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <ActionProvider>{node}</ActionProvider>
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** Record-detail panel: `amount` is NOT a column and has no schema type, so it reaches the inference fallback. */
async function detailPanelUnder(locale: string): Promise<string> {
  session(
    locale,
    <ObjectGrid
      schema={{
        type: 'object-grid',
        objectName: 'deals',
        columns: [{ field: 'name', label: 'Name' }],
        data: { provider: 'value', items: [{ id: '1', name: 'Alice', amount: 1234.5 }] },
        navigation: { mode: 'drawer' },
      } as never}
    />,
  );
  fireEvent.click(await screen.findByText('Alice'));
  await waitFor(() => expect(screen.getByTestId('record-detail-panel')).toBeInTheDocument());
  const text = screen.getByTestId('record-detail-panel').textContent ?? '';
  cleanup();
  return text;
}

/** Mobile card: an `amount`-named column is the card's amount line. */
async function mobileCardUnder(locale: string): Promise<string> {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
  const rows = [{ id: 'a1', account_name: 'Northwind', amount: 1234567 }];
  const ds = {
    find: vi.fn(async () => ({ data: rows, total: rows.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        account_name: { type: 'text', label: 'Account Name' },
        amount: { type: 'number', label: 'Amount' },
      },
    }),
  } as never;
  const { container } = session(
    locale,
    <SchemaRendererProvider dataSource={ds}>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'showcase_account',
          columns: [
            { field: 'account_name', label: 'Account Name' },
            { field: 'amount', label: 'Amount' },
          ],
          pagination: { pageSize: 50 },
        } as never}
        dataSource={ds}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
  const text = container.textContent ?? '';
  cleanup();
  return text;
}

interface Surface {
  name: string;
  read: (locale: string) => Promise<string>;
  de: RegExp;
  en: RegExp;
}

const SURFACES: Surface[] = [
  { name: 'record-detail panel — inferred currency', read: detailPanelUnder, de: /1\.234,5/, en: /1,234\.5/ },
  { name: 'mobile card — amount line', read: mobileCardUnder, de: /1,2\s?Mio\./, en: /1\.2M/ },
];

describe('ObjectGrid inferred currency faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', async ({ read, de }) => {
    const text = await read('de-DE');
    expect(text, `got: ${text}`).toMatch(de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', async ({ read, en }) => {
    const text = await read('en');
    expect(text, `got: ${text}`).toMatch(en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async ({ read }) => {
    expect(await read('de-DE')).not.toBe(await read('en'));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async ({ read }) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await read('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
