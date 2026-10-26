// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25916, third pass — the References sheet's table headers read
 * `engine.edit.refsCol*` from this module's own `engine.*` table (the Studio
 * carve-out, `packages/i18n/README.md`), so a zh session reads its column
 * names in zh where they were English literals. Control: an English session
 * still reads From type / From name / Path.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { t } from './i18n';

const objectDef = {
  name: 'showcase_account',
  label: 'Account',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

/** A plain packaged entry — this suite is about the References sheet only. */
const LAYERED = {
  code: { ...objectDef, _packageId: 'com.example.showcase', _provenance: 'package' },
  overlay: null,
  effective: { ...objectDef },
  provenance: 'package',
  packageId: 'com.example.showcase',
  editable: true,
  deletable: true,
  resettable: true,
};

/** One reference, so the sheet draws its table. */
const REFERENCE = { fromType: 'view', fromName: 'all_accounts', path: 'data.object' };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  layered: vi.fn(async () => LAYERED),
  reset: vi.fn(async () => ({ success: true })),
  references: vi.fn(async () => [REFERENCE]),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'object',
          name: 'object',
          label: 'Object',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, label: { type: 'string' } },
          },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';

const START_PATH = '/metadata/object/showcase_account';

function editor(language: 'zh' | 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[START_PATH]}>
        <Routes>
          <Route
            path="/metadata/:type/:name"
            element={<MetadataResourceEditPage type="object" name="showcase_account" />}
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Open the References sheet (the lazy load) and return its table's header cells. */
async function headersIn(locale: 'zh-CN' | 'en-US') {
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
  fireEvent.click(await screen.findByTitle(t('engine.edit.references', locale)));
  const name = await screen.findByText('all_accounts');
  const table = name.closest('table') as HTMLElement;
  return within(table).getAllByRole('columnheader').map((th) => th.textContent);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('References sheet column headers (#25916)', () => {
  it('guard: the zh rows are real zh, not English copies', () => {
    for (const key of ['engine.edit.refsColFromType', 'engine.edit.refsColFromName', 'engine.edit.refsColPath']) {
      expect(t(key, 'zh-CN')).not.toBe(t(key, 'en-US'));
      expect(t(key, 'zh-CN')).toMatch(/\p{Script=Han}/u);
    }
  });

  it('a zh session reads the column names in zh', async () => {
    editor('zh');
    expect(await headersIn('zh-CN')).toEqual([
      t('engine.edit.refsColFromType', 'zh-CN'),
      t('engine.edit.refsColFromName', 'zh-CN'),
      t('engine.edit.refsColPath', 'zh-CN'),
    ]);
  });

  it('control: an English session still reads From type / From name / Path', async () => {
    editor('en');
    expect(await headersIn('en-US')).toEqual(['From type', 'From name', 'Path']);
  });
});
