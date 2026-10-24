/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list`'s `title` is an `I18nLabel`, through the registry
 * (objectui#10993, batch 2).
 *
 * `@objectstack/spec` types `title` in `ComponentPropsMap['record:related_list']`
 * as `I18nLabel`: a plain string or an inline per-locale map.
 * `RecordRelatedListRenderer` already resolves it with `pickLocalized` against
 * the active UI language, before it falls back to the related object's label.
 * The registration declared `title` `'string'` only, so the manifest gate
 * reported `type-mismatch` on the legal map; objectui#10993 declares the
 * `object` arm. This file is the render half the arm rests on (the
 * `ComponentInput.type` rule: the render site resolves the map, so the arm may
 * be declared); the manifest half is the console's
 * `i18nLabelInputsManifest-10993.test.ts`.
 *
 * The node is mounted the way a page mounts it: the `{ type, properties }`
 * document through the real `SchemaRenderer`, this package's registration and
 * the real `RelatedList`, inside a record context with a stub adapter that
 * answers an empty child list. Every map lists `en` FIRST, so under `zh` a
 * resolver that fell back to `en` or to the first entry would paint English
 * and fail the row. The plain-string row is the control, and the no-title row
 * shows the heading is the authored text, not the object-label fallback.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers `record:related_list`, the block under test.
import '../../index';

afterEach(() => cleanup());

/** `en` first on purpose; see the file header. */
const TITLE = { en: 'Open tasks', 'zh-CN': '未完成任务' };

const makeDataSource = () => ({
  find: vi.fn(async () => ({ data: [], total: 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
});

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (title: unknown) => ({
  type: 'record:related_list',
  properties: {
    objectName: 'task',
    relationshipField: 'account_id',
    columns: ['name'],
    ...(title === undefined ? {} : { title }),
  },
});

function mountIn(language: string, title: unknown) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDataSource() as never}>
        <SchemaRenderer schema={doc(title) as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

describe('record:related_list title resolves an inline locale map through the registry (objectui#10993)', () => {
  it('zh: the list heading paints the zh-CN entry', async () => {
    const { container } = mountIn('zh', TITLE);
    expect(await screen.findByText('未完成任务')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('[object Object]');
    expect(container.textContent ?? '').not.toContain('failed to render');
  });

  it('en: the list heading paints the en entry', async () => {
    mountIn('en', TITLE);
    expect(await screen.findByText('Open tasks')).toBeInTheDocument();
  });

  it('CONTROL: a plain-string title renders exactly as authored, under zh', async () => {
    mountIn('zh', 'Open tasks');
    expect(await screen.findByText('Open tasks')).toBeInTheDocument();
  });

  it('CONTROL: with no title the heading is the related object\'s label, so the rows above read the authored text', async () => {
    mountIn('zh', undefined);
    expect(await screen.findByText('Task')).toBeInTheDocument();
    expect(screen.queryByText('未完成任务')).toBeNull();
  });
});
