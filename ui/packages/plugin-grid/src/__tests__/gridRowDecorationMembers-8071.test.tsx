/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8071 slice 12 — the MEMBER shapes `object-grid` reads inside its two
 * row-DECORATION keys, `rowColor` and `conditionalFormatting`.
 *
 * ## Why these two are pinned in ONE file
 *
 * They are one read. `ObjectGrid.tsx` builds the `DataTable` props with
 * `rowClassName` and `rowStyle` on ADJACENT lines, each gated on its own key,
 * and `data-table.tsx` applies both to the SAME `<tr>` — one through `cn(…)`,
 * one through the inline `style` attribute. Reading either key's members
 * without the other in view is how the last row of this file
 * (`neither key is the other's gate`) stays unwritten.
 *
 * ## What the registration cannot say, which is the whole reason for a pin
 *
 * `object-grid` registers `rowColor` as an OBJECT-armed input and
 * `conditionalFormatting` as an ARRAY-armed one. Neither arm says a word about
 * what is read INSIDE one — and inside one is where both keys live:
 * `rowColor` is a pair of co-required members (`field` names a RECORD field,
 * `colors` maps ITS value), and a formatting rule carries THREE alternative
 * predicate spellings with a precedence between them plus four style members,
 * one of which is RENAMED on the way to the DOM. That is the objectui#8068
 * criterion: constrain the shape the RENDERER READS, not the registration.
 *
 * ## Most of a rule's members are STORED-rule reads now (objectui#11533)
 *
 * Since objectui#11533 the grid's authoring faces take ONE rule dialect, the
 * spec list view's `{ condition, style }`: `expression`, the native
 * `field`/`operator`/`value` triple and the three top-level colour members
 * (`backgroundColor`, `borderColor`, `textColor`) are refused by name on
 * `ObjectGridSchema` and on the list view. The RENDERER still reads every one
 * of them: `resolveConditionalFormatting` keeps each arm as a compatibility
 * read for a grid or list view STORED in the retired dialect, and nothing on
 * the render path parses a stored node. So the rows below that write those
 * members are not authoring examples — they pin what a stored rule still
 * paints, and the last `describe` pins the two facts side by side: refused
 * at authoring, painted at render.
 *
 * ## Read through the real renderer, asserted on the `<tr>`
 *
 * Every case below renders the real `ObjectGrid` over inline data and reads the
 * row element the browser would paint. A unit call on `useRowColor` or
 * `resolveConditionalFormatting` is green against a grid that never passes the
 * resolver to the table at all — which is exactly the shape of the defect this
 * card exists for, so the assertion has to be taken at the row.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGridSchema } from '@object-ui/types/zod';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

function renderGrid(rows: Record<string, unknown>[], opts: Record<string, unknown> = {}) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: rows },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
}

/**
 * The colour classes `useRowColor` emitted onto one row, isolated from the
 * table's own base classes.
 *
 * `<tr>` always carries `bg-background`, `hover:bg-muted/40`, two
 * `data-[state=selected]:bg-…` tokens and an untinted `--os-row-tint`, so a
 * bare "contains `bg-`" reads TRUE on every row of every grid and would make
 * each absence below vacuous. The shapes matched here are exactly what
 * `colorToClass` can emit: a named colour's tint, which sets `--os-row-tint`
 * to a palette colour (objectui#12375), and the `bg-*` pass-through arm, a
 * bare, unprefixed `bg-<hue>-<step>`.
 */
function rowColourClasses(tr: HTMLTableRowElement): string[] {
  return tr.className
    .split(/\s+/)
    .filter((c) => /^bg-[a-z]+-\d+$/.test(c) || c.startsWith('[--os-row-tint:var(--color-'));
}

