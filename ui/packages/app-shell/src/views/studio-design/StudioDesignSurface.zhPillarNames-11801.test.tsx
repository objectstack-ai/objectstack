// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11801, item 1 — zh-CN names a Studio pillar by the label its tab
 * shows, never by a literal translation of the internal word "pillar" and
 * never by the English tab name.
 *
 * ## What was broken
 *
 * The pillar tab bar renders `t('engine.studio.pillar.<key>', locale)`, which
 * in zh-CN reads 数据 / 自动化 / 界面 / 权限. Two Studio hints named a pillar
 * otherwise: the nav-item inspector's "no objects" line read
 * 「先到 Data 支柱创建」, and the Interfaces pillar's object-leaf hint read
 * 「改字段 / 结构请到 Data 支柱」. 支柱 is a literal rendering of the code word
 * "pillar" that no tab shows, and "Data" is the English tab name. In the
 * second hint "Data" was not in the string table at all: it was a literal
 * `<span>` between the two translated halves, so it read English in every
 * locale whatever the table said.
 *
 * ## The three pins
 *
 * 1. No zh value in the designer string tables contains 支柱. Read through
 *    the extractor `check:i18n-designer-parity` reads with
 *    (`readDesignerPairs`), so the population is the whole table rather than
 *    a list of keys this file would have to keep. Its lit control: the
 *    extractor's zh value for `engine.studio.pillar.data` must be the one
 *    `t()` serves, so an extractor that read nothing cannot pass for "no 支柱".
 * 2. The "no objects" line names the Data pillar by its zh tab label.
 * 3. The object-leaf hint, rendered in zh-CN, names the Data pillar by its zh
 *    tab label and holds no English "Data"; rendered in en-US it is unchanged.
 *
 * ## Why the render pin mounts the pillar rather than composing three `t()`s
 *
 * Composing `pre + label + post` in the test would pass with the literal
 * `<span>Data</span>` still in the component, because the test would be
 * supplying the label the component did not. Only a render reads what the
 * component actually puts between the halves.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
// @ts-expect-error — plain-JS gate script, intentionally untyped (`allowJs: false`)
import { readDesignerPairs } from '../../../../../scripts/check-i18n-designer-table-parity.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const readTables: (root: string) => Map<string, Map<string, string>> = readDesignerPairs;

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const NAV = [{ id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' }];

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: objectDef, code: objectDef };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  withPreviewDrafts() { return this; },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { listStudioCanvasPreviewTypes } from './studio-canvas-preview';

afterEach(cleanup);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const ZH_DATA = t('engine.studio.pillar.data', 'zh-CN');

describe('zh-CN names a pillar by its tab label (objectui#11801)', () => {
  it('no zh value in the designer string tables says 支柱', () => {
    const tables = readTables(REPO_ROOT);
    const zh = tables.get('ENGINE_STRINGS_ZH');
    // Lit control: the extractor reads the table `t()` serves.
    expect(zh?.get('engine.studio.pillar.data')).toBe(ZH_DATA);
    expect(ZH_DATA).toBe('数据');

    const offenders: string[] = [];
    for (const [name, table] of tables) {
      if (!name.endsWith('_ZH')) continue;
      for (const [key, value] of table) if (value.includes('支柱')) offenders.push(`${name} ${key}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the "no objects" hint names the Data pillar by its zh tab label', () => {
    const zh = t('engine.studio.nav.noObjects', 'zh-CN');
    expect(zh).toContain(`「${ZH_DATA}」`);
    expect(zh).not.toMatch(/\bData\b/);
  });
});

function mountPillar(language: 'en' | 'zh') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The hint paragraph under the canvas, found by the words it opens with in either locale. */
const hintText = () =>
  Array.from(document.querySelectorAll('p'))
    .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
    .find((text) => text.startsWith('运行态列表预览') || text.startsWith('Runtime list preview')) ?? '';

describe('the Interfaces object-leaf hint names the Data pillar by its tab label (objectui#11801)', () => {
  it('reads the zh tab label, and no English "Data", under zh-CN', async () => {
    expect(listStudioCanvasPreviewTypes()).toContain('object');
    mountPillar('zh');
    fireEvent.click(await screen.findByTitle('object · showcase_task'));
    await waitFor(() => expect(hintText()).toContain('运行态列表预览'), { timeout: 4000 });
    expect(hintText()).toBe(`运行态列表预览 · 改字段 / 结构请到「${ZH_DATA}」`);
    expect(hintText()).not.toMatch(/\bData\b|支柱/);
  });

  it('is unchanged under en-US', async () => {
    mountPillar('en');
    fireEvent.click(await screen.findByTitle('object · showcase_task'));
    await waitFor(() => expect(hintText()).toContain('Runtime list preview'), { timeout: 4000 });
    expect(hintText()).toBe('Runtime list preview · edit fields / structure in the Data pillar');
  });
});
