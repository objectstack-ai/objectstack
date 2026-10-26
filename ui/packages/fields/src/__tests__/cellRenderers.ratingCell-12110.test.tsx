/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `rating` cell draws stars (objectui#12110 item 2, finding A-03 of the
 * HotCRM browser pass).
 *
 * The standard cell table mapped `rating` to `NumberCellRenderer`, so a list
 * column, a detail row and a related list showed a bare `4` for a value the
 * form draws as four of five stars. The cell now draws the same star row as
 * `RatingField`'s read-only branch, out of the field's declared `max` (5 when
 * none is declared — `Field.rating`'s own default), with the value and the
 * scale as the accessible text.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer } from '../index';

afterEach(() => cleanup());

function renderRating(value: unknown, field: Record<string, unknown> = {}) {
  const Cell = getCellRenderer('rating');
  return render(<Cell value={value} field={{ name: 'score', type: 'rating', ...field } as never} />);
}

const stars = (c: HTMLElement) => Array.from(c.querySelectorAll('svg.lucide-star'));
const filled = (c: HTMLElement) => stars(c).filter((s) => s.getAttribute('class')?.includes('fill-'));

describe('the `rating` cell draws stars (objectui#12110 item 2)', () => {
  it('THE DEFECT — 4 of a declared 5 is four filled stars of five, not the digit 4', () => {
    const { container } = renderRating(4, { max: 5 });
    expect(stars(container)).toHaveLength(5);
    expect(filled(container)).toHaveLength(4);
    // The value and the scale stay readable to assistive tech.
    expect(container.textContent).toContain('4 / 5');
  });

  it('reads the declared `max`, and 5 when none is declared', () => {
    const ten = renderRating(7, { max: 10 });
    expect(stars(ten.container)).toHaveLength(10);
    expect(filled(ten.container)).toHaveLength(7);
    cleanup();
    const undeclared = renderRating(2);
    expect(stars(undeclared.container)).toHaveLength(5);
    expect(filled(undeclared.container)).toHaveLength(2);
  });

  it('CONTROL: a value that is not a number keeps the text face, and no star', () => {
    const { container } = renderRating('n/a');
    expect(stars(container)).toHaveLength(0);
    expect(container.textContent).toBe('n/a');
  });
});
