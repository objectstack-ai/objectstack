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
 *    mode refuses with the prompt and the screen keeps one Save/Cancel set.
 *
 * Real subjects: `ReportNewPage` and the shell's design-mode controller. The
 * builder is a stub with a Save and a Close (the real one is
 * `reportBuilder-36374`'s subject); the metadata client and the save door are
 * fakes.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
    onClose: () => void;
    banner?: React.ReactNode;
  }) => (
    <div data-testid="builder">
      {props.banner}
      <button type="button" onClick={() => void props.onSave(DRAFT)}>
        save
      </button>
      <button type="button" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
}));

const saveAndPublish = vi.hoisted(() => vi.fn(async () => 'published' as const));
vi.mock('./runtime-metadata-persistence.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveAndPublishRuntimeMetadata: saveAndPublish,
}));

const client = vi.hoisted(() => ({ get: vi.fn(async () => null) }));
vi.mock('./metadata-admin/useMetadata.js', () => ({ useMetadataClient: () => client }));

const refresh = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../providers/MetadataProvider.js', () => ({
  useMetadata: () => ({ reports: [], loading: false, refresh }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: toastError, success: vi.fn() },
}));

import { ReportNewPage } from './ReportNewPage';
import { DesignModeProvider, useDesignModeController } from '../layout/designMode';

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

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  saveAndPublish.mockClear();
  client.get.mockClear();
  toastError.mockReset();
});
afterEach(() => {
  cleanup();
});

describe('the new-report page saves on its own (objectstack#36692)', () => {
  it('Save creates and publishes the report and lands on its page; nothing speaks of a menu', async () => {
    mount();
    expect(screen.queryByTestId('report-new-adds-to-menu')).toBeNull();
    fireEvent.click(screen.getByText('save'));
    await flush();
    await flush();
    expect(saveAndPublish).toHaveBeenCalledWith(
      'report',
      'payment_analysis',
      { ...DRAFT, name: 'payment_analysis' },
      expect.objectContaining({ metadataClient: client }),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/crm/report/payment_analysis');
  });

  it('Close goes back to the reports index, writing nothing', async () => {
    mount();
    fireEvent.click(screen.getByText('close'));
    await flush();
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(screen.getByTestId('where').textContent).toBe('/apps/crm/reports');
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
