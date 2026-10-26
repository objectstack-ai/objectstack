/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid`'s deprecated `title` resolves an inline locale map the way
 * `label` does (objectui#10993, batch 3).
 *
 * `title` is the legacy spelling of `label`. `ObjectGrid` reads it at exactly
 * two sites and only when `label` resolves to nothing: the data-table
 * `caption`, and the `viewLabel` that goes into the export file name. Both
 * sites resolve `label` through the spec's `resolveI18nLabel` against
 * `useDisplayLocale()`, and both used to hand `title` on raw. The spec types
 * `title` as `I18nLabel` (a plain string or an inline per-locale map), and the
 * spec-side validator accepts the map, so an authored map reached the caption
 * as an object: the data-table threw "Objects are not valid as a React child"
 * and the block failed to render; in the file name it went through `String(…)`
 * and came out as `[object Object]`.
 *
 * `ObjectGrid.labelI18nLabel-10993.test.tsx` is the `label` twin of this file.
 * It mounts the node the way a page does (the `{ type, properties }` document
 * through the real `SchemaRenderer` and the registered block) and reads the
 * table caption; this file does the same for `title`, and adds the export file
 * name, the second site, which the caption row cannot reach. No regional
 * locale is provided, so the display locale is the UI language. Every map lists
 * `en` FIRST, so under `zh` a resolver that fell back to `en` or to the first
 * entry would paint English and fail the row. The plain-string rows are the
 * controls, and the last two rows pin the order of the two keys: `label` still
 * wins when it resolves, and `title` is reached only when it does not.
 *
 * ⛔ Not the registry. `title` is one of the block's deliberately unregistered
 * `@deprecated` spellings (the header note in the package's `index.tsx`), so
 * no input declares an arm for it and no manifest row belongs here.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Registers `object-grid`, the block under test.
import '../index';

registerAllFields();

beforeAll(() => {
  // The client-side export builds a Blob URL; neither jsdom nor happy-dom
  // is guaranteed to carry the plumbing.
  const url = URL as unknown as Record<string, unknown>;
  if (!URL.createObjectURL) url.createObjectURL = () => 'blob:export';
  if (!URL.revokeObjectURL) url.revokeObjectURL = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** `en` first on purpose; see the file header. */
const TITLE = { en: 'Accounts', 'zh-CN': '客户' };

const rows = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (authored: Record<string, unknown>) => ({
  type: 'object-grid',
  properties: {
    objectName: 'contacts',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: rows },
    ...authored,
  },
});

function mountIn(language: string, authored: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRenderer schema={doc(authored) as never} />
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The table caption, once the rows are on screen (reachability first). */
async function captionOf(container: HTMLElement): Promise<string> {
  await waitFor(() => expect(container.textContent ?? '').toContain('Alice'));
  expect(container.textContent ?? '').not.toContain('failed to render');
  const caption = container.querySelector('caption');
  expect(caption, 'the grid rendered no table caption').not.toBeNull();
  return caption?.textContent ?? '';
}

/** The export button and its CSV item, by the accessible name each language gives them. */
const EXPORT_MENU: Record<string, { open: RegExp; csv: RegExp }> = {
  en: { open: /export/i, csv: /export as csv/i },
  zh: { open: /导出/, csv: /导出为 CSV/ },
};

/**
 * The file name the client-side CSV export hands to the browser. The rows are
 * inline, so the grid owns them and takes the client path; `fileNameFor` is the
 * one builder both export paths share.
 */
async function exportedFileNameOf(
  language: string,
  authored: Record<string, unknown>,
): Promise<string> {
  const downloads: string[] = [];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });

  const { container } = mountIn(language, { exportOptions: { formats: ['csv'] }, ...authored });
  await waitFor(() => expect(container.textContent ?? '').toContain('Alice'));
  expect(container.textContent ?? '').not.toContain('failed to render');

  // The export menu is translated too, so the buttons are found by the name
  // the language under test gives them.
  const menu = EXPORT_MENU[language];
  fireEvent.click(await screen.findByRole('button', { name: menu.open }));
  fireEvent.click(await screen.findByRole('button', { name: menu.csv }));

  await waitFor(() => expect(downloads).toHaveLength(1));
  return downloads[0];
}

describe('object-grid title resolves an inline locale map like label does (objectui#10993)', () => {
  describe('the table caption', () => {
    it('zh: paints the zh-CN entry', async () => {
      const { container } = mountIn('zh', { title: TITLE });
      expect(await captionOf(container)).toBe('客户');
      expect(container.textContent ?? '').not.toContain('[object Object]');
    });

    it('en: paints the en entry', async () => {
      const { container } = mountIn('en', { title: TITLE });
      expect(await captionOf(container)).toBe('Accounts');
    });

    it('CONTROL: a plain-string title renders exactly as authored, under zh', async () => {
      const { container } = mountIn('zh', { title: 'Accounts' });
      expect(await captionOf(container)).toBe('Accounts');
    });

    it('label still wins over title: a label map resolves first, under zh', async () => {
      const { container } = mountIn('zh', {
        label: { en: 'Directory', 'zh-CN': '通讯录' },
        title: TITLE,
      });
      expect(await captionOf(container)).toBe('通讯录');
    });

    it('title is reached only when label resolves to nothing: an empty label falls through to the title map, under zh', async () => {
      const { container } = mountIn('zh', { label: '', title: TITLE });
      expect(await captionOf(container)).toBe('客户');
    });
  });

  describe('the export file name', () => {
    it('zh: the view label in the name is the zh-CN entry, never [object Object]', async () => {
      const name = await exportedFileNameOf('zh', { title: TITLE });
      expect(name).not.toContain('object');
      expect(name).toMatch(/^contacts-客户-\d{8}-\d{6}\.csv$/);
    });

    it('CONTROL: a plain-string title lands in the name exactly as authored, under zh', async () => {
      const name = await exportedFileNameOf('zh', { title: 'Accounts' });
      expect(name).toMatch(/^contacts-Accounts-\d{8}-\d{6}\.csv$/);
    });
  });
});
