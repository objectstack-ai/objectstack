// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36716: the report builder saves a report an installed app ships
 * into the app's customization package.
 *
 * ## The defect this pins
 *
 * `ReportView.saveSchema` wrote every report edit naming no package, so the
 * save of a report a read-only (installed) package ships addressed that
 * package, and the metadata write door answered 403: the admin's edit was
 * lost at Save. ADR-0146 (D2, D3, D11) and the maintainer's 「定制都进 .custom」
 * decide where such an edit goes: the owning package when it is writable,
 * else the app's customization package `<base>.custom`, declaring the
 * override of its base, the route the in-page dashboard editor already takes
 * (`resolveInPlaceEditTarget`).
 *
 * ## What runs
 *
 * The real `ReportView`, the real `ReportBuilderHost` and the real persistence
 * seam and target resolver, over a metadata client double and the two package
 * doors (the package list, the ensure door) answered here. The builder is
 * reduced to one edit and its buttons, as in `ReportView.saveRefusal-11583`.
 *
 * Direction, written before the run: on the unmodified tree the shipped-report
 * case goes RED (the save names no package and no override), and so does the
 * writable-owner control on its package naming alone (the old save named no
 * package); the unbound case stays GREEN on both trees.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/plugin-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ReportRenderer: () => null,
  ReportBuilder: ({ report, onChange, onSave }: any) => (
    <div data-testid="report-builder" data-chart={String(report?.chart?.type)}>
      <button type="button" data-testid="stub-builder-edit" onClick={() => onChange({ ...report, chart: { type: 'pie' } })}>
        edit
      </button>
      <button type="button" data-testid="report-builder-save" onClick={() => onSave()}>save</button>
    </div>
  ),
}));
vi.mock('./metadata-admin/previews/useDatasetCatalog', () => ({
  useDatasetCatalog: () => ({ datasets: [], loading: false, error: null }),
  useDatasetSemantics: () => ({ dimensions: [], measures: [], loading: false, error: null }),
}));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: () => null,
}));
vi.mock('./RuntimeDraftBar', () => ({ RuntimeDraftBar: () => null }));

// The two package doors the target resolver asks: answered per case.
const doors = vi.hoisted(() => ({
  listed: new Map<string, any>(),
  ensure: null as any,
}));
vi.mock('./studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: vi.fn(async () => doors.listed),
  ensureCustomizationPackage: vi.fn((base: string) => doors.ensure(base)),
}));
const walled = vi.hoisted(() => ({ value: false }));
vi.mock('./studio-design/StudioCustomizeControls', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCustomizeDoorWalled: () => walled.value,
}));

