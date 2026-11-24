// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28239 — Studio's item toolbar: the five item tools Setup's item
 * page opens (Layers, References, History with rollback, Audit, Source) on
 * every item of the Data, Interfaces and Automations pillars.
 *
 *  - each pillar's open item opens all five, each reading its own door for
 *    that item;
 *  - a rollback from Studio asks the same in-app confirm Setup asks, writes
 *    through the same `client.rollback`, and the pillar re-reads the item;
 *  - a read-only package shows its history without rollback, and its source
 *    read-only;
 *  - History and Audit follow the authoring-trail doors, as on Setup;
 *  - CONTROL: Setup's item page still opens the five from the shared
 *    directory (as its tabs since objectstack#36901).
 *
 * The REAL pillars and the REAL Setup page; the metadata client is a server
 * double, and the records grid and the object settings panel are stubbed.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches `import('@objectstack/lint')`: paid here, at collection, never inside a test's clock.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const OBJECT = { name: 'showcase_account', label: 'Account', fields: { name: { type: 'text', label: 'Account Name' } } };
const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'active',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};
const APP = { name: 'acme_app', label: 'Acme', navigation: [{ id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' }] };
const HOME = {
  name: 'home',
  label: 'Home',
  type: 'app',
  regions: [{ name: 'main', components: [{ id: 'hello', type: 'element:text', properties: { content: 'Hello' } }] }],
};

const DOCS: Record<string, Record<string, unknown>> = {
  'object/showcase_account': OBJECT,
  'flow/approval': FLOW,
  'app/acme_app': APP,
  'page/home': HOME,
};

const mockClient = vi.hoisted(() => ({
  withPreviewDrafts() {
    return this;
  },
  list: vi.fn(async (type: string) =>
    Object.entries(DOCS)
      .filter(([key]) => key.startsWith(`${type}/`))
      .map(([, doc]) => ({ name: doc.name, label: doc.label })),
  ),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  layered: vi.fn(async (type: string, name: string) => {
    const doc = DOCS[`${type}/${name}`] ?? null;
    return { code: null, overlay: doc, overlayScope: doc ? 'env' : null, effective: doc, lock: 'none' };
  }),
  references: vi.fn(async () => [{ fromType: 'view', fromName: 'all_accounts', path: 'object' }]),
  history: vi.fn(async () => ({
    events: [
      { seq: 2, op: 'update', version: 2, actor: 'ada' },
      { seq: 1, op: 'create', version: 1, actor: 'ada' },
    ],
  })),
  audit: vi.fn(async () => ({ events: [] })),
  rollback: vi.fn(async () => ({ success: true })),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

const SCHEMA = { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } };

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../metadata-admin/useMetadata')>()),
  useMetadataClient: () => mockClient,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      { type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, allowRuntimeCreate: true, schema: SCHEMA },
    ],
  }),
}));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, ObjectView: () => <div data-testid="records-panel" /> };
});

vi.mock('./ObjectSettingsPanel', () => ({ ObjectSettingsPanel: () => <div data-testid="settings-panel" /> }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Monaco's loader fails (offline), so the JSON source editor is its textarea.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
vi.mock('@object-ui/plugin-editor', () => ({ configureBundledMonaco: () => Promise.resolve() }));

import { StudioItemHeader } from './StudioItemHeader';
import { StudioItemTools } from '../item-tools/StudioItemTools';
import { MetadataResourceEditPage } from '../metadata-admin/ResourceEditPage';
import '../../services/builtinComponents.js';
import { t } from '../metadata-admin/i18n';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { PageBlockInspector } from '../metadata-admin/inspectors/PageBlockInspector';
import { PageDefaultInspector } from '../metadata-admin/inspectors/PageDefaultInspector';

const dataSource = createEmptyDataSource();

registerMetadataPreview('page', PagePreview);
registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);

// The Automations pillar's `/automation/_status` probe: "absent", its documented fallback.
vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })));

const ROLLBACK = t('engine.edit.rollback', 'en');

