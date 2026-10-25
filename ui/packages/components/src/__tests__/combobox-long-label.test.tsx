/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#3821 — a long option must ellipsize inside the trigger, not
 * render past its border.
 *
 * The selected label was a bare text child of a flex button, so
 * "成员 (showcase_project_membership)" in the sharing-rule object picker
 * overflowed the control and collided with the field beside it. Flex children
 * need `truncate` AND `min-w-0` to clip; either one alone does nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Combobox } from '../custom/combobox';

const LONG = '成员 (showcase_project_membership)';
const OPTIONS = [{ value: 'showcase_project_membership', label: LONG }];

describe('Combobox trigger with a long label', () => {
  it('renders the label in a truncating element', () => {
    render(<Combobox options={OPTIONS} value={OPTIONS[0].value} onValueChange={vi.fn()} />);
    const label = screen.getByText(LONG);
    expect(label.className).toContain('truncate');
  });

  it('lets the trigger shrink so truncation can engage', () => {
    render(<Combobox options={OPTIONS} value={OPTIONS[0].value} onValueChange={vi.fn()} />);
    // `truncate` is inert inside a flex item that refuses to shrink below its
    // content, which is what `min-w-0` on the trigger unlocks.
    expect(screen.getByRole('combobox').className).toContain('min-w-0');
  });

  it('lets a consumer widen the trigger — the 200px default must not win', () => {
    render(
      <Combobox options={OPTIONS} value={OPTIONS[0].value} onValueChange={vi.fn()} className="w-full" />,
    );
    const cls = screen.getByRole('combobox').className;
    expect(cls).toContain('w-full');
    expect(cls).not.toContain('w-[200px]');
  });

  it('truncates the placeholder too', () => {
    render(<Combobox options={OPTIONS} value="" onValueChange={vi.fn()} placeholder={LONG} />);
    expect(screen.getByText(LONG).className).toContain('truncate');
  });
});
