/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36321 — the currency code picker is readable by a form host that
 * reads its fields off the DOM.
 *
 * The master-detail form's line grid reads the header's live values from the
 * header's named elements and re-reads them on each bubbling `input` /
 * `change` event (`scrapeHeaderRecord` in `@object-ui/plugin-form`). The
 * picker's only element in the form is its trigger, which carries the field's
 * `name`: it read as the empty string, so a New Invoice in the home currency
 * read as "no currency chosen" and a picked product's price was withheld from
 * the line. These pin the two halves of the read: the trigger's `value` is the
 * code, and a pick bubbles a `change` from the trigger once the new code is on
 * it.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { CurrencyCodePicker } from '../custom/currency-code-picker';

const labels = { placeholder: 'Pick a currency', search: 'Search', noResults: 'None', available: 'Available', all: 'All' };

function Host({ initial, onRead }: { initial?: string; onRead: (value: string) => void }) {
  const [value, setValue] = React.useState(initial);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const host = ref.current!;
    // The form host's read: the named element's value, on a bubbling change.
    const read = () => onRead((host.querySelector('[name="currency_code"]') as HTMLButtonElement).value);
    host.addEventListener('change', read);
    return () => host.removeEventListener('change', read);
  }, [onRead]);
  return (
    <div ref={ref}>
      <CurrencyCodePicker name="currency_code" value={value} onChange={setValue} home="USD" locale="en" labels={labels} />
    </div>
  );
}

describe('CurrencyCodePicker read by a DOM-reading form host (objectstack#36321)', () => {
  it('the named trigger carries the selected code as its value', () => {
    render(<Host initial="USD" onRead={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLButtonElement).value).toBe('USD');
  });

  it('with no code the trigger value is empty, never a code of its own', () => {
    render(<Host onRead={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLButtonElement).value).toBe('');
  });

  it('a pick bubbles one change from the trigger, read after the new code is on it', async () => {
    const reads: string[] = [];
    render(<Host initial="USD" onRead={(v) => reads.push(v)} />);
    // Opening on the seeded code announces nothing: only a changed code does.
    expect(reads).toEqual([]);

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /^EUR/ }));

    await waitFor(() => expect(reads).toEqual(['EUR']));
    expect((screen.getByRole('combobox') as HTMLButtonElement).value).toBe('EUR');
  });
});
