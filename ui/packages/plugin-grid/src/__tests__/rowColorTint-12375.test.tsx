/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12375 — a `rowColor` row reads in the dark theme, and its tint
 * covers the whole row.
 *
 * Before: each colour name resolved to one light-only `bg-*-100`, so the dark
 * theme put its light text on a light fill; and every sticky cell (frozen
 * columns, the right-pinned actions column) painted its own `bg-background`,
 * so the tint stopped short of both ends of the row.
 *
 * Now each name resolves to the `--os-row-tint` custom property, a light and a
 * dark value, painted by the row and layered by every sticky cell over its
 * opaque `bg-background`.
 *
 * What these pins cannot see: happy-dom loads no stylesheet, so they pin the
 * classes, not the painted colour. The painted colours and their contrast
 * ratios, in both themes, were measured once in Chromium for the PR.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObjectGrid } from '../ObjectGrid';
import { useRowColor } from '../useRowColor';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'useRowColor.ts'), 'utf8');

/** The 23 colour names the card counts, each with the palette hue it paints. */
const NAMES: ReadonlyArray<readonly [name: string, hue: string]> = [
  ['red', 'red'], ['green', 'green'], ['blue', 'blue'], ['yellow', 'yellow'],
  ['orange', 'orange'], ['purple', 'purple'], ['pink', 'pink'], ['gray', 'gray'],
  ['grey', 'gray'], ['indigo', 'indigo'], ['teal', 'teal'], ['cyan', 'cyan'],
  ['amber', 'amber'], ['lime', 'lime'], ['emerald', 'emerald'], ['rose', 'rose'],
  ['sky', 'sky'], ['violet', 'violet'], ['fuchsia', 'fuchsia'], ['slate', 'slate'],
  ['zinc', 'zinc'], ['stone', 'stone'], ['neutral', 'neutral'],
];

/** The layer a sticky cell paints over its opaque fill. */
const STICKY_ROW_TINT =
  'bg-[image:linear-gradient(var(--os-row-tint,transparent),var(--os-row-tint,transparent))]';

function resolve(value: string): string | undefined {
  const { result } = renderHook(() => useRowColor({ field: 'tone', colors: { [value]: value } }));
  return result.current({ tone: value });
}

const tokens = (cls: string | undefined) => (cls ?? '').split(/\s+/).filter(Boolean);

afterEach(() => cleanup());

describe('every colour name resolves to a light and a dark tint (objectui#12375)', () => {
  it('CONTROL: the list is the 23 names', () => {
    expect(new Set(NAMES.map(([n]) => n)).size).toBe(23);
  });

  it.each(NAMES)('%s resolves to a light value, a dark value, and the surface that paints them', (name, hue) => {
    const t = tokens(resolve(name));
    expect(t).toContain('bg-[color:var(--os-row-tint)]');
    expect(t).toContain(`[--os-row-tint:var(--color-${hue}-100)]`);
    const dark = t.filter((c) => c.startsWith('dark:'));
    expect(dark).toHaveLength(1);
    expect(dark[0]).toMatch(
      new RegExp(`^dark:\\[--os-row-tint:color-mix\\(in_oklab,var\\(--color-${hue}-(950\\)_40|800\\)_50)%,transparent\\)\\]$`),
    );
  });

  it.each(NAMES)('%s sets no text colour: a tint is a surface', (name) => {
    expect(tokens(resolve(name)).filter((c) => /(^|:)text-/.test(c))).toEqual([]);
  });

  it.each(NAMES)('%s: every class it emits is spelled out whole in the source Tailwind scans', (name) => {
    // Tailwind v4 compiles only class tokens it finds verbatim in scanned
    // source; a token assembled at runtime would reach the DOM unstyled.
    for (const c of tokens(resolve(name))) expect(SOURCE).toContain(c);
  });

  it('an authored `bg-*` class still passes through verbatim', () => {
    expect(resolve('bg-red-200')).toBe('bg-red-200');
  });
});

describe('the tint reaches the right-pinned actions column and the frozen column (objectui#12375)', () => {
  function renderGrid() {
    const schema = {
      type: 'object-grid',
      objectName: 'test_object',
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'subject', label: 'Subject' },
      ],
      data: {
        provider: 'value',
        items: [
          { id: '1', name: 'Tinted', subject: 'S1', priority: 'critical' },
          { id: '2', name: 'Plain', subject: 'S2', priority: 'low' },
        ],
      },
      rowActionDefs: [{ name: 'open', label: 'Open', variant: 'primary' }],
      rowColor: { field: 'priority', colors: { critical: 'red' } },
    } as React.ComponentProps<typeof ObjectGrid>['schema'];
    return render(
      <ActionProvider>
        <ObjectGrid schema={schema} />
      </ActionProvider>,
    );
  }

  const rowOf = (label: string) => screen.getByText(label).closest('tr') as HTMLTableRowElement;
  const stickyCells = (tr: HTMLTableRowElement) =>
    Array.from(tr.querySelectorAll(':scope > td')).filter((td) => tokens(td.className).includes('sticky'));

  it('a tinted row carries its tint, and each of its sticky cells layers it over an opaque fill', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-open').length).toBe(2));
    const tr = rowOf('Tinted');
    expect(tokens(tr.className)).toContain('[--os-row-tint:var(--color-red-100)]');
    // The row's own "no tint" default gave way to the tint.
    expect(tokens(tr.className)).not.toContain('[--os-row-tint:transparent]');

    const sticky = stickyCells(tr);
    const actions = screen.getAllByTestId('row-action-inline-open')[0].closest('td')!;
    // CONTROL: the row number, the frozen Name column and the right-pinned
    // actions column (the grid shows row numbers and freezes its first
    // column by default).
    expect(sticky).toHaveLength(3);
    expect(sticky[0]).toHaveTextContent('1');
    expect(sticky[1]).toHaveTextContent('Tinted');
    expect(sticky[2]).toBe(actions);
    for (const td of sticky) {
      const t = tokens(td.className);
      expect(t).toContain(STICKY_ROW_TINT);
      // Opaque: the only unconditional background colour is the theme's.
      expect(t.filter((c) => c.startsWith('bg-') && !c.startsWith('bg-[image:'))).toEqual(['bg-background']);
    }
  });

  it('an untinted row keeps no tint, so its sticky cells paint `bg-background` alone', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-open').length).toBe(2));
    const tr = rowOf('Plain');
    expect(tokens(tr.className)).toContain('[--os-row-tint:transparent]');
    expect(tokens(tr.className).filter((c) => c.startsWith('[--os-row-tint:var('))).toEqual([]);
    for (const td of stickyCells(tr)) expect(tokens(td.className)).toContain('bg-background');
  });

  it('the actions column HEADER does not take the row layer', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-open').length).toBe(2));
    const headers = Array.from(document.querySelectorAll('th'));
    const actionsHeader = headers[headers.length - 1];
    expect(tokens(actionsHeader.className)).toContain('right-0');
    expect(tokens(actionsHeader.className)).not.toContain(STICKY_ROW_TINT);
  });
});
