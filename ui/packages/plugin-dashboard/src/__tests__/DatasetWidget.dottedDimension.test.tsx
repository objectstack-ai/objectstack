// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression for objectui#4053 (migrated from objectstack#5144): a dataset
 * dimension whose `field` is a DOTTED relationship path (`crm_account.industry`)
 * got no select-option resolution at all, so the chart plotted the raw stored
 * enum (`education`, `finance`) — while the SAME field reached as a LOCAL
 * dimension resolved to its option labels (`Education`, `Finance`) beside it on
 * the same dashboard.
 *
 * Mechanism: the widget looks options up as `objSchema.fields[<path>]`, and
 * `objSchema` is the dataset's BASE object. For a dotted path the options live
 * on the RELATED object, so the lookup missed silently and the renderer fell
 * through to the stored value. Nothing errored — end users just read database
 * enum values.
 *
 * The pins below put BOTH dimensions on ONE widget so the split the issue
 * reports side-by-side is a single assertion pair: `industry` (local) and
 * `account_industry` (`crm_account.industry`) carry the SAME option set, so any
 * difference between their rendered categories is the bug and nothing else.
 *
 * Scope boundary: this file ends at "the label is in hand". Whether that label
 * then passes through the i18n bundle is objectstack#5076, deliberately not
 * fixed or asserted here.
 *
 * Like the sibling relabel suite, we register a stub `chart` component to
 * capture the schema the widget hands the renderer rather than asserting on
 * Recharts' SVG (which doesn't lay out in jsdom). This exercises the REAL
 * DatasetWidget + SchemaRenderer.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { DatasetWidget } from '../DatasetWidget';

let capturedChartSchema: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartSchema = props?.schema;
    return null;
  });
});
afterEach(() => {
  cleanup();
  capturedChartSchema = null;
  vi.restoreAllMocks();
});

/** The one option set both dimensions below resolve against. */
const INDUSTRY_OPTIONS = [
  { value: 'education', label: 'Education' },
  { value: 'finance', label: 'Finance' },
];

/**
 * TWO measures on purpose: `buildChartSeries` pivots the second dimension into
 * series only for 2+ dimensions with a SINGLE measure. With two measures the
 * rows pass through in long format, so `schema.data` is exactly the relabeled
 * rows and each dimension's rendered category can be read directly.
 */
const WIDGET = {
  type: 'bar',
  dataset: 'opportunity_metrics',
  dimensions: ['industry', 'account_industry'],
  values: ['total_amount', 'deal_count'],
};

/** Rows as the analytics layer returns them: grouped by the STORED value. */
const valueKeyedSource = () => ({
  queryDataset: vi.fn(async () => ({
    rows: [
      { industry: 'education', account_industry: 'education', total_amount: 10, deal_count: 2 },
      { industry: 'finance', account_industry: 'finance', total_amount: 20, deal_count: 3 },
    ],
    fields: [
      { name: 'industry', type: 'select', label: 'Industry' },
      { name: 'account_industry', type: 'select', label: 'Account Industry' },
      { name: 'total_amount', type: 'number', label: 'Total Amount' },
      { name: 'deal_count', type: 'number', label: 'Deal Count' },
    ],
    object: 'crm_opportunity',
    // The server's dimension → underlying field map. `account_industry` is the
    // dotted one; `industry` is local. This is what the widget resolves against.
    dimensionFields: { industry: 'industry', account_industry: 'crm_account.industry' },
  })),
});

/**
 * Route `GET /api/v1/meta/object/<name>` to a per-object document, recording the
 * object names asked for. A name with no document 404s the way a real server
 * would, so "the walk asked for an object that doesn't exist" stays visible
 * rather than resolving to an empty schema.
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

/** Categories the renderer received for one dimension key, in row order. */
const categoriesOf = (dim: string): unknown[] =>
  ((capturedChartSchema?.data ?? []) as Array<Record<string, unknown>>).map((r) => r[dim]);

