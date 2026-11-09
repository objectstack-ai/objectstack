// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29729 — the permission matrix's object columns in zh-CN.
 *
 * Three things, over the real editor in both renderings (Setup's environment
 * scope and the Studio Access pillar):
 *
 *  - the column headers spell the action word in zh (创建 … 修改 全部) and keep
 *    the abbreviations in en (C … MA); the legend line that spells the
 *    abbreviations out is drawn only where the headers are abbreviations;
 *  - the headers, their tooltips and the legend are rebuilt once the lazily
 *    fetched zh `studio` catalogue lands. They were memoised on the locale
 *    alone, so a matrix whose first render ran before the catalogue was
 *    resident kept that render's `en` answer: Setup's legend line and every
 *    header tooltip read English in zh-CN;
 *  - Setup's per-object sharing-model chip reads through the catalogue
 *    (`perm.owd.chip`), not a hard-coded `OWD ` prefix.
 *
 * ⛔ No module-scope `loadStudioCatalogue('zh')` here, unlike the sibling
 * suites: the defect only exists while the catalogue is NOT yet resident, so
 * the zh case asserts that precondition first. The `dom` project runs each
 * file isolated, so no other file can have loaded it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { isStudioCatalogueLoaded } from '@object-ui/i18n/namespaces/studio';

const SET = {
  name: 'sales_rep',
  label: 'Sales rep',
  objects: { a_account: { allowRead: true } },
  fields: {},
} as Record<string, unknown>;

function makeClient() {
  return {
    layered: async () => ({ effective: SET, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    withPreviewDrafts() {
      return this;
    },
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

let clientImpl: any;

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true, allowRuntimeCreate: true }],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(() => {
  cleanup();
});

type Rendering = 'setup' | 'studio';

function mount(language: 'zh' | 'en', rendering: Rendering) {
  clientImpl = makeClient();
  const i18n = createI18n({ defaultLanguage: language, detectBrowserLanguage: false, resources: { [language]: {} } });
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter>
        <PermissionMatrixEditPage
          type="permission"
          name="sales_rep"
          {...(rendering === 'studio'
            ? { packageId: 'app.a', studio: { tab: 'objects', onTabChange: () => {} } }
            : {})}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

const ZH_HEADERS = ['创建', '读取', '编辑', '删除', '导出', '转移', '查看 全部', '修改 全部'];
const EN_HEADERS = ['C', 'R', 'U', 'D', 'E', 'Tr', 'VA', 'MA'];

/** The eight object-action headers, in column order, with their tooltips. */
function actionHeaders(): Array<{ text: string; title: string | null }> {
  const pane = screen.getByTestId('perm-matrix-pane');
  return within(pane)
    .getAllByRole('columnheader')
    .filter((th) => th.querySelector('span.break-keep'))
    .map((th) => ({ text: (th.textContent ?? '').trim(), title: th.getAttribute('title') }));
}

describe('the matrix column headers in zh, after the lazy catalogue lands (objectstack#29729)', () => {
  it.each<Rendering>(['setup', 'studio'])(
    '%s: a matrix mounted before the zh catalogue is resident spells the action words, with zh tooltips and no legend line',
    async (rendering) => {
      if (rendering === 'setup') {
        expect(isStudioCatalogueLoaded('zh'), 'precondition: the zh catalogue is not resident yet').toBe(false);
      }
      mount('zh', rendering);
      await screen.findByText('创建', { selector: 'th span' }, { timeout: 8000 });
      const headers = actionHeaders();
      expect(headers.map((h) => h.text)).toEqual(ZH_HEADERS);
      expect(headers[0].title).toBe('创建');
      expect(headers[7].title).toBe('修改所有记录（绕过共享规则）');
      // The headers ARE the words: a legend line would only repeat them.
      expect(screen.queryByTestId('perm-column-legend')).toBeNull();
    },
  );
});

describe('CONTROL — en keeps the abbreviations and their legend line (objectstack#29729)', () => {
  it.each<Rendering>(['setup', 'studio'])('%s: C … MA, spelled out in the legend line', async (rendering) => {
    mount('en', rendering);
    await screen.findByText('Account');
    const headers = actionHeaders();
    expect(headers.map((h) => h.text)).toEqual(EN_HEADERS);
    expect(headers[0].title).toBe('Create');
    const legend = screen.getByTestId('perm-column-legend');
    expect(legend).toHaveTextContent('VA');
    expect(legend).toHaveTextContent(rendering === 'setup' ? 'View All Records' : 'View all');
  });
});

describe("Setup's sharing-model chip reads through the catalogue (objectstack#29729)", () => {
  it('zh names the sharing model in Chinese, with no bare OWD', async () => {
    mount('zh', 'setup');
    const chip = await screen.findByText(/^记录共享模型：/u, undefined, { timeout: 8000 });
    expect(chip.textContent).toBe('记录共享模型：私有（默认）');
    expect(chip.textContent).not.toMatch(/OWD/u);
  });

  it('CONTROL — en keeps "OWD {value}"', async () => {
    mount('en', 'setup');
    expect(await screen.findByText('OWD Private (default)')).toBeInTheDocument();
  });
});
