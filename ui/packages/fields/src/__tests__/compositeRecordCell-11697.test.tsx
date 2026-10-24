/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11697: a `composite` or `record` value read as its stored JSON on
 * the record page — `{"width":10,"height":20}` in a monospace face — because
 * the cell-renderer table mapped both types to `JsonCellRenderer`. They now
 * draw labelled sub-values on one line.
 *
 * Every case resolves its renderer through `getCellRenderer`, the resolver the
 * record page and the grid both call, so a regressed table entry goes red here
 * and not only a regressed renderer. The record-page end of the path is pinned
 * in `@object-ui/plugin-detail`'s `DetailSection.compositeRecord-11697`.
 *
 * Values are the platform's own producers where one exists: the showcase Field
 * Zoo seeds `f_composite` / `f_record`, and the SQL driver's fidelity test and
 * the dogfood field-zoo matrix write a `record` whose entries are scalars.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import type { FieldMetadata } from '@object-ui/types';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way `DetailSection` builds a read-mode value. */
function renderCell(type: string, value: unknown) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  const field = { type, name: `f_${type}` } as unknown as FieldMetadata;
  return render(<Renderer value={value} field={field} />);
}

/** What assistive technology reads in an element: its text minus `aria-hidden` nodes. */
function spokenText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return (clone.textContent ?? '').trim();
}

/** The `dt` / `dd` pairs directly under one `<dl>`, as spoken. */
function pairsOf(list: Element): Array<[term: string, definition: string]> {
  return Array.from(list.querySelectorAll(':scope > div')).map((group) => [
    spokenText(group.querySelector(':scope > dt')!),
    spokenText(group.querySelector(':scope > dd')!),
  ]);
}

/** The face's outer `<dl>`; fails loudly when the cell drew something else. */
function outerList(container: HTMLElement): HTMLElement {
  const outer = container.firstElementChild as HTMLElement | null;
  expect(outer?.tagName, 'the face is a description list').toBe('DL');
  return outer!;
}

