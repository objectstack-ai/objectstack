/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The EXPENSIVE half of objectui#8496: proof that putting the floor in
 * `@object-ui/core` FLATTENED NOTHING.
 *
 * The ruling (director seat, decision batch #86, option B) is two clauses, and
 * only the second one is hard: the floor goes below every consumer, AND every
 * surface that answers differently keeps its own answer. A suite that only
 * proves `isEmptyValue` works proves the clause nobody doubted. So every case
 * below asserts a DISAGREEMENT with the floor — either a member this renderer
 * DECLINES, or an extension it makes past the four.
 *
 * ⛔ If one of these goes red because a renderer now "just calls the floor",
 * that is not a test to update. It is the flattening the ruling forbids.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { getCellRenderer, resolveCellRendererType } from '../index';
import { isEmptyValue } from '@object-ui/core';

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

/** The four floor members, by name. */
const FLOOR: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ["''", ''],
  ['[]', []],
];

describe('objectui#8496 — @object-ui/fields renderers against the floor', () => {
  /**
   * The renderers whose guard IS the floor, with no clause of their own. These
   * are the cases the promotion had to keep byte-identical.
   */
  describe('THE FLOOR REACHED — every member answered by the shared affordance', () => {
    for (const type of ['select', 'status', 'multiselect', 'tags', 'lookup', 'master_detail', 'text', 'formula', 'color']) {
      for (const [label, value] of FLOOR) {
        it(`\`${type}\` holding ${label} draws the affordance`, () => {
          const { container } = renderCell(type, value, { options: [{ value: 'a', label: 'A' }] });
          expect(
            affordance(container),
            `${type} holding ${label}: the floor member lost its affordance`,
          ).not.toBeNull();
        });
      }
    }
  });

  /**
   * ⛔ THE DECLENSIONS. Each of these renderers calls `[]` a VALUE, and each
   * one was measured before it was allowed to. The floor says `[]` is empty;
   * these four say otherwise, out loud, in code.
   */
  describe('⛔ NOT FLATTENED — the renderers that DECLINE the floor’s `[]` member', () => {
    it('the floor itself calls [] empty — the premise these cases disagree with', () => {
      expect(isEmptyValue([])).toBe(true);
    });

    for (const type of ['json', 'object', 'composite', 'record']) {
      it(`\`${type}\` holding [] still prints the array literal (objectui#8474, pinned)`, () => {
        const { container } = renderCell(type, []);
        expect(
          container.textContent,
          `${type}: the two-character literal is the measured answer here`,
        ).toContain('[]');
        expect(
          affordance(container),
          `${type} holding []: drawing the affordance flattens objectui#8474`,
        ).toBeNull();
      });
    }

    for (const type of ['location', 'geolocation', 'address']) {
      it(`\`${type}\` holding [] keeps the unknown shape visible through its JSON fallback`, () => {
        const { container } = renderCell(type, []);
        expect(container.textContent, `${type}: an unknown shape must stay visible`).toContain('[]');
        expect(
          affordance(container),
          `${type} holding []: swallowing the shape is what the JSON fallback exists to prevent`,
        ).toBeNull();
      });
    }

    for (const type of ['file', 'video', 'audio']) {
      it(`\`${type}\` holding [] states its COUNT rather than "No value"`, () => {
        const { container } = renderCell(type, []);
        expect(
          container.textContent,
          `${type}: "0 files" is an answer the em-dash cannot give`,
        ).toContain('0');
        expect(
          affordance(container),
          `${type} holding []: the count is the measured answer here`,
        ).toBeNull();
      });
    }
  });

  /**
   * ⛔ THE EXTENSIONS. Each renderer below calls something EMPTY that the floor
   * calls a value. Deleting the extension would leave a green floor and a
   * broken cell.
   */
  describe('⛔ NOT FLATTENED — the renderers that answer MORE than the floor', () => {
    it('`boolean` calls every NON-BOOLEAN empty — the floor says nothing about them (objectui#8582)', () => {
      for (const [label, value] of [["the string 'false'", 'false'], ['0', 0], ['{}', {}], ["'x'", 'x']] as Array<[string, unknown]>) {
        expect(isEmptyValue(value), `${label} is not a floor member`).toBe(false);
        const { container } = renderCell('boolean', value);
        expect(
          affordance(container),
          `boolean holding ${label}: only a real boolean is a value of a boolean column`,
        ).not.toBeNull();
      }
    });

    it('⛔ but `false` STAYS A VALUE — the member the floor must never grow', () => {
      const { container } = renderCell('boolean', false, { name: 'completed' });
      expect(
        affordance(container),
        'boolean holding false: a stored false is a value, not a blank',
      ).toBeNull();
    });

    for (const type of ['date', 'datetime']) {
      it(`\`${type}\` deliberately calls the numeric EPOCH empty — its \`!value\` extension`, () => {
        expect(isEmptyValue(0), '0 is not a floor member').toBe(false);
        const { container } = renderCell(type, 0);
        expect(
          affordance(container),
          `${type} holding 0: the epoch is empty here on purpose (the ruling names this one)`,
        ).not.toBeNull();
      });
    }

    it('`user` extends the floor with every falsy scalar', () => {
      const { container } = renderCell('user', 0);
      expect(
        affordance(container),
        'user holding 0: an unresolved reference of zero is not a user',
      ).not.toBeNull();
    });

    for (const type of ['number', 'currency', 'percent', 'email', 'url', 'phone']) {
      it(`\`${type}\` extends the floor with WHITESPACE, on the coerced text`, () => {
        expect(isEmptyValue('   '), "'   ' is not a floor member").toBe(false);
        const { container } = renderCell(type, '   ');
        expect(
          affordance(container),
          `${type} holding '   ': Number('  ') is 0, a digit the record never held`,
        ).not.toBeNull();
      });
    }

    it('⛔ but `text` does NOT trim — the floor exactly, and the disagreement is the point', () => {
      const { container } = renderCell('text', '   ');
      expect(
        affordance(container),
        "text holding '   ': a stored string keeps its spaces; the trim belongs to the coercing renderers",
      ).toBeNull();
    });
  });
});