/** The `<tr>` the browser would paint for the row whose `name` is `label`. */
function rowOf(label: string): HTMLTableRowElement {
  const cell = screen.getByText(label);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no <tr> for row ${label}`);
  return tr as HTMLTableRowElement;
}

afterEach(() => cleanup());

describe('object-grid `rowColor` — the two members the row-className resolver reads', () => {
  it('reads `field` as a RECORD field name and `colors` as the map keyed by ITS value', () => {
    renderGrid(
      [
        { id: '1', name: 'Open row', status: 'open' },
        { id: '2', name: 'Closed row', status: 'closed' },
        { id: '3', name: 'Archived row', status: 'archived' },
      ],
      { rowColor: { field: 'status', colors: { open: 'green', closed: 'red' } } },
    );

    // The member pair is a LOOKUP, not a constant: two rows of the same grid
    // get two different classes, decided by the value in the named field.
    expect(rowOf('Open row').className).toContain('var(--color-green-100)');
    expect(rowOf('Closed row').className).toContain('var(--color-red-100)');
    // …and a value the author did not declare gets NO colour class at all —
    // the control that keeps the two rows above from reading as "some class
    // is always added".
    expect(rowColourClasses(rowOf('Archived row'))).toEqual([]);
  });

  it('keys the map by the STRINGIFIED value, so an absent field lands on the author\'s empty-string entry', () => {
    renderGrid(
      [
        { id: '1', name: 'Numeric row', status: 1 },
        { id: '2', name: 'Empty row' },
        { id: '3', name: 'Null row', status: null },
      ],
      { rowColor: { field: 'status', colors: { '1': 'blue', '': 'gray' } } },
    );

    // `String(row[field] ?? '')`: a number matches the map's string key…
    expect(rowOf('Numeric row').className).toContain('var(--color-blue-100)');
    // …and BOTH ways of having no value collapse onto the SAME `''` entry,
    // which is the only way an author can colour "not set yet". Drop the
    // `?? ''` and `null` becomes the key `"null"`, which no author writes.
    expect(rowOf('Empty row').className).toContain('var(--color-gray-100)');
    expect(rowOf('Null row').className).toContain('var(--color-gray-100)');
  });

  it('requires BOTH members — `field` without `colors` colours nothing', () => {
    renderGrid([{ id: '1', name: 'Alone', status: 'open' }], {
      rowColor: { field: 'status' },
    });
    expect(rowColourClasses(rowOf('Alone'))).toEqual([]);
  });

  it('requires BOTH members — `colors` without `field` colours nothing', () => {
    renderGrid([{ id: '1', name: 'Alone', status: 'open' }], {
      rowColor: { colors: { open: 'green' } },
    });
    expect(rowColourClasses(rowOf('Alone'))).toEqual([]);
  });

  it('CONTROL — the same data with the complete pair DOES colour, so the two absences above are about the members', () => {
    renderGrid([{ id: '1', name: 'Alone', status: 'open' }], {
      rowColor: { field: 'status', colors: { open: 'green' } },
    });
    expect(rowOf('Alone').className).toContain('var(--color-green-100)');
  });

  it('reads a map VALUE as a colour NAME or an already-built `bg-*` class, and hands back nothing for anything else', () => {
    renderGrid(
      [
        { id: '1', name: 'Named', tone: 'teal' },
        { id: '2', name: 'Prebuilt', tone: 'bg-red-200' },
        { id: '3', name: 'Freeform', tone: 'rebeccapurple' },
      ],
      {
        rowColor: {
          field: 'tone',
          colors: { teal: 'teal', 'bg-red-200': 'bg-red-200', rebeccapurple: '#663399' },
        },
      },
    );

    expect(rowOf('Named').className).toContain('var(--color-teal-100)');
    expect(rowOf('Prebuilt').className).toContain('bg-red-200');
    // A colour Tailwind has no static class for is dropped rather than emitted
    // as a class attribute of its own — a `class="#663399"` would be a silent
    // no-op the author could only find by reading the DOM.
    expect(rowOf('Freeform').className).not.toContain('#663399');
    expect(rowOf('Freeform').className).not.toContain('rebeccapurple');
    expect(rowColourClasses(rowOf('Freeform'))).toEqual([]);
  });
});

describe('object-grid `conditionalFormatting` — the members read inside ONE rule (retired ones as STORED-rule reads, objectui#11533)', () => {
  it('reads `condition` in preference to `expression` and to the native field/operator/value triple', () => {
    renderGrid(
      [
        { id: '1', name: 'Alpha' },
        { id: '2', name: 'Beta' },
        { id: '3', name: 'Gamma' },
      ],
      {
        conditionalFormatting: [
          {
            // Three predicate members in ONE rule, each naming a different row.
            condition: "record.name == 'Alpha'",
            expression: "record.name == 'Beta'",
            field: 'name',
            operator: 'equals',
            value: 'Gamma',
            backgroundColor: 'rgb(1, 2, 3)',
          },
        ],
      },
    );

    expect(rowOf('Alpha').style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(rowOf('Beta').style.backgroundColor).toBe('');
    expect(rowOf('Gamma').style.backgroundColor).toBe('');
  });

  it('falls to `expression` when `condition` is absent, and only then to field/operator/value', () => {
    renderGrid(
      [
        { id: '1', name: 'Beta' },
        { id: '2', name: 'Gamma' },
      ],
      {
        conditionalFormatting: [
          {
            expression: "record.name == 'Beta'",
            field: 'name',
            operator: 'equals',
            value: 'Gamma',
            backgroundColor: 'rgb(4, 5, 6)',
          },
        ],
      },
    );

    expect(rowOf('Beta').style.backgroundColor).toBe('rgb(4, 5, 6)');
    expect(rowOf('Gamma').style.backgroundColor).toBe('');
  });

  it('CONTROL — the native triple decides when it is the only predicate member present', () => {
    renderGrid(
      [
        { id: '1', name: 'Beta' },
        { id: '2', name: 'Gamma' },
      ],
      {
        conditionalFormatting: [
          { field: 'name', operator: 'equals', value: 'Gamma', backgroundColor: 'rgb(7, 8, 9)' },
        ],
      },
    );

    expect(rowOf('Gamma').style.backgroundColor).toBe('rgb(7, 8, 9)');
    expect(rowOf('Beta').style.backgroundColor).toBe('');
  });

  it('RENAMES `textColor` to the CSS `color` member, and keeps the other two under their own names', () => {
    renderGrid([{ id: '1', name: 'Painted' }], {
      conditionalFormatting: [
        {
          condition: "record.name == 'Painted'",
          backgroundColor: 'rgb(10, 20, 30)',
          textColor: 'rgb(40, 50, 60)',
          borderColor: 'rgb(70, 80, 90)',
        },
      ],
    });

    const tr = rowOf('Painted');
    expect(tr.style.backgroundColor).toBe('rgb(10, 20, 30)');
    expect(tr.style.borderColor).toBe('rgb(70, 80, 90)');
    // The member an author writes is `textColor`; the member the DOM receives
    // is `color`. Keeping the authored spelling hands React a style key it does
    // not know, which it drops in silence — the row keeps its background and
    // loses its text colour with nothing thrown and nothing logged.
    expect(tr.style.color).toBe('rgb(40, 50, 60)');
  });

  it('reads `style` as the BASE the three colour members override', () => {
    renderGrid([{ id: '1', name: 'Layered' }], {
      conditionalFormatting: [
        {
          condition: "record.name == 'Layered'",
          style: { backgroundColor: 'rgb(0, 0, 255)', fontWeight: 'bold' },
          backgroundColor: 'rgb(255, 0, 0)',
        },
      ],
    });

    const tr = rowOf('Layered');
    // The colour member WINS over the same key inside `style`…
    expect(tr.style.backgroundColor).toBe('rgb(255, 0, 0)');
    // …and a `style` member the colour trio does not name survives, which is
    // what makes the line above an override rather than a replacement.
    expect(tr.style.fontWeight).toBe('bold');
  });

  it('is FIRST-MATCH-WINS across rules — the later matching rule contributes nothing, not even its own keys', () => {
    renderGrid([{ id: '1', name: 'Both' }], {
      conditionalFormatting: [
        { condition: "record.name == 'Both'", backgroundColor: 'rgb(11, 11, 11)' },
        { condition: "record.name == 'Both'", backgroundColor: 'rgb(22, 22, 22)', textColor: 'rgb(33, 33, 33)' },
      ],
    });

    const tr = rowOf('Both');
    expect(tr.style.backgroundColor).toBe('rgb(11, 11, 11)');
    // Not a merge: the second rule's `textColor` never lands, because the
    // second rule is never consulted.
    expect(tr.style.color).toBe('');
  });

  it('SKIPS a rule carrying no predicate member at all, rather than reading it as always-true', () => {
    renderGrid(
      [
        { id: '1', name: 'First' },
        { id: '2', name: 'Second' },
      ],
      {
        conditionalFormatting: [
          // No `condition`, no `expression`, and an incomplete native triple
          // (`operator` missing) — nothing to evaluate.
          { field: 'name', backgroundColor: 'rgb(99, 99, 99)' },
          { condition: "record.name == 'Second'", backgroundColor: 'rgb(12, 34, 56)' },
        ],
      },
    );

    // The predicate-less rule paints NOTHING — not every row…
    expect(rowOf('First').style.backgroundColor).toBe('');
    // …and it does not swallow the rules after it either.
    expect(rowOf('Second').style.backgroundColor).toBe('rgb(12, 34, 56)');
  });
});

describe('object-grid — the two decoration keys reach the SAME row and neither is the other\'s gate', () => {
  it('applies the className from `rowColor` and the inline style from `conditionalFormatting` to one `<tr>`', () => {
    renderGrid([{ id: '1', name: 'Decorated', status: 'open' }], {
      rowColor: { field: 'status', colors: { open: 'green' } },
      conditionalFormatting: [
        { condition: "record.status == 'open'", backgroundColor: 'rgb(13, 13, 13)' },
      ],
    });

    const tr = rowOf('Decorated');
    expect(tr.className).toContain('var(--color-green-100)');
    expect(tr.style.backgroundColor).toBe('rgb(13, 13, 13)');
  });

  it('each key still decorates when the other is absent', () => {
    renderGrid([{ id: '1', name: 'ColourOnly', status: 'open' }], {
      rowColor: { field: 'status', colors: { open: 'green' } },
    });
    expect(rowOf('ColourOnly').className).toContain('var(--color-green-100)');
    expect(rowOf('ColourOnly').style.backgroundColor).toBe('');
    cleanup();

    renderGrid([{ id: '1', name: 'StyleOnly', status: 'open' }], {
      conditionalFormatting: [
        { condition: "record.status == 'open'", backgroundColor: 'rgb(14, 14, 14)' },
      ],
    });
    expect(rowColourClasses(rowOf('StyleOnly'))).toEqual([]);
    expect(rowOf('StyleOnly').style.backgroundColor).toBe('rgb(14, 14, 14)');
  });
});

describe('object-grid — a rule STORED in a retired dialect is refused at authoring and still paints (objectui#11533)', () => {
  /** The native rule, exactly as a grid stored before objectui#11533 carries it. */
  const STORED = { field: 'name', operator: 'equals', value: 'Gamma', backgroundColor: 'rgb(7, 8, 9)' };
  /** Its `{ condition, style }` respelling, the one dialect the authoring faces take. */
  const RESPELLED = { condition: "record.name == 'Gamma'", style: { backgroundColor: 'rgb(7, 8, 9)' } };
  const ROWS = [
    { id: '1', name: 'Beta' },
    { id: '2', name: 'Gamma' },
  ];
  const doc = (rule: unknown) => ({ type: 'object-grid', objectName: 'test_object', conditionalFormatting: [rule] });

  it('the authoring face refuses the stored native rule BY NAME, and the real grid still paints its row', () => {
    const parsed = ObjectGridSchema.safeParse(doc(STORED));
    expect(parsed.success).toBe(false);
    const atField = parsed.error!.issues.find((i) => i.path.join('.') === 'conditionalFormatting.0.field');
    expect(atField?.message).toContain('RETIRED (objectui#11533)');

    // Render is not a validation door: the stored rule reaches the resolver,
    // which keeps the native arm as a compatibility read.
    renderGrid(ROWS, { conditionalFormatting: [STORED] });
    expect(rowOf('Gamma').style.backgroundColor).toBe('rgb(7, 8, 9)');
    expect(rowOf('Beta').style.backgroundColor).toBe('');
  });

  it('CONTROL — the respelling is accepted at authoring and paints the SAME row with the same colour', () => {
    expect(ObjectGridSchema.safeParse(doc(RESPELLED)).success).toBe(true);
    renderGrid(ROWS, { conditionalFormatting: [RESPELLED] });
    expect(rowOf('Gamma').style.backgroundColor).toBe('rgb(7, 8, 9)');
    expect(rowOf('Beta').style.backgroundColor).toBe('');
  });
});
