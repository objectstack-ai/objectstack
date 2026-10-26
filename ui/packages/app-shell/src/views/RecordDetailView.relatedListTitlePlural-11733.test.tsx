/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11733 — a related-list section on the record page is titled with
 * the child object's PLURAL label.
 *
 * The section lists the child's records — a project's tasks — but it was
 * titled with the singular: "Task". Two producers wrote that title, and both
 * are read here:
 *
 *  - the single-relationship title, which `RecordDetailView` resolves from the
 *    child object (`objectPluralLabel` now, `objectLabel` before);
 *  - the multi-relationship title `deriveRelatedLists` composes when a child
 *    points at the parent through more than one field ("Opportunities ·
 *    Primary Project"), whose list half now comes from the same resolver the
 *    page hands it, where it used to be the child's raw, untranslated label.
 *
 * Measured from a real `RecordDetailView` mount (the `relatedListFilter-4664`
 * harness, related tab open) inside a real i18next instance booted in the
 * language under test. The `zh-CN` plurals differ from the `zh-CN` labels on
 * purpose, so each assertion can tell which key was read; the no-plural child
 * is the control. The relationship field's own label is the disambiguating
 * half and is not under test here (it is drawn as authored).
 *
 * Direction, written before the run: with both producers put back to the
 * singular, every plural cell RED (`Task` / `任务`, `Opportunity · …`), the
 * control GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Orthogonal chrome — stubbed so the only asynchrony here is the page's own.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

type Lang = 'en' | 'zh-CN';

const PARENT = 'showcase_project';
const RECORD_ID = 'p-1';

const BASE_FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};

const OBJECTS = [
  { name: PARENT, label: 'Project', pluralLabel: 'Projects', managedBy: 'platform', fields: BASE_FIELDS },
  // One relationship to the parent: the page resolves the title.
  {
    name: 'showcase_task',
    label: 'Task',
    pluralLabel: 'Tasks',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, project: { type: 'master_detail', reference: PARENT, label: 'Project' } },
  },
  // Two relationships to the parent: `deriveRelatedLists` composes the titles.
  {
    name: 'showcase_opportunity',
    label: 'Opportunity',
    pluralLabel: 'Opportunities',
    managedBy: 'platform',
    fields: {
      ...BASE_FIELDS,
      primary_project: { type: 'lookup', reference: PARENT, label: 'Primary Project' },
      partner_project: { type: 'lookup', reference: PARENT, label: 'Partner Project' },
    },
  },
  // The control: no plural declared.
  {
    name: 'showcase_note',
    label: 'Note',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, project: { type: 'lookup', reference: PARENT, label: 'Project' } },
  },
];

/** The catalog as the console loads it: `zh-CN` translates both scalars. */
const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: {},
  'zh-CN': {
    showcase: {
      objects: {
        showcase_task: { label: '任务', pluralLabel: '任务清单' },
        showcase_opportunity: { label: '商机', pluralLabel: '商机列表' },
      },
    },
  },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({ id: recordId, name: `Project ${recordId}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
}

function renderPage(lang: Lang) {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  const metadata = {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[`/app/demo/${PARENT}/${RECORD_ID}?tab=related`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView
            dataSource={makeDataSource()}
            objects={OBJECTS}
            onEdit={() => {}}
            objectNameOverride={PARENT}
            recordIdOverride={RECORD_ID}
            embedded
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Whether `text` is drawn as an element's whole text somewhere on the page. */
async function drawn(text: string): Promise<boolean> {
  return (await screen.findAllByText(text, undefined, { timeout: 5000 })).length > 0;
}
const absent = (text: string) => screen.queryAllByText(text).length === 0;

beforeEach(() => {
  cleanup();
  // The count store is module-scoped; a warm entry would badge this case.
  RelatedCountStore._reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — related-list titles read the plural (objectui#11733)', () => {
  it('en: "Tasks", and "Opportunities · …" for a child with two relationships', async () => {
    renderPage('en');
    expect(await drawn('Tasks')).toBe(true);
    expect(await drawn('Opportunities · Primary Project')).toBe(true);
    expect(await drawn('Opportunities · Partner Project')).toBe(true);
    expect(absent('Task')).toBe(true);
    expect(absent('Opportunity · Primary Project')).toBe(true);
  });

  it('zh-CN: the translated plurals, in both producers', async () => {
    renderPage('zh-CN');
    expect(await drawn('任务清单')).toBe(true);
    expect(await drawn('商机列表 · Primary Project')).toBe(true);
    expect(await drawn('商机列表 · Partner Project')).toBe(true);
    expect(absent('任务')).toBe(true);
  });

  it('control: a child that declares no plural is titled with its label', async () => {
    renderPage('en');
    expect(await drawn('Note')).toBe(true);
  });
});
