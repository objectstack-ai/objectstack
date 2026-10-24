/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4033 on the dashboard metric surface.
 *
 * MetricWidget is the MEASURED EXCEPTION to the card's ordinal no-grouping
 * default, so this file pins both halves of that split:
 *
 *  - the `en-US` hardcode IS removed — a metric follows the active display
 *    locale like every other number; but
 *  - grouping IS NOT suppressed, because `decimals` here is parsed from a
 *    numeral.js format pattern rather than a field's declared `scale`, and is 0
 *    for the commonest KPI patterns. The widget's own contract calls the
 *    separators load-bearing ("`1,930,000` not `1930000`").
 *
 * Without the second pin, a later reading of "scale 0 ⇒ no grouping" as a
 * global rule would turn every unformatted dashboard aggregate into a digit run
 * and nothing would fail.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { MetricWidget } from '../MetricWidget';

const renderMetric = (props: Record<string, unknown>, locale?: string) =>
  render(
    <LocalizationProvider value={{ locale }}>
      <MetricWidget label="Revenue" {...(props as any)} />
    </LocalizationProvider>,
  );

describe('MetricWidget — grouping stays load-bearing (objectui#4033 exception)', () => {
  it('keeps thousands separators for a large unformatted KPI aggregate', () => {
    renderMetric({ value: 1930000 }, 'en-US');
    expect(screen.getByText('1,930,000')).toBeInTheDocument();
  });

  it("keeps thousands separators for the '0,0' pattern (decimals parse to 0)", () => {
    renderMetric({ value: 1930000, format: '0,0' }, 'en-US');
    expect(screen.getByText('1,930,000')).toBeInTheDocument();
  });

  it('keeps grouping for a currency metric', () => {
    renderMetric({ value: 1930000, currency: 'USD' }, 'en-US');
    expect(screen.getByText('$1,930,000')).toBeInTheDocument();
  });
});

describe('MetricWidget — active display locale (objectui#4033 fix 3)', () => {
  it('groups per the active locale rather than a hardcoded en-US', () => {
    renderMetric({ value: 1930000 }, 'de-DE');
    expect(screen.getByText('1.930.000')).toBeInTheDocument();
  });

  it('points the decimal mark per the active locale', () => {
    renderMetric({ value: 1930.5, format: '0,0.0' }, 'de-DE');
    expect(screen.getByText('1.930,5')).toBeInTheDocument();
  });

  it('localizes a currency metric too', () => {
    renderMetric({ value: 1930000, currency: 'EUR' }, 'de-DE');
    // de-DE puts the symbol last; en-US would have produced "€1,930,000".
    expect(screen.getByText(/^1\.930\.000\s*€$/)).toBeInTheDocument();
  });

  it('localizes the compact notation path', () => {
    // de-DE compact spells its own scale word ("Mio."), which en-US cannot
    // produce — this is the pin that the compact branch took the locale too.
    renderMetric({ value: 1930000, format: '0.0a' }, 'de-DE');
    expect(screen.getByText(/Mio/)).toBeInTheDocument();
  });
});
