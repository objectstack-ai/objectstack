// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5587 — `ObjectChart` reads `fieldOptionLabel` DIRECTLY and still
 * fetches exactly once.
 *
 * `fetchData` used to hide that resolver behind a ref, because
 * `useSafeFieldLabel()` handed back a fresh object on every render outside an
 * i18next provider (objectui#5564). A direct dependency therefore made
 * `fetchData` fresh on every render, and the effect that depends on `fetchData`
 * refetched on every render — an unbounded loop, which is what the ref was
 * written to stop.
 *
 * `useObjectLabel`'s memo now holds on BOTH paths, so the ref is dead weight
 * and the dependency can be honest. This file is what pins that: it asserts a
 * FETCH COUNT across forced re-renders, not rendered output. Nothing renders
 * wrong when the loop is present — the chart just refetches forever — so an
 * output assertion is green against the defect.
 *
 * Ablation, run while writing this file: revert `packages/i18n/src/useObjectLabel.ts`
 * to its pre-#5585 state and both cases below go red with a fetch count in the
 * dozens instead of 1.
 *
 * NOTE ON ORDER: `createI18n` registers its instance as react-i18next's
 * process-global, and `useTranslation` falls back to that global when no
 * context supplies one. The no-provider case therefore runs FIRST, and asserts
 * the raw option label rather than the localized one — if an instance ever
 * leaked into it, that assertion fails instead of the case quietly becoming a
 * second test of the with-provider path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';

let lastSchema: any = null;

vi.mock('../ChartRenderer', () => ({
  ChartRenderer: (props: any) => {
    lastSchema = props.schema;
    return null;
  },
}));

import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectChart } from '../ObjectChart';

/** The option-color probe ObjectChart fires on the GLOBAL fetch, answered from a double. */
function installMetaFetchDouble() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      return { ok: true, json: async () => ({}) };
    }),
  );
  return calls;
}

let metaCalls: string[] = [];

beforeEach(() => {
  metaCalls = installMetaFetchDouble();
});

afterEach(() => {
  expect(metaCalls.filter((u) => u !== '/api/v1/meta/object/deal')).toEqual([]);
  vi.unstubAllGlobals();
  lastSchema = null;
});

/** Stable module-level schema — a fresh object per render would move `fetchData`'s OTHER deps. */
const SCHEMA = {
  type: 'object-chart' as const,
  objectName: 'deal',
  chartType: 'bar' as const,
  aggregate: { field: 'amount', function: 'sum' as const, groupBy: 'stage' },
  xAxisKey: 'stage',
};

/**
 * A `select` groupBy field, so `resolveGroupByLabels` takes the branch that
 * calls the resolver under test with the option's own label as the fallback.
 */
const OBJECT_SCHEMA = {
  fields: {
    stage: { type: 'select', options: [{ value: 'won', label: 'Won' }] },
  },
};

const RAW_OPTION_LABEL = 'Won';
const LOCALIZED_OPTION_LABEL = 'Won (localized)';

/** Both fetching entry points ObjectChart drives per data load, counted. */
const makeSource = () => ({
  aggregate: vi.fn(async () => [{ stage: 'won', amount: 120 }]),
  getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
});

/**
 * The schema reads one data load makes: one per reader. The groupBy label leg
 * of `fetchData` reads the schema after the aggregate, and since objectui#13039
 * the option-colour effect reads it through `getObjectSchema` too (it used to
 * fetch `/meta/object/NAME` raw), so this double, which counts calls rather than
 * joining them as the adapter's cache does, sees both. Neither re-runs on a
 * re-render; under the loop this file guards, the count is in the dozens.
 */
const SCHEMA_READS_PER_LOAD = 2;

/**
 * Let anything the render just scheduled actually run.
 *
 * Deliberately a plain timer rather than `act(async …)`: a refetch loop
 * regenerates work as fast as act drains it, so an exhaustive drain would hang
 * instead of failing. A fixed window lets the count be READ — under the loop it
 * is in the dozens, and the assertion reports that number.
 */
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mount, wait for the first load, force three more renders of the same tree,
 * and report how many times the data source was asked.
 */
async function countFetchesAcrossRerenders(wrap: (chart: React.ReactElement) => React.ReactElement) {
  const src = makeSource();
  // The `tick` used to ride on `ObjectChart` as a bare `tick={n}` prop, which
  // only compiled because the component was published as `(props: any)`
  // (objectui#7946). It is spelled `data-tick` now, and ⚠️ the reason that
  // compiles is worth stating exactly rather than approximately: TypeScript does
  // not check JSX attribute names containing a hyphen against the component's
  // prop type at all, so `data-tick` is accepted by the anchored
  // `ObjectChartProps` without being declared on it. It still does not reach the
  // component — `ObjectChart` reads only `schema` / `dataSource` /
  // `onSegmentClick` — which is fine, because its only job is to make each
  // rendered element distinct. What the test measures (re-render count vs fetch
  // count) is unchanged.
  const tree = (tick: number) => wrap(<ObjectChart key="chart" schema={SCHEMA} dataSource={src} data-tick={tick} />);

  const { rerender } = render(tree(0));
  await waitFor(() => expect(lastSchema?.data?.length).toBe(1));
  const afterFirstLoad = src.aggregate.mock.calls.length;

  for (const tick of [1, 2, 3]) {
    rerender(tree(tick));
    await settle();
  }
  await settle();

  return {
    afterFirstLoad,
    aggregateCalls: src.aggregate.mock.calls.length,
    schemaCalls: src.getObjectSchema.mock.calls.length,
    resolvedLabel: lastSchema?.data?.[0]?.stage,
  };
}

describe('ObjectChart — fieldOptionLabel is a direct dependency (objectui#5587)', () => {
  it('fetches once across re-renders with NO i18next provider', async () => {
    const seen = await countFetchesAcrossRerenders((chart) => chart);

    expect(seen.afterFirstLoad).toBe(1);
    expect(seen.aggregateCalls).toBe(1);
    expect(seen.schemaCalls).toBe(SCHEMA_READS_PER_LOAD);
    // Precondition, asserted rather than assumed: a leaked global instance
    // would localize this and turn the case into a duplicate of the next one.
    expect(seen.resolvedLabel).toBe(RAW_OPTION_LABEL);
  });

  it('fetches once across re-renders INSIDE an i18next provider', async () => {
    const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    // `getAppNamespaces()` only discovers a namespace carrying one of its
    // marker sub-keys, so `objects` is present to make `crm` discoverable at
    // all; `fieldOptions` is the entry the resolver actually reads.
    instance.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: { deal: { label: 'Deal' } },
          fieldOptions: { deal: { stage: { won: LOCALIZED_OPTION_LABEL } } },
        },
      },
      true,
      true,
    );

    const seen = await countFetchesAcrossRerenders((chart) => (
      <I18nProvider instance={instance} persistLanguage={false}>
        {chart}
      </I18nProvider>
    ));

    expect(seen.afterFirstLoad).toBe(1);
    expect(seen.aggregateCalls).toBe(1);
    expect(seen.schemaCalls).toBe(SCHEMA_READS_PER_LOAD);
    // The resolver really ran through the bound instance — so the case above
    // and this one exercise the two different identity paths, not one twice.
    expect(seen.resolvedLabel).toBe(LOCALIZED_OPTION_LABEL);
  });
});
