// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression for objectui#4263 — the half of the dotted-dimension gap that
 * objectui#4053 (PR #4261) deliberately did not reach.
 *
 * #4053 fixed the client-side label safety net so a DOTTED dimension path
 * (`crm_account.industry`) resolves its select options against the
 * relationship's target object. That net never runs for table / pivot / metric
 * widgets: the effect opens with `if (isMetric || isTable) { …; return; }`, and
 * the relabeling it feeds is applied only on the chart branch. So on a `table`
 * or `pivot` a dotted dimension still rendered the raw stored enum
 * (`education`), which is exactly the symptom #4053 reports for charts.
 *
 * The ruling on #4263 was a DOTTED-ONLY GAP-FILL:
 *
 *  - For a LOCAL dimension the server resolves the display label (ADR-0021) —
 *    that is why #4053's widget B (a `table`) rendered `Education` correctly.
 *    The client net stayed OFF there, so a table would not double-resolve a
 *    label the server already produced — and, the part that made "unchanged"
 *    literal, issued NO metadata read at all.
 *  - For a DOTTED dimension the server is silent too (that is #4053's premise),
 *    so the value reaches the table unresolved and the client net is the only
 *    resolution available. Pinned red-first below.
 *
 * ## ⚠️ THE LOCAL HALF OF THAT BOUNDARY IS AMENDED — objectui#4330
 *
 * The no-metadata-read half was an acceptance boundary for label RESOLUTION,
 * ruled in that context: "the label already exists, do not produce it twice."
 * It held exactly as long as resolution was the only consumer of the read.
 * objectui#4030 / PR #4324 added a second one — the LOCALE BUNDLE, which is
 * keyed by the option's stored value and therefore needs the option LIST, not
 * the label. Under that pin a zh-CN console rendered `Domestic` in a table cell
 * while the related list beside it rendered 国内, with nothing on the client to
 * translate against (objectui#4330).
 *
 * So the PM amended it deliberately, in the PR that uses it: a table / pivot
 * takes the ONE read needed to feed the SAME seam #4324 landed, for EVERY
 * dimension. Concretely, in this file:
 *
 *  - the LOCAL cell of the mixed test now resolves too — it was pinned as
 *    `education` (raw, because that fixture models a server that did not
 *    resolve it) and now reads `Education`;
 *  - `a LOCAL-only table … resolving nothing` becomes `… issues the ONE read`:
 *    it still renders the server's string untouched under `en`, but the read
 *    that makes it translatable is now expected rather than forbidden;
 *  - the CSV follows its table's cells, as it always has.
 *
 * What did NOT change, and is still pinned here: the dotted walk itself, the
 * multi-hop walk, the METRIC branch's silence (it renders no dimension value,
 * so it resolves nothing and reads nothing), and identity keys — a drill still
 * filters by the stored value. `DatasetWidget.localSelectI18n.test.tsx` is the
 * new behaviour's own suite; this file keeps the #4263 shape so the amendment
 * is legible as a diff.
 *
 * The mixed test still puts BOTH dimension kinds on ONE table widget for the
 * reason the #4053 suite does — the two carry the SAME option set, so any
 * difference between the two rendered cells is the widget's own doing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { DatasetWidget } from '../DatasetWidget';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The one option set the dimensions below resolve against. */
const INDUSTRY_OPTIONS = [
  { value: 'education', label: 'Education' },
  { value: 'finance', label: 'Finance' },
];
const TYPE_OPTIONS = [
  { value: 'partner', label: 'Partner' },
  { value: 'direct', label: 'Direct' },
];

/** Base object: a local `industry` select + the `crm_account` relationship. */
const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    industry: { type: 'select', options: INDUSTRY_OPTIONS },
    crm_account: { type: 'lookup', reference: 'crm_account' },
  },
};
/** The relationship's TARGET object, where the dotted paths' options live. */
const ACCOUNT = {
  name: 'crm_account',
  fields: {
    industry: { type: 'select', options: INDUSTRY_OPTIONS },
    type: { type: 'select', options: TYPE_OPTIONS },
    owner: { type: 'lookup', reference: 'crm_user' },
  },
};

