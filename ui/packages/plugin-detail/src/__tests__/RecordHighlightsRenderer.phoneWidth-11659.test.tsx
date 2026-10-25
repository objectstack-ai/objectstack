/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11659 ruling 4 — the record header does not cut a phone number.
 *
 * The cloud acceptance run read 「0574-876」 in the highlight row of a record
 * drawer for the stored `0574-8765-4321`, with no ellipsis. The phone cell
 * draws a dial icon, the number and a copy button inside an `inline-flex` box;
 * the chip's `truncate` span cannot put an ellipsis on an inline-flex child, so
 * a 9rem chip clipped the number mid-way. A phone chip now takes the wide basis,
 * as `email` and `url` already did, so a whole number fits.
 *
 * happy-dom has no layout engine, so this is a class-semantics pin, not a pixel
 * measurement (same approach as `RecordHighlightsRenderer.percentClip.test.tsx`).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordHighlightsRenderer } from '../renderers/record-highlights';

const PHONE = '0574-8765-4321';

const objectSchema = {
  fields: {
    phone: { type: 'phone', label: 'Phone' },
    status: { type: 'text', label: 'Status' },
  },
};

const renderStrip = () =>
  render(
    <RecordContextProvider
      objectName="crm_customer"
      recordId="C1"
      data={{ phone: PHONE, status: 'Active' }}
      objectSchema={objectSchema}
    >
      <RecordHighlightsRenderer schema={{ fields: ['phone', 'status'] }} />
    </RecordContextProvider>,
  );

/** The chip column (`group flex flex-col …`) that holds a given value. */
const chipOf = (text: string) => screen.getByText(text).closest('div.group') as HTMLElement;

describe('record:highlights — a phone chip shows the whole number (objectui#11659)', () => {
  it('gives the phone chip the wide basis, not the 9rem one', () => {
    renderStrip();

    const chip = chipOf(PHONE);
    expect(chip).not.toBeNull();
    expect(chip).toHaveClass('basis-[16rem]');
    expect(chip).not.toHaveClass('basis-[9rem]');
  });

  it('keeps a short text chip on the 9rem basis (the change is phone-only)', () => {
    renderStrip();

    const chip = chipOf('Active');
    expect(chip).toHaveClass('basis-[9rem]');
    expect(chip).not.toHaveClass('basis-[16rem]');
  });

  it('carries the whole number in the DOM and as the hover title', () => {
    const { container } = renderStrip();

    expect(screen.getByText(PHONE)).toBeInTheDocument();
    const clipBox = chipOf(PHONE).querySelector('span.truncate');
    expect(clipBox).not.toBeNull();
    expect(clipBox).toHaveAttribute('title', PHONE);
    expect(container.querySelector(`a[href="tel:${PHONE}"]`)).not.toBeNull();
  });
});
