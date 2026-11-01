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
 *    directory.
 *
 * The REAL pillars and the REAL Setup page; the metadata client is a server
 * double, and the records grid and the object settings panel are stubbed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

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

import { AutomationsPillar, DataPillar, InterfacesPillar } from './StudioDesignSurface';
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

function mePermissions(systemPermissions: string[]): MePermissionsResponse {
  return { authenticated: true, userId: 'u1', tenantId: 'org_1', hasAnyQueue: false, positions: [], permissionSets: [], systemPermissions, objects: {}, fields: {} };
}
const SETUP_ONLY = mePermissions(['manage_org_users', 'setup.access', 'setup.write']);

const ROLLBACK = t('engine.edit.rollback', 'en');

beforeEach(() => {
  for (const fn of Object.values(mockClient)) {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as unknown as { mockClear: () => void }).mockClear();
  }
});

afterEach(cleanup);

type Pillar = 'data' | 'interfaces' | 'automations';
const PILLARS: Array<{ pillar: Pillar; type: string; name: string; ready: () => Promise<unknown> }> = [
  { pillar: 'data', type: 'object', name: 'showcase_account', ready: () => screen.findByTestId('records-panel', undefined, { timeout: 8000 }) },
  { pillar: 'interfaces', type: 'page', name: 'home', ready: () => screen.findByRole('button', { name: 'Select hello' }, { timeout: 8000 }) },
  { pillar: 'automations', type: 'flow', name: 'approval', ready: () => screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 }) },
];

function mountPillar(pillar: Pillar, opts: { readOnly?: boolean; perms?: MePermissionsResponse } = {}) {
  const body =
    pillar === 'data' ? (
      <DataPillar packageId={PKG} readOnly={opts.readOnly} />
    ) : pillar === 'interfaces' ? (
      <InterfacesPillar packageId={PKG} readOnly={opts.readOnly} />
    ) : (
      <AutomationsPillar packageId={PKG} readOnly={opts.readOnly} />
    );
  const routed = <MemoryRouter initialEntries={[`/studio/${PKG}/${pillar}`]}>{body}</MemoryRouter>;
  render(opts.perms ? <MePermissionsProvider initialPermissions={opts.perms}>{routed}</MePermissionsProvider> : routed);
}

/** Click a tool and return the sheet it opened. */
async function openTool(tool: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId(`studio-item-tool-${tool}`, undefined, { timeout: 8000 }));
  return screen.findByTestId(`studio-item-tool-sheet-${tool}`);
}

describe('Studio item toolbar — every pillar opens the five tools (objectstack#28239)', () => {
  it.each(PILLARS)('$pillar: Layers, References, History, Audit and Source open on $type/$name', async ({ pillar, type, name, ready }) => {
    mountPillar(pillar);
    await ready();
    const tools = within(await screen.findByTestId('studio-item-tools', undefined, { timeout: 8000 }));
    expect(tools.getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual([
      'studio-item-tool-layers',
      'studio-item-tool-references',
      'studio-item-tool-history',
      'studio-item-tool-audit',
      'studio-item-tool-source',
    ]);

    const layers = await openTool('layers');
    expect(await within(layers).findByRole('tab', { name: t('engine.layers.diff', 'en') })).toBeInTheDocument();
    expect(mockClient.layered).toHaveBeenCalledWith(type, name, { packageId: PKG });

    const refs = await openTool('references');
    expect(await within(refs).findByText('all_accounts')).toBeInTheDocument();
    expect(mockClient.references).toHaveBeenCalledWith(type, name);

    const history = await openTool('history');
    expect(await within(history).findAllByTitle(ROLLBACK)).toHaveLength(2);
    expect(mockClient.history).toHaveBeenCalledWith(type, name, { limit: 100 });

    await openTool('audit');
    await waitFor(() => expect(mockClient.audit).toHaveBeenCalledWith(type, name, { limit: 100 }));

    const source = await openTool('source');
    const editor = await within(source).findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 });
    expect((editor as HTMLTextAreaElement).value).toContain(`"name": "${name}"`);
    expect(editor).not.toHaveAttribute('readonly');
  });
});

describe('Studio item toolbar — rollback (objectstack#28239)', () => {
  it('asks the in-app confirm, writes through the same rollback door as Setup, and the pillar re-reads the item', async () => {
    mountPillar('data');
    await PILLARS[0]!.ready();
    const history = await openTool('history');
    const buttons = await within(history).findAllByTitle(ROLLBACK);
    const reads = mockClient.layered.mock.calls.filter(([type]) => type === 'object').length;
    // Newest first: the second button is version 1.
    fireEvent.click(buttons[1]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Restore object/showcase_account to version 1?');
    expect(mockClient.rollback).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('history-rollback-confirm-action'));

    await waitFor(() => expect(mockClient.rollback).toHaveBeenCalledWith('object', 'showcase_account', 1));
    expect(mockClient.rollback).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockClient.layered.mock.calls.filter(([type]) => type === 'object').length).toBeGreaterThan(reads),
    );
  });

  it('a read-only package shows its history without rollback, and its source read-only', async () => {
    mountPillar('automations', { readOnly: true });
    await PILLARS[2]!.ready();
    const history = await openTool('history');
    expect(await within(history).findByText('seq 2')).toBeInTheDocument();
    expect(within(history).queryAllByTitle(ROLLBACK)).toHaveLength(0);

    const source = await openTool('source');
    expect(source).toHaveTextContent(t('engine.studio.itemTools.sourceReadOnly', 'en'));
    const editor = await within(source).findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 });
    expect(editor).toHaveAttribute('readonly');
  });

  it('CONTROL: a writable package offers the rollback the read-only one withholds', async () => {
    mountPillar('automations');
    await PILLARS[2]!.ready();
    const history = await openTool('history');
    expect(await within(history).findAllByTitle(ROLLBACK)).toHaveLength(2);
  });
});

describe('Studio item toolbar — History and Audit follow the trail doors (objectstack#28239)', () => {
  it('a setup.access-only caller is offered Layers, References and Source, not History or Audit', async () => {
    mountPillar('data', { perms: SETUP_ONLY });
    await PILLARS[0]!.ready();
    const tools = within(await screen.findByTestId('studio-item-tools', undefined, { timeout: 8000 }));
    expect(tools.getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual([
      'studio-item-tool-layers',
      'studio-item-tool-references',
      'studio-item-tool-source',
    ]);
  });
});

describe("CONTROL — Setup's item page still opens the five from the shared directory (objectstack#28239)", () => {
  it('Layers, References, History, Audit and Source open on a Setup item', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/setup/metadata/page/home']}>
        <MetadataResourceEditPage type="page" name="home" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTitle(t('engine.edit.layers', 'en'), undefined, { timeout: 8000 }));
    expect(await screen.findByRole('tab', { name: t('engine.layers.diff', 'en') })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle(t('engine.edit.references', 'en')));
    expect(await screen.findByText('all_accounts')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('history-button'));
    expect(await screen.findAllByTitle(ROLLBACK)).toHaveLength(2);

    fireEvent.click(screen.getByTestId('audit-button'));
    await waitFor(() => expect(mockClient.audit).toHaveBeenCalledWith('page', 'home', { limit: 100 }));

    // Setup's source is the inspector's Source tab, beside the open sheet.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: t('engine.edit.inspector.source', 'en') }));
    expect(await screen.findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 })).toBeInTheDocument();
  });
});
