/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `summary` report with two or more `rows` levels draws per-group subtotals
 * (objectstack-ai/objectstack#27975, triage: the default, no new key).
 *
 * It asks the server for every proper prefix of `rows` through
 * `totals.groupings` and draws each outer group as a header row, its inner rows
 * with the outer value left blank, and the SERVER's subtotal row; the subtotal
 * is placed, never summed here. A one-level summary, a `tabular` and a matrix
 * degraded to this table keep their face, and an answer without the prefix
 * groupings (an older server) draws the plain table.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

type Rows = Array<Record<string, unknown>>;
type Result = {
  rows: Rows;
  object?: string;
  dimensionFields?: Record<string, string>;
  drillRawRows?: Rows;
  drillRanges?: Array<Record<string, { field: string; gte: unknown; lt: unknown }>>;
  totals?: Array<{ dimensions: string[]; rows: Rows }>;
};

function makeSource(result: Result) {
  const selections: Array<Record<string, unknown>> = [];
  return {
    selections,
    queryDataset: vi.fn(async (_dataset: string, selection: Record<string, unknown>) => {
      selections.push(selection);
      return result;
    }),
  };
}

beforeEach(() => {
  // The dimension-label probe reads object metadata over `fetch`; it declares
  // no option fields, so the rows are drawn as the server sent them.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ item: { fields: {} } }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The drawn body, one array of cell texts per row, a spanned cell padded with blanks. */
function bodyCells(): string[][] {
  const table = screen.getByRole('table');
  return Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).flatMap((c) => {
      const span = Number((c as HTMLTableCellElement).colSpan || 1);
      return [c.textContent ?? '', ...Array.from({ length: span - 1 }, () => '')];
    }),
  );
}

// The server's GROUP BY order, inner rows of one owner together.
const TWO_LEVEL: Result = {
  rows: [
    { owner: 'Amy Chen', stage: 'Negotiation', amount: 500 },
    { owner: 'Amy Chen', stage: 'Prospecting', amount: 600 },
    { owner: 'Zoe Admin', stage: 'Proposal', amount: 200 },
  ],
  totals: [
    { dimensions: ['owner'], rows: [{ owner: 'Amy Chen', amount: 1100 }, { owner: 'Zoe Admin', amount: 200 }] },
    { dimensions: [], rows: [{ amount: 1300 }] },
  ],
};

const SUMMARY = {
  name: 'opportunity_funnel_owner_stage',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['owner', 'stage'],
  values: ['amount'],
};

describe('summary report subtotals (objectstack-ai/objectstack#27975)', () => {
  it('a two-level summary asks for the outer prefix grouping and the grand total', async () => {
    const src = makeSource(TWO_LEVEL);
    render(<DatasetReportRenderer report={SUMMARY as never} dataSource={src} />);
    await screen.findByRole('table');
    expect(src.selections[0].totals).toEqual({ groupings: [['owner'], []] });
  });

  it('a three-level summary asks for every proper prefix, outermost first, then the grand total', async () => {
    const src = makeSource({ rows: [{ a: 'x', b: 'y', c: 'z', n: 1 }] });
    render(
      <DatasetReportRenderer report={{ ...SUMMARY, rows: ['a', 'b', 'c'], values: ['n'] } as never} dataSource={src} />,
    );
    await screen.findByRole('table');
    expect(src.selections[0].totals).toEqual({ groupings: [['a'], ['a', 'b'], []] });
  });

  it('draws a header and a server subtotal per outer group, never repeating the outer value', async () => {
    render(<DatasetReportRenderer report={SUMMARY as never} dataSource={makeSource(TWO_LEVEL)} />);
    await screen.findByTestId('dataset-report-total-row');
    expect(bodyCells()).toEqual([
      ['Amy Chen', '', ''],
      ['', 'Negotiation', '500'],
      ['', 'Prospecting', '600'],
      ['Subtotal', '', '1100'],
      ['Zoe Admin', '', ''],
      ['', 'Proposal', '200'],
      ['Subtotal', '', '200'],
      ['Total', '', '1300'],
    ]);
    expect(screen.getAllByTestId('dataset-report-group-header')).toHaveLength(2);
    expect(screen.getAllByTestId('dataset-report-subtotal-row')).toHaveLength(2);
  });

  it('places the server subtotal even where the inner rows would sum to something else', async () => {
    // An `avg` cannot be recombined from its buckets: the drawn subtotal is the
    // server's number, not the sum of the rows above it.
    const result: Result = {
      rows: [
        { owner: 'Amy Chen', stage: 'Negotiation', avg_amount: 10 },
        { owner: 'Amy Chen', stage: 'Prospecting', avg_amount: 30 },
      ],
      totals: [
        { dimensions: ['owner'], rows: [{ owner: 'Amy Chen', avg_amount: 25 }] },
        { dimensions: [], rows: [{ avg_amount: 25 }] },
      ],
    };
    render(<DatasetReportRenderer report={{ ...SUMMARY, values: ['avg_amount'] } as never} dataSource={makeSource(result)} />);
    await screen.findByTestId('dataset-report-subtotal-row');
    expect(bodyCells()[3]).toEqual(['Subtotal', '', '25']);
  });

  it('nests three levels: an inner header and subtotal inside each outer group', async () => {
    const result: Result = {
      rows: [
        { region: 'East', owner: 'Amy', stage: 'Won', n: 2 },
        { region: 'East', owner: 'Amy', stage: 'Lost', n: 1 },
        { region: 'East', owner: 'Bob', stage: 'Won', n: 4 },
      ],
      totals: [
        { dimensions: ['region'], rows: [{ region: 'East', n: 7 }] },
        { dimensions: ['region', 'owner'], rows: [{ region: 'East', owner: 'Amy', n: 3 }, { region: 'East', owner: 'Bob', n: 4 }] },
        { dimensions: [], rows: [{ n: 7 }] },
      ],
    };
    render(
      <DatasetReportRenderer
        report={{ ...SUMMARY, rows: ['region', 'owner', 'stage'], values: ['n'] } as never}
        dataSource={makeSource(result)}
      />,
    );
    await screen.findByTestId('dataset-report-total-row');
    expect(bodyCells()).toEqual([
      ['East', '', '', ''],
      ['', 'Amy', '', ''],
      ['', '', 'Won', '2'],
      ['', '', 'Lost', '1'],
      ['', 'Subtotal', '', '3'],
      ['', 'Bob', '', ''],
      ['', '', 'Won', '4'],
      ['', 'Subtotal', '', '4'],
      ['Subtotal', '', '', '7'],
      ['Total', '', '', '7'],
    ]);
  });

  it('draws one group per outer value even when an authored order interleaves them', async () => {
    // `order` by the measure: the server answers by amount, so one owner's rows
    // arrive apart. Groups keep the order of their first row.
    const result: Result = {
      rows: [
        { owner: 'Zoe Admin', stage: 'Proposal', amount: 900 },
        { owner: 'Amy Chen', stage: 'Prospecting', amount: 600 },
        { owner: 'Zoe Admin', stage: 'Qualification', amount: 100 },
      ],
      totals: [
        { dimensions: ['owner'], rows: [{ owner: 'Amy Chen', amount: 600 }, { owner: 'Zoe Admin', amount: 1000 }] },
        { dimensions: [], rows: [{ amount: 1600 }] },
      ],
    };
    render(
      <DatasetReportRenderer
        report={{ ...SUMMARY, order: [{ by: 'amount', direction: 'desc' }] } as never}
        dataSource={makeSource(result)}
      />,
    );
    await screen.findByTestId('dataset-report-total-row');
    expect(bodyCells()).toEqual([
      ['Zoe Admin', '', ''],
      ['', 'Proposal', '900'],
      ['', 'Qualification', '100'],
      ['Subtotal', '', '1000'],
      ['Amy Chen', '', ''],
      ['', 'Prospecting', '600'],
      ['Subtotal', '', '600'],
      ['Total', '', '1600'],
    ]);
  });

  it('an answer without the prefix grouping (older server) draws the plain table, outer value repeated', async () => {
    const result: Result = { ...TWO_LEVEL, totals: [{ dimensions: [], rows: [{ amount: 1300 }] }] };
    render(<DatasetReportRenderer report={SUMMARY as never} dataSource={makeSource(result)} />);
    await screen.findByTestId('dataset-report-total-row');
    expect(bodyCells()).toEqual([
      ['Amy Chen', 'Negotiation', '500'],
      ['Amy Chen', 'Prospecting', '600'],
      ['Zoe Admin', 'Proposal', '200'],
      ['Total', '', '1300'],
    ]);
    expect(screen.queryByTestId('dataset-report-subtotal-row')).not.toBeInTheDocument();
  });

  it('an answer with no totals at all draws the plain table and no total row', async () => {
    render(<DatasetReportRenderer report={SUMMARY as never} dataSource={makeSource({ rows: TWO_LEVEL.rows })} />);
    await screen.findByRole('table');
    expect(bodyCells()).toEqual([
      ['Amy Chen', 'Negotiation', '500'],
      ['Amy Chen', 'Prospecting', '600'],
      ['Zoe Admin', 'Proposal', '200'],
    ]);
  });

  it('a one-level summary keeps the grand-total face: no prefix grouping, no subtotal rows', async () => {
    const src = makeSource({
      rows: [{ owner: 'Amy Chen', amount: 1100 }],
      totals: [{ dimensions: [], rows: [{ amount: 1100 }] }],
    });
    render(<DatasetReportRenderer report={{ ...SUMMARY, rows: ['owner'] } as never} dataSource={src} />);
    await screen.findByTestId('dataset-report-total-row');
    expect(src.selections[0].totals).toEqual({ groupings: [[]] });
    expect(bodyCells()).toEqual([['Amy Chen', '1100'], ['Total', '1100']]);
  });

  it('a tabular report with two levels asks for no totals and repeats the outer value as before', async () => {
    const src = makeSource(TWO_LEVEL);
    render(<DatasetReportRenderer report={{ ...SUMMARY, type: 'tabular' } as never} dataSource={src} />);
    await screen.findByRole('table');
    expect(src.selections[0].totals).toBeUndefined();
    expect(bodyCells()).toEqual([
      ['Amy Chen', 'Negotiation', '500'],
      ['Amy Chen', 'Prospecting', '600'],
      ['Zoe Admin', 'Proposal', '200'],
    ]);
  });

  it('a matrix without columns keeps the grand total only', async () => {
    const src = makeSource(TWO_LEVEL);
    render(<DatasetReportRenderer report={{ ...SUMMARY, type: 'matrix' } as never} dataSource={src} />);
    await screen.findByRole('table');
    expect(src.selections[0].totals).toEqual({ groupings: [[]] });
    expect(screen.queryByTestId('dataset-report-subtotal-row')).not.toBeInTheDocument();
  });

  it('a summary block in a joined report draws its subtotals too', async () => {
    const src = makeSource(TWO_LEVEL);
    render(
      <DatasetReportRenderer
        report={{ name: 'j', type: 'joined', blocks: [{ name: 'b1', ...SUMMARY }] } as never}
        dataSource={src}
      />,
    );
    await screen.findByTestId('dataset-report-total-row');
    expect(src.selections[0].totals).toEqual({ groupings: [['owner'], []] });
    expect(screen.getAllByTestId('dataset-report-subtotal-row')).toHaveLength(2);
  });

  describe('drill', () => {
    const DRILLABLE: Result = {
      ...TWO_LEVEL,
      object: 'opportunity',
      dimensionFields: { owner: 'owner_id', stage: 'stage' },
      drillRawRows: [
        { owner: 'usr_amy', stage: 'negotiation' },
        { owner: 'usr_amy', stage: 'prospecting' },
        { owner: 'usr_zoe', stage: 'proposal' },
      ],
    };

    it('a subtotal row drills by the outer dimension alone', async () => {
      const onDrill = vi.fn();
      render(<DatasetReportRenderer report={SUMMARY as never} dataSource={makeSource(DRILLABLE)} onDrill={onDrill} />);
      fireEvent.click((await screen.findAllByTestId('dataset-report-subtotal-row'))[0]);
      expect(onDrill).toHaveBeenCalledWith({
        dataset: 'opportunity_metrics',
        groupKey: { owner: 'Amy Chen' },
        runtimeFilter: undefined,
        object: 'opportunity',
        objectFilter: { owner_id: 'usr_amy' },
      });
    });

    it('an inner row still drills by every dimension', async () => {
      const onDrill = vi.fn();
      render(<DatasetReportRenderer report={SUMMARY as never} dataSource={makeSource(DRILLABLE)} onDrill={onDrill} />);
      fireEvent.click((await screen.findAllByTestId('dataset-drill-row'))[1]);
      expect(onDrill).toHaveBeenCalledWith(
        expect.objectContaining({
          groupKey: { owner: 'Amy Chen', stage: 'Prospecting' },
          objectFilter: { owner_id: 'usr_amy', stage: 'prospecting' },
        }),
      );
    });

    it("a subtotal over a time-bucketed inner dimension spans its group's buckets", async () => {
      const result: Result = {
        rows: [
          { owner: 'Amy Chen', month: '2026-01', amount: 1 },
          { owner: 'Amy Chen', month: '2026-03', amount: 2 },
        ],
        object: 'opportunity',
        dimensionFields: { owner: 'owner_id' },
        drillRawRows: [{ owner: 'usr_amy' }, { owner: 'usr_amy' }],
        drillRanges: [
          { month: { field: 'close_date', gte: '2026-01-01', lt: '2026-02-01' } },
          { month: { field: 'close_date', gte: '2026-03-01', lt: '2026-04-01' } },
        ],
        totals: [
          { dimensions: ['owner'], rows: [{ owner: 'Amy Chen', amount: 3 }] },
          { dimensions: [], rows: [{ amount: 3 }] },
        ],
      };
      const onDrill = vi.fn();
      render(
        <DatasetReportRenderer
          report={{ ...SUMMARY, rows: ['owner', 'month'] } as never}
          dataSource={makeSource(result)}
          onDrill={onDrill}
        />,
      );
      fireEvent.click(await screen.findByTestId('dataset-report-subtotal-row'));
      expect(onDrill).toHaveBeenCalledWith(
        expect.objectContaining({
          groupKey: { owner: 'Amy Chen' },
          objectFilter: { owner_id: 'usr_amy', close_date: { $gte: '2026-01-01', $lt: '2026-04-01' } },
        }),
      );
    });

    it('a subtotal whose group holds the empty time bucket drops that range: the whole group', async () => {
      const result: Result = {
        rows: [
          { owner: 'Amy Chen', month: '2026-01', amount: 1 },
          { owner: 'Amy Chen', month: null, amount: 2 },
        ],
        object: 'opportunity',
        dimensionFields: { owner: 'owner_id' },
        drillRawRows: [{ owner: 'usr_amy' }, { owner: 'usr_amy' }],
        drillRanges: [{ month: { field: 'close_date', gte: '2026-01-01', lt: '2026-02-01' } }, {}],
        totals: [
          { dimensions: ['owner'], rows: [{ owner: 'Amy Chen', amount: 3 }] },
          { dimensions: [], rows: [{ amount: 3 }] },
        ],
      };
      const onDrill = vi.fn();
      render(
        <DatasetReportRenderer
          report={{ ...SUMMARY, rows: ['owner', 'month'] } as never}
          dataSource={makeSource(result)}
          onDrill={onDrill}
        />,
      );
      fireEvent.click(await screen.findByTestId('dataset-report-subtotal-row'));
      expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({ objectFilter: { owner_id: 'usr_amy' } }));
    });
  });
});