describe('DatasetWidget dotted-path dimension label resolution (objectui#4053)', () => {
  /** Base object: a local `industry` select + the `crm_account` relationship. */
  const OPPORTUNITY = {
    name: 'crm_opportunity',
    fields: {
      industry: { type: 'select', options: INDUSTRY_OPTIONS },
      crm_account: { type: 'lookup', reference: 'crm_account' },
    },
  };
  /** The relationship's TARGET object, where the dotted path's options live. */
  const ACCOUNT = {
    name: 'crm_account',
    fields: { industry: { type: 'select', options: INDUSTRY_OPTIONS } },
  };

  it('resolves a dotted dimension against the relationship target, matching the local dimension', async () => {
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY, crm_account: ACCOUNT });

    render(<DatasetWidget widget={WIDGET} dataSource={valueKeyedSource()} />);

    // The local dimension resolves its option labels — this half already worked
    // and must keep working (the issue's widget B).
    await waitFor(() => {
      expect(capturedChartSchema).toBeTruthy();
      expect(categoriesOf('industry')).toEqual(['Education', 'Finance']);
    });

    // The dotted dimension must resolve to the SAME labels (the issue's widget
    // A). Pre-fix this held the raw stored values.
    await waitFor(() => expect(categoriesOf('account_industry')).toEqual(['Education', 'Finance']));
    expect(categoriesOf('account_industry')).not.toContain('education');

    // ...and it got there by reading the TARGET object's metadata, through the
    // same `GET /meta/object/:name` channel the base read already uses — not a
    // new fetch layer.
    expect(requested).toContain('crm_account');
  });

  it('walks MULTI-HOP paths (a.b.field), the shape the dataset designer emits', async () => {
    // ADR-0071: the dataset designer offers `relationship.relationship.field`
    // paths (`useDatasetFields.ts` builds them, capped at 3 hops), so 2-hop
    // paths genuinely reach this resolver — the walk is per-segment, not
    // single-hop special-casing.
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [{ owner_dept: 'rnd', total: 1 }],
        fields: [{ name: 'owner_dept', type: 'select' }, { name: 'total', type: 'number' }],
        object: 'crm_opportunity',
        dimensionFields: { owner_dept: 'crm_account.owner.department' },
      })),
    };
    const { requested } = installMetaRouter({
      crm_opportunity: OPPORTUNITY,
      crm_account: {
        name: 'crm_account',
        fields: { owner: { type: 'lookup', reference: 'crm_user' } },
      },
      crm_user: {
        name: 'crm_user',
        fields: {
          department: { type: 'select', options: [{ value: 'rnd', label: 'Research & Development' }] },
        },
      },
    });

    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['owner_dept'], values: ['total'] }}
        dataSource={src}
      />,
    );

    await waitFor(() =>
      expect(categoriesOf('owner_dept')).toEqual(['Research & Development']),
    );
    // Every hop along the chain was fetched, in order.
    expect(requested).toEqual(['crm_opportunity', 'crm_account', 'crm_user']);
  });

  it('leaves a dotted path to a NON-select target field untouched', async () => {
    // Control: the target field has no `options`, so there is nothing to
    // resolve. The raw value must survive rather than be coerced or dropped.
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [{ site: 'acme.example', total: 1 }],
        fields: [{ name: 'site', type: 'text' }, { name: 'total', type: 'number' }],
        object: 'crm_opportunity',
        dimensionFields: { site: 'crm_account.website' },
      })),
    };
    installMetaRouter({
      crm_opportunity: OPPORTUNITY,
      crm_account: { name: 'crm_account', fields: { website: { type: 'text' } } },
    });

    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['site'], values: ['total'] }}
        dataSource={src}
      />,
    );

    await waitFor(() => expect(categoriesOf('site')).toEqual(['acme.example']));
  });

  it('falls through gracefully when the target object lacks the field', async () => {
    // Control: the relationship resolves but the terminal field is absent —
    // today's behaviour (raw value, no crash) stays exactly as it is.
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [{ ghost: 'education', total: 1 }],
        fields: [{ name: 'ghost', type: 'select' }, { name: 'total', type: 'number' }],
        object: 'crm_opportunity',
        dimensionFields: { ghost: 'crm_account.no_such_field' },
      })),
    };
    installMetaRouter({
      crm_opportunity: OPPORTUNITY,
      crm_account: { name: 'crm_account', fields: {} },
    });

    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['ghost'], values: ['total'] }}
        dataSource={src}
      />,
    );

    await waitFor(() => expect(categoriesOf('ghost')).toEqual(['education']));
  });

  it('falls through gracefully when the relationship segment is not a relationship', async () => {
    // Control: `industry` is a plain select on the base object, so
    // `industry.something` names no relationship at all. No target object can
    // be reached, and the raw value must survive — the walk must not invent an
    // object name out of the segment.
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: [{ bogus: 'education', total: 1 }],
        fields: [{ name: 'bogus', type: 'select' }, { name: 'total', type: 'number' }],
        object: 'crm_opportunity',
        dimensionFields: { bogus: 'industry.nested' },
      })),
    };
    const { requested } = installMetaRouter({ crm_opportunity: OPPORTUNITY });

    render(
      <DatasetWidget
        widget={{ type: 'bar', dataset: 'd', dimensions: ['bogus'], values: ['total'] }}
        dataSource={src}
      />,
    );

    await waitFor(() => expect(categoriesOf('bogus')).toEqual(['education']));
    // Only the base object was ever asked for.
    //
    // Bare (objectui#4487): `bogus` never resolves — the raw value renders BY
    // IDENTITY regardless of whether the base-object read has even been
    // issued yet, so the category wait above is only incidentally ordered
    // before the read. Wait on `requested` itself, not on the category.
    await waitFor(() => expect(requested).toEqual(['crm_opportunity']));
  });
});
