/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3344 — the combobox trigger must not submit an enclosing form.
 *
 * An HTML <button> defaults to `type="submit"` inside a <form>, and Radix's
 * PopoverTrigger does not preventDefault on click — so a Combobox rendered
 * inside an object form (object-ref / recipient-picker field widgets)
 * submitted the form on every click of its dropdown trigger. The trigger now
 * declares `type="button"`, placed BEFORE the #3318 pass-through spread so a
 * consumer who explicitly passes `type` (e.g. `type="submit"`) still wins.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Combobox } from '../custom/combobox';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('Combobox trigger inside a form', () => {
  it('defaults to type="button" and does not submit the form on click', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />
      </form>,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('type', 'button');
    fireEvent.click(trigger);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still opens the popover when clicked inside a form', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />
      </form>,
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('lets an explicit type="submit" override the default (#3318 pass-through ordering)', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Combobox options={OPTIONS} value="" onValueChange={vi.fn()} type="submit" />
      </form>,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('type', 'submit');
    fireEvent.click(trigger);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
