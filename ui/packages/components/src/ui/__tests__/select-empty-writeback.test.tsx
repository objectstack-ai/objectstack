/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `Select` must never echo an empty string back to its owner (#2968).
 *
 * Radix keeps a hidden native `<select>` mirror so the value participates in
 * native form submission. Assigning a value the mirror has no `<option>` for is
 * a no-op — the element stays on `''` — yet Radix still dispatches the
 * synthetic `change`, which surfaces as `onValueChange('')`. Since the option
 * set registers a commit AFTER the trigger mounts, any value that lands while a
 * form is still hydrating hits that window and gets written back as `''`,
 * wiping the field the caller just set.
 *
 * `SelectItem` rejects `value=""`, so `''` is never a value a user picked; the
 * wrapper drops it and forwards every real selection unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { act } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';

const OPTIONS = [
  { label: '00 Production', value: 'production' },
  { label: '01 Quality', value: 'quality' },
];

function Harness({
  value,
  options = OPTIONS,
  onValueChange,
}: {
  value?: string;
  options?: typeof OPTIONS;
  onValueChange: (v: string) => void;
}) {
  return (
    <form>
      <Select name="category" value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </form>
  );
}

describe('Select — empty-string write-back (#2968)', () => {
  it('does not report a value when the controlled value is not among the options', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<Harness value={undefined} onValueChange={onValueChange} />);

    // The owner sets a value the mirror carries no <option> for — exactly what
    // a record landing before the option set registers looks like.
    rerender(<Harness value="not-offered" onValueChange={onValueChange} />);

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('does not report a value while the option list is still empty', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<Harness value={undefined} options={[]} onValueChange={onValueChange} />);

    rerender(<Harness value="production" options={[]} onValueChange={onValueChange} />);
    expect(onValueChange).not.toHaveBeenCalled();

    // …and the value survives once the options do arrive.
    rerender(<Harness value="production" options={OPTIONS} onValueChange={onValueChange} />);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('stays quiet when a controlled value the options do carry is applied', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<Harness value={undefined} onValueChange={onValueChange} />);

    rerender(<Harness value="production" onValueChange={onValueChange} />);

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('still forwards a real selection', () => {
    const onValueChange = vi.fn();
    const { container } = render(<Harness onValueChange={onValueChange} />);

    // Drive the hidden native mirror the way Radix does when a user picks an
    // option — the trigger/listbox itself needs pointer capture that jsdom
    // cannot provide, but this is the same event path the value travels.
    const mirror = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      mirror.value = 'quality';
      mirror.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onValueChange).toHaveBeenCalledWith('quality');
  });
});
