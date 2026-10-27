/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { InlineEditProvider } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';

/**
 * objectstack#25883 item 1 — the read-mode inline-edit pencil was revealed on
 * HOVER only (`opacity-0 group-hover:opacity-100`). It is a real `<button>`, so
 * a keyboard Tab stop landed on it while it stayed fully transparent: the
 * focus ring the shared `Button` draws was painted at opacity 0.
 *
 * The pencil must now also show while it, or anything else in its field, has
 * keyboard focus, in both places it is drawn: the details body
 * (`DetailSection`) and the highlights strip (`HeaderHighlight`). Hover and
 * double-click behave exactly as before.
 *
 * jsdom has no layout and no CSS engine, so "visible on focus" cannot be
 * measured here. What these tests pin is the contract a browser turns into
 * visibility: the pencil is a focusable button, it carries the focus-reveal
 * utilities next to the unchanged hover reveal, the shared focus ring is still
 * on it, and the `group` its `group-*` variants resolve against is its own
 * field. Activation and double-click are asserted behaviourally.
 *
 * The pencil is found by its icon, not by its localized label, so the tests
 * hold in every locale.
 */

const pencilButtons = (root: HTMLElement): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll('svg.lucide-pencil')).map(
    (svg) => svg.closest('button') as HTMLButtonElement,
  );

function expectFocusRevealContract(pencil: HTMLButtonElement) {
  // A real, enabled, tabbable control: the Tab stop the defect is about.
  expect(pencil.tagName).toBe('BUTTON');
  expect(pencil).not.toBeDisabled();
  expect(pencil.getAttribute('tabindex')).not.toBe('-1');
  pencil.focus();
  expect(pencil).toHaveFocus();

  const cls = pencil.classList;
  // Hidden at rest, revealed on hover: unchanged.
  expect(cls.contains('opacity-0')).toBe(true);
  expect(cls.contains('group-hover:opacity-100')).toBe(true);
  // Revealed on keyboard focus of the pencil itself …
  expect(cls.contains('focus-visible:opacity-100')).toBe(true);
  // … and while focus is anywhere inside its field (e.g. a lookup's link).
  expect(cls.contains('group-focus-within:opacity-100')).toBe(true);
  // The shared Button's focus ring survives the className merge, so the
  // revealed pencil also shows where focus is.
  expect(cls.contains('focus-visible:ring-2')).toBe(true);

  // `group-*` variants resolve against the nearest `.group` ancestor; it must
  // be this field's own wrapper, so focus in one field reveals only its pencil.
  const group = pencil.closest('.group');
  expect(group).not.toBeNull();
  expect(pencilButtons(group as HTMLElement)).toEqual([pencil]);
}

describe('DetailSection read-mode pencil — keyboard focus reveal (#25883)', () => {
  beforeAll(() => {
    // useIsMobile() keys off window.innerWidth; the desktop row carries the pencil.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  const objectSchema = {
    fields: {
      title: { type: 'text' },
      city: { type: 'text' },
      score: { type: 'formula' },
    },
  };
  const section: DetailViewSection = {
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'city', label: 'City' },
      { name: 'score', label: 'Score' },
    ],
  } as DetailViewSection;
  const data = { title: 'Hello', city: 'Paris', score: 42 };

  it('draws one focus-revealed pencil per editable field, none on a computed one', () => {
    const { container } = render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        onEnterInlineEdit={vi.fn()}
      />,
    );
    const pencils = pencilButtons(container);
    expect(pencils).toHaveLength(2); // title + city; the formula has none
    pencils.forEach(expectFocusRevealContract);
  });

  it('activating the focused pencil enters inline edit on its own field', () => {
    const onEnter = vi.fn();
    const { container } = render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        onEnterInlineEdit={onEnter}
      />,
    );
    const [titlePencil, cityPencil] = pencilButtons(container);
    cityPencil.focus();
    // Enter / Space on a native <button> dispatch `click`.
    fireEvent.click(cityPencil);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith('city');
    expect(titlePencil).not.toHaveFocus();
  });

  it('double-click on the value still enters inline edit', () => {
    const onEnter = vi.fn();
    render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        onEnterInlineEdit={onEnter}
      />,
    );
    fireEvent.doubleClick(screen.getByText('Hello'));
    expect(onEnter).toHaveBeenCalledWith('title');
  });

  it('draws no pencil when the record offers no inline edit', () => {
    const { container } = render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} />,
    );
    expect(pencilButtons(container)).toHaveLength(0);
  });
});

describe('HeaderHighlight pencil — keyboard focus reveal (#25883)', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  const objectSchema = {
    fields: {
      owner: { type: 'text' },
      score: { type: 'formula' },
    },
  };
  const fields = [
    { name: 'owner', label: 'Owner' },
    { name: 'score', label: 'Score' },
  ] as any;
  const data = { owner: 'Alice', score: '99' };

  it('draws a focus-revealed pencil on the editable highlight only', () => {
    const { container } = render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
      </InlineEditProvider>,
    );
    const pencils = pencilButtons(container);
    expect(pencils).toHaveLength(1); // owner; the formula has none
    expectFocusRevealContract(pencils[0]);
  });

  it('activating the focused pencil enters the shared edit session', () => {
    const { container } = render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
      </InlineEditProvider>,
    );
    const [pencil] = pencilButtons(container);
    pencil.focus();
    fireEvent.click(pencil);
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
  });

  it('double-click on the highlight still enters the shared edit session', () => {
    render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
      </InlineEditProvider>,
    );
    fireEvent.doubleClick(screen.getByText('Alice'));
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
  });

  it('draws no pencil when the record is not editable', () => {
    const { container } = render(
      <InlineEditProvider canEdit={false}>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
      </InlineEditProvider>,
    );
    expect(pencilButtons(container)).toHaveLength(0);
  });
});
