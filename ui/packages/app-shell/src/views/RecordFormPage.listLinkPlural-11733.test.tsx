/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11733 — the record form page's breadcrumb link names the object's
 * LIST with the plural; the page's own title and its save toast keep the
 * singular.
 *
 * One variable fed all three: `label`, the singular. The link opens the
 * object's list page, titled with the plural since objectui#11696, under a
 * header crumb that reads the plural too — so the page read "Projects ▾" above
 * an in-page "Project / Create Project". The variable is split: the link reads
 * `objectPluralLabel`, the title and the toast still read `objectLabel`, since
 * they speak of the one record being created or edited.
 *
 * Measured from a real `RecordFormPage` mount inside a real i18next instance
 * booted in the language under test (the `RecordFormPage.i18n` harness; the
 * form itself is a stand-in that fires `onSuccess`). The `zh-CN` plural differs
 * from the `zh-CN` label on purpose, so each assertion can tell which key was
 * read; the no-plural object is the control.
 *
 * Direction, written before the run: with the link put back to the singular,
 * the two plural link cells RED (`Project` / `项目`); every title, toast and
 * control cell GREEN on both sides. With the split collapsed the other way
 * (everything plural), the title and toast cells go RED instead.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { RecordFormPage } from './RecordFormPage';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

// Stand-in for the real form: a button that fires `onSuccess`, which is what
// raises the save toast.
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: { onSuccess?: () => void } }) => (
    <button type="button" data-testid="fire-success" onClick={() => schema.onSuccess?.()}>
      ok
    </button>
  ),
}));

const OBJECTS = [
  { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects', fields: { name: { type: 'text' } } },
  { name: 'showcase_note', label: 'Note', fields: { name: { type: 'text' } } },
];

vi.mock('../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: OBJECTS, loading: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

type Lang = 'en' | 'zh-CN';

/** The breadcrumb landmark's name in each language under test, read from the pack. */
const CRUMB_NAME: Record<Lang, string> = { en: en.common.breadcrumb, 'zh-CN': zh.common.breadcrumb };

/** The catalog as the console loads it: `zh-CN` translates both scalars. */
const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: {},
  'zh-CN': { showcase: { objects: { showcase_project: { label: '项目', pluralLabel: '项目清单' } } } },
};

beforeEach(() => {
  toastSuccess.mockClear();
});
afterEach(cleanup);

interface PageText {
  link: string;
  title: string;
  toast: string;
}

async function pageText(lang: Lang, mode: 'create' | 'edit', objectName: string): Promise<PageText> {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  const path = mode === 'create' ? `/apps/demo/${objectName}/new` : `/apps/demo/${objectName}/record/r1/edit`;
  const route = mode === 'create' ? '/apps/:appName/:objectName/new' : '/apps/:appName/:objectName/record/:recordId/edit';
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<RecordFormPage mode={mode} />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
  const title = (await screen.findByTestId('record-form-page-title')).textContent ?? '';
  // The breadcrumb's one link is the way to the object's list. The landmark
  // is found by the name the language under test's PACK gives it
  // (`common.breadcrumb`, objectui#12145): under zh-CN that is the zh pack's
  // word, so this lookup is also the package's zh role-and-name pin.
  const crumb = screen.getByRole('navigation', { name: CRUMB_NAME[lang] });
  const link = crumb.querySelector('a');
  expect(link?.getAttribute('href')).toBe(`/apps/demo/${objectName}`);
  fireEvent.click(screen.getByTestId('fire-success'));
  expect(toastSuccess).toHaveBeenCalledTimes(1);
  return { link: link?.textContent ?? '', title, toast: String(toastSuccess.mock.calls[0][0]) };
}

describe('RecordFormPage — the list link reads the plural, the record copy the singular (objectui#11733)', () => {
  it('en, create: "Projects" links to the list; the title and toast say "Project"', async () => {
    expect(await pageText('en', 'create', 'showcase_project')).toEqual({
      link: 'Projects',
      title: 'Create Project',
      toast: 'Project created successfully',
    });
  });

  it('en, edit: "Projects" links to the list; the title and toast say "Project"', async () => {
    expect(await pageText('en', 'edit', 'showcase_project')).toEqual({
      link: 'Projects',
      title: 'Edit Project',
      toast: 'Project updated successfully',
    });
  });

  it('zh-CN, create: the translated plural links to the list; the title and toast keep the translated label', async () => {
    expect(await pageText('zh-CN', 'create', 'showcase_project')).toEqual({
      link: '项目清单',
      title: '新建项目',
      toast: '项目创建成功',
    });
  });

  it('control: an object that declares no plural is named by its label in all three', async () => {
    expect(await pageText('en', 'create', 'showcase_note')).toEqual({
      link: 'Note',
      title: 'Create Note',
      toast: 'Note created successfully',
    });
  });
});
