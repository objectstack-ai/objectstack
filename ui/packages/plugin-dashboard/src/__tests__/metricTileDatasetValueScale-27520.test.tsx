/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27520 row 3 — the dataset-bound KPI tile's value scales before
 * it would clip.
 *
 * On a phone the Delivery Operations dashboard draws its KPI tiles two to a
 * row, and the Total Budget tile cut `$1,090,000.00` to `$1,090,00...`: the
 * dataset-bound tile drew every value at the short face (20 px, 24 px from a
 * 160 px tile), while the plain tiles already took the size ladder
 * (objectui#12942). Now it takes a ladder of its own, measured against its own
 * box, which has no Card inset.
 *
 * jsdom has no layout, so this file pins the CONTRACT: every step starts where
 * the formula in `../metricTile` says, which rung a value takes, and that the
 * tile's value node carries it. The measured widths are in the pull request,
 * from a browser.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
// Module scope (AGENTS.md 测试纪律): the barrel registers the dashboard blocks.
import '@object-ui/components';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import {
  METRIC_TILE_DATASET_VALUE_LADDER,
  METRIC_TILE_VALUE_CLASS,
  METRIC_TILE_VALUE_FINAL_SIZES,
  METRIC_TILE_VALUE_LADDER,
  metricTileValueClass,
  metricTileValueEm,
} from '../metricTile';

afterEach(cleanup);

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** Tailwind's type scale, in px, for the sizes the ladder uses. */
const PX: Record<string, number> = { 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20, 'text-2xl': 24 };

/** The size a class list draws at in a container `width` px wide. */
function sizeAt(classes: string[], width: number): number {
  let px = 0;
  let from = -1;
  for (const c of classes) {
    const step = /^@\[(\d+)px\]:(text-[a-z0-9]+)$/.exec(c);
    if (step && PX[step[2]] !== undefined) {
      const at = Number(step[1]);
      if (width >= at && at > from) { from = at; px = PX[step[2]]; }
    } else if (PX[c] !== undefined && from < 0) {
      px = PX[c];
    }
  }
  return px;
}

/** The short rung's own step for a size: 20 px from 0, 24 px from 160 px. */
const SHORT_FACE_STEP: Record<string, number> = { 'text-xl': 0, 'text-2xl': 160 };

const BUDGET = '$1,090,000.00';

describe('the dataset tile value ladder (objectstack#27520)', () => {
  it('has the plain ladder\'s rungs and its short face', () => {
    expect(METRIC_TILE_DATASET_VALUE_LADDER.map((r) => r.maxEm)).toEqual(METRIC_TILE_VALUE_LADDER.map((r) => r.maxEm));
    expect(METRIC_TILE_DATASET_VALUE_LADDER[0].sizes).toBe(METRIC_TILE_VALUE_LADDER[0].sizes);
  });

  it('starts every step where its size fits the rung\'s widest value, never before the short face\'s own step', () => {
    for (const { maxEm, sizes } of METRIC_TILE_DATASET_VALUE_LADDER.slice(1)) {
      const cls = sizes.split(' ');
      expect(cls[0]).toBe('text-sm');
      for (const c of cls.slice(1)) {
        const step = /^@\[(\d+)px\]:(text-[a-z0-9]+)$/.exec(c);
        expect(step, c).not.toBeNull();
        const need = Math.max(Math.ceil(maxEm * PX[step![2]]), SHORT_FACE_STEP[step![2]] ?? 0);
        expect(Number(step![1]), `${c} on the ${maxEm} em rung`).toBe(need);
      }
    }
    expect(METRIC_TILE_VALUE_FINAL_SIZES).toBe('text-sm');
  });

  it('never draws a longer value larger than a shorter one in the same tile', () => {
    const rungs = METRIC_TILE_DATASET_VALUE_LADDER.map((r) => r.sizes.split(' '));
    for (let width = 60; width <= 400; width += 1) {
      const px = rungs.map((cls) => sizeAt(cls, width));
      expect(px, `at ${width} px`).toEqual([...px].sort((a, b) => b - a));
    }
  });

  it('fits the Total Budget figure at every width from where 14 px holds it', () => {
    const em = metricTileValueEm(BUDGET);
    const cls = metricTileValueClass(BUDGET, METRIC_TILE_DATASET_VALUE_LADDER).split(' ');
    for (let width = Math.ceil(em * 14); width <= 400; width += 1) {
      expect(em * sizeAt(cls, width), `at a ${width} px tile`).toBeLessThanOrEqual(width);
    }
    // The short face did not: 20 px in a 140 px tile, 24 px in a 170 px one.
    const short = METRIC_TILE_VALUE_CLASS.split(' ');
    expect(em * sizeAt(short, 140)).toBeGreaterThan(140);
    expect(em * sizeAt(short, 170)).toBeGreaterThan(170);
  });
});

describe('the rendered dataset tile (objectstack#27520)', () => {
  const renderTile = (value: number) =>
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <DashboardRenderer
          schema={{
            type: 'dashboard',
            name: 'ops',
            widgets: [{ id: 'kpi_total_budget', type: 'metric', title: 'Total Budget', dataset: 'project_metrics', values: ['budget_sum'] }],
          } as unknown as DashboardComponentSchema}
          dataSource={{
            queryDataset: vi.fn(async () => ({
              rows: [{ budget_sum: value }],
              fields: [{ name: 'budget_sum', label: 'Total Budget', type: 'currency', format: '$0,0.00' }],
            })),
          }}
        />
      </I18nProvider>,
    );

  it('draws a long money figure on its ladder rung, whole, with the figure as its tooltip', async () => {
    renderTile(1090000);
    const value = await screen.findByText(BUDGET);
    const cls = classesOf(value);
    expect(cls).toEqual(expect.arrayContaining(metricTileValueClass(BUDGET, METRIC_TILE_DATASET_VALUE_LADDER).split(' ')));
    expect(cls).not.toContain('text-xl');
    expect(value.textContent).toBe(BUDGET);
    expect(value).toHaveAttribute('title', BUDGET);
  });

  it('CONTROL: a short figure keeps the short face and no tooltip', async () => {
    renderTile(42);
    const value = await screen.findByText('$42.00');
    expect(classesOf(value)).toEqual(expect.arrayContaining(METRIC_TILE_VALUE_CLASS.split(' ')));
    expect(value).not.toHaveAttribute('title');
  });
});
