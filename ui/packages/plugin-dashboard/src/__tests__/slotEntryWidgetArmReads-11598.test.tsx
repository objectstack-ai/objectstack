/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11598, N2 — a widget key is read on the widget arm alone.
 *
 * Every dashboard surface reads a `widgets[]` entry by the slot's element type,
 * the component arm (`metric-card`) or the widget arm. The surfaces used to
 * read widget keys off the entry whichever arm it was, through `BaseSchema`'s
 * index signature, and one read was a deliberate fork: "a `dataset` draws
 * `DatasetWidget` on either arm". The seat ruled N2 = A on objectui#8347: every
 * read narrows with `isSlotComponentEntry`, the either-arm fork and
 * `entryComponent`'s cross-arm read retire.
 *
 * ## What is pinned
 *
 *   1. The narrowed `dataset` path, both ways, on BOTH surfaces: a widget-arm
 *      entry with `dataset` draws `DatasetWidget`; a `metric-card` entry
 *      carrying `dataset` does not reach it and draws its card.
 *   2. The other cross-arm reads a card used to take: `options` spread over the
 *      card's own keys, and a `component` envelope drawn in the card's place.
 *   3. The change is confined to documents the strict face refuses: each card
 *      in 1–2 is refused by `StrictAnyComponentSchema` and accepted by the
 *      tolerant `AnyComponentSchema`, and the strict-valid card (the CONTROL)
 *      draws as before.
 *
 * `DatasetWidget` is told apart by its `dataset-loading` skeleton under a
 * query that never settles (the idiom `DashboardGridLayout.datasetPath.test`
 * uses): nothing else on either surface emits that test id.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/plugin-charts';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';
import { entryComponent, type DashboardWidgetSlotEntry } from '../widgetDispatch';
import { AnyComponentSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';

afterEach(cleanup);

/** A capable source whose query never settles, so `DatasetWidget` stays on its skeleton. */
const pendingSource = () => ({ queryDataset: vi.fn(() => new Promise<Record<string, unknown>>(() => {})) });

/** A strict-valid card: the component arm's own keys. */
const CARD = { id: 'c1', type: 'metric-card', title: 'Revenue', value: '$24k' } as const;

/** A widget-arm entry bound to a dataset. */
const BOUND_WIDGET = { id: 'w1', type: 'bar', dataset: 'invoices', dimensions: ['status'], values: ['count'] } as const;

/** Cards carrying a widget key the component arm does not declare. */
const CARD_WITH_DATASET = { ...CARD, dataset: 'invoices', values: ['count'] };
const CARD_WITH_OPTIONS = { ...CARD, options: { value: 'OPTIONS-FIGURE' } };
const CARD_WITH_COMPONENT = { ...CARD, component: { type: 'text', content: 'ENVELOPE-NODE' } };

const doc = (widget: Record<string, unknown>) => ({ type: 'dashboard', widgets: [widget] });

/**
 * Stored metadata is what a surface receives: the three cards above parse only
 * on the tolerant face, so they cross the declared type once, here.
 */
const renderOn = (surface: 'renderer' | 'grid', widget: Record<string, unknown>, dataSource: unknown) => {
  const schema = doc(widget) as never;
  return surface === 'renderer'
    ? render(<DashboardRenderer schema={schema} dataSource={dataSource} />)
    : render(<DashboardGridLayout schema={schema} dataSource={dataSource} />);
};

const SURFACES = ['renderer', 'grid'] as const;

/* ── 1. the narrowed `dataset` path, both ways ───────────────────────────── */

describe('objectui#11598 N2 — `dataset` draws `DatasetWidget` on the widget arm alone', () => {
  it.each(SURFACES)('%s: a widget-arm entry with `dataset` draws `DatasetWidget`', (surface) => {
    const src = pendingSource();
    renderOn(surface, BOUND_WIDGET, src);
    expect(screen.getByTestId('dataset-loading')).toBeInTheDocument();
    expect(src.queryDataset).toHaveBeenCalledWith('invoices', { dimensions: ['status'], measures: ['count'] });
  });

  it.each(SURFACES)('%s: a `metric-card` entry carrying `dataset` does not reach it, and draws its card', async (surface) => {
    const src = pendingSource();
    renderOn(surface, CARD_WITH_DATASET, src);
    expect(await screen.findByText('$24k')).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-loading')).not.toBeInTheDocument();
    expect(src.queryDataset).not.toHaveBeenCalled();
  });

  it.each(SURFACES)('%s: CONTROL — the strict-valid card draws its figure and sends no query', async (surface) => {
    const src = pendingSource();
    renderOn(surface, CARD, src);
    expect(await screen.findByText('$24k')).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-loading')).not.toBeInTheDocument();
    expect(src.queryDataset).not.toHaveBeenCalled();
  });
});

/* ── 2. the card's other cross-arm reads ─────────────────────────────────── */

describe('objectui#11598 N2 — a card takes no other widget key', () => {
  it.each(SURFACES)('%s: `options` is not spread over the card\'s own keys', async (surface) => {
    renderOn(surface, CARD_WITH_OPTIONS, pendingSource());
    expect(await screen.findByText('$24k')).toBeInTheDocument();
    expect(screen.queryByText('OPTIONS-FIGURE')).not.toBeInTheDocument();
  });

  it.each(SURFACES)('%s: a `component` envelope is not drawn in the card\'s place', async (surface) => {
    renderOn(surface, CARD_WITH_COMPONENT, pendingSource());
    expect(await screen.findByText('$24k')).toBeInTheDocument();
    expect(screen.queryByText('ENVELOPE-NODE')).not.toBeInTheDocument();
  });

  it('`entryComponent` reads the envelope on the widget arm alone', () => {
    // A `metric-card`: the one node the envelope's type admits since objectui#12163 (ruling C).
    const envelope = { type: 'metric-card', value: 'ENVELOPE-NODE' } as const;
    const widgetArm: DashboardWidgetSlotEntry = { id: 'w2', component: envelope };
    expect(entryComponent(widgetArm)).toBe(envelope);
    expect(entryComponent(CARD_WITH_COMPONENT as unknown as DashboardWidgetSlotEntry)).toBeUndefined();
  });
});

/* ── 3. confined to documents the strict face refuses ────────────────────── */

describe('objectui#11598 N2 — every card whose drawing moved is refused by the strict face', () => {
  it.each([
    ['dataset', CARD_WITH_DATASET],
    ['options', CARD_WITH_OPTIONS],
    ['component', CARD_WITH_COMPONENT],
  ] as const)('a card carrying `%s`: strict refuses it at the widget, the tolerant face accepts it', (_key, card) => {
    const strict = StrictAnyComponentSchema.safeParse(doc(card));
    expect(strict.success).toBe(false);
    expect(strict.error?.issues.map((issue) => `${issue.code}@${issue.path.join('.')}`)).toEqual(['invalid_union@widgets.0']);
    expect(AnyComponentSchema.safeParse(doc(card)).success).toBe(true);
  });

  it('CONTROL — the card without them parses on the strict face', () => {
    expect(StrictAnyComponentSchema.safeParse(doc(CARD)).success).toBe(true);
  });
});
