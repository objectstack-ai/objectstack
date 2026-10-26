/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13470 — a report whose `label` and `description` are the spec's
 * inline locale map (`I18nLabel`, `{ 'zh-CN', en }`) opens, in the viewer's
 * language.
 *
 * ## The defect
 *
 * `ReportSchema` in `@objectstack/spec` types both keys as `I18nLabelSchema`,
 * so the map parses and publishes clean, and the `/meta` read serves it
 * unchanged. `ReportView` drew `label` as the page heading and `description`
 * under it as given: React refused the object as a child (error #31) and the
 * report page was blank for every viewer. The drill drawer's title fell back
 * to `String(label)`, which reads `[object Object]`.
 *
 * ## Discrimination
 *
 * The report carries the map on both keys, as the card's repro does. Putting
 * either key back raw blanks the page, so every leg goes red; putting the
 * drill title back raw leaves the page up and turns only its own leg red. The
 * zh-CN and en legs read different strings out of the same map, which a
 * resolver that took the first entry, or always `en`, cannot both pass.
 * `PLAIN_STRING_CONTROL` is a report written with plain strings, asserted
 * unchanged in both languages.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DataSource } from '@object-ui/types';

// The report body stands in as one button that drills on the whole report: an
// empty group key, so the drawer is titled by the report itself.
vi.mock('@object-ui/plugin-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ReportRenderer: ({ onDrill }: { onDrill?: (args: unknown) => void }) => (
    <button
      type="button"
      data-testid="report-body"
      onClick={() => onDrill?.({ dataset: 'srm_delivery_metrics', groupKey: {}, object: 'srm_delivery', objectFilter: {} })}
    >
      drill
    </button>
  ),
}));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div data-testid="drill-title">{title}</div> : null,
}));
vi.mock('./ReportConfigPanel', () => ({ ReportConfigPanel: () => null }));

const meta = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'srm_delivery_scorecard' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/report/srm_delivery_scorecard', search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({ get: vi.fn() }) }));
vi.mock('./runtime-metadata-persistence', () => ({ persistRuntimeMetadata: vi.fn() }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

import { ReportView } from './ReportView';

afterEach(cleanup);

/** Each inline map, and what each viewer must read out of it. */
const LABEL_MAP = { 'zh-CN': '供应商交付与质量（按期间）', en: 'Supplier Delivery and Quality by Period' };
const DESCRIPTION_MAP = { 'zh-CN': '按期间统计的准时交付率与质量。', en: 'On-time delivery and quality, per period.' };

/** The card's repro report: a dataset-bound summary with both keys as maps. */
const MAP_REPORT = {
  name: 'srm_delivery_scorecard',
  label: LABEL_MAP,
  description: DESCRIPTION_MAP,
  type: 'summary',
  dataset: 'srm_delivery_metrics',
  rows: ['period', 'supplier'],
  values: ['line_count', 'otd_rate'],
};

/** PLAIN_STRING_CONTROL — the same report written with plain strings. */
const PLAIN = { label: 'Delivery Scorecard', description: 'Shown to buyers first.' };
const PLAIN_REPORT = { ...MAP_REPORT, ...PLAIN };

type Lang = 'en' | 'zh-CN';
const pick = (map: Record<string, string>, lang: Lang) => (lang === 'zh-CN' ? map['zh-CN'] : map.en);

function renderReport(report: Record<string, unknown>, lang: Lang) {
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [report],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  const dataSource = { find: vi.fn(async () => ({ data: [] })) } as unknown as DataSource;
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      <ReportView dataSource={dataSource} />
    </I18nProvider>,
  );
}

describe.each<Lang>(['en', 'zh-CN'])('objectui#13470 — a report with inline locale maps, viewer in %s', (lang) => {
  it('HEADING_MAP_RESOLVES — the page heading is the viewer\'s label', async () => {
    renderReport(MAP_REPORT, lang);
    await screen.findByTestId('report-body');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(pick(LABEL_MAP, lang));
  });

  it('DESCRIPTION_MAP_RESOLVES — the line under the heading is the viewer\'s description', async () => {
    renderReport(MAP_REPORT, lang);
    await screen.findByTestId('report-body');
    expect(screen.getByText(pick(DESCRIPTION_MAP, lang))).toBeInTheDocument();
  });

  it('DRILL_TITLE_MAP_RESOLVES — a whole-report drill titles its drawer with the viewer\'s label', async () => {
    renderReport(MAP_REPORT, lang);
    fireEvent.click(await screen.findByTestId('report-body'));
    expect(await screen.findByTestId('drill-title')).toHaveTextContent(pick(LABEL_MAP, lang));
  });

  it('PLAIN_STRING_CONTROL — a plain-string label and description draw unchanged', async () => {
    renderReport(PLAIN_REPORT, lang);
    fireEvent.click(await screen.findByTestId('report-body'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PLAIN.label);
    expect(screen.getByText(PLAIN.description)).toBeInTheDocument();
    expect(await screen.findByTestId('drill-title')).toHaveTextContent(PLAIN.label);
  });
});
