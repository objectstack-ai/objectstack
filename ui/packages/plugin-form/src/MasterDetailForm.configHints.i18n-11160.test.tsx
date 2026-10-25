/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A master-detail collection's three configuration hints speak the session
 * locale (objectui#11160).
 *
 * `MasterDetailForm` shows a hint in place of a collection's grid when the
 * collection cannot be resolved: it names no `childObject`
 * (`md-detail-no-child-object`), its child schema failed to load
 * (`md-detail-schema-unavailable`), or nothing on the child links it to the
 * parent (`md-detail-no-relationship-field`). All three were English literals,
 * so under a `zh` session the collection heading read `明细行` above
 * `This collection has no child object configured…`.
 *
 * They now read `form.masterDetail.*` through `useFormChromeTranslation`. The
 * property and object names they carry stay code and are never translated:
 * each is a hole in the pack sentence, and the value rendered in it is the
 * authored one.
 *
 * The provider-less English is the `.no-provider` companion of this file.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const PARENT = 'purchase_order';
const parentSchema = { name: PARENT, fields: { ref: { type: 'text', label: 'Ref' } } };
/** Loads fine, and carries no lookup or master_detail field to the parent. */
const underivableChildSchema = {
  name: 'po_line',
  fields: { amount: { type: 'number', label: 'Amount' } },
};

function dataSource(failing: string[] = []) {
  return {
    getObjectSchema: vi.fn(async (obj: string) => {
      if (failing.includes(obj)) throw new Error(`SCHEMA_UNAVAILABLE: ${obj}`);
      return obj === PARENT ? parentSchema : underivableChildSchema;
    }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  };
}

function form(language: 'zh' | 'en' | 'ja', details: unknown[], failing: string[] = []) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MasterDetailForm
        schema={{ objectName: PARENT, mode: 'create', fields: ['ref'], details } as never}
        dataSource={dataSource(failing) as never}
      />
    </I18nProvider>,
  );
}

/** The hint's text, and the text of each code element in it, in order. */
const read = (testId: string) => {
  const hint = screen.getByTestId(testId);
  return {
    text: hint.textContent,
    code: Array.from(hint.querySelectorAll('code')).map((c) => c.textContent),
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MasterDetailForm: the collection config hints read the locale packs (objectui#11160)', () => {
  it('zh: a collection with no `childObject` reads the zh hint, with `childObject` as code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form('zh', [{ title: 'Unconfigured' }]);

    await waitFor(() =>
      expect(read('md-detail-no-child-object')).toEqual({
        text: '此集合未配置子对象：请将 childObject 设为其所列行所属的对象。',
        code: ['childObject'],
      }),
    );
  });

  it('zh: a collection whose child schema failed to load reads the zh hint, with the authored object name as code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form('zh', [{ childObject: 'po_line', title: 'PO lines' }], ['po_line']);

    await waitFor(() =>
      expect(read('md-detail-schema-unavailable')).toEqual({
        text: '无法加载 po_line 的对象结构，因此此集合没有可显示的列。请检查该对象是否存在且可读，然后重新加载。',
        code: ['po_line'],
      }),
    );
    // The thrown error is logged, not shown: the hint is the only text.
    expect(document.body.textContent).not.toContain('SCHEMA_UNAVAILABLE');
  });

  it('zh: a collection with no field linking it to the parent reads the zh hint, with both object names and `relationshipField` as code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form('zh', [{ childObject: 'po_line', title: 'PO lines' }]);

    await waitFor(() =>
      expect(read('md-detail-no-relationship-field')).toEqual({
        text:
          '无法确定 po_line 如何关联到 purchase_order：它没有引用父对象的 lookup 或 master_detail 字段。'
          + '请在此集合上将 relationshipField 设为保存父记录的字段。',
        code: ['po_line', PARENT, 'relationshipField'],
      }),
    );
  });

  it('ja: a hole that opens the sentence still renders as code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form('ja', [{ childObject: 'po_line', title: 'PO lines' }], ['po_line']);

    await waitFor(() => expect(read('md-detail-schema-unavailable').code).toEqual(['po_line']));
    const hint = screen.getByTestId('md-detail-schema-unavailable');
    expect(hint.firstElementChild?.tagName).toBe('CODE');
    expect(hint.textContent?.startsWith('po_line のスキーマを読み込めなかったため')).toBe(true);
  });

  it('CONTROL en: the three hints read the English they read before, byte for byte', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form('en', [{ title: 'Unconfigured' }]);
    await waitFor(() =>
      expect(read('md-detail-no-child-object')).toEqual({
        text: 'This collection has no child object configured: set childObject to the object whose rows it lists.',
        code: ['childObject'],
      }),
    );
    cleanup();

    form('en', [{ childObject: 'po_line', title: 'PO lines' }], ['po_line']);
    await waitFor(() =>
      expect(read('md-detail-schema-unavailable')).toEqual({
        text:
          'Could not load the schema of po_line, so this collection has no columns to show. '
          + 'Check that the object exists and is readable, then reload.',
        code: ['po_line'],
      }),
    );
    cleanup();

    form('en', [{ childObject: 'po_line', title: 'PO lines' }]);
    await waitFor(() =>
      expect(read('md-detail-no-relationship-field')).toEqual({
        text:
          'Could not work out how po_line links to purchase_order: no lookup or master_detail field on it '
          + 'references the parent. Set relationshipField on this collection to the field that holds the parent record.',
        code: ['po_line', PARENT, 'relationshipField'],
      }),
    );
  });
});
