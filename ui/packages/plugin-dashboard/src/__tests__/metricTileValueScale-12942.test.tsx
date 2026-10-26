/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12942 — a metric tile's value scales before it would clip.
 *
 * On HotCRM's Sales Home the KPI card holds four `object-metric` tiles about
 * 156 px wide at 1024 px and 174 px at 1440 px. A money value with cents
 * (`1,290,000.00`) drew at 20 px and 24 px and was cut with an ellipsis. Now a
 * value past the short rung takes a size ladder whose steps start where each
 * size fits the tile's value room.
 *
 * jsdom has no layout, so this file pins the CONTRACT: which rung a value
 * takes (the class string the value node carries), that every step of the
 * ladder starts where the formula in `../metricTile` says, and that a short
 * value keeps today's face. The measured widths are in the pull request, from
 * a browser.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module scope (AGENTS.md 测试纪律): the barrel registers `object-metric`.
import '@object-ui/components';
import '../index';
import { MetricWidget } from '../MetricWidget';
import { MetricCard } from '../MetricCard';
import {
  METRIC_TILE_VALUE_CLASS,
  METRIC_TILE_VALUE_FINAL_SIZES,
  METRIC_TILE_VALUE_INSET,
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

// The narrowest and widest tiles the card measured, as the container query
// reads them: the Card's content box, inside its 1 px border.
const NARROW = 156 - 2;
const WIDE = 174 - 2;
const SEVEN_DIGIT_MONEY = '1,290,000.00';

describe('the value ladder (objectui#12942)', () => {
  it('starts every step where its size fits the rung\'s widest value', () => {
    for (const { maxEm, sizes } of METRIC_TILE_VALUE_LADDER) {
      for (const c of sizes.split(' ')) {
        const step = /^@\[(\d+)px\]:(text-[a-z0-9]+)$/.exec(c);
        if (!step) continue;
        const need = Math.ceil(METRIC_TILE_VALUE_INSET + maxEm * PX[step[2]]);
        // The short rung's 24 px step is today's 160 px: it must not start
        // before the value fits; every other step starts exactly there.
        if (maxEm === METRIC_TILE_VALUE_LADDER[0].maxEm) expect(Number(step[1])).toBeGreaterThanOrEqual(need);
        else expect(Number(step[1]), `${c} on the ${maxEm} em rung`).toBe(need);
      }
    }
  });

  it('gives every rung past the short one a 14 px floor, and climbs as the tile widens', () => {
    for (const { sizes } of METRIC_TILE_VALUE_LADDER.slice(1)) {
      const cls = sizes.split(' ');
      expect(cls[0]).toBe('text-sm');
      const at = cls.slice(1).map((c) => Number(/^@\[(\d+)px\]:/.exec(c)?.[1]));
      expect(at).toEqual([...at].sort((a, b) => a - b));
    }
    expect(METRIC_TILE_VALUE_FINAL_SIZES).toBe('text-sm');
  });

  it('reads a seven-digit money value as wider than the short rung, and a count as within it', () => {
    expect(metricTileValueEm(SEVEN_DIGIT_MONEY)).toBeGreaterThan(METRIC_TILE_VALUE_LADDER[0].maxEm);
    expect(metricTileValueEm('4,210')).toBeLessThanOrEqual(METRIC_TILE_VALUE_LADDER[0].maxEm);
  });

  it('fits a seven-digit money value at the narrowest and widest measured tile', () => {
    const em = metricTileValueEm(SEVEN_DIGIT_MONEY);
    const cls = metricTileValueClass(SEVEN_DIGIT_MONEY).split(' ');
    for (const width of [NARROW, WIDE]) {
      const px = sizeAt(cls, width);
      expect(px).toBeGreaterThan(0);
      expect(em * px, `at a ${width} px container`).toBeLessThanOrEqual(width - METRIC_TILE_VALUE_INSET);
    }
    // Today's face did not: 20 px at the narrow tile, 24 px at the wide one.
    const today = METRIC_TILE_VALUE_CLASS.split(' ');
    expect(em * sizeAt(today, NARROW)).toBeGreaterThan(NARROW - METRIC_TILE_VALUE_INSET);
    expect(em * sizeAt(today, WIDE)).toBeGreaterThan(WIDE - METRIC_TILE_VALUE_INSET);
  });

  it('takes the 14 px final face past the last rung', () => {
    const huge = '123,456,789,012,345,678.00';
    expect(metricTileValueEm(huge)).toBeGreaterThan(METRIC_TILE_VALUE_LADDER[METRIC_TILE_VALUE_LADDER.length - 1].maxEm);
    expect(metricTileValueClass(huge)).toBe(METRIC_TILE_VALUE_CLASS.replace(' text-xl @[160px]:text-2xl', ' text-sm'));
  });
});

describe('rendered tiles (objectui#12942)', () => {
  const wrap = (ui: React.ReactElement) =>
    render(<I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>{ui}</I18nProvider>);

  it('object-metric: a seven-digit money value draws the full figure on the scaled rung, not the clipping face', () => {
    wrap(
      <SchemaRendererProvider dataSource={undefined as never}>
        <SchemaRenderer
          schema={{
            type: 'object-metric',
            properties: { objectName: 'crm_opportunity', label: 'Revenue (Won)', icon: 'dollar-sign', fallbackValue: 1290000, format: '0,0.00' },
          } as never}
        />
      </SchemaRendererProvider>,
    );
    const value = screen.getByText(SEVEN_DIGIT_MONEY);
    const cls = classesOf(value);
    expect(cls).toEqual(expect.arrayContaining(metricTileValueClass(SEVEN_DIGIT_MONEY).split(' ')));
    expect(cls).not.toContain('@[160px]:text-2xl');
    expect(sizeAt(cls, NARROW)).toBe(14);
    expect(sizeAt(cls, WIDE)).toBe(18);
    // The figure is whole in the DOM, and in the tooltip.
    expect(value.textContent).toBe(SEVEN_DIGIT_MONEY);
    expect(value).toHaveAttribute('title', SEVEN_DIGIT_MONEY);
  });

  it('MetricWidget and MetricCard read the same ladder', () => {
    wrap(<MetricWidget label="Pipeline Value" value={2017500} format="0,0.00" />);
    const widgetValue = screen.getByText('2,017,500.00');
    expect(classesOf(widgetValue)).toEqual(expect.arrayContaining(metricTileValueClass('2,017,500.00').split(' ')));
    cleanup();
    wrap(<MetricCard title="Pipeline Value" value="2,017,500.00" />);
    const cardValue = screen.getByText('2,017,500.00');
    expect(classesOf(cardValue)).toEqual(expect.arrayContaining(metricTileValueClass('2,017,500.00').split(' ')));
    expect(cardValue).toHaveAttribute('title', '2,017,500.00');
  });

  it('CONTROL: a short value keeps today\'s face — 20 px below a 160 px tile, 24 px from it — and no tooltip', () => {
    wrap(<MetricWidget label="Open Deals" value={4210} />);
    const value = screen.getByText('4,210');
    const cls = classesOf(value);
    expect(cls).toEqual(expect.arrayContaining(METRIC_TILE_VALUE_CLASS.split(' ')));
    expect(cls).not.toContain('text-sm');
    expect(sizeAt(cls, NARROW)).toBe(20);
    expect(sizeAt(cls, WIDE)).toBe(24);
    expect(value).not.toHaveAttribute('title');
  });
});
