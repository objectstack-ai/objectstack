// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26194 — with a query in the type picker's search, the
 * highlighted row is the first type the query names, so Enter picks it.
 *
 * Typing "Number" on a Phone field used to leave Phone highlighted: Phone's
 * description ("A phone number.") matches the query as a whole word, its
 * group comes first, and the list highlights its first row. Enter then
 * re-chose Phone and committed nothing.
 *
 * With an empty query the current type stays highlighted, and re-choosing it
 * still commits nothing. The search itself is objectui#12516's and is pinned
 * in `FieldTypePicker.search-12516.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '../i18n';
import { FieldTypePicker } from './FieldTypePicker';

beforeEach(() => {
  // Radix reads pointer capture, which the DOM double does not implement.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
});

afterEach(cleanup);

async function open(value: string) {
  const onCommit = vi.fn();
  render(<FieldTypePicker label="Type" value={value} onCommit={onCommit} locale="en-US" />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
  const search = await screen.findByRole('combobox', { name: t('designer.canvas.searchFieldType', 'en-US') });
  return { onCommit, search };
}

/** The listed type ids, in order. */
const shownTypes = () => screen.getAllByRole('option').map((o) => o.getAttribute('data-field-type'));
/** The type id of the highlighted row. */
const highlighted = () =>
  screen
    .getAllByRole('option')
    .filter((o) => o.getAttribute('aria-selected') === 'true')
    .map((o) => o.getAttribute('data-field-type'));

describe('FieldTypePicker — Enter picks the first match (objectstack#26194)', () => {
  it('on a Phone field, typing "Number" and pressing Enter commits Number', async () => {
    const { search, onCommit } = await open('phone');
    await userEvent.type(search, 'Number');
    // Phone is still listed, first, by its description: the case the card names.
    expect(shownTypes()[0]).toBe('phone');
    expect(highlighted()).toEqual(['number']);
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('number');
  });

  it('with an empty query the current type is highlighted, and Enter commits nothing', async () => {
    const { onCommit } = await open('phone');
    expect(highlighted()).toEqual(['phone']);
    await userEvent.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clearing the query highlights the current type again', async () => {
    const { search } = await open('phone');
    await userEvent.type(search, 'Number');
    expect(highlighted()).toEqual(['number']);
    await userEvent.clear(search);
    expect(highlighted()).toEqual(['phone']);
  });

  it('the arrow keys still move on from the highlighted match', async () => {
    const { search, onCommit } = await open('phone');
    await userEvent.type(search, 'Number');
    const types = shownTypes();
    const next = types[types.indexOf('number') + 1];
    expect(next).toBeDefined();
    await userEvent.keyboard('{ArrowDown}');
    expect(highlighted()).toEqual([next]);
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith(next);
  });

  it('a query that names no type highlights the first row', async () => {
    const { search, onCommit } = await open('phone');
    // "masked" is only in the descriptions of Password and Secret.
    await userEvent.type(search, 'masked');
    expect(shownTypes()).toEqual(['password', 'secret']);
    expect(highlighted()).toEqual(['password']);
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('password');
  });
});