describe('objectui#11697 — composite and record values render as labelled sub-values', () => {
  it('a composite value renders each sub-field as a labelled pair, not as its JSON', () => {
    // The Field Zoo seed for `f_composite`, the value the card reported.
    const { container } = renderCell('composite', { width: 10, height: 20 });
    const outer = outerList(container);

    expect(pairsOf(outer)).toEqual([
      ['Width', '10'],
      ['Height', '20'],
    ]);
    expect(container.textContent).toBe('Width 10 · Height 20');
    expect(container.textContent, 'no stored-JSON signature').not.toMatch(/[{}"]/);
  });

  it('a record value renders one labelled group per entry name, holding that entry’s pairs', () => {
    // The Field Zoo seed for `f_record`.
    const { container } = renderCell('record', {
      primary: { name: 'A', score: 9 },
      backup: { name: 'B', score: 7 },
    });
    const outer = outerList(container);

    const entries = Array.from(outer.querySelectorAll(':scope > div'));
    expect(entries.map((entry) => spokenText(entry.querySelector(':scope > dt')!))).toEqual([
      'Primary',
      'Backup',
    ]);
    const groups = entries.map((entry) => entry.querySelector(':scope > dd > dl')!);
    expect(pairsOf(groups[0])).toEqual([
      ['Name', 'A'],
      ['Score', '9'],
    ]);
    expect(pairsOf(groups[1])).toEqual([
      ['Name', 'B'],
      ['Score', '7'],
    ]);
    expect(container.textContent).toBe('Primary (Name A · Score 9) · Backup (Name B · Score 7)');
    expect(container.textContent, 'no stored-JSON signature').not.toMatch(/[{}"]/);
  });

  it('a record entry that is not a sub-object is drawn as a pair, with no group', () => {
    // The shape the SQL driver's fidelity test and the dogfood matrix write.
    const { container } = renderCell('record', { home: '+1', work: '+2' });
    const outer = outerList(container);

    expect(pairsOf(outer)).toEqual([
      ['Home', '+1'],
      ['Work', '+2'],
    ]);
    expect(outer.querySelector('dd dl'), 'a scalar entry opens no group').toBeNull();
  });

  it('a nested object or array inside a sub-value stays compact JSON', () => {
    const composite = renderCell('composite', { size: { w: 1 }, tags: ['a', 'b'] });
    expect(pairsOf(outerList(composite.container))).toEqual([
      ['Size', '{"w":1}'],
      ['Tags', '["a","b"]'],
    ]);
    expect(
      composite.container.querySelector('dd dl'),
      'a composite never groups: its sub-field holds an object, it is not a map entry',
    ).toBeNull();
    cleanup();

    const record = renderCell('record', { primary: { dims: { w: 1 } } });
    expect(record.container.textContent).toBe('Primary (Dims {"w":1})');
  });

  it('each scalar sub-value reads through this package’s face for its type', () => {
    const { container } = renderCell('composite', {
      total: 1234.5,
      active: true,
      archived: false,
      note: null,
      code: 'x-1',
    });
    const pairs = pairsOf(outerList(container));

    // The number is the `number` cell's own text for a field with no `scale`:
    // compared against that cell, not against a literal, so the two agree by
    // construction rather than by a copy.
    const numberCell = render(
      React.createElement(getCellRenderer('number'), {
        value: 1234.5,
        field: { type: 'number', name: 'n' } as FieldMetadata,
      }),
    );
    expect(pairs[0]).toEqual(['Total', numberCell.container.textContent]);
    expect(pairs[0][1], 'grouped, natural precision').toBe('1,234.5');
    // A boolean is the locale's word, the boolean-as-text face.
    expect(pairs[1]).toEqual(['Active', 'Yes']);
    expect(pairs[2]).toEqual(['Archived', 'No']);
    // A floor member is the shared affordance, with its accessible name.
    const noteValue = outerList(container).querySelectorAll(':scope > div > dd')[3];
    expect(
      noteValue.querySelector('[data-slot="empty-value"]')?.getAttribute('aria-label'),
      'an unset sub-value is the shared "No value" affordance',
    ).toBe('No value');
    expect(pairs[4]).toEqual(['Code', 'x-1']);
  });

  it('the face is one truncated line whose title carries the full text', () => {
    const { container } = renderCell('record', {
      primary: { name: 'A', score: 9 },
      backup: { name: 'B', score: 7 },
    });
    const outer = outerList(container);
    for (const token of ['block', 'max-w-full', 'truncate']) {
      expect(outer.classList.contains(token), `the line carries \`${token}\``).toBe(true);
    }
    expect(outer.getAttribute('title'), 'the hover text is the line itself').toBe(container.textContent);
  });
});

describe('objectui#11697 — what does NOT move', () => {
  for (const type of ['composite', 'record'] as const) {
    it(`\`${type}\`: the floor and the unrecognized shapes answer exactly as the JSON cell does`, () => {
      for (const empty of [null, undefined, '']) {
        const { container } = renderCell(type, empty);
        expect(
          container.querySelector('[data-slot="empty-value"]'),
          `${type} holding ${JSON.stringify(empty)}: the shared affordance`,
        ).not.toBeNull();
        expect(container.querySelector('dl')).toBeNull();
        cleanup();
      }
      // The literals objectui#8474 and objectui#8481's fence pinned, and a
      // string that happens to hold JSON: drawn as it is, never parsed.
      for (const [input, text] of [
        [[], '[]'],
        [{}, '{}'],
        ['{"width":10}', '{"width":10}'],
      ] as const) {
        const { container } = renderCell(type, input);
        expect(container.textContent, `${type} holding ${JSON.stringify(input)}`).toBe(text);
        expect(container.querySelector('dl')).toBeNull();
        cleanup();
      }
    });
  }

  it('`json` and `object` keep the compact JSON face', () => {
    for (const type of ['json', 'object']) {
      const { container } = renderCell(type, { width: 10, height: 20 });
      expect(container.textContent, `${type}: a free-form JSON value reads as JSON`).toBe(
        '{"width":10,"height":20}',
      );
      cleanup();
    }
  });
});
