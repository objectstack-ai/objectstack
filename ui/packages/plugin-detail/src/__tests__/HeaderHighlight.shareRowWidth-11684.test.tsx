/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11684: the header highlights share the row's free width and
 * truncate only when it runs out.
 *
 * The 2026-10-06 console sweep created a Product with SKU "QA Widget 1" and
 * read "QA Wid…" in the record drawer's highlights with most of the row empty.
 * Every chip was a fixed column: a `basis-[9rem]` with no grow and a 16rem
 * cap. A value wider than the chip's ~79px of content was clipped, however much
 * of the row was left.
 *
 * The distribution now has three parts, and each is pinned below:
 *  - the basis stays the FLOOR, so line breaking (which chips share a line)
 *    reads what it always read;
 *  - `grow` hands the line's free width to the chips;
 *  - `max-w-max` caps each chip at its own content, so a chip that fits stops
 *    growing and the free width goes on to the chips that still need it. No
 *    chip is wider than what it shows, which is what kept a sparse strip
 *    packed left under the old fixed caps.
 *
 * happy-dom has no layout engine, so these are class-semantics pins, not pixel
 * measurements (the same approach as
 * `RecordHighlightsRenderer.phoneWidth-11659.test.tsx`). The Chromium reading
 * they rest on is in the pull request that landed this file. It was taken in
 * the console's own drawer at its default width, before and after.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import type { HighlightField } from '@object-ui/types';
import { InlineEditProvider, RecordContextProvider } from '@object-ui/react';
import { HeaderHighlight } from '../HeaderHighlight';
import { RecordHighlightsRenderer } from '../renderers/record-highlights';

/** The value the sweep measured, in both chips it was cut in. */
const SKU = 'QA Widget 1';

/** The showcase Product's own field types (`showcase_product`). */
const productSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    sku: { type: 'text', label: 'SKU' },
    description: { type: 'text', label: 'Description' },
    unit_price: { type: 'currency', label: 'Unit Price' },
  },
};

/** The fixed caps and the shrink floor this card retired. */
const RETIRED = ['max-w-[16rem]', 'max-w-[24rem]', 'min-w-[7rem]'];

const renderProductStrip = () =>
  render(
    <RecordContextProvider
      objectName="showcase_product"
      recordId="P1"
      data={{ name: 'QA Widget', sku: SKU, description: SKU, unit_price: 19.99 }}
      objectSchema={productSchema}
    >
      <RecordHighlightsRenderer schema={{ fields: ['sku', 'description', 'unit_price'] }} />
    </RecordContextProvider>,
  );

/** The chip column (`group flex flex-col …`) around an element. */
const chipAround = (el: Element) => el.closest('div.group') as HTMLElement;

describe('record:highlights shares the row instead of fixing each chip (objectui#11684)', () => {
  it('gives every chip carrying the measured SKU a floor, a grow and a content cap', () => {
    renderProductStrip();

    const chips = screen.getAllByText(SKU).map(chipAround);
    // SKU and Description: the sweep read "QA Wid…" in both.
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip).toHaveClass('grow', 'max-w-max', 'basis-[9rem]', 'min-w-[min(9rem,100%)]');
      for (const retired of RETIRED) expect(chip).not.toHaveClass(retired);
    }
  });

  it('keeps truncation for the case the line DOES run out, with the whole value as the title', () => {
    renderProductStrip();

    for (const text of screen.getAllByText(SKU)) {
      const clipBox = chipAround(text).querySelector('span.truncate');
      expect(clipBox).not.toBeNull();
      expect(clipBox).toHaveAttribute('title', SKU);
    }
  });

  it('applies the same three parts to a short chip, so no chip keeps a fixed width', () => {
    const { container } = renderProductStrip();

    const chips = Array.from(container.querySelectorAll('div.group'));
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip).toHaveClass('grow', 'max-w-max');
      for (const retired of RETIRED) expect(chip).not.toHaveClass(retired);
    }
  });

  it('still lays the chips out on a wrapping flex row', () => {
    const { container } = renderProductStrip();

    const row = container.querySelector('div.group')?.parentElement;
    expect(row).toHaveClass('flex', 'flex-wrap');
  });
});

describe('the wide floor keeps its role under the shared row (objectui#11684)', () => {
  const fields: HighlightField[] = [
    { name: 'owner', label: 'Owner', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
  ];
  const data = { owner: 'Alice', email: 'ada@example.com' };

  it('gives a wide display type the 16rem floor, the grow and the content cap', () => {
    render(<HeaderHighlight fields={fields} data={data} />);

    const chip = chipAround(screen.getByText('ada@example.com'));
    expect(chip).toHaveClass('grow', 'max-w-max', 'basis-[16rem]', 'min-w-[min(16rem,100%)]');
    expect(chip).not.toHaveClass('basis-[9rem]');
    for (const retired of RETIRED) expect(chip).not.toHaveClass(retired);
  });

  it('widens an editing column to the 16rem floor, which still grows (expand-on-edit)', () => {
    render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} />
      </InlineEditProvider>,
    );
    const readChip = chipAround(screen.getByText('Alice'));
    expect(readChip).toHaveClass('basis-[9rem]', 'min-w-[min(9rem,100%)]');

    fireEvent.doubleClick(screen.getByText('Alice'));

    const editChip = chipAround(screen.getByDisplayValue('Alice'));
    expect(editChip).toHaveClass('grow', 'max-w-max', 'basis-[16rem]', 'min-w-[min(16rem,100%)]');
    expect(editChip).not.toHaveClass('basis-[9rem]');
  });
});
