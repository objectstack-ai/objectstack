/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';

/**
 * objectstack#26329 — the read-mode copy-to-clipboard button on a copyable,
 * non-editable field was revealed on HOVER only (`opacity-0
 * group-hover:opacity-100`). It is a real `<button>`, so a keyboard Tab stop
 * landed on it while it stayed fully transparent: the focus ring the shared
 * `Button` draws was painted at opacity 0. The inline-edit pencil beside it had
 * the same defect and was fixed the same way (objectstack#25883; its pin is
 * `inlineEditPencil.focusReveal-25883.test.tsx`).
 *
 * The copy button must now also show while it, or anything else in its field
 * (the field's own click-to-copy row is a Tab stop too), has keyboard focus.
 * Hover behaves exactly as before.
 *
 * jsdom has no layout and no CSS engine, so "visible on focus" cannot be
 * measured here. What these tests pin is the contract a browser turns into
 * visibility: the copy button is a focusable button, it carries the
 * focus-reveal utilities next to the unchanged hover reveal, the shared focus
 * ring is still on it, and the `group` its `group-*` variants resolve against
 * is its own field. Activation is asserted behaviourally.
 *
 * The copy button is found by its icon, not by its localized label, so the
 * tests hold in every locale.
 */

const copyButtons = (root: HTMLElement): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll('svg.lucide-copy')).map(
    (svg) => svg.closest('button') as HTMLButtonElement,
  );

function expectFocusRevealContract(copy: HTMLButtonElement) {
  // A real, enabled, tabbable control: the Tab stop the defect is about.
  expect(copy.tagName).toBe('BUTTON');
  expect(copy).not.toBeDisabled();
  expect(copy.getAttribute('tabindex')).not.toBe('-1');
  copy.focus();
  expect(copy).toHaveFocus();

  const cls = copy.classList;
  // Hidden at rest, revealed on hover: unchanged.
  expect(cls.contains('opacity-0')).toBe(true);
  expect(cls.contains('group-hover:opacity-100')).toBe(true);
  // Revealed on keyboard focus of the copy button itself …
  expect(cls.contains('focus-visible:opacity-100')).toBe(true);
  // … and while focus is anywhere inside its field (e.g. its click-to-copy row).
  expect(cls.contains('group-focus-within:opacity-100')).toBe(true);
  // The shared Button's focus ring survives the className merge, so the
  // revealed button also shows where focus is.
  expect(cls.contains('focus-visible:ring-2')).toBe(true);

  // `group-*` variants resolve against the nearest `.group` ancestor; it must
  // be this field's own wrapper, so focus in one field reveals only its button.
  const group = copy.closest('.group');
  expect(group).not.toBeNull();
  expect(copyButtons(group as HTMLElement)).toEqual([copy]);
}

describe('DetailSection read-mode copy button — keyboard focus reveal (#26329)', () => {
  beforeAll(() => {
    // useIsMobile() keys off window.innerWidth; the desktop row carries the button.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  afterEach(() => {
    cleanup();
  });

  const objectSchema = {
    fields: {
      title: { type: 'text' },
      city: { type: 'text' },
      notes: { type: 'text' },
    },
  };
  const section: DetailViewSection = {
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'city', label: 'City' },
      { name: 'notes', label: 'Notes' },
    ],
  } as DetailViewSection;
  const data = { title: 'Hello', city: 'Paris', notes: '' };

  it('draws one focus-revealed copy button per copyable field, none on an empty one', () => {
    const { container } = render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} />,
    );
    const buttons = copyButtons(container);
    expect(buttons).toHaveLength(2); // title + city; the empty `notes` offers no copy
    buttons.forEach(expectFocusRevealContract);
  });

  it('focus on the field row sits inside the same group as its copy button', () => {
    const { container } = render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} />,
    );
    const [titleCopy] = copyButtons(container);
    const group = titleCopy.closest('.group') as HTMLElement;
    // The click-to-copy row is itself a Tab stop; focusing it is what
    // `group-focus-within` turns into the button's reveal.
    const row = group.querySelector('[role="button"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('tabindex')).toBe('0');
    row.focus();
    expect(row).toHaveFocus();
    expect(group.contains(document.activeElement)).toBe(true);
  });

  it('activating the focused copy button copies its own field', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { container } = render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} />,
    );
    const [, cityCopy] = copyButtons(container);
    cityCopy.focus();
    // Enter / Space on a native <button> dispatch `click`.
    fireEvent.click(cityCopy);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('Paris');
  });

  it('draws no copy button on an editable field (the pencil takes its place)', () => {
    const { container } = render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        onEnterInlineEdit={vi.fn()}
      />,
    );
    expect(copyButtons(container)).toHaveLength(0);
  });
});
