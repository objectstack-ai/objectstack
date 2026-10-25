/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3951, diagnostics half — a grid authored in the declared spelling
 * (`name`, the key of `GridFieldMetadata['columns']`) must render without React's missing-key
 * warning. While `GridField` read a divergent `field` key, every header, chip
 * and cell was emitted with `key={undefined}`, so a spec-compliant grid logged
 * the warning on top of rendering blank cells.
 *
 * WHY THIS LIVES IN ITS OWN FILE: React emits the missing-key warning only
 * ONCE per owner component. A second `GridField` render in the same module
 * instance observes nothing at all, so the same assertion sitting after
 * another render would pass whether or not the bug is present — green for an
 * empty reason. Vitest isolates per FILE (`isolate: true` on the `dom`
 * project), so giving the check its own file guarantees it owns the first
 * render and the observation is real. Keep it that way: do not add another
 * GridField render above it.
 *
 * The positive control below renders a deliberately key-less list first and
 * asserts the spy DOES see a warning, so a green result downstream proves the
 * detector is live rather than proving the console spy is broken.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { GridFieldMetadata } from '@object-ui/types';
import { GridField } from './GridField';

const columns: NonNullable<GridFieldMetadata['columns']> = [
  { name: 'product', label: 'Product', type: 'text' },
  { name: 'quantity', label: 'Qty', type: 'number' },
  { name: 'price', label: 'Price', type: 'currency' },
];

const field = { type: 'grid', name: 'order_items', columns } as GridFieldMetadata;

const rows = [
  { product: 'Widget A', quantity: 2, price: 29.99 },
  { product: 'Widget B', quantity: 1, price: 49.99 },
];

/** Collects everything React writes to console for the duration of a render. */
function captureConsole() {
  const messages: string[] = [];
  const record = (...args: unknown[]) => { messages.push(args.map(String).join(' ')); };
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(record);
  return {
    keyWarnings: () => messages.filter((m) => /unique "?key"?/i.test(m)),
    restore: () => { errorSpy.mockRestore(); warnSpy.mockRestore(); },
  };
}

/** Deliberately key-less — the positive control for the detector above. */
function KeylessControl(): React.ReactElement {
  return <ul>{['a', 'b'].map((v) => <li>{v}</li>)}</ul>;
}

describe('GridField emits no missing-key warning for declared-spelling columns (objectui#3951)', () => {
  it('renders spec-compliant grid metadata with no React "unique key" warning', () => {
    const capture = captureConsole();

    // Control first: prove a missing key IS observable through this spy in
    // this environment, so the assertion that follows means something.
    render(<KeylessControl />);
    expect(capture.keyWarnings().length).toBeGreaterThan(0);

    const before = capture.keyWarnings().length;
    render(<GridField value={rows} onChange={() => {}} field={field} />);
    capture.restore();

    // No NEW key warning attributable to the grid's own render.
    expect(capture.keyWarnings().length).toBe(before);
  });
});
