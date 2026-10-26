/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:details`' `sections[].label` and `record:related_list`'s `add.label`
 * and `columns[].label` are `I18nLabel`, through the registry (objectui#10993,
 * batch 4).
 *
 * `@objectstack/spec` types both positions `I18nLabel` — a plain string or an
 * inline per-locale map — and both renderers resolve a map with
 * `pickLocalized` against the active UI language: `RecordDetailsRenderer` for
 * the section heading, `RecordRelatedListRenderer` for the Add button text it
 * hands `RelatedList`. Batch 4 widens `@object-ui/types`' TypeScript face of
 * both from `string` to the spec's type; this file is the render half that
 * widening rests on (a member whose renderer did not resolve the map would not
 * be widened on the type face alone). The type half is `@object-ui/types`'
 * `record-components-i18n-label-members-10993.test.ts`; the other two members
 * widened beside these, `record:path`'s `stages[].label` and
 * `record:related_list`'s `title`, carry batch 2's render pins.
 *
 * `columns[].label` is the REPAIR in this file. The spec's
 * `record:related_list.columns` declares the saved-view union since 17.5.0, so
 * a column may be a `ListColumn` object whose `label` is `I18nLabel`. A string
 * label became the column header, and a map drew a BLANK header: `RelatedList`
 * turns `label` into the table's `header` through `columnHeader`, which takes
 * a string only. `RecordRelatedListRenderer` now resolves the map against the
 * UI language before it hands the columns on (`localizeColumnLabels`). This
 * pins the render only; adopting the column-object arm on this package's
 * registration input and on `@object-ui/types`' `columns` is not this card's.
 *
 * Each node is mounted the way a page mounts it: the `{ type, properties }`
 * document through the real `SchemaRenderer` and this package's registration,
 * inside a record context. Every map lists `en` FIRST, so under `zh` a
 * resolver that fell back to `en` or to the first entry would paint English
 * and fail the row. The plain-string rows are the controls. The section is
 * deliberately NAMELESS: a named section's bundle key outranks its authored
 * label, and no bundle is configured here, so the heading can only be the
 * authored text.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
// Registers `record:details` and `record:related_list`, the blocks under test.
import '../../index';

// `record:details` asks `POST /api/v1/security/explain` whether the record may
// be edited; under happy-dom a relative fetch is a REAL socket (objectui#6640),
// so it is served from a double installed for every case.
beforeEach(() => installRecordSecurityExplainDouble(vi));

// ONE hook, in this order (objectui#7439): unmount before the real `fetch` is
// restored, so no late read escapes.
afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

/** `en` first on purpose; see the file header. */
const SECTION_LABEL = { en: 'Commercial terms', 'zh-CN': '商务条款' };
const ADD_LABEL = { en: 'Link tasks', 'zh-CN': '关联任务' };
const COLUMN_LABEL = { en: 'Subject', 'zh-CN': '主题' };

/**
 * `name` is declared and left unset: the page-H1 dedupe ladder resolves its
 * title candidate to `name`, finds no value and hides nothing, so `industry`
 * stays in the section (the objectui#8175 trap).
 */
const objectSchema = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Account Name' },
    industry: { type: 'text', label: 'Industry' },
  },
};
const record = { industry: 'Retail' };

const makeDataSource = () => ({
  find: vi.fn(async () => ({ data: [{ id: 't1', name: 'Call back' }], total: 1 })),
  findOne: vi.fn(async () => record),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
});

function mountIn(language: string, doc: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider
        objectName="account"
        recordId="ACC-1"
        data={record}
        objectSchema={objectSchema as never}
        dataSource={makeDataSource() as never}
      >
        <SchemaRenderer schema={doc as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const detailsDoc = (label: unknown) => ({
  type: 'record:details',
  properties: { sections: [{ label, fields: ['industry'] }] },
});

const relatedListDoc = (label: unknown) => ({
  type: 'record:related_list',
  properties: {
    objectName: 'task',
    relationshipField: 'account_id',
    columns: ['name'],
    title: 'Tasks',
    add: { picker: { object: 'task' }, label },
  },
});

const columnsDoc = (label: unknown) => ({
  type: 'record:related_list',
  properties: {
    objectName: 'task',
    relationshipField: 'account_id',
    title: 'Tasks',
    columns: [{ field: 'name', label }],
  },
});

/** The list's column headers, once its row is on screen (reachability first). */
async function headersOf(container: HTMLElement): Promise<string[]> {
  await screen.findByText('Call back');
  return [...container.querySelectorAll('th')].map((th) => th.textContent ?? '');
}

function expectNoRawMap(container: HTMLElement) {
  expect(container.textContent ?? '').not.toContain('[object Object]');
  expect(container.textContent ?? '').not.toContain('failed to render');
}

describe('record:details sections[].label resolves an inline locale map through the registry (objectui#10993)', () => {
  it('zh: the section heading paints the zh-CN entry', async () => {
    const { container } = mountIn('zh', detailsDoc(SECTION_LABEL));
    expect(await screen.findByText('商务条款')).toBeInTheDocument();
    expect(screen.queryByText('Commercial terms')).toBeNull();
    expectNoRawMap(container);
  });

  it('en: the section heading paints the en entry', async () => {
    const { container } = mountIn('en', detailsDoc(SECTION_LABEL));
    expect(await screen.findByText('Commercial terms')).toBeInTheDocument();
    expectNoRawMap(container);
  });

  it('CONTROL: a plain-string section label renders exactly as authored, under zh', async () => {
    mountIn('zh', detailsDoc('Commercial terms'));
    expect(await screen.findByText('Commercial terms')).toBeInTheDocument();
    // The field row is drawn too, so the section really mounted.
    expect(await screen.findByText('Retail')).toBeInTheDocument();
  });
});

describe('record:related_list add.label resolves an inline locale map through the registry (objectui#10993)', () => {
  it('zh: the Add button paints the zh-CN entry', async () => {
    const { container } = mountIn('zh', relatedListDoc(ADD_LABEL));
    expect(await screen.findByRole('button', { name: '关联任务' })).toBeInTheDocument();
    expect(screen.queryByText('Link tasks')).toBeNull();
    expectNoRawMap(container);
  });

  it('en: the Add button paints the en entry', async () => {
    const { container } = mountIn('en', relatedListDoc(ADD_LABEL));
    expect(await screen.findByRole('button', { name: 'Link tasks' })).toBeInTheDocument();
    expectNoRawMap(container);
  });

  it('CONTROL: a plain-string add.label renders exactly as authored, under zh', async () => {
    mountIn('zh', relatedListDoc('Link tasks'));
    expect(await screen.findByRole('button', { name: 'Link tasks' })).toBeInTheDocument();
  });
});

describe('record:related_list columns[].label resolves an inline locale map through the registry (objectui#10993)', () => {
  it('zh: the column header paints the zh-CN entry', async () => {
    const { container } = mountIn('zh', columnsDoc(COLUMN_LABEL));
    expect(await headersOf(container)).toEqual(['主题']);
    expectNoRawMap(container);
  });

  it('en: the column header paints the en entry', async () => {
    const { container } = mountIn('en', columnsDoc(COLUMN_LABEL));
    expect(await headersOf(container)).toEqual(['Subject']);
  });

  it('CONTROL: a plain-string column label renders exactly as authored, under zh', async () => {
    const { container } = mountIn('zh', columnsDoc('Subject'));
    expect(await headersOf(container)).toEqual(['Subject']);
  });
});
