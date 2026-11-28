// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36692 — the new-report builder page is reached from the reports
 * index only, and saves on its own: the design mode no longer hands it a menu
 * place (the maintainer's 「照 Twenty 分开」).
 *
 *  - Save creates and publishes the report itself and lands on its page; the
 *    page says nothing about a menu;
 *  - Close goes back to the app's reports index;
 *  - while the builder is open it holds the design mode out, so entering the
 *    mode refuses with the prompt and the screen keeps one Save/Cancel set;
 *  - reached with the mode already on (the browser's Back), the page draws a
 *    prompt in place of the builder, and the builder opens once the mode is
 *    left.
 *
 * Real subjects: `ReportNewPage` and the shell's design-mode controller. The
 * builder is a stub with a Save and a Close (the real one is
 * `reportBuilder-36374`'s subject); the metadata client and the save door are
 * fakes.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const DRAFT = vi.hoisted(() => ({
  name: '',
  label: 'Payment analysis',
  type: 'summary',
  dataset: 'invoice_metrics',
  values: ['invoice_count'],
  chart: { type: 'metric', xAxis: '', yAxis: 'invoice_count' },
}));

vi.mock('./ReportBuilderHost.js', () => ({
  ReportBuilderHost: (props: {
    onSave: (draft: Record<string, unknown>) => Promise<boolean>;
    onClose: (left: { dirty: boolean }) => void;
    banner?: React.ReactNode;
  }) => (
    <div data-testid="builder">
      {props.banner}
      <button type="button" onClick={() => void props.onSave(DRAFT)}>
        save
      </button>
      <button type="button" onClick={() => props.onClose({ dirty: false })}>
        close
      </button>
      {/* The real host says `dirty` when it holds edits the close would drop. */}
      <button type="button" onClick={() => props.onClose({ dirty: true })}>
        close over an edit
      </button>
    </div>
  ),
}));

const saveAndPublish = vi.hoisted(() => vi.fn(async () => 'published' as const));
vi.mock('./runtime-metadata-persistence.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveAndPublishRuntimeMetadata: saveAndPublish,
}));

const client = vi.hoisted(() => ({
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({ success: true })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({ success: true })),
}));
vi.mock('./metadata-admin/useMetadata.js', () => ({ useMetadataClient: () => client }));

const refresh = vi.hoisted(() => vi.fn(async () => {}));
/** The app `crm` is routed by its name; its package is {@link PKG}. */
const PKG = 'com.example.crm';
vi.mock('../providers/MetadataProvider.js', () => ({
  useMetadata: () => ({ reports: [], apps: [{ name: 'crm', _packageId: 'com.example.crm' }], loading: false, refresh }),
}));

/** The package doors `resolveRuntimeCreatePackage` asks: the listed packages, and the ensure door. */
const doors = vi.hoisted(() => ({
  listed: new Map<string, { writable: boolean }>(),
  ensure: vi.fn(async (_base: string): Promise<{ packageId: string; writable: boolean }> => {
    throw new Error('not asked');
  }),
  listCalls: 0,
}));
vi.mock('./studio-design/packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () => {
    doors.listCalls += 1;
    return doors.listed;
  },
  ensureCustomizationPackage: (base: string) => doors.ensure(base),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const toastError = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: toastError, info: toastInfo, success: vi.fn() },
}));

// The source under test reaches dynamic imports of `@objectstack/lint` (through the
// draft bar's package rule): their first load is paid here, at collection, never
// inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import { ReportNewPage } from './ReportNewPage';
import { DesignModeProvider, useDesignModeController } from '../layout/designMode';
import { loadHanRomanizer } from './metadata-admin/romanizeHan';

// Save first awaits the Han romanizer, a cold dynamic import: its first load is
// paid here, at collection, never inside a case's clock. The save cases also
// wait on what they assert (`waitFor`), never on a count of ticks.
beforeAll(async () => {
  await loadHanRomanizer();
});

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

