/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#5066 — a `percent` chip in `record:highlights` showed a smaller,
 * plausible number. The chip clips with `truncate` (then a fixed `basis-[9rem]`
 * column, ~72-104px of content; since objectui#11684 a chip grows into its
 * line's free width, but a full line still clips it), and
 * the percent display renderer put a `w-16 shrink-0` bar in front of a
 * shrinkable value span: bar (64) + gap (8) left the value 0-32px and `truncate`
 * removed the rest. Downstream a stored `33.33` was read off the screen as `3`
 * (yinlianghui/hotcrm-heimao#59) and the app had to override the highlight's
 * render type to `number` to get its digits back.
 *
 * These pin the whole authored-metadata → chip → renderer path from the
 * CONSUMER side (`packages/fields` owns the renderer, but this strip is where
 * the clipping container lives): the value span keeps shrink priority even at
 * the chip count that squeezes hardest, and the chip still clips — the fix is a
 * shrink-priority inversion in the renderer, NOT the removal of the chip's
 * truncation.
 *
 * jsdom has no layout engine, so this is a class-semantics pin, not a pixel
 * measurement (same approach as `cell-truncation.test.tsx`).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordHighlightsRenderer } from '../renderers/record-highlights';

const objectSchema = {
  fields: {
    // objectui#11475 — `33.33` is percentage points, so the field declares
    // whole-point storage (`max: 100`, the spec's `percentScaleOf`); the cell
    // used to guess it from the value's size. The clip this file pins is
    // unmoved.
    supply_share: { type: 'percent', max: 100 },
    progress: { type: 'progress' },
    owner: { type: 'text' },
    stage: { type: 'text' },
    amount: { type: 'number' },
    city: { type: 'text' },
    code: { type: 'text' },
  },
};

const data = {
  supply_share: 33.33,
  progress: 62,
  owner: 'Alice',
  stage: 'Won',
  amount: 1200,
  city: 'Shanghai',
  code: 'A-1',
};

const renderStrip = (fields: unknown[]) =>
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId="A1"
      data={data}
      objectSchema={objectSchema}
    >
      <RecordHighlightsRenderer schema={{ fields } as any} />
    </RecordContextProvider>,
  );

describe('record:highlights — a percent chip shows its number, not the bar (#5066)', () => {
  it('keeps the value shrink-proof and the bar shrinkable inside the chip', () => {
    renderStrip([{ name: 'supply_share', label: 'Supply Share' }]);

    const value = screen.getByText('33%');
    expect(value).toHaveClass('shrink-0');

    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveClass('shrink-0');
    expect(bar).toHaveClass('w-16', 'min-w-0', 'shrink');
  });

  it('still clips the chip — the renderer, not the chip, gave way', () => {
    const { container } = renderStrip([{ name: 'supply_share', label: 'Supply Share' }]);

    // The chip's single-line clipping span is unchanged: this fix must not buy
    // legible percents by letting every other renderer overflow the strip.
    const clipBox = container.querySelector('span.truncate');
    expect(clipBox).not.toBeNull();
    expect(clipBox).toHaveClass('block', 'min-w-0', 'truncate');
    expect(clipBox).toContainElement(screen.getByRole('progressbar'));
  });

  it('holds at the chip count that squeezes hardest (7 chips)', () => {
    renderStrip([
      { name: 'supply_share', label: 'Supply Share' },
      'progress',
      'owner',
      'stage',
      'amount',
      'city',
      'code',
    ]);

    // Both bar-carrying chips keep the number as the protected content.
    expect(screen.getByText('33%')).toHaveClass('shrink-0');
    expect(screen.getByText('62%')).toHaveClass('shrink-0');
    for (const bar of screen.getAllByRole('progressbar')) {
      expect(bar).not.toHaveClass('shrink-0');
      expect(bar).toHaveClass('min-w-0', 'shrink');
    }
  });

  it('renders the full formatted value in the DOM (the loss was purely visual)', () => {
    renderStrip([{ name: 'supply_share', label: 'Supply Share' }]);

    // The DOM always carried `33%` — that is why a DOM-only probe called this
    // healthy. Pinned so a future "fix" cannot shorten the text instead.
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.queryByText('3')).toBeNull();
  });
});
