// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4330 — a LOCAL select dimension on a table / pivot dataset widget
 * renders the object's authored ENGLISH option label while the related list on
 * the same screen renders the zh-CN translation. The residual of objectui#4030
 * that PR #4324 measured and deliberately left open.
 *
 * ## Why #4324 could not reach it
 *
 * A local dimension arrives SERVER-RESOLVED (ADR-0021: the rows carry the
 * object's authored label, not the stored value), and objectui#4263's landed
 * acceptance pin asserted that this path issues **no metadata read at all**.
 * The locale bundle is keyed by the option's stored value
 * (`{ns}.fieldOptions.<object>.<field>.<value>`), so translating needs the
 * option LIST — i.e. exactly the read that pin forbade. There was nothing on
 * the client to translate against, so the cells stayed English.
 *
 * ## The amended boundary (PM ruling recorded on #4330 at queue time)
 *
 * #4263's no-metadata-read pin was an acceptance boundary for DOTTED-dimension
 * label RESOLUTION — "the label already exists, do not produce it twice" —
 * ruled before the read had a second consumer. #4030 gave it one. The boundary
 * is therefore amended deliberately, in the same PR that uses it: a table /
 * pivot takes the ONE read needed to feed the SAME seam #4324 landed
 * (`resolveDimensionFieldMeta` → `localizeFieldOptions` /
 * `buildDimensionLabelMap` → `relabelDimensions`). One channel, no second
 * dialect. The amended pins live in `DatasetWidget.dottedDimensionTable.test.tsx`
 * (#4263's own file) and in `DatasetWidget.optionLabelI18n.test.tsx` (#4324's
 * restatement of it); this file is the new behaviour.
 *
 * ## Why the read is NOT gated on "a select dimension is present"
 *
 * Measured, not assumed — select-ness is invisible before the read:
 *
 *  - `@objectstack/spec`'s `DatasetDimension.type` is
 *    `string | number | date | boolean | lookup`. There is no `select` member,
 *    so no authored dataset can declare one;
 *  - every select dimension in the live example apps declares `type: 'string'`
 *    (`showcase_task.status` / `.priority`, `showcase_invoice.status`,
 *    `showcase_account.industry` / `.sales_region` — all `Field.select` objects
 *    behind a `type: 'string'` dimension);
 *  - on the wire, `AnalyticsResult.fields[]` types a select column `'string'`
 *    too (the analytics cube registry's `fieldTypeToDimensionType` maps
 *    everything that is not number/boolean/date to `'string'`).
 *
 * So the gate lands on the read's OUTPUT, where it is exact rather than
 * heuristic: `resolveDimensionFieldMeta` yields an entry only for a terminal
 * field that actually carries `options`. `pins the read is issued ONCE …` and
 * `BOUNDARY — a dimension whose field carries no options …` below are that
 * measurement, stated as tests.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *  - the zh-CN cases (cells, pivot headers, pivot totals, CSV) are RED before
 *    the change — they render the authored English label, which IS the bug;
 *  - the drill pin is red too, for a SEQUENCING reason rather than an assertion
 *    one: it waits for the translated cell so the click lands after the
 *    metadata read settles, and that wait is what fails without the seam. Its
 *    assertion — the filter — is direction-independent;
 *  - the `en` case and the no-bundle-entry case are GREEN on both sides. They
 *    are the acceptance boundary: an untranslated app keeps exactly the label
 *    it renders today;
 *  - every pin that counts the READ is red before the change for the direct
 *    reason — the read did not happen. That includes the no-options pin, whose
 *    RENDERED half is green in both directions (`renewal risk` either way) and
 *    whose read-count half is not. The prediction written here first said that
 *    pin was green on both sides; it was measured red on its second assertion
 *    and this line is the correction, not a re-run to fit the sentence. The
 *    distinction is the point of the pin: after this change the read is issued
 *    for a dimension that owns no options, and it resolves nothing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

/** Observe the drill filter without rendering the real drawer. */
const drillFilters: Array<Record<string, unknown>> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: ({ filter }: { filter: Record<string, unknown> }) => {
    drillFilters.push(filter);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  drillFilters.length = 0;
  vi.restoreAllMocks();
});

