/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35278 — the auto-number read display carries the theme's
 * foreground token, which has a dark-mode value, instead of a fixed grey that
 * dims in dark mode. Same rule and pin shape as the summary face
 * (objectstack#34182, `summaryFaces.numberFace-11752.test.tsx`).
 * happy-dom applies no Tailwind, so the class list is the measured property.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AutoNumberField } from '../widgets/AutoNumberField';

afterEach(() => cleanup());

const noop = () => {};
const field = { type: 'auto_number', name: 'invoice_no' } as never;

/** A fixed palette shade with no `dark:` partner does not follow the theme. */
const fixedShades = (el: Element) =>
  Array.from(el.classList).filter((c) => /^text-(gray|slate|zinc|neutral|stone)-\d+$/.test(c));

describe('the auto-number read display carries a dark-mode colour (objectstack#35278)', () => {
  it.each([
    ['a formatted number', 'INV-000042'],
    ['a bare sequence', 42],
  ])('%s reads in `text-foreground`, with no fixed grey', (_label, value) => {
    const { container } = render(<AutoNumberField field={field} value={value} onChange={noop} readonly />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span).toHaveTextContent(String(value));
    expect(span).toHaveClass('text-foreground');
    expect(fixedShades(span!)).toEqual([]);
  });
});
