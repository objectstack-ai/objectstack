/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A master-detail grid's derived boolean options take the session's words even
 * when the language catalogue lands AFTER the child schema (objectui#12924).
 *
 * `I18nProvider` supports a host that does not await `preloadBootstrapLocale`:
 * its first paint renders through `fallbackLng: 'en'`, and it re-renders in the
 * user's language when the catalogue lands. `MasterDetailForm` derives a
 * `boolean` / `toggle` column's two options once, in its resolve effect, when
 * the child schema arrives. A schema that arrives first is derived with the
 * `en` words, and the re-render the catalogue triggers must still re-label
 * those options, which this file pins.
 *
 * The order is made deterministic, not left to timing. The DOM test setup
 * makes every catalogue resident before any test mounts
 * (`vitest.setup.i18n-catalogues.ts`, the state a host that awaits the preload
 * reaches), so this row builds its own instance and takes the `zh` bundle out
 * of it, the state of a host whose catalogue has not landed. The registry's
 * `loadBuiltInLocale` is wrapped so the provider's catalogue load is held until
 * the test releases it, after the child schema has been derived. Everything
 * else is the real registry, provider, form and grid.
 *
 * The same row also pins the half that rules out the obvious fix: the
 * catalogue landing must NOT re-run the resolve effect. A new set of resolved
 * entries re-reads the lines over any unsaved edit, so the line typed before
 * the catalogue lands is still on screen after it, and the lines were not read
 * again.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

/** Holds the `zh` catalogue until `release()`; records every language asked for. */
const gate = vi.hoisted(() => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release: () => release(), asked: [] as string[] };
});

vi.mock('../../i18n/src/locales/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../i18n/src/locales/registry')>();
  return {
    ...actual,
    loadBuiltInLocale: async (lang: string) => {
      gate.asked.push(lang);
      if (lang.startsWith('zh')) await gate.held;
      return actual.loadBuiltInLocale(lang);
    },
  };
});

import { I18nProvider, createI18n } from '@object-ui/i18n';
import { zh } from '@object-ui/i18n/locales';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

afterEach(() => cleanup());

const ZH = zh as unknown as { common: { yes: string; no: string; save: string } };
const YES = ZH.common.yes;
const NO = ZH.common.no;

const CHILD = {
  name: 'inv_line',
  fields: {
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'inv' },
    description: { type: 'text', label: 'Description' },
    billable: { type: 'boolean', label: 'Billable' },
  },
};
const LINES = [
  { id: 'l1', invoice: 'inv1', description: 'Freight', billable: true },
  { id: 'l2', invoice: 'inv1', description: 'Packing', billable: false },
];

function dataSource() {
  return {
    getObjectSchema: vi.fn(async (o: string) =>
      o === 'inv_line' ? CHILD : { name: 'inv', fields: { ref: { type: 'text', label: 'Ref' } } },
    ),
    findOne: vi.fn().mockResolvedValue({ id: 'inv1', ref: 'INV-1' }),
    find: vi.fn(async (o: string) => ({ data: o === 'inv_line' ? LINES.map((l) => ({ ...l })) : [] })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: vi.fn(),
  };
}

/** The two lines' `Billable` pickers' text, in row order. */
const billable = () => screen.getAllByRole('combobox', { name: 'Billable' }).slice(0, 2).map((el) => el.textContent);
const descriptions = () => screen.getAllByLabelText('Description') as HTMLInputElement[];

describe('MasterDetailForm re-labels derived boolean options when the catalogue lands late (objectui#12924)', () => {
  it('a child schema derived before the zh catalogue reads the zh words once it lands, and keeps an unsaved edit', async () => {
    const ds = dataSource();
    // A zh session whose catalogue has not landed: the instance boots in zh
    // and, with no zh bundle, every key reads the `en` fallback.
    const instance = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
    instance.removeResourceBundle('zh', 'translation');
    expect(instance.language).toBe('zh');
    expect(instance.t('common.yes')).toBe('Yes');
    render(
      <I18nProvider instance={instance} persistLanguage={false}>
        <MasterDetailForm
          schema={{
            objectName: 'inv',
            mode: 'edit',
            recordId: 'inv1',
            fields: ['ref'],
            details: [{ childObject: 'inv_line', title: 'Lines', inlineMode: 'grid' }],
          } as never}
          dataSource={ds as never}
        />
      </I18nProvider>,
    );

    // Precondition: the catalogue is held, so the columns were derived with
    // the `en` fallback's words. If this read were already zh, the row would
    // not be measuring a late catalogue.
    await waitFor(() => expect(billable()).toEqual(['Yes', 'No']));
    expect(screen.getByTestId('md-form-submit').textContent).toBe('Save');
    expect(gate.asked).toContain('zh');

    // An unsaved edit on the first line, made before the catalogue lands.
    fireEvent.change(descriptions()[0], { target: { value: 'Freight, edited' } });
    expect(descriptions()[0].value).toBe('Freight, edited');
    const lineReads = () => ds.find.mock.calls.filter(([o]) => o === 'inv_line').length;
    const readsBefore = lineReads();
    const schemaReadsBefore = ds.getObjectSchema.mock.calls.length;

    gate.release();

    // The catalogue landed and the form re-rendered in zh: its Save button
    // reads the zh word. Without this, a red below could mean nothing landed.
    await waitFor(() => expect(screen.getByTestId('md-form-submit').textContent).toBe(ZH.common.save));
    await waitFor(() => expect(billable()).toEqual([YES, NO]));
    // The resolve effect did not run again: no second schema fetch, no line
    // re-read, and the edit is still on screen.
    expect(ds.getObjectSchema.mock.calls.length).toBe(schemaReadsBefore);
    expect(lineReads()).toBe(readsBefore);
    expect(descriptions()[0].value).toBe('Freight, edited');
  });
});
