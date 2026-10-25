/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9055 — the field-key display spellings that survived OUTSIDE the
 * `table` widget family, pinned on the surfaces that actually render them.
 *
 * ## The class, already ruled on
 *
 * objectui#5425 ruled that one value may not appear twice under two spellings
 * on one dashboard, and `humanizeFieldKey` (`../utils`) names itself the single
 * home for the KEY convention. objectui#9000 made the two header branches of
 * `ObjectDataTable` agree with it. Two more producers of a field-key display
 * string were left outside that diff on purpose — its scope was the surface it
 * named — and this file is their pin.
 *
 * ## Instance 1 — the record drawer, measured ON ONE CLICK CHAIN
 *
 * `RecordDetailDrawer` built its label from an inline expression that
 * upper-cased only the FIRST word, where `humanizeFieldKey` title-cases every
 * word. The assertions below deliberately do NOT compare two pure functions:
 * they render ONE `ObjectDataTable`, read its rendered headers, CLICK a row,
 * and read the drawer that click opened. That is the card's severity argument
 * — one uninterrupted interaction, one key, two spellings — and a
 * pure-function comparison cannot carry it.
 *
 * ⚠️ `unitPrice` and `amount` render IDENTICALLY under both spellings, so they
 * cannot tell the fixed world from the broken one. They are asserted under
 * `KEYS_THAT_CANNOT_DISCRIMINATE` and are recorded, not evidence; the
 * discriminating population is the snake_case pair.
 *
 * ## Instance 2 — the chart series label
 *
 * `resolveSeriesLabel` (`../DashboardRenderer`) has THREE arms, and the card
 * names only one of them:
 *
 *   arm 1  synthetic y-field + an aggregate  -> an i18n'd aggregate name.
 *          UNTOUCHED, and pinned below as a LIVE CONTROL rather than as a
 *          comment: it is the arm a blind "humanize everything" would eat.
 *   arm 2  a real object + a real field      -> `fieldLabel`'s fallback WAS the
 *          raw key; it is the humanized key now. The bundle still wins over it.
 *   arm 3  no object name at all             -> returned the raw key outright.
 *          ⭐ objectui#9055 does not mention this arm. It is reached on every
 *          static-data chart `DashboardRenderer` composes
 *          (`resolveSeriesLabel(undefined, yField, undefined)`), so it is a
 *          live third spelling of one decision, not dead code — which is why
 *          it is fixed here rather than "noted".
 *
 * ## Why the composed node rather than a recharts legend
 *
 * The decision under test is which string the RELAY composes. `ChartRenderer`
 * turns `series[].label` into `config[dataKey].label` (`s.label || s.dataKey`),
 * which is the legend / tooltip text; recharts resolves inside `plugin-charts`
 * and lays out no SVG in happy-dom. Same split objectui#8266 made for the
 * sibling `dataKey` decision on this very callback.
 *
 * ## DIRECTIONS, written before the reverse verification was run
 *
 * Predicted RED on `origin/main` 8e74b27fc: the drill-chain PARITY assertions
 * over `close_date` / `needs_analysis`, and the arm-2 / arm-3 series-label
 * assertions. Predicted GREEN on both sides: every
 * `KEYS_THAT_CANNOT_DISCRIMINATE` assertion, the arm-1 aggregate control, and
 * both BUNDLE ENTRY controls. Measured results are recorded in the PR body.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';

import { ObjectDataTable } from '../ObjectDataTable';
import { DashboardRenderer } from '../DashboardRenderer';
import { humanizeFieldKey } from '../utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '@object-ui/components';

const OBJECT_NAME = 'crm_opportunity';

/**
 * One record. `id` is a system field on BOTH surfaces (the shared
 * `isSystemField` denylist), so the key populations stay identical without
 * either side being told what to hide.
 */
const ROW = {
  id: 'opp-1',
  close_date: '2026-01-01',
  needs_analysis: 'Needs a call',
  unitPrice: 3,
  amount: 1500,
};

/** snake_case: the two spellings differ, so these tell the two worlds apart. */
const DISCRIMINATING_KEYS = ['close_date', 'needs_analysis'];

