/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12523: the link cells fit a bounded single-line slot with an
 * ellipsis.
 *
 * The record page's highlight strip read "+1-555-0" and
 * "mira.costa@atlasconstruction": the chip's `truncate` span clipped the
 * value with no ellipsis. A Chromium reading put the cause here, not in the
 * chip. Each of these three cells drew its text inside an `inline-flex` anchor:
 *  - so the text sat in an anonymous flex item that no `text-overflow` reaches;
 *  - and the cell was one atomic inline box in its host's line. CSS Overflow 3
 *    clips the first atomic inline on a line and never ellipses it.
 * Any clipping host therefore cut the address mid-word, silently.
 *
 * The fix is the convention `TruncatedText` already states for this file
 * (objectui#3466):
 *  - the cell's outer box is bounded by its host (`max-w-full`);
 *  - the box holding the text is a block container with `truncate`;
 *  - every box between them can shrink (`min-w-0`, or `overflow:hidden`,
 *    which zeroes a flex item's automatic minimum);
 *  - the decorations keep their size (`shrink-0`).
 *
 * happy-dom has no layout engine and loads no stylesheet, so these pin the
 * classes and the structure. The pixel reading (an ellipsis drawn at a 1088px
 * and a 358px strip, values cut nowhere else) is in the pull request that
 * landed this file.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { EmailCellRenderer, PhoneCellRenderer, UrlCellRenderer } from '../index';

const EMAIL = 'mira.costa@atlasconstruction.example.com';
const PHONE = '+1-555-0117-1119';
const SITE = 'https://atlasconstruction.example.com/projects/2026';

describe('the email cell fits a bounded slot with an ellipsis (objectui#12523)', () => {
  it('draws the address in a block anchor that truncates its own text', () => {
    render(<EmailCellRenderer value={EMAIL} field={{ name: 'email', type: 'email' } as never} />);

    const anchor = screen.getByText(EMAIL);
    expect(anchor.tagName).toBe('A');
    expect(anchor).toHaveAttribute('href', `mailto:${EMAIL}`);
    expect(anchor).toHaveClass('block', 'min-w-0', 'truncate');
    // `Button`'s own display, which put the text out of reach of the ellipsis.
    expect(anchor).not.toHaveClass('inline-flex');
  });

  it('bounds the cell to its host and keeps the copy button whole', () => {
    render(<EmailCellRenderer value={EMAIL} field={{ name: 'email', type: 'email' } as never} />);

    const cell = screen.getByText(EMAIL).parentElement as HTMLElement;
    expect(cell).toHaveClass('inline-flex', 'max-w-full');
    expect(screen.getByRole('button')).toHaveClass('shrink-0');
  });
});

describe('the url cell fits a bounded slot with an ellipsis (objectui#12523)', () => {
  it('is an inline-level block container bounded by its host', () => {
    render(<UrlCellRenderer value={SITE} field={{ name: 'site', type: 'url' } as never} />);

    const anchor = screen.getByText(SITE);
    expect(anchor.tagName).toBe('A');
    expect(anchor).toHaveAttribute('href', SITE);
    expect(anchor).toHaveClass('inline-block', 'max-w-full', 'truncate', 'align-top');
    expect(anchor).not.toHaveClass('inline-flex');
  });
});

describe('the phone cell fits a bounded slot with an ellipsis (objectui#12523)', () => {
  it('puts the number in its own truncating flex item inside the anchor', () => {
    render(<PhoneCellRenderer value={PHONE} field={{ name: 'phone', type: 'phone' } as never} />);

    const number = screen.getByText(PHONE);
    expect(number.tagName).toBe('SPAN');
    expect(number).toHaveClass('truncate');

    const anchor = number.parentElement as HTMLElement;
    expect(anchor.tagName).toBe('A');
    expect(anchor).toHaveAttribute('href', `tel:${PHONE}`);
    expect(anchor).toHaveClass('inline-flex', 'min-w-0');
    expect(anchor.querySelector('svg')).toHaveClass('shrink-0');
  });

  it('bounds the cell to its host and keeps the copy button whole', () => {
    render(<PhoneCellRenderer value={PHONE} field={{ name: 'phone', type: 'phone' } as never} />);

    const cell = screen.getByText(PHONE).closest('a')?.parentElement as HTMLElement;
    expect(cell).toHaveClass('inline-flex', 'max-w-full');
    expect(screen.getByRole('button')).toHaveClass('shrink-0');
  });
});
