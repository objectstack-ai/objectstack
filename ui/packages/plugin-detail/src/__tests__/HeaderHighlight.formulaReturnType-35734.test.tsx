/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `formula` whose declared `returnType` the spec reads AS a field type
 * (`percent`, `currency`) is a KPI chip on the highlights strip, as a field of
 * that type is: its value carries the strip's figure typography. A formula of
 * any other return type keeps the face it had (CONTROL: `number`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { HeaderHighlight } from '../HeaderHighlight';

afterEach(cleanup);

const objectSchema = {
  fields: {
    win_rate: { type: 'percent', label: 'Win Rate' },
    margin_pct: { type: 'formula', label: 'Margin', returnType: 'percent', expression: 'record.profit / record.revenue' },
    net_amount: { type: 'formula', label: 'Net', returnType: 'currency', expression: 'record.revenue - record.cost' },
    units_left: { type: 'formula', label: 'Units Left', returnType: 'number', expression: 'record.stock - record.sold' },
  },
};

function renderStrip() {
  render(
    <HeaderHighlight
      fields={
        [
          { name: 'win_rate', label: 'Win Rate' },
          { name: 'margin_pct', label: 'Margin' },
          { name: 'net_amount', label: 'Net' },
          { name: 'units_left', label: 'Units Left' },
        ] as any
      }
      data={{ win_rate: 0.4, margin_pct: 0.25, net_amount: 1200, units_left: 7 }}
      objectSchema={objectSchema}
    />,
  );
}

/** The value span of the chip captioned `label`. */
const valueOf = (label: string) => {
  const span = (screen.getByText(label).closest('div.group') as HTMLElement).querySelector('span.truncate');
  expect(span, `a value span under "${label}"`).not.toBeNull();
  return span as HTMLElement;
};

describe('the highlights strip reads a formula by its declared returnType (objectstack#35734)', () => {
  it('a percent field is a KPI chip (the reference)', () => {
    renderStrip();
    expect(valueOf('Win Rate').className).toMatch(/\btabular-nums\b/);
  });

  it('a percent-returning formula is a KPI chip, as a percent field is', () => {
    renderStrip();
    expect(valueOf('Margin').className).toMatch(/\btabular-nums\b/);
    expect(valueOf('Margin').className).toBe(valueOf('Win Rate').className);
    expect(valueOf('Margin').textContent).toContain('25%');
  });

  it('a currency-returning formula is a KPI chip too', () => {
    renderStrip();
    expect(valueOf('Net').className).toMatch(/\btabular-nums\b/);
  });

  it('CONTROL: a number-returning formula keeps the face it had', () => {
    renderStrip();
    expect(valueOf('Units Left').className).not.toMatch(/\btabular-nums\b/);
  });
});
