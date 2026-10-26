/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid`'s `label` is an `I18nLabel`, through the registry
 * (objectui#10993, batch 2).
 *
 * `@objectstack/spec` types `label` in `ComponentPropsMap['object-grid']` as
 * `I18nLabel`: a plain string or an inline per-locale map. `ObjectGrid`
 * already resolves every read of it with the spec's `resolveI18nLabel` against
 * `useDisplayLocale()` (the table caption, the export title, the record-detail
 * overlay heading). The registration declared `label` `'string'` only, so the
 * manifest gate reported `type-mismatch` on the legal map; objectui#10993
 * declares the `object` arm. This file is the render half the arm rests on (the
 * `ComponentInput.type` rule: the render site resolves the map, so the arm may
 * be declared); the manifest half is the console's
 * `i18nLabelInputsManifest-10993.test.ts`.
 *
 * `ObjectGrid.overlayTitleInlineLocale-9092.test.tsx` pins the overlay heading
 * on the component mounted directly. This file mounts the node the way a page
 * does, the `{ type, properties }` document through the real `SchemaRenderer`
 * and the registered block, and reads the table caption. No regional locale is
 * provided, so the display locale is the UI language. Every map lists `en`
 * FIRST, so under `zh` a resolver that fell back to `en` or to the first entry
 * would paint English and fail the row. The plain-string row is the control.
 *
 * ⛔ Not `title`. The deprecated `title` is the caption's fallback when `label`
 * resolves to nothing; its pin is `ObjectGrid.titleI18nLabel-10993.test.tsx`
 * (objectui#10993, batch 3), so this file authors no `title`.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Registers `object-grid`, the block under test.
import '../index';

registerAllFields();

afterEach(() => cleanup());

/** `en` first on purpose; see the file header. */
const LABEL = { en: 'Accounts', 'zh-CN': '客户' };

const rows = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (label: unknown) => ({
  type: 'object-grid',
  properties: {
    objectName: 'contacts',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: rows },
    label,
  },
});

function mountIn(language: string, label: unknown) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRenderer schema={doc(label) as never} />
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

describe('object-grid label resolves an inline locale map through the registry (objectui#10993)', () => {
  it('zh: the caption paints the zh-CN entry', async () => {
    const { container } = mountIn('zh', LABEL);
    expect(await captionOf(container)).toBe('客户');
    expect(container.textContent ?? '').not.toContain('[object Object]');
  });

  it('en: the caption paints the en entry', async () => {
    const { container } = mountIn('en', LABEL);
    expect(await captionOf(container)).toBe('Accounts');
  });

  it('CONTROL: a plain-string label renders exactly as authored, under zh', async () => {
    const { container } = mountIn('zh', 'Accounts');
    expect(await captionOf(container)).toBe('Accounts');
  });
});