/** The card's fields, on the card's object — #4030's fixture verbatim. */
const CHANNEL_OPTIONS = [
  { value: 'domestic', label: 'Domestic' },
  { value: 'export', label: 'Export' },
];
const COMPETITOR_OPTIONS = [
  { value: 'cabot', label: 'Cabot' },
  { value: 'orion', label: 'Orion Engineered Carbons' },
  // No bundle entry — the untranslated-option boundary.
  { value: 'birla', label: 'Birla Carbon' },
];

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    sales_channel: { type: 'select', options: CHANNEL_OPTIONS },
    competitor_name: { type: 'select', options: COMPETITOR_OPTIONS },
    // A dimension whose field carries no `options` at all — the read finds
    // nothing for it and it renders exactly as the server sent it.
    owner_note: { type: 'text' },
  },
};

const ZH_BUNDLE = {
  zh: {
    crm: {
      fields: {
        crm_opportunity: { sales_channel: '销售渠道', competitor_name: '竞争对手' },
      },
      fieldOptions: {
        crm_opportunity: {
          sales_channel: { domestic: '国内', export: '出口' },
          competitor_name: { cabot: '卡博特', orion: '欧励隆' },
        },
      },
    },
  },
};

function installMetaRouter(docs: Record<string, unknown>) {
  const requested: string[] = [];
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
    const name = m ? decodeURIComponent(m[1]) : '';
    requested.push(name);
    const doc = docs[name];
    if (!doc) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ item: doc }) };
  }) as any;
  return { requested };
}

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
      {ui}
    </I18nProvider>,
  );
}

/**
 * A flat table over TWO local select dimensions, as the server sends it:
 * ADR-0021 already replaced the stored values with the object's AUTHORED
 * labels, which is precisely why the screen reads English.
 */
const serverResolvedTable = () =>
  sourceOf({
    rows: [
      { sales_channel: 'Domestic', competitor_name: 'Orion Engineered Carbons', deals: 7 },
      { sales_channel: 'Export', competitor_name: 'Cabot', deals: 3 },
    ],
    fields: [
      // `type: 'string'` deliberately — that is what a select dimension is on
      // the wire. See the header: this is the reason the read is not gated on it.
      { name: 'sales_channel', type: 'string', label: 'Sales Channel' },
      { name: 'competitor_name', type: 'string', label: 'Competitor' },
      { name: 'deals', type: 'number', label: 'Deals' },
    ],
    object: 'crm_opportunity',
    dimensionFields: { sales_channel: 'sales_channel', competitor_name: 'competitor_name' },
    drillRawRows: [
      { sales_channel: 'domestic', competitor_name: 'orion' },
      { sales_channel: 'export', competitor_name: 'cabot' },
    ],
  });

/** Cell texts of the flat table's rows, in column order. */
const rowCells = (i: number): string[] =>
  Array.from(document.querySelectorAll('tbody tr')[i]?.querySelectorAll('td') ?? []).map(
    (td) => td.textContent ?? '',
  );

