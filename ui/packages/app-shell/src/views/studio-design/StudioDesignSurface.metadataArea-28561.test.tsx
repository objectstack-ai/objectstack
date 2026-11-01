// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28561 — the "All metadata" area in the builder (ADR-0146 D1):
 * the header links it beside the four pillars, and the builder's body is the
 * area on its route (`/studio/<package>/metadata/*`), which the console mounts
 * as `<StudioDesignSurface area="metadata" />`.
 *
 * The surface and the area are real here, and so is the one package-list read
 * both make (`GET /api/v1/packages`). The metadata-admin pages are stubs that
 * print which page they are and the host the area handed them: what the pages
 * do with the host is pinned beside them (`metadataAreaHost.*-28561.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useMetadataAreaHost } from '../metadata-admin/metadataAreaHost';

const PACKAGE_ID = 'app.r34d';
const KERNEL_ID = 'com.objectstack.platform';
const PHANTOM = 'com.example.nosuch';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_t: string, name: string) => ({ effective: { name } })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

function PageStub({ page }: { page: string }) {
  const host = useMetadataAreaHost();
  return <div data-testid="area-page" data-page={page} data-host={JSON.stringify(host)} />;
}
vi.mock('../metadata-admin/index.js', () => ({
  MetadataDirectoryPage: () => <PageStub page="directory" />,
  MetadataDiagnosticsPage: () => <PageStub page="diagnostics" />,
  MetadataResourceListPage: () => <PageStub page="list" />,
  MetadataResourceEditPage: () => <PageStub page="item" />,
  MetadataResourceHistoryPage: () => <PageStub page="history" />,
}));

/**
 * objectstack#28569 — the area's form editor, a stub printing what the surface
 * hands it (the customization, without its door) and saving a draft on click.
 */
vi.mock('./StudioBundleItemEditor.js', () => ({
  StudioBundleItemEditor: ({
    customization,
    onDraftSaved,
    type,
    name,
  }: {
    customization: { ensure?: unknown } | null;
    onDraftSaved?: (saved?: { type: string; name: string }) => void;
    type: string;
    name: string;
  }) => {
    const { ensure, ...facts } = customization ?? {};
    return (
      <div data-testid="form-editor" data-customization={customization ? JSON.stringify(facts) : 'null'}>
        <span data-testid="form-editor-door">{typeof ensure}</span>
        <button type="button" onClick={() => onDraftSaved?.({ type, name })}>
          save a draft
        </button>
      </div>
    );
  },
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** The package list as the server serves it: one writable app package and one kernel package. */
function servePackages() {
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input) !== '/api/v1/packages') return answer([]);
    return answer({
      success: true,
      data: {
        packages: [
          { manifest: { id: PACKAGE_ID, name: 'Field Ops' }, writable: true },
          { manifest: { id: KERNEL_ID, name: 'Platform', scope: 'system' }, writable: false },
        ],
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** objectstack#28569 — the list with an installed, read-only base that declares its version. */
const BASE_ID = 'com.vendor.hotcrm';
function serveWithBase() {
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input) !== '/api/v1/packages') return answer([]);
    return answer({
      success: true,
      data: {
        packages: [
          { manifest: { id: PACKAGE_ID, name: 'Field Ops' }, writable: true },
          { manifest: { id: BASE_ID, name: 'HotCRM', version: '4.0.0', scope: 'installed' }, writable: false },
        ],
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

/** The console's two builder routes, as `StudioRoute.tsx` declares them. */
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/studio" element={<div data-testid="studio-landing" />} />
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const nav = () => within(screen.getByTestId('studio-pillar-nav'));
async function areaPage() {
  const el = await screen.findByTestId('area-page');
  return { page: el.getAttribute('data-page'), host: JSON.parse(el.getAttribute('data-host') ?? 'null') };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio: the "All metadata" area in the builder (objectstack#28561)', () => {
  it('a pillar links the area beside the four pillars, not current', async () => {
    servePackages();
    renderAt(`/studio/${PACKAGE_ID}/data`);
    const link = await waitFor(() => nav().getByRole('link', { name: t('engine.studio.pillar.metadata', 'en') }));
    expect(link).toHaveAttribute('href', `/studio/${PACKAGE_ID}/metadata`);
    expect(link).not.toHaveAttribute('aria-current');
    expect(nav().getByRole('link', { current: 'page' })).toHaveAttribute('href', `/studio/${PACKAGE_ID}/data`);
  });

  it('the area\'s route: the area is current, no pillar is, and its body is the package\'s directory', async () => {
    const fetchMock = servePackages();
    renderAt(`/studio/${PACKAGE_ID}/metadata`);
    expect(await areaPage()).toEqual({
      page: 'directory',
      host: { packageId: PACKAGE_ID, readOnly: false, basePath: `/studio/${PACKAGE_ID}/metadata` },
    });
    expect(where()).toBe(`/studio/${PACKAGE_ID}/metadata?package=${PACKAGE_ID}`);
    const current = nav().getByRole('link', { current: 'page' });
    expect(current).toHaveAttribute('href', `/studio/${PACKAGE_ID}/metadata`);
    // The builder's header stays: the package chip, its pillars, the area.
    expect(nav().getAllByRole('link')).toHaveLength(5);
    expect(screen.queryByTestId('studio-pillar-not-found')).toBeNull();
    // The surface and the area share the one package-list read.
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/packages')).toHaveLength(1);
  });

  it('the pages below the area\'s root are the area\'s too', async () => {
    servePackages();
    renderAt(`/studio/${PACKAGE_ID}/metadata/translation?package=${PACKAGE_ID}`);
    expect((await areaPage()).page).toBe('list');
    expect(nav().getByRole('link', { current: 'page' })).toHaveAttribute('href', `/studio/${PACKAGE_ID}/metadata`);
  });

  it('a kernel package the switcher hides opens its area read-only', async () => {
    servePackages();
    renderAt(`/studio/${KERNEL_ID}/metadata/agent/a1?package=${KERNEL_ID}`);
    expect(await areaPage()).toEqual({
      page: 'item',
      host: { packageId: KERNEL_ID, readOnly: true, basePath: `/studio/${KERNEL_ID}/metadata` },
    });
  });

  it('a package that is not there has no area either', async () => {
    servePackages();
    renderAt(`/studio/${PHANTOM}/metadata`);
    expect(await screen.findByTestId('studio-package-not-found')).toBeInTheDocument();
    expect(nav().queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByTestId('studio-metadata-area')).toBeNull();
  });
});

describe('the area\'s form editor in the builder (objectstack#28569)', () => {
  it('on a read-only base, the editor is handed the surface\'s customization: the base, its version and the door', async () => {
    serveWithBase();
    renderAt(`/studio/${BASE_ID}/metadata/email_template/welcome?package=${BASE_ID}&member=zh-CN`);
    const editor = await screen.findByTestId('form-editor', undefined, { timeout: 8000 });
    await waitFor(() => expect(editor.getAttribute('data-customization')).not.toBe('null'));
    expect(JSON.parse(editor.getAttribute('data-customization') ?? 'null')).toEqual({
      base: BASE_ID,
      baseLabel: 'HotCRM',
      basedOn: '4.0.0',
      walled: false,
      pairId: null,
      // objectstack#28572 — the base's served customization read, which the rails mark rows from.
      marks: expect.any(Object),
    });
    expect(screen.getByTestId('form-editor-door')).toHaveTextContent('function');
  });

  it('on a writable package, the editor has no customization, and its saved draft counts in the header', async () => {
    serveWithBase();
    renderAt(`/studio/${PACKAGE_ID}/metadata/translation/ui_en?package=${PACKAGE_ID}`);
    const editor = await screen.findByTestId('form-editor', undefined, { timeout: 8000 });
    expect(editor).toHaveAttribute('data-customization', 'null');
    expect(screen.queryByTestId('studio-changes-count')).toBeNull();
    fireEvent.click(within(editor).getByRole('button', { name: 'save a draft' }));
    // The header counts the draft the save wrote, before its own re-read answers.
    expect(await screen.findByTestId('studio-changes-count')).toHaveTextContent('1');
  });
});