const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'hours_by_status_chart' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/reports/hours_by_status_chart', search: '' }),
}));
vi.mock('./useOpenRecordList', () => ({
  useRecordListDrillNavigation: () => ({ openRecordList: vi.fn(), canOpenRecordList: () => true }),
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
const client = vi.hoisted(() => ({ value: null as any }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => client.value }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

import { ReportView } from './ReportView';
import { ensureCustomizationPackage, fetchListedPackageManifests } from './studio-design/packages-io';

/** The stored report: a dataset-bound chart report, the shape the builder edits. */
const STORED = {
  name: 'hours_by_status_chart',
  label: 'Hours by status (chart)',
  type: 'summary',
  dataset: 'timesheet_metrics',
  rows: ['status'],
  values: ['hours'],
  chart: { type: 'bar' },
};

function listed(entries: Record<string, { writable: boolean; version?: string }>) {
  doors.listed = new Map(
    Object.entries(entries).map(([id, e]) => [id, { writable: e.writable, manifest: { id, version: e.version } }]),
  );
}

function mount(served: Record<string, unknown>) {
  client.value = {
    get: vi.fn(async () => null),
    getDraft: vi.fn(async () => null),
    layered: vi.fn(async () => ({ code: STORED, overlay: null, overlayScope: null, effective: STORED, draft: null })),
    save: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
  };
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [served],
    pages: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  render(<ReportView dataSource={{ find: vi.fn(async () => ({ data: [] })) } as any} />);
}

async function openEditAndSave() {
  fireEvent.click(await screen.findByTestId('report-edit-button'));
  await screen.findByTestId('report-builder');
  fireEvent.click(screen.getByTestId('stub-builder-edit'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('report-builder-save'));
  });
  await waitFor(() => expect(client.value.save).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  walled.value = false;
  doors.ensure = vi.fn(async (base: string) => ({ basePackageId: base, packageId: `${base}.custom`, writable: true }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the report builder saves a package-shipped report into <base>.custom (objectstack#36716)', () => {
  it('a report a read-only package ships is saved and published in the app\'s customization package', async () => {
    listed({ showcase: { writable: false, version: '3.2.0' } });
    mount({ ...STORED, _packageId: 'showcase' });
    await openEditAndSave();

    // The buffer is still read at the package the report is served from.
    expect(client.value.layered).toHaveBeenCalledWith('report', 'hours_by_status_chart', { packageId: 'showcase' });
    expect(client.value.getDraft).toHaveBeenCalledWith('report', 'hours_by_status_chart', { packageId: 'showcase' });
    // The pair is asked of the ensure door at Save, and the save lands there.
    expect(ensureCustomizationPackage).toHaveBeenCalledWith('showcase');
    const [type, name, body, opts] = client.value.save.mock.calls[0];
    expect([type, name, opts]).toEqual([
      'report',
      'hours_by_status_chart',
      { mode: 'draft', ifNoneMatch: '*', packageId: 'showcase.custom' },
    ]);
    expect(body).toMatchObject({ chart: { type: 'pie' }, overrides: { package: 'showcase', basedOn: '3.2.0' } });
    expect(client.value.publish).toHaveBeenCalledWith('report', 'hours_by_status_chart', { packageId: 'showcase.custom' });
    await waitFor(() => expect(screen.queryByTestId('report-builder')).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a report of a writable package is saved in that package, asking no pair (control)', async () => {
    listed({ showcase: { writable: true, version: '3.2.0' } });
    mount({ ...STORED, _packageId: 'showcase' });
    await openEditAndSave();

    expect(ensureCustomizationPackage).not.toHaveBeenCalled();
    const [, , body, opts] = client.value.save.mock.calls[0];
    expect(opts).toEqual({ mode: 'draft', ifNoneMatch: '*', packageId: 'showcase' });
    expect(body).toMatchObject({ chart: { type: 'pie' } });
    expect(body).not.toHaveProperty('overrides');
    expect(client.value.publish).toHaveBeenCalledWith('report', 'hours_by_status_chart', { packageId: 'showcase' });
  });

  it('a report that names no package is saved where it lives, naming none', async () => {
    mount({ ...STORED });
    await openEditAndSave();

    expect(fetchListedPackageManifests).not.toHaveBeenCalled();
    expect(client.value.save.mock.calls[0][3]).toEqual({ mode: 'draft', ifNoneMatch: '*' });
    expect(client.value.publish).toHaveBeenCalledWith('report', 'hours_by_status_chart');
  });

  it('the builder does not open where its Save could not land, and says why', async () => {
    // The owner is not in the package list: no package to save into.
    listed({});
    mount({ ...STORED, _packageId: 'showcase' });
    fireEvent.click(await screen.findByTestId('report-edit-button'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain("The package 'showcase' is not listed.");
    expect(screen.queryByTestId('report-builder')).toBeNull();
    cleanup();
    vi.mocked(toast.error).mockClear();

    // The ensure door is walled for this caller.
    walled.value = true;
    listed({ showcase: { writable: false, version: '3.2.0' } });
    mount({ ...STORED, _packageId: 'showcase' });
    fireEvent.click(await screen.findByTestId('report-edit-button'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('only the platform operator can customize');
    expect(screen.queryByTestId('report-builder')).toBeNull();
    cleanup();
    vi.mocked(toast.error).mockClear();

    // No listed base version to declare the override at.
    walled.value = false;
    listed({ showcase: { writable: false } });
    mount({ ...STORED, _packageId: 'showcase' });
    fireEvent.click(await screen.findByTestId('report-edit-button'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('which version of showcase is installed');
    expect(screen.queryByTestId('report-builder')).toBeNull();
    expect(client.value.save).not.toHaveBeenCalled();
    expect(ensureCustomizationPackage).not.toHaveBeenCalled();
  });
});
