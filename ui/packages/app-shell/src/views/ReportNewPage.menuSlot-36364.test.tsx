// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36364 (report half) — the new-report builder page filling the
 * design mode's held menu place: with a slot offered for the app, Save hands
 * the report to it and writes nothing itself, Close cancels the place, and
 * the page says that saving adds the report to the menu. With no slot the
 * page saves on its own, as before.
 *
 * Real subjects: `ReportNewPage` and the slot store. The builder is a stub
 * with a Save and a Close (the real one is `reportBuilder-36374`'s subject);
 * the metadata client, the menu's slot and the save door are fakes.
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

import { ReportNewPage } from './ReportNewPage';
import { offerNewReportSlot, withdrawNewReportSlot, type NewReportSlot } from '../layout/designModeReportSlot';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/apps/crm/object/crm_lead', '/apps/crm/reports/new']} initialIndex={1}>
      <Routes>
        <Route path="/apps/:appName/reports/new" element={<ReportNewPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

let slot: NewReportSlot;
beforeEach(() => {
  saveAndPublish.mockClear();
  client.get.mockClear();
  slot = { appName: 'crm', save: vi.fn(async () => true), cancel: vi.fn() };
});
afterEach(() => {
  withdrawNewReportSlot(slot);
  cleanup();
});

describe('the new-report page for a held menu place (objectstack#36364)', () => {
  it('Save hands the report to the menu, which writes it; the page writes nothing itself', async () => {
    offerNewReportSlot(slot);
    mount();
    expect(screen.getByTestId('report-new-adds-to-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByText('save'));
    await flush();
    await flush();
    expect(slot.save).toHaveBeenCalledWith('payment_analysis', 'Payment analysis', {
      ...DRAFT,
      name: 'payment_analysis',
    });
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/crm/report/payment_analysis');
  });

  it('a save the menu refuses keeps the builder open', async () => {
    slot = { ...slot, save: vi.fn(async () => false) };
    offerNewReportSlot(slot);
    mount();
    fireEvent.click(screen.getByText('save'));
    await flush();
    await flush();
    expect(slot.save).toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/crm/reports/new');
  });

  it('Close cancels the held place and goes back, writing nothing', async () => {
    offerNewReportSlot(slot);
    mount();
    fireEvent.click(screen.getByText('close'));
    await flush();
    expect(slot.cancel).toHaveBeenCalled();
    expect(slot.save).not.toHaveBeenCalled();
    expect(saveAndPublish).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/crm/object/crm_lead');
  });

  it("another app's slot is not this page's: it saves on its own", async () => {
    slot = { ...slot, appName: 'hr' };
    offerNewReportSlot(slot);
    mount();
    expect(screen.queryByTestId('report-new-adds-to-menu')).toBeNull();
    fireEvent.click(screen.getByText('save'));
    await flush();
    await flush();
    expect(slot.save).not.toHaveBeenCalled();
    expect(saveAndPublish).toHaveBeenCalledWith(
      'report',
      'payment_analysis',
      { ...DRAFT, name: 'payment_analysis' },
      expect.objectContaining({ metadataClient: client }),
    );
  });
});
