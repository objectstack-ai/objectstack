/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8581 — an UNPARSABLE date string drew `formatDate`'s hand-rolled
 * em-dash, and the sibling renderer one function down already disagreed.
 *
 * `DateCellRenderer` handed any value to `formatDate`, which returns its own
 * `'—'` for anything whose `new Date(...)` is invalid, and wrapped that string
 * in a SPAN classed `tabular-nums` with the raw value as `title`. So a `date`
 * column holding `not-a-date` painted naked punctuation: no `data-slot` of
 * `empty-value`, no accessible name, nothing a screen reader can name. That is
 * the objectui#8475 (`RelatedList`) / objectui#8491 (`ObjectGrid`) class of
 * defect, and objectui#8490 routed this renderer's COERCED-EMPTY input (`[]`,
 * `''`, whitespace) to the shared affordance while deliberately leaving this
 * one — the other input reaching the same dash — to a card of its own.
 *
 * ── The ruling, and the arm that was refused ──────────────────────────────
 * The maintainer seat ruled ARM 1: match `DateTimeCellRenderer` and render the
 * shared `EmptyValue`, on NEAREST-SIBLING PARITY. The sibling is one function
 * down in this same barrel, answers the IDENTICAL input
 * (`date === null || isNaN(date.getTime())`), and has returned `EmptyValue`
 * for it all along; two renderers of one data family disagreeing about one
 * input is the shape this repo keeps paying for.
 *
 * Arm 2 — print the raw text, the way `NumberCellRenderer` and
 * `PercentCellRenderer` print `String(safe)` on their NaN branch — is on the
 * record as a real argument and NOT as a mistake: "No value" is a statement
 * about a cell that does hold *something*. It lost because a *date* renderer's
 * nearest precedent is the other *date* renderer. Both arms delete the bare
 * dash; "leave it" was never an arm.
 *
 * ── The cost, measured rather than assumed ────────────────────────────────
 * Arm 1 discards the `title` the invalid branch carried (the raw value on
 * hover). Before implementing, the tree was searched for any consumer of it —
 * `ByTitle` queries, `[title=...]` selectors, `getAttribute('title')` reads,
 * snapshots, e2e specs, export paths — with lit controls on the same command
 * shapes (`getAttribute('title')`: 33 hits elsewhere; `getAttribute('data-slot')`:
 * 10). Zero read THIS `title`; `isoString` occurred only at its assignment and
 * its one use. A PARSEABLE value keeps its `title`, and the POPULATED block
 * below pins exactly that, so the half arm 1 does not touch stays measured.
 *
 * ── Why `DateTimeCellRenderer` runs here as a LIVE CONTROL ────────────────
 * The claim of this card is "the two siblings now agree". Asserting it about
 * `date` alone would be an assertion; driving BOTH through the same
 * `renderCell` command shape, in the same file, makes it a measurement — and
 * it is the control that refuses a harness which rendered nothing at all. The
 * `datetime` rows below were green BEFORE this change and must stay green:
 * they move if someone ever "unifies" the two renderers in the wrong
 * direction. The POPULATED `datetime` row is the liveness half — a harness
 * whose renderer silently produced an empty container would pass every
 * absence assertion in this file and fail that one.
 *
 * ── One sibling pin moved with this change, by its own instruction ───────
 * `cellRenderers.objectLiteral-8596.test.tsx` recorded `date` holding `{}` as
 * a dash that is NOT the affordance, and said in as many words that a fix
 * landing on this renderer "would have to move a pin rather than pass
 * silently". It did: `{}` coerces to `[Object]`, which `new Date` rejects, so
 * that row now reads the affordance. Its census row and its BOUNDARY case were
 * updated with this change — the only edit outside this file and the renderer.
 *
 * ── Why the fix is at the RENDERER and not in `formatDate` ────────────────
 * `formatDate` is a SHARED formatter in `@object-ui/core` with nine other call
 * sites (`ObjectGrid`'s two, `ObjectGantt`'s two, `DateField`, `FormulaField`,
 * `GridField`, `lookupColumnDisplay`, `dataset-format`'s measure, and
 * `data-table`'s timestamp column) — every one of them a STRING consumer that
 * has no `EmptyValue` to return, and two landed pins assert its `'—'` return
 * directly (`core`'s `date-display.optionsStyle-7745` on `'not a date'`, and
 * this package's `date-formatter-residue-4272` on the datetime twin). Moving
 * the dash at its source would change eight faces to fix one cell. The
 * renderer intercept is co-extensive with this cell and nothing else.
 *
 * ── Why the defect leg asserts the SPAN'S ABSENCE first ───────────────────
 * Same convention as objectui#8490's pin: on the unfixed tree the first
 * sentence to fail is "the value span must not be drawn around a value the
 * renderer cannot format", which is textually distinct from the failure of a
 * harness that has lost its navigation target ("the shared affordance must be
 * present"). Observed as two different sentences, not predicted.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(
    <Renderer value={value as any} field={{ type, name: type, ...field } as any} />,
  );
}

/** The shared "No value" affordance — a muted glyph carrying an aria-label. */
const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

function expectAffordance(root: HTMLElement, label: string) {
  const empty = affordance(root);
  expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
  expect(
    empty?.getAttribute('aria-label'),
    `${label}: the affordance must carry its accessible name`,
  ).toBe('No value');
}

/**
 * Every em-dash in the cell must be the shared affordance. `EmptyValue` itself
 * renders U+2014, so "no dash at all" is the wrong instrument; the defect is a
 * dash OUTSIDE it — one a screen reader reaches as bare punctuation.
 */
function handRolledDashes(root: HTMLElement): HTMLElement[] {
  return within(root)
    .queryAllByText('—')
    .filter((el) => el.getAttribute('data-slot') !== 'empty-value');
}

/**
 * Values whose `new Date(...)` is invalid, each verified against V8 before
 * being written down. `'1700000000000'` is the sharp one: the epoch as a
 * STRING does not parse (the number does — see the BOUNDARY block), so it
 * reached the dash too.
 */
const UNPARSABLE = ['not-a-date', '2024-13-45', 'tomorrow', '1700000000000'] as const;

describe('objectui#8581 — an unparsable date string is not a formatted value, and `date` drew a bare dash for it', () => {
  describe('THE DEFECT — `date` renders the shared affordance, not `formatDate`\'s hand-rolled dash', () => {
    for (const value of UNPARSABLE) {
      it(`THE DEFECT — \`date\` holding ${JSON.stringify(value)} draws no value span and no bare dash`, () => {
        const { container } = renderCell('date', value);
        expect(
          container.querySelector('span.tabular-nums'),
          `date holding ${JSON.stringify(value)}: the value span must not be drawn around a value the renderer cannot format`,
        ).toBeNull();
        expect(
          handRolledDashes(container).length,
          `date holding ${JSON.stringify(value)}: the em-dash must be the shared affordance, not a bare span a screen reader cannot name`,
        ).toBe(0);
        expectAffordance(container, `date holding ${JSON.stringify(value)}`);
      });
    }

    it('THE DEFECT — the raw value is no longer smuggled into a `title` on a span that is gone', () => {
      // The declared cost of arm 1, pinned so it is a decision on the record
      // rather than an accident: no element in the cell carries the raw text.
      const { container } = renderCell('date', 'not-a-date');
      const titled = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
      expect(
        titled,
        'date: the unformattable raw value must not survive as a hover hint on an affordance that cannot show one',
      ).not.toContain('not-a-date');
    });

    it('THE DEFECT — a due-like unparsable value is not painted red either', () => {
      // `isOverdue` compared an Invalid Date, which is never `<` anything, so
      // the colour never fired — but a repair that kept the span alive could
      // resurrect it. There is no overdue-ness in a value with no instant.
      const { container } = renderCell('date', 'not-a-date', { name: 'due_date' });
      expect(
        container.querySelector('.text-red-600'),
        'due_date: an unparsable value states no deadline, so nothing is overdue',
      ).toBeNull();
      expectAffordance(container, 'due_date holding an unparsable value');
    });
  });

  describe('LIVE CONTROL — `datetime`, the sibling this card matches (green BEFORE the change, and after)', () => {
    for (const value of UNPARSABLE) {
      it(`LIVE CONTROL — \`datetime\` holding ${JSON.stringify(value)} already answered with the affordance`, () => {
        const { container } = renderCell('datetime', value);
        expect(
          handRolledDashes(container).length,
          `datetime holding ${JSON.stringify(value)}: the sibling has never drawn a bare dash`,
        ).toBe(0);
        expectAffordance(container, `datetime holding ${JSON.stringify(value)}`);
      });
    }

    it('THE AGREEMENT — the two siblings answer the identical input with the identical DOM', () => {
      // Measured, not asserted: same command shape, same fixture, and the
      // rendered markup of the two cells compared directly.
      const dateCell = renderCell('date', 'not-a-date');
      const dateHtml = dateCell.container.innerHTML;
      cleanup();
      const dateTimeCell = renderCell('datetime', 'not-a-date');
      expect(
        dateHtml,
        '`date` and `datetime` must now render the same answer for the same unparsable input',
      ).toBe(dateTimeCell.container.innerHTML);
    });

    it('LIVE CONTROL (liveness) — `datetime` holding a real instant still draws its value span', () => {
      // Refuses a harness that renders nothing: every absence assertion above
      // would pass against an empty container, and this one would not.
      const { container } = renderCell('datetime', '2024-07-04T07:00:00.000Z');
      const span = container.querySelector('span.tabular-nums');
      expect(span, 'datetime: a real instant must still draw its value span').not.toBeNull();
      expect(span?.textContent, 'datetime: a real instant must render a formatted value').toMatch(/2024/);
      expect(affordance(container), 'datetime: a real instant must NOT render the affordance').toBeNull();
    });
  });

  describe('POPULATED — these refuse an EMPTY-for-everything implementation', () => {
    it('POPULATED — a real ISO date still renders in its value span, and KEEPS its `title`', () => {
      // The half arm 1 does not touch. The hover hint is discarded only on the
      // branch whose span is gone; a parseable value keeps the ISO instant.
      const { container } = renderCell('date', '2024-01-15T00:00:00.000Z', { format: 'short' });
      const span = container.querySelector('span.tabular-nums');
      expect(span, 'date: a real date must still draw its value span').not.toBeNull();
      expect(span?.textContent, 'date: a real date must render a formatted value').toMatch(/24/);
      expect(span?.getAttribute('title'), 'date: a real date keeps its ISO hover hint').toBe(
        '2024-01-15T00:00:00.000Z',
      );
      expect(handRolledDashes(container).length, 'date: a real date draws no dash').toBe(0);
      expect(affordance(container), 'date: a real date must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a past due_date is still "Overdue Nd" in red', () => {
      const past = new Date();
      past.setDate(past.getDate() - 6);
      // Declared (objectui#11815): overdue is declared-only, the name guesses nothing.
      const { container } = renderCell('date', past.toISOString(), { name: 'due_date', dueLike: true });
      const span = container.querySelector('span.tabular-nums');
      expect(span?.textContent, 'due_date: a real past date must still read Overdue').toMatch(/Overdue/);
      expect(span?.className, 'due_date: a real past date must still be red').toMatch(/text-red-600/);
      expect(affordance(container), 'due_date: a real past date must NOT render the affordance').toBeNull();
    });
  });

  describe('THE BOUNDARY — the guard is co-extensive with the dash it replaces, never wider', () => {
    it('THE BOUNDARY — a numeric epoch timestamp still renders (the guard must not stringify)', () => {
      // `coerceToSafeValue` returns a number unchanged, and `new Date(number)`
      // is valid while `new Date(String(number))` is NOT. A guard written on
      // `String(safe)` would blank a column that renders today — this row is
      // what catches that.
      const { container } = renderCell('date', 1700000000000, { format: 'short' });
      const span = container.querySelector('span.tabular-nums');
      expect(span, 'date: a numeric timestamp must still draw its value span').not.toBeNull();
      expect(span?.textContent, 'date: a numeric timestamp must render a formatted value').toMatch(/23/);
      expect(affordance(container), 'date: a numeric timestamp must NOT render the affordance').toBeNull();
    });

    it('THE BOUNDARY — a `Date` instance still renders (it coerces to a parseable ISO string)', () => {
      const { container } = renderCell('date', new Date('2024-01-15T00:00:00.000Z'), { format: 'short' });
      const span = container.querySelector('span.tabular-nums');
      expect(span, 'date: a Date instance must still draw its value span').not.toBeNull();
      expect(span?.getAttribute('title'), 'date: a Date instance keeps its ISO hover hint').toBe(
        '2024-01-15T00:00:00.000Z',
      );
      expect(affordance(container), 'date: a Date instance must NOT render the affordance').toBeNull();
    });

    it('THE BOUNDARY — the coerced-EMPTY inputs objectui#8490 swept still land on the same affordance', () => {
      // The seam with the neighbouring card: `[]`, `''` and whitespace were
      // already routed here, and this change must not move them anywhere else.
      for (const value of [[], '', '   '] as const) {
        const { container } = renderCell('date', value);
        expect(
          handRolledDashes(container).length,
          `date holding ${JSON.stringify(value)}: objectui#8490's routing is unchanged`,
        ).toBe(0);
        expectAffordance(container, `date holding ${JSON.stringify(value)}`);
        cleanup();
      }
    });
  });
});