/**
 * Route `GET /api/v1/meta/object/<name>` to a per-object document, recording
 * the object names asked for (so "no resolution was attempted at all" is
 * observable, not just "no relabeling happened"). Mirrors the #4053 suite.
 */
function installMetaRouter(docs: Record<string, unknown>) {
  const requested: string[] = [];
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
    const name = m ? decodeURIComponent(m[1]) : '';
    requested.push(name);
    const doc = docs[name];
    if (!doc) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ item: doc }) };
  });
  global.fetch = fn as any;
  return { requested };
}

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

/** Cell texts of the flat table's first body row, in column order. */
const firstRowCells = (): string[] =>
  Array.from(document.querySelectorAll('tbody tr')[0]?.querySelectorAll('td') ?? []).map(
    (td) => td.textContent ?? '',
  );

describe('DatasetWidget dotted-dimension labels on table / pivot (objectui#4263, amended by #4330)', () => {
  it('resolves a DOTTED dimension on a table, and the LOCAL one alongside it (#4330)', async () => {
    // Both dimensions carry the SAME option set. The server sent both
    // value-keyed — for the local one that is the server's own business
    // (ADR-0021 resolution is its job and this fixture models a server that
    // did not do it), for the dotted one it is the #4053 premise.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    render(
      <DatasetWidget
        widget={{
          type: 'table',
          dataset: 'd',
          dimensions: ['industry', 'account_industry'],
          values: ['total_amount'],
        }}
        dataSource={sourceOf({
          rows: [{ industry: 'education', account_industry: 'education', total_amount: 10 }],
          fields: [
            { name: 'industry', type: 'select', label: 'Industry' },
            { name: 'account_industry', type: 'select', label: 'Account Industry' },
            { name: 'total_amount', type: 'number', label: 'Total Amount' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { industry: 'industry', account_industry: 'crm_account.industry' },
        })}
      />,
    );

    // THE GAP: the dotted dimension resolves to its option label. Pre-#4263
    // this cell held the raw stored `education`.
    await waitFor(() => expect(firstRowCells()[1]).toBe('Education'));

    // AMENDED BY #4330 — the local dimension resolves in the same render.
    // Under #4263 this asserted `education`: the client net was OFF for a local
    // dimension because the server owns that label on a table. The read is now
    // issued for every dimension (the locale bundle needs the option list), and
    // resolving a value the server left raw is the same map doing the same
    // thing — value-keyed, idempotent, so a label the server DID resolve is
    // still not touched twice (pinned under `en` in
    // `DatasetWidget.localSelectI18n.test.tsx`).
    expect(firstRowCells()[0]).toBe('Education');

    // It got there through the same `GET /meta/object/:name` channel #4261
    // already uses, walking to the relationship target.
    expect(requested).toEqual(['crm_opportunity', 'crm_account']);
  });

  it('renders a LOCAL-only table exactly as the server sent it, and issues the ONE read (#4330)', async () => {
    // ⚠️ THE AMENDED PIN (objectui#4330). Under #4263 this asserted
    // `expect(requested).toEqual([])` — a local-only table issued NO metadata
    // read at all, which was the acceptance boundary for dotted-dimension
    // label resolution.
    //
    // The boundary now reads: the read IS issued (it is what gives the locale
    // bundle an option list to translate against — see the file header), and
    // what stays untouched is the RENDERED STRING. With no bundle mounted the
    // display equals the authored label, so `buildDimensionLabelMap` emits no
    // key, `relabelDimensions` returns the server's rows BY IDENTITY, and the
    // cell is byte-identical to #4263's. That identity — not the absence of a
    // fetch — is what "no double resolution" means after the amendment.
    //
    // Exactly ONE read: `resolveDimensionFieldMeta` memoizes per call, and a
    // local path never walks a relationship.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    render(
      <DatasetWidget
        widget={{ type: 'table', dataset: 'd', dimensions: ['industry'], values: ['total_amount'] }}
        dataSource={sourceOf({
          // The server DID resolve it (ADR-0021) — this is #4053's widget B.
          rows: [{ industry: 'Education', total_amount: 10 }],
          fields: [
            { name: 'industry', type: 'select', label: 'Industry' },
            { name: 'total_amount', type: 'number', label: 'Total Amount' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { industry: 'industry' },
        })}
      />,
    );

    await waitFor(() => expect(firstRowCells()[0]).toBe('Education'));
    // Bare (objectui#4487): the LOCAL cell renders BY IDENTITY — it does not
    // depend on the metadata read having resolved, or even having been issued
    // yet — so the two are only incidentally ordered. Wait on `requested`
    // itself, not on the cell that happens to precede it.
    await waitFor(() => expect(requested).toEqual(['crm_opportunity']));
  });

  it('resolves BOTH the row and the column dimension of a dotted pivot, keeping server totals aligned', async () => {
    // A pivot's row/column bucket IDS are derived from the same values as its
    // header LABELS, while the server's marginal totals arrive keyed by the raw
    // values. Relabeling one side only would silently break the total lookup —
    // the headers would read `Education` while the row-total cell fell back to
    // `—`. The totals here are what pins that.
    installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    render(
      <DatasetWidget
        widget={{
          type: 'pivot',
          dataset: 'd',
          dimensions: ['acct_industry', 'acct_type'],
          values: ['total'],
        }}
        dataSource={sourceOf({
          rows: [
            { acct_industry: 'education', acct_type: 'partner', total: 5 },
            { acct_industry: 'finance', acct_type: 'direct', total: 7 },
          ],
          fields: [
            { name: 'acct_industry', type: 'select', label: 'Industry' },
            { name: 'acct_type', type: 'select', label: 'Type' },
            { name: 'total', type: 'number', label: 'Total' },
          ],
          object: 'crm_opportunity',
          dimensionFields: {
            acct_industry: 'crm_account.industry',
            acct_type: 'crm_account.type',
          },
          totals: [
            {
              dimensions: ['acct_industry'],
              rows: [
                { acct_industry: 'education', total: 5 },
                { acct_industry: 'finance', total: 7 },
              ],
            },
            {
              dimensions: ['acct_type'],
              rows: [
                { acct_type: 'partner', total: 5 },
                { acct_type: 'direct', total: 7 },
              ],
            },
            { dimensions: [], rows: [{ total: 12 }] },
          ],
        })}
      />,
    );

    const matrix = await screen.findByTestId('dataset-matrix');
    // Row dimension (down the side) resolves.
    await waitFor(() => {
      const rowCells = Array.from(matrix.querySelectorAll('tbody tr td')).map((td) => td.textContent);
      expect(rowCells).toContain('Education');
      expect(rowCells).toContain('Finance');
    });
    // Column dimension (across the top) resolves too.
    const headers = Array.from(matrix.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toContain('Partner');
    expect(headers).toContain('Direct');
    expect(headers).not.toContain('partner');

    // …and the server's row totals still find their bucket after the relabel.
    const rowTotals = within(matrix).getAllByTestId('matrix-row-total').map((td) => td.textContent);
    expect(rowTotals).toEqual(['5', '7']);
    expect(within(matrix).getByTestId('matrix-grand-total').textContent).toBe('12');
  });

  it('walks a MULTI-HOP dotted path on a table (a.b.field)', async () => {
    // ADR-0071: the dataset designer emits `relationship.relationship.field`,
    // and #4261's resolver walks per-segment. One pin that the table path gets
    // the same walk, not a single-hop special case.
    const { requested } = installMetaRouter({
      crm_opportunity: OPPORTUNITY,
      crm_account: ACCOUNT,
      crm_user: {
        name: 'crm_user',
        fields: {
          department: { type: 'select', options: [{ value: 'rnd', label: 'Research & Development' }] },
        },
      },
    });
    render(
      <DatasetWidget
        widget={{ type: 'table', dataset: 'd', dimensions: ['owner_dept'], values: ['total'] }}
        dataSource={sourceOf({
          rows: [{ owner_dept: 'rnd', total: 1 }],
          fields: [
            { name: 'owner_dept', type: 'select', label: 'Department' },
            { name: 'total', type: 'number', label: 'Total' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { owner_dept: 'crm_account.owner.department' },
        })}
      />,
    );

    await waitFor(() => expect(firstRowCells()[0]).toBe('Research & Development'));
    expect(requested).toEqual(['crm_opportunity', 'crm_account', 'crm_user']);
  });

  it('exports the resolved label for BOTH the dotted and the local column (#4330)', async () => {
    // The CSV is the table's data, so it follows the table's cells — unchanged
    // as a rule, and the cells it follows are the amended ones. Under #4263
    // this expected `education,Education,10`; the local column now resolves for
    // the same reason its cell does. Measures stay numeric either way.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const blobs: any[] = [];
    (URL as any).createObjectURL = (b: any) => { blobs.push(b); return 'blob:x'; };
    (URL as any).revokeObjectURL = () => {};
    try {
      installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
      render(
        <DatasetWidget
          widget={{
            type: 'table',
            dataset: 'd',
            dimensions: ['industry', 'account_industry'],
            values: ['total_amount'],
          }}
          dataSource={sourceOf({
            rows: [{ industry: 'education', account_industry: 'education', total_amount: 10 }],
            fields: [
              { name: 'industry', type: 'select', label: 'Industry' },
              { name: 'account_industry', type: 'select', label: 'Account Industry' },
              { name: 'total_amount', type: 'number', label: 'Total Amount' },
            ],
            object: 'crm_opportunity',
            dimensionFields: { industry: 'industry', account_industry: 'crm_account.industry' },
          })}
        />,
      );
      // Wait for the resolution to land before exporting.
      await waitFor(() => expect(firstRowCells()[1]).toBe('Education'));
      fireEvent.click(await screen.findByTestId('dataset-export'));
      expect(blobs).toHaveLength(1);
      // downloadCsv prepends a UTF-8 BOM so Excel reads non-ASCII labels.
      const text: string = (await blobs[0].text()).replace(/^\uFEFF/, '');
      const [, body] = text.split('\r\n');
      expect(body).toBe('Education,Education,10');
    } finally {
      (URL as any).createObjectURL = origCreate;
      (URL as any).revokeObjectURL = origRevoke;
    }
  });

  it('METRIC: the branch renders no dimension value at all, so there is nothing to resolve', async () => {
    // Measured verdict for the metric third of this card. `METRIC_TYPES`
    // (metric/kpi/gauge/solid-gauge/bullet) renders ONE measure value plus the
    // measure's header label — a dimension's value never reaches the DOM, in
    // any spelling. So a dotted dimension on a metric has no raw value on
    // screen to resolve: the gap the issue describes for table/pivot is empty
    // here, and turning the resolution on would be a metadata fetch whose
    // result nothing reads.
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });
    const { container } = render(
      <DatasetWidget
        widget={{ type: 'metric', dataset: 'd', dimensions: ['acct_industry'], values: ['total'] }}
        dataSource={sourceOf({
          rows: [{ acct_industry: 'education', total: 5 }],
          fields: [
            { name: 'acct_industry', type: 'select', label: 'Industry' },
            { name: 'total', type: 'number', label: 'Total' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { acct_industry: 'crm_account.industry' },
        })}
      />,
    );

    await waitFor(() => expect(container.textContent).toContain('5'));
    // Neither the raw value nor its label is rendered — the dimension is not
    // part of this branch's output.
    expect(container.textContent).not.toContain('education');
    expect(container.textContent).not.toContain('Education');
    // And no resolution was attempted for it.
    expect(requested).toEqual([]);
  });
});
