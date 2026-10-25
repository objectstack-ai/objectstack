/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The Import Wizard preview's cell check agrees with the server on a `time`
 * column, and on the user import's email column (objectui#11913). The import
 * button counts the rows the preview finds nothing on, so a cell the server
 * refuses and the preview takes is a row the button overcounts. The server side,
 * as published in 17.7.0:
 *
 * - a `time` cell is read by `parseDateCell(cell, 'time')` (`@objectstack/core`'s
 *   `import-coerce.ts`), which takes `10:00` and refuses `25:00`, `abc`,
 *   `10:00Z` and `9am` with `invalid_time`;
 * - the user import endpoint refuses a non-ASCII or placeholder email with
 *   `INVALID_EMAIL` (plugin-auth's `isLikelyEmail` / `isPlaceholderEmail`). Its
 *   host flags the column `emailRule: 'identity'`; a plain `email` field keeps
 *   the record validator's rule.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard, __testables } from './ImportWizard';

const { checkImportCell, formatDryRunError } = __testables;
const OFF = { keepUnknownOptions: false, requireValues: true };
type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];
const field = (type: string, extra: Partial<WizardField> = {}): WizardField => ({ name: 'f', label: 'F', type, ...extra });
const IDENTITY_EMAIL = field('email', { emailRule: 'identity' });

/** English rendering with `{{var}}` interpolation, standing in for `t`. */
const t = (key: string, vars?: Record<string, unknown>) =>
  key === 'grid.import.invalidTime' ? `"${String(vars?.value)}" is not a valid time` : key;

describe('checkImportCell: a time cell read the way the server reads it (objectui#11913)', () => {
  it('takes a wall clock', () => {
    expect(checkImportCell('10:00', field('time'), OFF)).toBeUndefined();
  });

  it('marks what the server refuses with invalid_time', () => {
    for (const cell of ['25:00', 'abc', '10:00Z', '9am']) {
      expect(checkImportCell(cell, field('time'), OFF), cell).toEqual({ code: 'invalid_time', value: cell });
    }
  });

  it('reads the server dry run\'s invalid_time with the same sentence', () => {
    const { message } = formatDryRunError({ field: 'f', code: 'invalid_time', error: 'f: "9am" is not a valid time' }, new Map(), '9am', t);
    expect(message).toBe('"9am" is not a valid time');
  });
});

describe('checkImportCell: an identity email column by the endpoint rule (objectui#11913)', () => {
  it('marks a non-ASCII address and a placeholder address', () => {
    for (const cell of ['735431496@柴仟.com', 'u-abc@placeholder.invalid']) {
      expect(checkImportCell(cell, IDENTITY_EMAIL, OFF), cell).toEqual({ code: 'invalid_email', value: cell });
    }
  });

  it('takes a plain address', () => {
    expect(checkImportCell('ada@example.com', IDENTITY_EMAIL, OFF)).toBeUndefined();
  });

  it('asks the endpoint rule instead of the record rule, not both', () => {
    // The endpoint takes `a@b..c`; the record validator refuses it.
    expect(checkImportCell('a@b..c', IDENTITY_EMAIL, OFF)).toBeUndefined();
    expect(checkImportCell('a@b..c', field('email'), OFF)).toEqual({ code: 'invalid_email', value: 'a@b..c' });
  });

  it('leaves a plain email field on the record rule', () => {
    expect(checkImportCell('735431496@柴仟.com', field('email'), OFF)).toBeUndefined();
  });
});

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** Open the wizard, paste rows whose headers equal the field labels, go to the preview. */
async function openPreview(tsv: string, fields: WizardField[]) {
  render(<ImportWizard objectName="task" fields={fields} dataSource={{}} open onOpenChange={() => {}} />);
  pasteRows(tsv);
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

const cell = (row: number, col: number) => screen.getByTestId(`import-preview-cell-${row}-${col}`);
const TITLE: WizardField = { name: 'title', label: 'Title', type: 'text' };

describe('ImportWizard preview: the import button follows the server verdict (objectui#11913)', () => {
  it('marks the time cells the server refuses and counts only the clean row', async () => {
    const button = await openPreview(
      'Title\tStarts\nA\t10:00\nB\t25:00\nC\tabc\nD\t10:00Z\nE\t9am',
      [TITLE, { name: 'starts', label: 'Starts', type: 'time' }],
    );
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'false');
    for (const row of [1, 2, 3, 4]) expect(cell(row, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(1, 1).closest('td')).toHaveAttribute('title', '"25:00" is not a valid time');
    expect(button).toHaveTextContent('Import 1 Row');
  });

  it('marks a non-ASCII and a placeholder address on an identity email column', async () => {
    const button = await openPreview(
      'Title\tEmail\nA\tada@example.com\nB\t735431496@柴仟.com\nC\tu-abc@placeholder.invalid',
      [TITLE, { name: 'email', label: 'Email', type: 'email', emailRule: 'identity' }],
    );
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'false');
    expect(cell(1, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(2, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(button).toHaveTextContent('Import 1 Row');
  });
});