describe('DatasetWidget table — a LOCAL select dimension is localized (objectui#4330)', () => {
  it('renders the zh-CN option labels in the CELLS of a table', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{
          type: 'table',
          dataset: 'd',
          dimensions: ['sales_channel', 'competitor_name'],
          values: ['deals'],
        }}
        dataSource={serverResolvedTable()}
      />,
    );

    await waitFor(() => expect(rowCells(0)[0]).toBe('国内'));
    expect(rowCells(0)[1]).toBe('欧励隆');
    expect(rowCells(1)[0]).toBe('出口');
    expect(rowCells(1)[1]).toBe('卡博特');
    // The authored English label must not survive beside the translation.
    expect(document.body.textContent).not.toContain('Orion Engineered Carbons');
  });

  it('pins the read is issued ONCE for a table, whatever its dimension count', async () => {
    // The gating measurement (see the file header). Two dimensions on one
    // object cost ONE `GET /meta/object/:name`: `resolveDimensionFieldMeta`
    // memoizes per call, so sibling dimensions share the base schema fetch.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{
          type: 'table',
          dataset: 'd',
          dimensions: ['sales_channel', 'competitor_name'],
          values: ['deals'],
        }}
        dataSource={serverResolvedTable()}
      />,
    );
    await waitFor(() => expect(rowCells(0)[0]).toBe('国内'));
    expect(requested).toEqual(['crm_opportunity']);
  });

  it('BOUNDARY — under `en` the table reads exactly what it reads today', async () => {
    // Green on both sides, with the same bundle mounted: an `en` console keeps
    // the object's authored labels. `localizeFieldOptions` /
    // `buildDimensionLabelMap` emit no key when the display equals the authored
    // label, so `relabelDimensions` hands back the server's rows by identity.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'en',
      <DatasetWidget
        widget={{
          type: 'table',
          dataset: 'd',
          dimensions: ['sales_channel', 'competitor_name'],
          values: ['deals'],
        }}
        dataSource={serverResolvedTable()}
      />,
    );

    await waitFor(() => expect(rowCells(0)[1]).toBe('Orion Engineered Carbons'));
    expect(rowCells(0)[0]).toBe('Domestic');
    expect(document.body.textContent).not.toContain('国内');
  });

  it('BOUNDARY — an option the bundle does not carry keeps its authored label', async () => {
    // Green on both sides. Not sequenced on a translated string, so it survives
    // the reverse verification: `Birla Carbon` is what this cell reads with the
    // seam and without it.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'table', dataset: 'd', dimensions: ['competitor_name'], values: ['deals'] }}
        dataSource={sourceOf({
          rows: [{ competitor_name: 'Birla Carbon', deals: 1 }],
          fields: [
            { name: 'competitor_name', type: 'string', label: 'Competitor' },
            { name: 'deals', type: 'number', label: 'Deals' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { competitor_name: 'competitor_name' },
        })}
      />,
    );

    await waitFor(() => expect(rowCells(0)[0]).toBe('Birla Carbon'));
  });

  it('BOUNDARY — a dimension whose field carries no options renders untouched', async () => {
    // The accepted cost of not gating the read on a client-visible "select"
    // signal (there is none — see the header): the read IS issued, and it
    // resolves nothing, so the rows come back by identity. This is the pin that
    // makes "the select gate lands on the read's output" literal.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{ type: 'table', dataset: 'd', dimensions: ['owner_note'], values: ['deals'] }}
        dataSource={sourceOf({
          rows: [{ owner_note: 'renewal risk', deals: 2 }],
          fields: [
            { name: 'owner_note', type: 'string', label: 'Note' },
            { name: 'deals', type: 'number', label: 'Deals' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { owner_note: 'owner_note' },
        })}
      />,
    );

    await waitFor(() => expect(rowCells(0)[0]).toBe('renewal risk'));
    // Bare (objectui#4487): per the file header, this cell's RENDERED half is
    // green in both directions ('renewal risk' either way, since the field
    // carries no options to resolve) — it does not depend on the metadata
    // read having resolved, or even having been issued yet, so the wait above
    // is only incidentally ordered before the read. Wait on `requested`
    // itself, not on the cell.
    await waitFor(() => expect(requested).toEqual(['crm_opportunity']));
  });

  it('a drilled row still filters by the STORED value, AFTER the relabel', async () => {
    // Display translates; identity keys do not (objectui#4263 / #4273).
    //
    // Sequenced on the translated cell, which puts this pin in the RED set for
    // a SEQUENCING reason rather than an assertion one: clicking as soon as the
    // rows exist races the metadata read, and a drill asserted before the
    // relabel lands proves nothing about a drill after it. This fixture arrives
    // server-resolved, so the translation is the only observable "the read
    // settled" signal. The assertion itself is direction-independent — the
    // filter reads `drillRawRows`, which no relabel touches. (#4324's chart
    // drill pin, untouched, still holds the same property green in both
    // directions.)
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{
          type: 'table',
          dataset: 'd',
          dimensions: ['sales_channel', 'competitor_name'],
          values: ['deals'],
        }}
        dataSource={serverResolvedTable()}
      />,
    );

    await waitFor(() => expect(rowCells(0)[0]).toBe('国内'));
    const row = (await screen.findAllByTestId('dataset-drill-row'))[0];
    fireEvent.click(row);
    await waitFor(() => expect(drillFilters.length).toBeGreaterThan(0));
    expect(drillFilters[drillFilters.length - 1]).toMatchObject({
      sales_channel: 'domestic',
      competitor_name: 'orion',
    });
  });

  it('exports the localized dimension cell and the RAW numeric measure', async () => {
    // The CSV follows the table's own cells (objectui#4263's convention, which
    // #4324's own summary restates) — so a localized cell exports localized,
    // and the UTF-8 BOM `downloadCsv` prepends is what makes Excel read it. The
    // measure stays a number, because a CSV is data that must round-trip.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const blobs: any[] = [];
    (URL as any).createObjectURL = (b: any) => { blobs.push(b); return 'blob:x'; };
    (URL as any).revokeObjectURL = () => {};
    try {
      installMetaRouter({ crm_opportunity: OPPORTUNITY });
      renderIn(
        'zh',
        <DatasetWidget
          widget={{
            type: 'table',
            dataset: 'd',
            dimensions: ['sales_channel', 'competitor_name'],
            values: ['deals'],
          }}
          dataSource={serverResolvedTable()}
        />,
      );
      await waitFor(() => expect(rowCells(0)[0]).toBe('国内'));
      fireEvent.click(await screen.findByTestId('dataset-export'));
      expect(blobs).toHaveLength(1);
      const text: string = (await blobs[0].text()).replace(/^\uFEFF/, '');
      const [, body] = text.split('\r\n');
      expect(body).toBe('国内,欧励隆,7');
    } finally {
      (URL as any).createObjectURL = origCreate;
      (URL as any).revokeObjectURL = origRevoke;
    }
  });
});

