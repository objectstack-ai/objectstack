/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list` with no authored `title` is headed with the related
 * object's PLURAL label (objectui#11733).
 *
 * The block lists the related object's records, so it is named as that
 * object's list page is (objectui#11696). Its fallback read the singular bundle
 * key, `objects.{name}.label`; it now reads `objectPluralLabel`, which tries
 * `objects.{name}.pluralLabel` first and falls back to that same singular key,
 * then to the humanized object name, exactly as before.
 *
 * This renderer has the related object's NAME only, never its definition, so
 * both its rungs are bundle keys (the declared `label` was never read here
 * either); the fixtures therefore carry the plural in the bundle, in `en` as in
 * `zh-CN`, and the plural differs from the label in each, so the heading tells
 * which key was read. Two controls: a bundle that translates only the label
 * keeps it, and an object the bundle does not know is humanized.
 *
 * Mounted the way a page mounts the node: the JSON document through the real
 * `SchemaRenderer`, this package's registration and the real `RelatedList`,
 * inside a record context (the `titleI18nLabel-10993` harness), within a real
 * i18next instance booted in the language under test.
 *
 * Direction, written before the run: with the fallback put back to
 * `objectLabel`, the two plural cells RED (`Task` / `任务`); both controls
 * GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers `record:related_list`, the block under test.
import '../../index';

afterEach(() => cleanup());

type Lang = 'en' | 'zh-CN';

const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: { showcase: { objects: { showcase_task: { label: 'Task', pluralLabel: 'Tasks' } } } },
  'zh-CN': {
    showcase: {
      objects: {
        showcase_task: { label: '任务', pluralLabel: '任务清单' },
        showcase_note: { label: '笔记' },
      },
    },
  },
};

const makeDataSource = () => ({
  find: vi.fn(async () => ({ data: [], total: 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
});

/** A JSON document with no `title`: the heading is the fallback under test. */
const doc = (objectName: string) => ({
  type: 'record:related_list',
  properties: { objectName, relationshipField: 'project', columns: ['name'] },
});

function mountIn(lang: Lang, objectName: string) {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  return render(
    <I18nProvider instance={i18n}>
      <RecordContextProvider objectName="showcase_project" recordId="P-1" dataSource={makeDataSource() as never}>
        <SchemaRenderer schema={doc(objectName) as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

describe('record:related_list heads an untitled list with the plural (objectui#11733)', () => {
  it('en: "Tasks"', async () => {
    mountIn('en', 'showcase_task');
    expect(await screen.findByText('Tasks')).toBeInTheDocument();
    expect(screen.queryByText('Task')).toBeNull();
  });

  it('zh-CN: the translated plural', async () => {
    mountIn('zh-CN', 'showcase_task');
    expect(await screen.findByText('任务清单')).toBeInTheDocument();
    expect(screen.queryByText('任务')).toBeNull();
  });

  it('CONTROL: a bundle that translates only the label keeps the label', async () => {
    mountIn('zh-CN', 'showcase_note');
    expect(await screen.findByText('笔记')).toBeInTheDocument();
  });

  it('CONTROL: an object the bundle does not know is humanized, as before', async () => {
    mountIn('en', 'showcase_note');
    expect(await screen.findByText('Showcase Note')).toBeInTheDocument();
  });
});