/**
 * ⚠️ NOT EVIDENCE. The inline drawer expression and `humanizeFieldKey` return
 * the same string for these, so they hold in the broken world too. Recorded so
 * the fix is not misread as having moved them.
 */
const KEYS_THAT_CANNOT_DISCRIMINATE = ['unitPrice', 'amount'];

/** Render order on both surfaces: the record's own key order, minus `id`. */
const VISIBLE_KEYS = [...DISCRIMINATING_KEYS, ...KEYS_THAT_CANNOT_DISCRIMINATE];

type Wrap = (node: React.ReactElement) => React.ReactElement;

const zhWrap = (resources: Record<string, any> = {}): Wrap => (node) => (
  <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources }}>
    {node}
  </I18nProvider>
);

/**
 * ONE interaction: render the table, read its headers, click a row, read the
 * drawer the click opened. Both readings come out of the same mounted tree.
 */
function drillChain(extra: Record<string, unknown> = {}, wrap?: Wrap) {
  const node = (
    <ObjectDataTable
      schema={{
        type: 'object-data-table',
        objectName: OBJECT_NAME,
        data: [ROW],
        drillDown: { enabled: true },
        ...extra,
      } as any}
    />
  );
  render(wrap ? wrap(node) : node);

  const headers = Array.from(document.querySelectorAll('thead th')).map(
    (th) => (th.textContent ?? '').trim(),
  );

  // The click the card's argument is about: a table cell, not a test hook.
  fireEvent.click(screen.getByText('Needs a call'));
  const body = screen.getByTestId('record-detail-body');
  const labels = Array.from(body.querySelectorAll('dt')).map(
    (dt) => (dt.textContent ?? '').trim(),
  );

  const byKey = (values: string[]) =>
    Object.fromEntries(VISIBLE_KEYS.map((k, i) => [k, values[i]]));

  return { headers, labels, headerByKey: byKey(headers), labelByKey: byKey(labels) };
}

/* ------------------------------------------------------------------ */
/* Instance 2 harness — record what the relay composes.                */
/* ------------------------------------------------------------------ */

/** Every chart node `DashboardRenderer` handed the renderer, in order. */
const composed: any[] = [];

const recorder = (props: any) => {
  composed.push(props.schema ?? props);
  return null;
};
for (const type of ['object-chart', 'chart'] as const) {
  ComponentRegistry.register(type, recorder as any, {
    namespace: 'test',
    label: 'recorder',
    category: 'plugin',
  } as any);
}

const chartDataSource = { aggregate: async () => [], find: async () => [] };

async function composedSeriesLabel(widget: Record<string, unknown>, wrap?: Wrap) {
  composed.length = 0;
  const node = (
    <SchemaRendererProvider dataSource={chartDataSource as any}>
      <DashboardRenderer schema={{ widgets: [widget] } as any} />
    </SchemaRendererProvider>
  );
  render(wrap ? wrap(node) : node);
  await waitFor(() => expect(composed.length).toBeGreaterThan(0));
  const label = composed[composed.length - 1]?.series?.[0]?.label;
  cleanup();
  return label;
}

const objectBoundChart = (aggregate: Record<string, unknown>) => ({
  id: 'w-object',
  type: 'bar',
  title: 'By stage',
  options: { xField: 'stage' },
  data: { provider: 'object', object: OBJECT_NAME, aggregate },
});

