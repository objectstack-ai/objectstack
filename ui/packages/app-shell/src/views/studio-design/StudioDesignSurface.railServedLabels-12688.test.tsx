// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12688 — on a zh-CN session the Studio Interfaces rail draws the
 * navigation labels the server's `/meta` boundary localized, as the runtime
 * sidebar does, while every editor keeps the authored label.
 *
 * The rail drew the app's navigation from the nav editor's buffer: the app's
 * pending draft, else its `/layers` code layer. No server localizes that
 * layer, so the rail read "Capability Map" beside a sidebar reading 能力地图.
 * The pillar's app load already lists the package's apps through `/meta`,
 * which the server answers translated; the rail now draws that answer's label
 * for every entry whose authored label still equals the published one.
 *
 * The mocked client answers as objectstack does (measured against the
 * showcase): `list('app')` is the `/meta/app?package=…` row, translated for
 * the session's language; `layered('app')` is the authored English layer. The
 * pillar is the real `InterfacesPillar` (the harness of
 * `StudioDesignSurface.interfacesRailLabelMap-11158.test.tsx`).
 *
 *  - zh: the rail heading, the group headings and the rows draw the served
 *    labels, and the leaf the pillar opens is captioned as its row reads;
 *  - zh: the nav editor's card and the nav-item inspector's Label input keep
 *    the authored label, so an edit can never write a served text;
 *  - zh: an entry changed in the draft, and one added there, draw their
 *    authored text beside a served sibling;
 *  - en: the served row equals the authored layer, and the rail reads as
 *    before.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';

const PKG = 'com.example.showcase';

/** The published layer, as `/layers` serves it: authored, never localized. */
const CODE = {
  name: 'showcase_app',
  label: 'Showcase',
  navigation: [
    // The first leaf: the pillar opens it when no `?surface=` is given.
    { id: 'nav_capability_map', type: 'page', label: 'Capability Map', pageName: 'capability_map' },
    { id: 'nav_start_here', type: 'page', label: 'Page Authoring', pageName: 'start_here' },
    {
      id: 'grp_workspace',
      type: 'group',
      label: 'Workspace',
      children: [{ id: 'nav_my_work', type: 'page', label: 'My Work', pageName: 'my_work' }],
    },
  ],
};

/** The same app as `/meta/app?package=…` answers a zh-CN request (`translateApp`). */
const SERVED_ZH = {
  name: 'showcase_app',
  label: '功能展示',
  navigation: [
    { id: 'nav_capability_map', type: 'page', label: '能力地图', pageName: 'capability_map' },
    { id: 'nav_start_here', type: 'page', label: '页面搭建', pageName: 'start_here' },
    {
      id: 'grp_workspace',
      type: 'group',
      label: '工作区',
      children: [{ id: 'nav_my_work', type: 'page', label: '我的工作', pageName: 'my_work' }],
    },
  ],
};

/** What the server answers an en-US request: the showcase's English bundle repeats the authored labels. */
const SERVED_EN = JSON.parse(JSON.stringify(CODE)) as typeof CODE;

const state: { served: unknown; draft: unknown } = { served: SERVED_ZH, draft: null };

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [JSON.parse(JSON.stringify(state.served))] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: JSON.parse(JSON.stringify(CODE)) };
    if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async (type: string) => (type === 'app' && state.draft ? { item: JSON.parse(JSON.stringify(state.draft)) } : null)),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
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

beforeEach(() => {
  state.served = SERVED_ZH;
  state.draft = null;
  for (const fn of Object.values(mockClient)) fn.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderPillar(language: 'en' | 'zh') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Render the pillar in `language`, and return its rail once `firstRow` has rendered. */
async function rail(language: 'en' | 'zh', firstRow: string): Promise<HTMLElement> {
  renderPillar(language);
  const el = await screen.findByTestId('studio-rail-interfaces', undefined, { timeout: 8000 });
  await within(el).findByText(firstRow, undefined, { timeout: 8000 });
  return el;
}

describe('the objectui#12688 fixture is what the spec accepts', () => {
  it('the authored layer, the zh-CN answer and an edited draft all parse against AppSchema', () => {
    expect(AppSchema.safeParse(CODE).success).toBe(true);
    expect(AppSchema.safeParse(SERVED_ZH).success).toBe(true);
    expect(AppSchema.safeParse(editedDraft()).success).toBe(true);
  });
});

describe('objectui#12688 — the zh-CN Interfaces rail draws the served navigation labels', () => {
  it('the heading, the group heading and the rows read as the server localized them', async () => {
    const el = await rail('zh', '能力地图');

    expect(el).toHaveTextContent('功能展示 · 导航');
    expect(within(el).getByText('页面搭建')).toBeInTheDocument();
    expect(within(el).getByText('工作区')).toBeInTheDocument();
    expect(within(el).getByText('我的工作')).toBeInTheDocument();
    for (const authored of ['Showcase', 'Capability Map', 'Page Authoring', 'Workspace', 'My Work']) {
      expect(el).not.toHaveTextContent(authored);
    }
  });

  it('the leaf the pillar opens is captioned with the text its row reads', async () => {
    await rail('zh', '能力地图');
    await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('能力地图'), { timeout: 8000 });
    expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent('能力地图');
  });
});

describe('objectui#12688 — every editor keeps the authored label on the same zh-CN session', () => {
  it('the nav editor card and the nav-item inspector Label input read the authored label', async () => {
    const el = await rail('zh', '能力地图');

    fireEvent.click(within(el).getByTitle('编辑导航(拖拽排序 / 重命名 / 增删)'));
    // The edit-mode card reads the buffer: the authored label, never the served one.
    const card = await within(el).findByTitle(/^Capability Map · /, undefined, { timeout: 8000 });
    expect(within(el).queryByText('能力地图')).toBeNull();
    fireEvent.click(card);

    expect(await screen.findByDisplayValue('Capability Map', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('能力地图')).toBeNull();
  });
});

/** The app's pending draft: one entry renamed, one added. */
function editedDraft() {
  const draft = JSON.parse(JSON.stringify(CODE)) as typeof CODE & { navigation: Array<Record<string, unknown>> };
  draft.navigation[1] = { ...draft.navigation[1], label: 'Page Builder' };
  draft.navigation.push({ id: 'nav_release_notes', type: 'page', label: 'Release Notes', pageName: 'release_notes' });
  return draft;
}

describe('objectui#12688 — an entry changed or added in the draft draws its authored text', () => {
  it('the renamed entry and the added one read as authored, beside a served sibling', async () => {
    state.draft = editedDraft();
    const el = await rail('zh', '能力地图');

    expect(within(el).getByText('Page Builder')).toBeInTheDocument();
    expect(within(el).getByText('Release Notes')).toBeInTheDocument();
    expect(within(el).queryByText('页面搭建')).toBeNull();
    // The unchanged group keeps its served heading.
    expect(within(el).getByText('工作区')).toBeInTheDocument();
  });
});

describe('objectui#12688 — an English session reads as before', () => {
  it('the en-US answer repeats the authored labels, and the rail draws them unchanged', async () => {
    state.served = SERVED_EN;
    const el = await rail('en', 'Capability Map');

    expect(el).toHaveTextContent('Showcase · Navigation');
    for (const authored of ['Page Authoring', 'Workspace', 'My Work']) {
      expect(within(el).getByText(authored)).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Capability Map'), { timeout: 8000 });
  });
});
