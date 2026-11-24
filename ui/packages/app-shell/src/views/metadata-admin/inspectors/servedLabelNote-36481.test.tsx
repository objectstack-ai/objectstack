// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36481 — a report's name box and a dashboard card's title box say
 * so, before Save, when readers in the session language are served a
 * translation instead of the text saved there.
 *
 * The server's order is not changed (ruling record 6631250894): with no
 * packaged base the bundle answers ahead of an inline entry, and on an
 * installed item a translation the paired `.custom` package ships does. The
 * two cases of the card, each as edit → Save → reload, with the context the
 * hosts build (`servedReportTextOf` on the report page, `servedWidgetTextOf`
 * on the dashboard card panel), so the pairing is the hosts' own:
 *
 *  - no packaged base: the published name is a plain string the bundle
 *    translates; an edit shows the `ifKept` note; after Save and a reload the
 *    published name carries the zh-CN entry and the server still serves the
 *    bundle's text, and the box shows the `kept` note before any edit;
 *  - an override whose pair translates the slot: the published name carries
 *    the zh-CN entry, the pair's translation is served, and the box shows the
 *    `kept` note.
 *
 * Controls: no note where the entry is what is served (an installed item with
 * no pair translation, after #36373), where no translation exists, and on an
 * untouched box over a translated source. The note's prose is not pinned: its
 * kind and the served text it names are.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';
await loadStudioCatalogue('zh');

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

const CATALOG: DatasetCatalogEntry[] = [
  {
    name: 'deal_figures',
    label: '成交数据',
    dimensions: [{ name: 'phase', label: '阶段', type: 'text' }],
    measures: [{ name: 'contract_value', label: '合同额', aggregate: 'sum' }],
  },
];

vi.mock('../previews/useDatasetCatalog', async (importOriginal) => {
  const real = await importOriginal<Record<string, any>>();
  return {
    ...real,
    useDatasetSemantics: () => ({
      dimensions: CATALOG[0].dimensions,
      measures: CATALOG[0].measures,
      loading: false,
      error: null,
    }),
    useDatasetCatalog: (override?: DatasetCatalogEntry[]) => ({ datasets: override ?? CATALOG, loading: false, error: null }),
  };
});

// Pay the dynamic `@objectstack/formula` / `@objectstack/lint` load at collection, never inside a case's
// clocked window (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import { DashboardWidgetInspector } from './DashboardWidgetInspector';
import { servedLabelNote } from './servedLabel';
import { ServedReportTextContext, servedReportTextOf } from '../../studio-design/servedReportText';
import { ServedWidgetTextContext, servedWidgetTextOf } from '../../studio-design/servedDashboardText';

afterEach(cleanup);

const SOURCE = 'Deals by Phase';
/** The translation the server serves for zh-CN: the deployment's bundle, or the pair's. */
const KEPT = '各阶段成交';
const EDIT = '本公司成交分布';

// ─── The report page's panel ─────────────────────────────────────────────────

function report(label: unknown) {
  return { name: 'deals_by_phase', label, type: 'summary', dataset: 'deal_figures', rows: ['phase'], values: ['contract_value'] };
}

/**
 * The report page's editor: the context `ReportView` builds from the published
 * layer and the served row, and a draft the panel's patches land in.
 */
function ReportPage({ published, served }: { published: Record<string, unknown>; served: Record<string, unknown> }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({ ...published });
  return (
    <ServedReportTextContext.Provider value={servedReportTextOf(published, served)}>
      <ReportDefaultInspector
        type="report"
        name="deals_by_phase"
        locale="zh-CN"
        draft={draft}
        onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        readOnly={false}
        datasetCatalogOverride={CATALOG}
      />
    </ServedReportTextContext.Provider>
  );
}

const reportNote = () => screen.queryByTestId('report-label-served-note');

describe('the report page: the name box says when a translation is served instead (objectstack#36481)', () => {
  it('no packaged base: an edit over the bundle translation shows the note before Save', () => {
    render(<ReportPage published={report(SOURCE)} served={report(KEPT)} />);
    // Untouched: the box shows the served translation, nothing to explain yet.
    expect(screen.getByDisplayValue(KEPT)).toBeInTheDocument();
    expect(reportNote()).toBeNull();
    fireEvent.change(screen.getByDisplayValue(KEPT), { target: { value: EDIT } });
    expect(screen.getByDisplayValue(EDIT)).toBeInTheDocument();
    expect(reportNote()).toHaveAttribute('data-note-kind', 'ifKept');
    expect(reportNote()).toHaveTextContent(KEPT);
  });

  it('no packaged base, after Save and reload: the entry is stored, the bundle still served — the kept note, before any edit', () => {
    // What the server serves after the save: the bundle's zh-CN text ahead of the entry.
    render(<ReportPage published={report({ default: SOURCE, 'zh-CN': EDIT })} served={report(KEPT)} />);
    expect(reportNote()).toHaveAttribute('data-note-kind', 'kept');
    expect(reportNote()).toHaveTextContent(KEPT);
  });

  it('an override whose pair translates the name: the kept note', () => {
    render(<ReportPage published={report({ default: SOURCE, 'zh-CN': EDIT })} served={report('定制包译名')} />);
    expect(reportNote()).toHaveAttribute('data-note-kind', 'kept');
    expect(reportNote()).toHaveTextContent('定制包译名');
  });

  it('control: an installed item with no pair translation serves the entry — no note', () => {
    const map = { default: SOURCE, 'zh-CN': EDIT };
    render(<ReportPage published={report(map)} served={report(map)} />);
    expect(screen.getByDisplayValue(EDIT)).toBeInTheDocument();
    expect(reportNote()).toBeNull();
  });

  it('control: no translation for this language — an edit shows no note', () => {
    render(<ReportPage published={report(SOURCE)} served={report(SOURCE)} />);
    fireEvent.change(screen.getByDisplayValue(SOURCE), { target: { value: EDIT } });
    expect(reportNote()).toBeNull();
  });
});

// ─── The dashboard card panel ────────────────────────────────────────────────

function dashboard(title: unknown) {
  return {
    name: 'deal_board',
    widgets: [{ id: 'w1', type: 'bar', title, dataset: 'deal_figures', dimensions: ['phase'], values: ['contract_value'] }],
  };
}

/** The card panel on the dashboard page: the context `DashboardInPageEditor` builds. */
function CardPanel({ published, served }: { published: Record<string, unknown>; served: Record<string, unknown> }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({ ...published });
  return (
    <ServedWidgetTextContext.Provider value={servedWidgetTextOf(published, served)}>
      <DashboardWidgetInspector
        type="dashboard"
        name="deal_board"
        locale="zh-CN"
        draft={draft}
        selection={{ kind: 'widget', id: 'w1' }}
        onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
      />
    </ServedWidgetTextContext.Provider>
  );
}

const cardNote = () => screen.queryByTestId('widget-title-served-note');

describe('the dashboard card panel: the title box says when a translation is served instead (objectstack#36481)', () => {
  it('no packaged base: an edit over the bundle translation shows the note before Save, described by the box', () => {
    render(<CardPanel published={dashboard(SOURCE)} served={dashboard(KEPT)} />);
    const box = screen.getByDisplayValue(KEPT);
    expect(cardNote()).toBeNull();
    fireEvent.change(box, { target: { value: EDIT } });
    expect(cardNote()).toHaveAttribute('data-note-kind', 'ifKept');
    expect(cardNote()).toHaveTextContent(KEPT);
    expect(screen.getByDisplayValue(EDIT)).toHaveAttribute('aria-describedby', 'widget-title-served-note');
  });

  it('no packaged base, after Save and reload: the kept note, before any edit', () => {
    render(<CardPanel published={dashboard({ default: SOURCE, 'zh-CN': EDIT })} served={dashboard(KEPT)} />);
    expect(cardNote()).toHaveAttribute('data-note-kind', 'kept');
    expect(cardNote()).toHaveTextContent(KEPT);
  });

  it('an override whose pair translates the title: the kept note', () => {
    render(<CardPanel published={dashboard({ default: SOURCE, 'zh-CN': EDIT })} served={dashboard('定制包标题')} />);
    expect(cardNote()).toHaveAttribute('data-note-kind', 'kept');
  });

  it('control: the entry is what is served — no note', () => {
    const map = { default: SOURCE, 'zh-CN': EDIT };
    render(<CardPanel published={dashboard(map)} served={dashboard(map)} />);
    expect(cardNote()).toBeNull();
    expect(screen.getByDisplayValue(EDIT)).not.toHaveAttribute('aria-describedby');
  });
});

// ─── The rule, on the pair alone ─────────────────────────────────────────────

describe('servedLabelNote (objectstack#36481)', () => {
  const pair = (authored: unknown, served: unknown) => ({ authored: authored as any, served: served as any });

  it('no pair, or no served text: null', () => {
    expect(servedLabelNote(SOURCE, null, 'zh-CN')).toBeNull();
    expect(servedLabelNote(SOURCE, { authored: SOURCE, served: undefined }, 'zh-CN')).toBeNull();
  });

  it('another language reads its own text: no note for an en reader over a zh entry', () => {
    const map = { default: SOURCE, 'zh-CN': EDIT };
    expect(servedLabelNote(map, pair(map, SOURCE), 'en-US')).toBeNull();
  });

  it('a box whose own text is the served one has nothing to say', () => {
    const map = { default: SOURCE, 'zh-CN': KEPT };
    expect(servedLabelNote(map, pair({ default: SOURCE, 'zh-CN': EDIT }, KEPT), 'zh-CN')).toBeNull();
  });

  it('a base-tag entry counts as this language’s own (the entry an edit replaces)', () => {
    const map = { default: SOURCE, zh: EDIT };
    expect(servedLabelNote(map, pair(map, KEPT), 'zh-CN')).toEqual({ kind: 'kept', served: KEPT });
  });
});
