// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12516 — the type picker's search: the list opens with its search
 * input focused at the top; a query filters on the type's name, api value and
 * description (`pick` leaves Picklist alone, `look` leaves Lookup); each group
 * keeps its heading over its matches and a group with none is dropped; the
 * arrow keys move through the matches and Enter picks one.
 *
 * The search over names, categories and ids is objectui#11793's and is pinned
 * in `ObjectFieldInspector.typePicker-11793.test.tsx`; this suite pins what
 * #12516 adds and the queries its card names, on the picker alone.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t, type SupportedLocale } from '../i18n';
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

async function open(locale: SupportedLocale = 'en-US', value = 'text') {
  const onCommit = vi.fn();
  render(<FieldTypePicker label="Type" value={value} onCommit={onCommit} locale={locale} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));
  const search = await screen.findByRole('combobox', { name: t('designer.canvas.searchFieldType', locale) });
  return { onCommit, search };
}

/** The listed type ids, in order. */
const shownTypes = () => screen.getAllByRole('option').map((o) => o.getAttribute('data-field-type'));
/** The group headings over the list, in order. */
const shownHeadings = () =>
  Array.from(document.querySelectorAll('[cmdk-group-heading]')).map((h) => h.textContent);

describe('FieldTypePicker — the search (objectui#12516)', () => {
  it('opens with the search input focused, above the list', async () => {
    const { search } = await open();
    expect(search).toHaveFocus();
    const list = screen.getByRole('listbox');
    expect(search.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('typing "pick" shows Picklist only, under its Selection heading', async () => {
    const { search } = await open();
    await userEvent.type(search, 'pick');
    expect(shownTypes()).toEqual(['select']);
    expect(shownHeadings()).toEqual([t('engine.fieldCategory.selection', 'en-US')]);
  });

  it('typing "look" shows Lookup only, under its Relation heading', async () => {
    const { search } = await open();
    await userEvent.type(search, 'look');
    expect(shownTypes()).toEqual(['lookup']);
    expect(shownHeadings()).toEqual([t('engine.fieldCategory.relation', 'en-US')]);
  });

  it('a whole word of a description finds the type; case does not matter', async () => {
    const { search } = await open();
    // Password ("Text that is masked when it is read back.") and Secret
    // ("… masked when read back."): no name, category or id holds "masked".
    await userEvent.type(search, 'MASKED');
    expect(shownTypes()).toEqual(['password', 'secret']);
  });

  it('a description matches on whole words only: "picked" finds Slider, "pick" does not', async () => {
    const { search } = await open();
    await userEvent.type(search, 'picked');
    expect(shownTypes()).toEqual(['slider']);
    await userEvent.clear(search);
    await userEvent.type(search, 'pick');
    expect(shownTypes()).not.toContain('slider');
  });

  it('the groups keep their headings over the matches, in catalog order, and a group with none is dropped', async () => {
    const { search } = await open();
    // "address" is in Email's description ("An email address.") and is the
    // Address type's own name, in two different groups.
    await userEvent.type(search, 'address');
    const types = shownTypes();
    expect(types).toContain('email');
    expect(types).toContain('address');
    const headings = shownHeadings();
    expect(headings[0]).toBe(t('engine.fieldCategory.text', 'en-US'));
    expect(headings).not.toContain(t('engine.fieldCategory.number', 'en-US'));
    for (const heading of document.querySelectorAll('[cmdk-group]')) {
      expect(within(heading as HTMLElement).queryAllByRole('option').length).toBeGreaterThan(0);
    }
  });

  it('the arrow keys move through the matches and Enter picks the highlighted one', async () => {
    const { search, onCommit } = await open();
    await userEvent.type(search, 'select');
    // The Selection group, by its heading, in catalog order: Picklist first.
    expect(shownTypes()).toEqual(['select', 'multiselect', 'radio', 'checkboxes']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('multiselect');
  });

  it('zh: a query in Han script finds a type by a substring of its zh description', async () => {
    const { search } = await open('zh-CN');
    const desc = t('engine.fieldTypeDesc.password', 'zh-CN');
    const name = t('engine.fieldType.password', 'zh-CN');
    // A run of the description that the name does not hold.
    const query = [...desc].find((c) => /\p{Script=Han}/u.test(c) && !name.includes(c));
    expect(query).toBeDefined();
    await userEvent.type(search, query!);
    expect(shownTypes()).toContain('password');
  });
});
