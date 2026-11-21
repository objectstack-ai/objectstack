/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An Enter the input method owns does only what the input method does with it
 * (objectstack#35996), in the three widgets objectstack#35797 left out:
 *
 *  - `GridField`: a cell's Enter moves to the next line, and on the last line
 *    appends one; the composed text then landed in the wrong line.
 *  - `DatePickerField`: Enter commits the typed date text.
 *  - `RecordPickerDialog`: Enter in the page-jump box jumps and clears it.
 *
 * Each widget is driven through the two sequences browsers really send
 * (Chromium / Firefox: the picking keydown inside the composition, with
 * `isComposing: true` and keyCode 229; Safari: the 229 keydown after
 * `compositionend`), and each case ends with the control: a plain Enter does
 * what the widget always did, so a guard that swallowed every Enter goes red.
 *
 * The predicate itself is pinned once, in `imeComposition-35797.test.tsx`;
 * `./imeKey` is the pass-through of the one definition on the
 * `@object-ui/components` entry, which the identity case below pins.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { isImeKey as componentsIsImeKey } from '@object-ui/components';
import { isImeKey } from './imeKey';
import { GridField } from './GridField';
import { DatePickerField } from './date-picker/DatePickerField';
import { RecordPickerDialog } from './RecordPickerDialog';
import { getCellRenderer } from '../index';

/** The keydown that picks a candidate while the composition is open. */
const COMPOSING_ENTER = { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: true } as const;
/** Safari's candidate-picking Enter, raised after `compositionend`. */
const SAFARI_POST_COMPOSITION_ENTER = { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: false } as const;
/** An Enter the input method does not own. */
const PLAIN_ENTER = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 } as const;

type Composer = (el: HTMLElement, text: string) => void;
const type = (el: HTMLElement, text: string) => fireEvent.change(el, { target: { value: text } });

/** Chromium / Firefox: the picking keydown arrives inside the composition. */
const composeChromium: Composer = (el, text) => {
  fireEvent.compositionStart(el, { data: '' });
  type(el, text);
  fireEvent.keyDown(el, COMPOSING_ENTER);
  fireEvent.compositionEnd(el, { data: text });
};

/** Safari: the composition has ended when the picking keydown arrives. */
const composeSafari: Composer = (el, text) => {
  fireEvent.compositionStart(el, { data: '' });
  type(el, text);
  fireEvent.compositionEnd(el, { data: text });
  fireEvent.keyDown(el, SAFARI_POST_COMPOSITION_ENTER);
};

const BROWSERS = [['Chromium', composeChromium], ['Safari', composeSafari]] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('one IME-key predicate in the repository (objectstack#35996)', () => {
  it('the fields widgets ask the very function the components entry exports', () => {
    expect(isImeKey).toBe(componentsIsImeKey);
  });
});

describe('GridField — an IME Enter in a cell neither moves nor appends a line (objectstack#35996)', () => {
  const FIELD = { name: 'lines', type: 'grid', columns: [{ name: 'desc', type: 'text', label: 'Desc' }] } as never;

  function mountGrid() {
    const onChange = vi.fn();
    const Host = () => {
      const [value, setValue] = React.useState<Record<string, unknown>[]>([{ desc: 'a' }, { desc: 'b' }]);
      return (
        <GridField
          value={value}
          onChange={(v: Record<string, unknown>[]) => {
            onChange(v);
            setValue(v);
          }}
          field={FIELD}
        />
      );
    };
    const { container } = render(<Host />);
    const cell = (row: number) => container.querySelector(`[data-cell="${row}-0"]`) as HTMLInputElement | null;
    return { cell, onChange };
  }

  for (const [browser, compose] of BROWSERS) {
    it(`${browser}: the candidate-picking Enter keeps focus on its line; the next Enter moves down`, () => {
      const { cell } = mountGrid();
      cell(0)!.focus();
      compose(cell(0)!, '你');
      expect(document.activeElement).toBe(cell(0));
      expect(cell(0)!.value).toBe('你');

      fireEvent.keyDown(cell(0)!, PLAIN_ENTER);
      expect(document.activeElement).toBe(cell(1));
    });

    it(`${browser}: on the last line the candidate-picking Enter appends no line; the next Enter does`, async () => {
      const { cell, onChange } = mountGrid();
      cell(1)!.focus();
      compose(cell(1)!, '好');
      // The composed text is the one write; no third line.
      expect(onChange.mock.calls.every(([rows]) => (rows as unknown[]).length === 2)).toBe(true);
      expect(cell(2)).toBeNull();
      expect(document.activeElement).toBe(cell(1));

      fireEvent.keyDown(cell(1)!, PLAIN_ENTER);
      expect(onChange).toHaveBeenLastCalledWith([expect.anything(), expect.anything(), expect.anything()]);
      await waitFor(() => expect(document.activeElement).toBe(cell(2)));
    });
  }
});

describe('DatePickerField — an IME Enter does not commit the typed text (objectstack#35996)', () => {
  const FIELD = { name: 'close_date', type: 'date' } as never;

  for (const [browser, compose] of BROWSERS) {
    it(`${browser}: the candidate-picking Enter commits nothing; the next Enter commits the date`, () => {
      const onChange = vi.fn();
      render(<DatePickerField value="" onChange={onChange} field={FIELD} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      input.focus();
      compose(input, '10/16/2026');
      expect(onChange).not.toHaveBeenCalled();
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
      expect(input.value).toBe('10/16/2026');

      fireEvent.keyDown(input, PLAIN_ENTER);
      expect(onChange).toHaveBeenLastCalledWith('2026-10-16');
    });
  }
});

describe('RecordPickerDialog — an IME Enter in the page-jump box neither jumps nor clears it (objectstack#35996)', () => {
  const USERS = Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { id: `u${n}`, name: `User ${n}` };
  });
  const FIELDS = { name: { type: 'text', label: 'Name' } };

  function mountPicker() {
    const dataSource = {
      find: vi.fn(async (_o: string, params?: { $skip?: number; $top?: number }) => {
        const skip = params?.$skip ?? 0;
        const top = params?.$top ?? USERS.length;
        return { data: USERS.slice(skip, skip + top), total: USERS.length };
      }),
      findOne: vi.fn(async (_o: string, id: string) => USERS.find((r) => r.id === id) ?? null),
      getObjectSchema: vi.fn(async () => ({ name: 'sys_user', fields: FIELDS })),
    } as any;
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={dataSource}
        objectName="sys_user"
        columns={['name']}
        fieldsMeta={FIELDS}
        cellRenderer={getCellRenderer}
        onSelect={() => {}}
      />,
    );
  }
  const rows = () => document.querySelectorAll('[data-testid^="record-row-"]');

  for (const [browser, compose] of BROWSERS) {
    it(`${browser}: the candidate-picking Enter stays on page 1 and keeps the text; the next Enter jumps`, async () => {
      mountPicker();
      await waitFor(() => expect(rows()).toHaveLength(10));
      const jump = screen.getByTestId('record-picker-page-jump') as HTMLInputElement;
      jump.focus();
      compose(jump, '2');
      expect(jump.value).toBe('2');
      expect(jump).toHaveAttribute('placeholder', '1');

      fireEvent.keyDown(jump, PLAIN_ENTER);
      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(jump).toHaveAttribute('placeholder', '2');
      expect(jump.value).toBe('');
    });
  }
});