beforeEach(() => {
  for (const fn of Object.values(mockClient)) {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as unknown as { mockClear: () => void }).mockClear();
  }
});

afterEach(cleanup);

describe("CONTROL — Setup's item page still opens the five from the shared directory (objectstack#28239)", () => {
  it('Layers, References, History, Audit and Source open on a Setup item', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/setup/metadata/page/home']}>
        <MetadataResourceEditPage type="page" name="home" />
      </MemoryRouter>,
    );
    // The five are the page's tabs since objectstack#36901: layers read
    // inside Source, the audit log inside History.
    fireEvent.click(await screen.findByTestId('item-tab-source', undefined, { timeout: 8000 }));
    fireEvent.click(screen.getByTestId('item-tab-view-layers'));
    expect(await screen.findByRole('tab', { name: t('engine.layers.diff', 'en') })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('item-tab-references'));
    expect(await screen.findByText('all_accounts')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('item-tab-history'));
    expect(await screen.findAllByTitle(ROLLBACK)).toHaveLength(2);

    fireEvent.click(screen.getByTestId('item-tab-view-audit'));
    await waitFor(() => expect(mockClient.audit).toHaveBeenCalledWith('page', 'home', { limit: 100 }));

    fireEvent.click(screen.getByTestId('item-tab-source'));
    fireEvent.click(screen.getByTestId('item-tab-view-editor'));
    expect(await screen.findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 })).toBeInTheDocument();
  });
});

/**
 * objectstack#29693 — on a row too narrow for the title's twelve characters,
 * the five tools fold into the header's ⋯ menu. Each menu entry opens the same
 * sheet its button opens, reading the same door. The row's geometry is stubbed
 * (no layout here): a 100 px row, the button group 146 px wide, the title's
 * whole text 200 px and its first twelve characters 120 px.
 */
describe('Studio item toolbar — folded into the header’s ⋯ menu, each tool opens the same sheet (objectstack#29693)', () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  const box = (width: number) => ({ left: 0, right: width, width, top: 0, bottom: 32, height: 32, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  beforeEach(() => {
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    spies.push(
      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => box(120)),
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('@container') ? 100 : 0;
      }),
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === 'studio-item-tools' ? box(146) : realRect.call(this);
      }),
      // The title's whole text, wider than its twelve characters.
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.tagName === 'H1' ? 200 : 0;
      }),
    );
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('Layers, References, History, Audit and Source open from the menu on object/showcase_account', async () => {
    render(
      <MemoryRouter>
        <StudioItemHeader
          title="Account"
          foldMenu={{ label: 'More', testId: 'hdr-more' }}
          actions={<StudioItemTools type="object" name="showcase_account" packageId={PKG} locale="en" />}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByTestId('studio-item-tools')).toBeNull());
    const pick = async (tool: string) => {
      fireEvent.pointerDown(screen.getByTestId('hdr-more'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
      fireEvent.click(within(await screen.findByRole('menu')).getByTestId(`studio-item-tool-${tool}`));
      return screen.findByTestId(`studio-item-tool-sheet-${tool}`);
    };
    const close = async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };

    const layers = await pick('layers');
    expect(await within(layers).findByRole('tab', { name: t('engine.layers.diff', 'en') })).toBeInTheDocument();
    expect(mockClient.layered).toHaveBeenCalledWith('object', 'showcase_account', { packageId: PKG });
    await close();

    const refs = await pick('references');
    expect(await within(refs).findByText('all_accounts')).toBeInTheDocument();
    expect(mockClient.references).toHaveBeenCalledWith('object', 'showcase_account');
    await close();

    const history = await pick('history');
    expect(await within(history).findAllByTitle(ROLLBACK)).toHaveLength(2);
    await close();

    await pick('audit');
    await waitFor(() => expect(mockClient.audit).toHaveBeenCalledWith('object', 'showcase_account', { limit: 100 }));
    await close();

    const source = await pick('source');
    const editor = await within(source).findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 });
    expect((editor as HTMLTextAreaElement).value).toContain('"name": "showcase_account"');
  });
});