/** The shell's hold on the design mode, and its door. */
function Shell({ children }: { children: React.ReactNode }) {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      <output data-testid="mode">{mode.active ? 'on' : 'off'}</output>
      <button type="button" onClick={() => mode.enter()}>
        enter design mode
      </button>
      <button type="button" onClick={() => mode.cancel()}>
        cancel design mode
      </button>
      {children}
    </DesignModeProvider>
  );
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/apps/crm/reports', '/apps/crm/reports/new']} initialIndex={1}>
      <Shell>
        <Routes>
          <Route path="/apps/:appName/reports/new" element={<ReportNewPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </Shell>
    </MemoryRouter>,
  );
}

/** A link inside the app, standing in for the browser's Back to `reports/new`. */
function GoNew() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/apps/crm/reports/new')}>
      go to new report
    </button>
  );
}

/** Starts on the reports index, where nothing holds the mode out. */
function mountOnIndex() {
  render(
    <MemoryRouter initialEntries={['/apps/crm/reports']}>
      <Shell>
        <Routes>
          <Route path="/apps/:appName/reports/new" element={<ReportNewPage />} />
          <Route path="*" element={<GoNew />} />
        </Routes>
        <Where />
      </Shell>
    </MemoryRouter>,
  );
}

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  saveAndPublish.mockClear();
  client.get.mockClear();
  client.save.mockClear();
  client.publish.mockClear();
  client.reset.mockClear();
  toastError.mockReset();
  toastInfo.mockReset();
  doors.listed = new Map([[PKG, { writable: true }]]);
  doors.ensure.mockReset();
  doors.ensure.mockImplementation(async () => {
    throw new Error('not asked');
  });
  doors.listCalls = 0;
});

/** Install a `window.confirm` answering `answer` (this DOM ships none); returns it and the restore. */
function installConfirm(answer: boolean) {
  const before = window.confirm;
  const confirm = vi.fn(() => answer);
  window.confirm = confirm as unknown as typeof window.confirm;
  return { confirm, restore: () => (window.confirm = before) };
}
afterEach(() => {
  cleanup();
});