describe('DatasetWidget pivot — headers AND server totals localize together (objectui#4330)', () => {
  const pivotSource = () =>
    sourceOf({
      rows: [
        { sales_channel: 'Domestic', competitor_name: 'Orion Engineered Carbons', deals: 5 },
        { sales_channel: 'Export', competitor_name: 'Cabot', deals: 7 },
      ],
      fields: [
        { name: 'sales_channel', type: 'string', label: 'Sales Channel' },
        { name: 'competitor_name', type: 'string', label: 'Competitor' },
        { name: 'deals', type: 'number', label: 'Deals' },
      ],
      object: 'crm_opportunity',
      dimensionFields: { sales_channel: 'sales_channel', competitor_name: 'competitor_name' },
      // The server resolves its marginal totals through the SAME ADR-0021 pass
      // it resolves the rows with, so they arrive carrying authored labels too.
      totals: [
        {
          dimensions: ['sales_channel'],
          rows: [
            { sales_channel: 'Domestic', deals: 5 },
            { sales_channel: 'Export', deals: 7 },
          ],
        },
        {
          dimensions: ['competitor_name'],
          rows: [
            { competitor_name: 'Orion Engineered Carbons', deals: 5 },
            { competitor_name: 'Cabot', deals: 7 },
          ],
        },
        { dimensions: [], rows: [{ deals: 12 }] },
      ],
    });

  it('localizes the DOWN axis, the ACROSS headers, and keeps the totals aligned', async () => {
    // The bucket ids the totals lookup uses are derived from the same values
    // the headers display, so relabeling one side only would silently break the
    // other — the headers would read 国内 while every total cell fell back to
    // `—`. The totals are what pin that.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{
          type: 'pivot',
          dataset: 'd',
          dimensions: ['sales_channel', 'competitor_name'],
          values: ['deals'],
        }}
        dataSource={pivotSource()}
      />,
    );

    const matrix = await screen.findByTestId('dataset-matrix');
    await waitFor(() => {
      const down = Array.from(matrix.querySelectorAll('tbody tr td')).map((td) => td.textContent);
      expect(down).toContain('国内');
      expect(down).toContain('出口');
    });
    const headers = Array.from(matrix.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toContain('欧励隆');
    expect(headers).toContain('卡博特');
    expect(headers).not.toContain('Orion Engineered Carbons');

    // …and the server's marginal totals still find their buckets after it.
    const rowTotals = within(matrix).getAllByTestId('matrix-row-total').map((td) => td.textContent);
    expect(rowTotals).toEqual(['5', '7']);
    expect(within(matrix).getByTestId('matrix-grand-total').textContent).toBe('12');
  });
});
