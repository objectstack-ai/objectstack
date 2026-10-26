/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A list column's inline locale-map `label` heads the column in the viewer's
 * language (objectui#12358).
 *
 * `ListColumnSchema.label` is the spec's `I18nLabel`: a plain string or an
 * inline per-locale map, which `@objectstack/spec` documents as resolved by the
 * renderer. `resolveColumnLabel` kept only a plain string and answered
 * `undefined` for a map, so the header silently fell back to the field label
 * in every language. The map now goes through `pickLocalized`, the console's
 * one `I18nLabel` locale pick, against the UI language.
 *
 * Every case renders under a REAL `I18nProvider` whose app bundle translates
 * the field, so a header that fell back to the field label reads as the
 * bundle's text and fails the row. The map lists `en` FIRST, so under `zh` a
 * resolver that fell back to `en` or to the first entry would paint English.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

afterEach(() => cleanup());

const OBJECT = 'crm_lead';
const OBJECT_FIELDS = {
  name: { name: 'name', type: 'text', label: 'Lead Name' },
  amount: { name: 'amount', type: 'text', label: 'Estimated Amount' },
  source: { name: 'source', type: 'text', label: 'Source' },
};
const ROWS = [{ id: 'l1', name: 'Fabrikam', amount: '1200', source: 'Web' }];

const dataSource = {
  find: async () => ({ data: ROWS, total: ROWS.length }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => true,
  getObjectSchema: async () => ({ name: OBJECT, fields: OBJECT_FIELDS }),
};

/** `en` first on purpose; see the file header. */
const AMOUNT_LABEL = { en: 'MAPEN Est', 'zh-CN': 'MAPZH 预计' };

/** The app bundle translates every field, in both languages. */
const RESOURCES = {
  en: { testapp: { fields: { [OBJECT]: { name: 'Lead Name', amount: 'Estimated Amount', source: 'Source' } }, fieldOptions: {} } },
  zh: { testapp: { fields: { [OBJECT]: { name: '线索名称', amount: '预计金额', source: '来源' } }, fieldOptions: {} } },
};

function mount(language: string) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: RESOURCES }}
      persistLanguage={false}
    >
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: OBJECT,
            // `amount` carries a map label, `name` a plain-string label (the
            // control), `source` none.
            columns: [
              { field: 'name', label: 'Company' },
              { field: 'amount', label: AMOUNT_LABEL },
              { field: 'source' },
            ],
          } as never}
          dataSource={dataSource as never}
        />
      </ActionProvider>
    </I18nProvider>,
  );
}

const headerTexts = () => screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').trim());

async function headersIn(language: string): Promise<string[]> {
  mount(language);
  await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
  const headers = headerTexts();
  expect(headers.some((h) => h.includes('[object Object]')), `headers: ${JSON.stringify(headers)}`).toBe(false);
  return headers;
}

describe('a list column\'s inline locale-map label heads the column (objectui#12358)', () => {
  it('en: the map\'s en entry heads the column, not the field label', async () => {
    const headers = await headersIn('en');
    expect(headers.some((h) => h.includes('MAPEN Est')), `headers: ${JSON.stringify(headers)}`).toBe(true);
    expect(headers.some((h) => h.includes('Estimated Amount')), `headers: ${JSON.stringify(headers)}`).toBe(false);
  });

  it('zh: the map\'s zh-CN entry heads the column, not the en entry and not the field label', async () => {
    const headers = await headersIn('zh');
    expect(headers.some((h) => h.includes('MAPZH 预计')), `headers: ${JSON.stringify(headers)}`).toBe(true);
    expect(headers.some((h) => h.includes('MAPEN Est')), `headers: ${JSON.stringify(headers)}`).toBe(false);
    expect(headers.some((h) => h.includes('预计金额')), `headers: ${JSON.stringify(headers)}`).toBe(false);
  });

  it('a locale the map does not carry takes the resolver\'s floor (the en entry)', async () => {
    const headers = await headersIn('fr');
    expect(headers.some((h) => h.includes('MAPEN Est')), `headers: ${JSON.stringify(headers)}`).toBe(true);
    expect(headers.some((h) => h.includes('MAPZH 预计')), `headers: ${JSON.stringify(headers)}`).toBe(false);
  });

  it('CONTROL: a plain-string label renders unchanged in either language', async () => {
    for (const language of ['en', 'zh']) {
      const headers = await headersIn(language);
      expect(headers.some((h) => h.includes('Company')), `${language} headers: ${JSON.stringify(headers)}`).toBe(true);
      cleanup();
    }
  });

  it('CONTROL: a column with no label still takes the translated field label', async () => {
    const headers = await headersIn('zh');
    expect(headers.some((h) => h.includes('来源')), `headers: ${JSON.stringify(headers)}`).toBe(true);
  });
});
