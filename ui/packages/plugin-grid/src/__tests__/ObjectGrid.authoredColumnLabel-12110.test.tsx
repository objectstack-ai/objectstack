/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A view column's authored `label` wins over the field's label
 * (objectui#12110 item 1, finding A-02 of the HotCRM browser pass).
 *
 * `ListColumnSchema.label` is, in `@objectstack/spec`'s own words, the
 * "Display label override". The grid built the header as
 * `col.label || field.label || prettified name` and then handed THAT to the
 * translated field-label lookup as its fallback — so whenever the app bundle
 * carried a translation for the field, the bundle's FIELD label replaced the
 * column's override. A deployed app's bundle carries one for every field, so
 * on a real deployment the override never showed.
 *
 * Every case renders under a REAL `I18nProvider`, the field's translation an
 * app bundle key, the way a deployed app's bundle carries it.
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

const OBJECT = 'crm_account';
const OBJECT_FIELDS = {
  name: { name: 'name', type: 'text', label: 'Account Name' },
  industry: { name: 'industry', type: 'text', label: 'Industry' },
};
const ROWS = [{ id: 'a1', name: 'Fabrikam', industry: 'Retail' }];

const dataSource = {
  find: async () => ({ data: ROWS, total: ROWS.length }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => true,
  getObjectSchema: async () => ({ name: OBJECT, fields: OBJECT_FIELDS }),
};

/** The app bundle translates BOTH fields, in both languages. */
const RESOURCES = {
  en: { testapp: { fields: { [OBJECT]: { name: 'Account Name', industry: 'Industry' } }, fieldOptions: {} } },
  zh: { testapp: { fields: { [OBJECT]: { name: '客户名称', industry: '行业' } }, fieldOptions: {} } },
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
            // `name` carries an authored override; `industry` carries none.
            columns: [{ field: 'name', label: 'Company' }, { field: 'industry' }],
          } as never}
          dataSource={dataSource as never}
        />
      </ActionProvider>
    </I18nProvider>,
  );
}

const headerTexts = () => screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').trim());

describe('an authored column label wins over the field label (objectui#12110 item 1)', () => {
  for (const language of ['en', 'zh']) {
    it(`${language}: the override "Company" heads the column, not the bundle's field label`, async () => {
      mount(language);
      await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
      const headers = headerTexts();
      expect(headers.some((h) => h.includes('Company')), `headers: ${JSON.stringify(headers)}`).toBe(true);
      const fieldLabel = RESOURCES[language as 'en' | 'zh'].testapp.fields[OBJECT].name;
      expect(headers.some((h) => h.includes(fieldLabel)), `headers: ${JSON.stringify(headers)}`).toBe(false);
    });
  }

  it('CONTROL: a column with no override still takes the translated field label', async () => {
    mount('zh');
    await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
    expect(headerTexts().some((h) => h.includes('行业'))).toBe(true);
  });
});