const staticChart = (yField: string) => ({
  id: 'w-static',
  type: 'bar',
  title: 'Inline rows',
  options: { xField: 'name', yField },
  data: [{ name: 'Acme', [yField]: 1 }],
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#9055 instance 1 — the record drawer agrees with the header the user just left', () => {
  it('PARITY on one click chain, over the keys that can discriminate', () => {
    const { headerByKey, labelByKey } = drillChain();

    for (const key of DISCRIMINATING_KEYS) {
      // Reported as a pair so a failure names the key, not just two strings.
      expect([key, labelByKey[key]]).toEqual([key, headerByKey[key]]);
    }
    // The convention anchor, referenced rather than re-spelled: parity alone
    // would also hold if BOTH surfaces moved to a new shared wrongness.
    expect(DISCRIMINATING_KEYS.map((k) => labelByKey[k])).toEqual(
      DISCRIMINATING_KEYS.map(humanizeFieldKey),
    );
  });

  it('PARITY over the whole rendered chain, header list against label list', () => {
    const { headers, labels } = drillChain();
    expect(headers).toHaveLength(VISIBLE_KEYS.length);
    expect(labels).toEqual(headers);
  });

  it('KEYS_THAT_CANNOT_DISCRIMINATE — recorded, NOT evidence (green in both worlds)', () => {
    const { headerByKey, labelByKey } = drillChain();
    for (const key of KEYS_THAT_CANNOT_DISCRIMINATE) {
      expect([key, labelByKey[key]]).toEqual([key, headerByKey[key]]);
    }
  });

  it('the `objectName` guard is intact — no object name, still one spelling', () => {
    // Both surfaces skip the i18n lookup here and use the derived string
    // directly. If the guard were dropped the render would throw or fall back
    // to a raw key; it does neither.
    const { headerByKey, labelByKey } = drillChain({ objectName: undefined });
    for (const key of DISCRIMINATING_KEYS) {
      expect([key, labelByKey[key]]).toEqual([key, humanizeFieldKey(key)]);
      expect([key, headerByKey[key]]).toEqual([key, humanizeFieldKey(key)]);
    }
  });

  it('BUNDLE ENTRY — a translation still wins over the derived spelling on BOTH surfaces', () => {
    const resources = { zh: { crm: { fields: { [OBJECT_NAME]: { close_date: '结单日期' } } } } };
    const { headerByKey, labelByKey } = drillChain({}, zhWrap(resources));

    expect(headerByKey.close_date).toBe('结单日期');
    expect(labelByKey.close_date).toBe('结单日期');
    // The untranslated neighbour still shows the derived spelling, so the
    // assertion above is about the bundle and not about the whole surface.
    expect(labelByKey.needs_analysis).toBe(humanizeFieldKey('needs_analysis'));
  });
});

describe('objectui#9055 instance 2 — the chart series label stops leaking the raw key', () => {
  it('arm 2 — an object-bound measure legends under the humanized key, not the raw one', async () => {
    const label = await composedSeriesLabel(
      objectBoundChart({ function: 'max', field: 'close_date', groupBy: 'stage' }),
    );
    expect(label).toBe(humanizeFieldKey('close_date'));
    expect(label).not.toBe('close_date');
  });

  it('arm 3 — a static-data chart legends under the humanized key (the arm the card missed)', async () => {
    const label = await composedSeriesLabel(staticChart('unit_price'));
    expect(label).toBe(humanizeFieldKey('unit_price'));
    expect(label).not.toBe('unit_price');
  });

  it('arm 1 LIVE CONTROL — a synthetic key with an aggregate still gets the i18n aggregate name', async () => {
    // Green before AND after. A blind humanize applied above this branch would
    // render `Count` here and fail: the aggregate vocabulary would be gone.
    const label = await composedSeriesLabel(
      objectBoundChart({ function: 'count', groupBy: 'stage' }),
      zhWrap(),
    );
    expect(label).toBe('计数');
  });

  it('arm 1 LIVE CONTROL — a fieldless count keeps the aggregate name in English too', async () => {
    const label = await composedSeriesLabel(
      objectBoundChart({ function: 'count', groupBy: 'stage' }),
      (node) => (
        <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
          {node}
        </I18nProvider>
      ),
    );
    expect(label).toBe('Count');
  });

  it('BUNDLE ENTRY — a translated field label still wins over the humanized fallback', async () => {
    const resources = { zh: { crm: { fields: { [OBJECT_NAME]: { close_date: '结单日期' } } } } };
    const label = await composedSeriesLabel(
      objectBoundChart({ function: 'max', field: 'close_date', groupBy: 'stage' }),
      zhWrap(resources),
    );
    expect(label).toBe('结单日期');
  });
});
