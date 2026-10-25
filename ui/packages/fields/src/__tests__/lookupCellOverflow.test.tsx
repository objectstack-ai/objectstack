/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A multi-value lookup cell used to render EVERY referenced record as its own
 * chip. With a large reference set (the reported production cell held 60+
 * work objects) the chips wrapped line after line and a single grid row grew
 * to several screens of height, blowing the page layout apart.
 *
 * The cell now caps the chips at MAX_LOOKUP_CELL_CHIPS (3) and collapses the
 * rest into one "+N" chip — the same pattern UserCellRenderer has always used
 * for its avatar stack. The hidden display names stay reachable through the
 * overflow chip's `title`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { LookupCellRenderer } from '../index';

const FIELD = { type: 'lookup', reference: 'mtc_work_object' } as any;

const manyRecords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `obj-${i + 1}`, name: `ZTLW-A.${i + 1}` }));

describe('LookupCellRenderer — multi-value overflow cap', () => {
  it('renders at most 3 chips plus a "+N" overflow chip', () => {
    render(<LookupCellRenderer value={manyRecords(60)} field={FIELD} />);

    expect(screen.getByText('ZTLW-A.1')).toBeInTheDocument();
    expect(screen.getByText('ZTLW-A.2')).toBeInTheDocument();
    expect(screen.getByText('ZTLW-A.3')).toBeInTheDocument();
    // The 4th and later references are collapsed, not rendered as chips.
    expect(screen.queryByText('ZTLW-A.4')).toBeNull();
    expect(screen.getByText('+57')).toBeInTheDocument();
  });

  it('keeps the hidden display names reachable on the overflow chip title', () => {
    render(<LookupCellRenderer value={manyRecords(5)} field={FIELD} />);

    const overflow = screen.getByText('+2');
    expect(overflow).toHaveAttribute('title', 'ZTLW-A.4, ZTLW-A.5');
  });

  it('renders no overflow chip when the set fits the cap', () => {
    render(<LookupCellRenderer value={manyRecords(3)} field={FIELD} />);

    expect(screen.getByText('ZTLW-A.3')).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it('caps primitive-id arrays the same way', () => {
    const options = Array.from({ length: 10 }, (_, i) => ({
      value: `id-${i + 1}`,
      label: `Label ${i + 1}`,
    }));
    render(
      <LookupCellRenderer
        value={options.map((o) => o.value)}
        field={{ ...FIELD, options }}
      />,
    );

    expect(screen.getByText('Label 3')).toBeInTheDocument();
    expect(screen.queryByText('Label 4')).toBeNull();
    const overflow = screen.getByText('+7');
    expect(overflow.getAttribute('title')).toContain('Label 4');
    expect(overflow.getAttribute('title')).toContain('Label 10');
  });
});
