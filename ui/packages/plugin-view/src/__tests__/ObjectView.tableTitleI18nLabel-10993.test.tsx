/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10993 (batch 4) — an `object-view`'s `table.title` is `I18nLabel`,
 * and a locale map paints the viewer's entry in the REAL grid's caption.
 *
 * The view's `table` slot takes `ObjectGridSchema`'s keys
 * (`ObjectGridSlotKey` in `@object-ui/types`, and the zod slot rebuilt from
 * the grid's `.shape`), so batch 4 widening `ObjectGridSchema.title` from
 * `string` to the spec's `I18nLabel` widened `table.title` on both faces too.
 * That is only honest if the map reaches the screen resolved: `ObjectView`
 * reads `table.title` by name and hands it to the grid node it builds as
 * `title`, and `ObjectGrid` resolves `title` against the display locale since
 * batch 3 (`ObjectGrid.titleI18nLabel-10993.test.tsx` in `plugin-grid`). This
 * file pins the composed path — the registered `object-view` renderer through
 * the real `SchemaRenderer`, the real `ObjectGrid` — rather than either half.
 *
 * No regional locale is provided, so the display locale is the UI language.
 * The map lists `en` FIRST, so under `zh` a resolver that fell back to `en` or
 * to the first entry would paint English and fail the row. The plain string is
 * the control.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
// Module scope, not a hook: this import IS the `object-view` registration.
import '../index';
import { installExplainDouble } from './explainDouble';

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

beforeEach(() => {
  installExplainDouble();
});

afterEach(() => {
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** `en` first on purpose; see the file header. */
const TITLE = { en: 'Accounts', 'zh-CN': '客户' };

const makeDataSource = (): DataSource =>
  ({
    find: vi.fn(async () => ({ data: [{ id: 'r1', name: 'Alice' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'contacts',
      label: 'Contact',
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    })),
  }) as unknown as DataSource;

function mountIn(language: string, title: unknown) {
  const ds = makeDataSource();
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRendererProvider dataSource={ds}>
          <SchemaRenderer
            schema={{ type: 'object-view', objectName: 'contacts', table: { columns: ['name'], title } } as never}
          />
        </SchemaRendererProvider>
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The grid's table caption, once its row is on screen (reachability first). */
async function captionOf(container: HTMLElement): Promise<string> {
  await waitFor(() => expect(container.textContent ?? '').toContain('Alice'));
  expect(container.textContent ?? '').not.toContain('failed to render');
  expect(container.textContent ?? '').not.toContain('[object Object]');
  const caption = container.querySelector('caption');
  expect(caption, 'the grid rendered no table caption').not.toBeNull();
  return caption?.textContent ?? '';
}

describe('object-view table.title — a locale map reaches the real grid resolved (objectui#10993)', () => {
  it('zh: the caption paints the zh-CN entry', async () => {
    const { container } = mountIn('zh', TITLE);
    expect(await captionOf(container)).toBe('客户');
  });

  it('en: the caption paints the en entry', async () => {
    const { container } = mountIn('en', TITLE);
    expect(await captionOf(container)).toBe('Accounts');
  });

  it('CONTROL: a plain-string table.title renders exactly as authored, under zh', async () => {
    const { container } = mountIn('zh', 'Accounts');
    expect(await captionOf(container)).toBe('Accounts');
  });
});