describe('the new-report page saves on its own (objectstack#36692)', () => {
  it('Save creates and publishes the report and lands on its page; nothing speaks of a menu', async () => {
    mount();
    expect(screen.queryByTestId('report-new-adds-to-menu')).toBeNull();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/apps/crm/report/payment_analysis'));
    // objectstack#37261 — where it is saved is pinned by the app's-own-New
    // describe below; here, that it was saved and published once.
    expect(client.save).toHaveBeenCalledTimes(1);
    expect(client.publish).toHaveBeenCalledTimes(1);
  });

  it('Close goes back to the reports index, writing nothing', async () => {
    mount();
    fireEvent.click(screen.getByText('close'));
    await flush();
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(screen.getByTestId('where').textContent).toBe('/apps/crm/reports');
  });

  it('Close over unsaved edits asks first (objectstack#36906): declining stays, agreeing goes back', async () => {
    const { confirm, restore } = installConfirm(false);
    try {
      mount();
      fireEvent.click(screen.getByText('close over an edit'));
      await flush();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('where').textContent).toBe('/apps/crm/reports/new');
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByText('close over an edit'));
      await flush();
      expect(screen.getByTestId('where').textContent).toBe('/apps/crm/reports');
      expect(saveAndPublish).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('while the builder is open, entering the design mode refuses with the prompt', async () => {
    mount();
    fireEvent.click(screen.getByText('enter design mode'));
    await flush();
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
    expect(toastError).toHaveBeenCalledWith('Save or cancel your dashboard or report changes before designing the layout.');
    expect(screen.getByTestId('builder')).toBeInTheDocument();
  });
});

describe('reached with the design mode already on, the page draws no builder (objectstack#36692)', () => {
  it('mode on, then reports/new mounts: no builder and no second Save, the prompt instead', async () => {
    mountOnIndex();
    fireEvent.click(screen.getByText('enter design mode'));
    await flush();
    expect(screen.getByTestId('mode')).toHaveTextContent('on');
    fireEvent.click(screen.getByText('go to new report'));
    await flush();
    expect(screen.getByTestId('where').textContent).toBe('/apps/crm/reports/new');
    expect(screen.getByTestId('mode')).toHaveTextContent('on');
    expect(screen.queryByTestId('builder')).toBeNull();
    expect(screen.queryByText('save')).toBeNull();
    expect(screen.getByTestId('report-new-design-mode')).toBeInTheDocument();
  });

  it('once the mode is left, the builder opens there and holds the mode out', async () => {
    mountOnIndex();
    fireEvent.click(screen.getByText('enter design mode'));
    await flush();
    fireEvent.click(screen.getByText('go to new report'));
    await flush();
    fireEvent.click(screen.getByText('cancel design mode'));
    await flush();
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
    expect(screen.getByTestId('builder')).toBeInTheDocument();
    fireEvent.click(screen.getByText('enter design mode'));
    await flush();
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
    expect(screen.getByTestId('builder')).toBeInTheDocument();
  });

  it('control: with the mode off, reports/new draws the builder and no prompt', async () => {
    mountOnIndex();
    fireEvent.click(screen.getByText('go to new report'));
    await flush();
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
    expect(screen.getByTestId('builder')).toBeInTheDocument();
    expect(screen.getByText('save')).toBeInTheDocument();
    expect(screen.queryByTestId('report-new-design-mode')).toBeNull();
  });
});

describe("the app's own New saves into the app's package, as a new view does (objectstack#37261)", () => {
  // Opened from the app's reports index, outside Studio: the same rule as the
  // Studio leg below and as a new view (`resolveRuntimeCreatePackage`).
  async function saveFromApp() {
    mount();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/apps/crm/report/payment_analysis'));
  }

  it("from an app on a writable package, a new report names that package", async () => {
    await saveFromApp();
    expect(client.save).toHaveBeenCalledWith(
      'report',
      'payment_analysis',
      { ...DRAFT, name: 'payment_analysis' },
      { mode: 'draft', ifNoneMatch: '*', packageId: PKG },
    );
    expect(client.publish).toHaveBeenCalledWith('report', 'payment_analysis', { packageId: PKG });
    expect(doors.ensure).not.toHaveBeenCalled();
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("on an installed (read-only) app, a new report names the base's customization package", async () => {
    doors.listed = new Map([[PKG, { writable: false }]]);
    doors.ensure.mockImplementation(async (base: string) => ({ packageId: `${base}.custom`, writable: true }));
    await saveFromApp();
    expect(doors.ensure).toHaveBeenCalledWith(PKG);
    expect(client.save).toHaveBeenCalledWith(
      'report',
      'payment_analysis',
      { ...DRAFT, name: 'payment_analysis' },
      { mode: 'draft', ifNoneMatch: '*', packageId: `${PKG}.custom` },
    );
    expect(client.publish).toHaveBeenCalledWith('report', 'payment_analysis', { packageId: `${PKG}.custom` });
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  // objectstack#38149 (decisions Q-b of topic objectstack#37424, answered C):
  // the package-less fallback is retired. The ensure door refusing this caller
  // (403) refuses the save with the door's reason, and nothing is written.
  it('control: when the ensure door refuses the caller, Save is refused with its reason and nothing is written', async () => {
    doors.listed = new Map([[PKG, { writable: false }]]);
    doors.ensure.mockImplementation(async () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    });
    mount();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(doors.ensure).toHaveBeenCalledWith(PKG);
    expect(toastError).toHaveBeenCalledWith('form.saveError', { description: expect.stringContaining('Forbidden') });
    expect(client.save).not.toHaveBeenCalled();
    expect(client.publish).not.toHaveBeenCalled();
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).not.toHaveTextContent('/apps/crm/report/payment_analysis');
  });
});

describe("opened from Studio's report list (objectstack#36906, decision 13)", () => {
  const studioList = '/studio/crm/metadata/report?q=pay';
  const fromStudio = `?studio=${encodeURIComponent(studioList)}`;

  function WhereFull() {
    const { pathname, search } = useLocation();
    return <span data-testid="where-full">{`${pathname}${search}`}</span>;
  }

  function mountFromStudio() {
    render(
      <MemoryRouter initialEntries={[`/apps/crm/reports/new${fromStudio}`]}>
        <Shell>
          <Routes>
            <Route path="/apps/:appName/reports/new" element={<ReportNewPage />} />
            <Route path="*" element={null} />
          </Routes>
          <WhereFull />
        </Shell>
      </MemoryRouter>,
    );
  }

  it("the builder's x goes back to the Studio list, writing nothing and asking nothing", async () => {
    const { confirm, restore } = installConfirm(false);
    try {
      mountFromStudio();
      fireEvent.click(screen.getByText('close'));
      await flush();
      expect(confirm).not.toHaveBeenCalled();
      expect(saveAndPublish).not.toHaveBeenCalled();
      expect(screen.getByTestId('where-full').textContent).toBe(studioList);
    } finally {
      restore();
    }
  });

  it("x over unsaved edits asks; declining stays with nothing sent; agreeing goes back to the Studio list", async () => {
    const { confirm, restore } = installConfirm(false);
    try {
      mountFromStudio();
      fireEvent.click(screen.getByText('close over an edit'));
      await flush();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('where-full').textContent).toBe(`/apps/crm/reports/new${fromStudio}`);
      expect(screen.getByTestId('builder')).toBeInTheDocument();
      expect(saveAndPublish).not.toHaveBeenCalled();
      expect(client.save).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByText('close over an edit'));
      await flush();
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('where-full').textContent).toBe(studioList);
      expect(saveAndPublish).not.toHaveBeenCalled();
      expect(client.save).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("Save writes the report into the app's package, where the Studio list finds it", async () => {
    mountFromStudio();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() =>
      expect(screen.getByTestId('where-full').textContent).toBe(`/apps/crm/report/payment_analysis${fromStudio}`),
    );
    expect(client.save).toHaveBeenCalledWith(
      'report',
      'payment_analysis',
      { ...DRAFT, name: 'payment_analysis' },
      { mode: 'draft', ifNoneMatch: '*', packageId: PKG },
    );
    expect(client.publish).toHaveBeenCalledWith('report', 'payment_analysis', { packageId: PKG });
    expect(doors.ensure).not.toHaveBeenCalled();
    // The package-less save is not the one taken, and nothing says it was.
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("on a read-only base, Save writes the report into the base's customization package", async () => {
    doors.listed = new Map([[PKG, { writable: false }]]);
    doors.ensure.mockImplementation(async (base: string) => ({ packageId: `${base}.custom`, writable: true }));
    mountFromStudio();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() =>
      expect(screen.getByTestId('where-full').textContent).toBe(`/apps/crm/report/payment_analysis${fromStudio}`),
    );
    expect(doors.ensure).toHaveBeenCalledWith(PKG);
    expect(client.save).toHaveBeenCalledWith(
      'report',
      'payment_analysis',
      { ...DRAFT, name: 'payment_analysis' },
      { mode: 'draft', ifNoneMatch: '*', packageId: `${PKG}.custom` },
    );
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  // objectstack#38149: as on the app leg, the refusal is said and nothing is written.
  it('control: when the ensure door refuses the caller, Save is refused with its reason and stays on the builder', async () => {
    doors.listed = new Map([[PKG, { writable: false }]]);
    doors.ensure.mockImplementation(async () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    });
    mountFromStudio();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(doors.ensure).toHaveBeenCalledWith(PKG);
    expect(client.save).not.toHaveBeenCalled();
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
    expect(screen.getByTestId('builder')).toBeInTheDocument();
  });

  it("Save lands on the new report's page, which keeps the way back to Studio", async () => {
    mountFromStudio();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() =>
      expect(screen.getByTestId('where-full').textContent).toBe(`/apps/crm/report/payment_analysis${fromStudio}`),
    );
  });
});
