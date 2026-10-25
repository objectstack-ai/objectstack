/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10639: the readonly `PasswordField` widget drew the set-credential
 * mask for an EMPTY value too.
 *
 * Its readonly branch never read `value`, so `null`, `undefined` and `''` drew
 * exactly the mask a set credential draws. That is the defect objectui#8678
 * fixed on the cell path (`MaskedCellRenderer`), against the same platform
 * read contract: `SECRET_MASK` (imported below) is served only for a set
 * credential, and an unset one "reads back `null` instead, never this mask".
 *
 * ── The ruling this implements (triage on the card) ───────────────────────
 * "the cell's shape, i.e. the cell's empty predicate and `<EmptyValue />` for
 * an empty value, and the mask only for a present one. ⛔ The value is never
 * printed; ⛔ no weaker mask for a set value."
 *
 * ── What refuses the caricature ───────────────────────────────────────────
 * The caricature is "draw `EmptyValue` for everything", which satisfies every
 * EMPTY row here. `PRESENT` refuses it: a set value, `{}` and a whitespace-only
 * string must render the readonly mask this widget drew before the card,
 * BYTE-FOR-BYTE. The literal bytes are pinned, because "unchanged" is the claim.
 * `THE RULE` refuses a second, drifting predicate: the widget must call a value
 * empty exactly when the `password` CELL does.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SECRET_MASK } from '@objectstack/spec/data';
import { PasswordField } from '../widgets/PasswordField';
import { getCellRenderer, type CellRendererProps } from '../index';

afterEach(() => cleanup());

/** The readonly face a SET credential drew before this card, as bytes. */
const READONLY_MASK = '<span class="text-sm">••••••••</span>';

const BULLET = '•';

const noop = () => {};

function renderWidget(value: unknown, readonly: boolean) {
  return render(
    <PasswordField
      value={value as string}
      onChange={noop}
      readonly={readonly}
      field={{ type: 'password', name: 'secret_key' } as never}
    />,
  );
}

function renderPasswordCell(value: unknown) {
  const Renderer = getCellRenderer('password');
  const field = { type: 'password', name: 'secret_key' } as unknown as CellRendererProps['field'];
  return render(<Renderer value={value} field={field} />);
}

const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

/** Nothing is stored: the widget must say so, and must not draw the mask. */
const EMPTY: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ["''", ''],
];

/**
 * Something IS stored: the mask stays. `{}` is a value per objectui#8596's
 * string-class ruling, and a whitespace-only string is a set credential.
 * `forbidden` is the value's own text, which must never reach the DOM. The
 * byte-equality to `READONLY_MASK` already proves that for every row; the list
 * says it out loud where the value's text is distinguishable from the mask.
 * `SECRET_MASK` is what the platform serves for a set credential on a masked
 * read, and its text is the same eight bullets, so it carries no list.
 */
const PRESENT: ReadonlyArray<readonly [label: string, value: unknown, forbidden: readonly string[]]> = [
  ["'hunter2'", 'hunter2', ['hunter2']],
  ['SECRET_MASK', SECRET_MASK, []],
  ['{}', {}, ['[object Object]', '[Object]', '{}']],
  ["'   '", '   ', []],
];

describe('objectui#10639 — the readonly password widget says "No value" when nothing is stored', () => {
  describe('EMPTY — the shared affordance, and no bullet at all', () => {
    for (const [label, value] of EMPTY) {
      it(`EMPTY — readonly holding ${label} draws the affordance, not the mask`, () => {
        const { container } = renderWidget(value, true);
        // Defect-absence FIRST: on the unfixed tree this is the sentence that
        // fails (the set-credential mask over nothing).
        expect(container.innerHTML, `${label}: nothing is stored, so the mask is a false claim`).not.toBe(
          READONLY_MASK,
        );
        expect(container.textContent, `${label}: no bullet character may be drawn`).not.toContain(BULLET);
        const empty = affordance(container);
        expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
        expect(empty?.getAttribute('aria-label'), `${label}: it must carry its accessible name`).toBe('No value');
      });
    }
  });

  describe('PRESENT — the mask stays, byte for byte, and the value is never printed', () => {
    for (const [label, value, forbidden] of PRESENT) {
      it(`PRESENT — readonly holding ${label} keeps the pre-card mask`, () => {
        const { container } = renderWidget(value, true);
        expect(affordance(container), `${label}: this is a stored value`).toBeNull();
        expect(container.innerHTML, `${label}: the set-credential mask is unchanged`).toBe(READONLY_MASK);
        for (const text of forbidden) {
          expect(container.innerHTML, `${label}: the stored value must never reach the DOM`).not.toContain(text);
        }
      });
    }
  });

  describe('THE RULE — the widget calls a value empty exactly when the `password` cell does', () => {
    it('THE RULE — for every census input, widget and cell agree on "empty"', () => {
      const census: ReadonlyArray<readonly [string, unknown]> = [
        ...EMPTY,
        ...PRESENT.map(([label, value]) => [label, value] as const),
        ['[]', []],
        ["['']", ['']],
        ["['x']", ['x']],
      ];
      let cellEmptyCount = 0;
      let cellPresentCount = 0;
      for (const [label, value] of census) {
        const cell = renderPasswordCell(value);
        const cellEmpty = affordance(cell.container) !== null;
        cleanup();
        if (cellEmpty) cellEmptyCount++;
        else cellPresentCount++;
        const { container } = renderWidget(value, true);
        expect(affordance(container) !== null, `${label}: widget and cell must agree on "empty"`).toBe(cellEmpty);
        if (!cellEmpty) expect(container.innerHTML, `${label}: a stored value keeps the mask`).toBe(READONLY_MASK);
        cleanup();
      }
      // Lit control: the census really separates the inputs, so agreement is
      // not "both always empty" or "both always masked".
      expect(cellEmptyCount, 'the cell calls some census inputs empty').toBeGreaterThan(0);
      expect(cellPresentCount, 'the cell calls some census inputs stored').toBeGreaterThan(0);
    });
  });

  describe('CONTROL — the editable widget is unchanged', () => {
    it('CONTROL — an editable widget holding a value is a password input carrying it, not a display', () => {
      const { container } = renderWidget('hunter2', false);
      const input = container.querySelector('input');
      expect(input, 'the editable branch renders an input').not.toBeNull();
      expect(input?.getAttribute('type')).toBe('password');
      expect((input as HTMLInputElement).value).toBe('hunter2');
      expect(affordance(container), 'no readonly affordance in the editable branch').toBeNull();
      expect(container.querySelector('button'), 'the visibility toggle is still there').not.toBeNull();
    });

    it('CONTROL — an editable widget holding nothing is an empty password input, not the affordance', () => {
      for (const [label, value] of EMPTY) {
        const { container } = renderWidget(value, false);
        const input = container.querySelector('input');
        expect(input, `${label}: the editable branch renders an input`).not.toBeNull();
        expect(input?.getAttribute('type')).toBe('password');
        expect((input as HTMLInputElement).value, `${label}: the input is empty`).toBe('');
        expect(affordance(container), `${label}: no readonly affordance in the editable branch`).toBeNull();
        cleanup();
      }
    });
  });
});
