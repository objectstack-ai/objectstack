/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The Import Wizard preview's cell check agrees with the server's import on
 * dates, on the spec's other numeric and boolean types, and on email
 * (objectui#11889). The import button counts the rows the preview finds
 * nothing on, so a check looser than the server overcounts and a stricter one
 * undercounts. The server side, as published in 17.7.0:
 *
 * - a `date` / `datetime` cell is read by `parseDateCell` (`@objectstack/core`'s
 *   `import-coerce.ts`), which takes ISO 8601, the export shape and a
 *   year-first date, and refuses `07/15/2026`, `July 15, 2026` and `1/2/26`
 *   with `invalid_date`;
 * - `rating`, `slider`, `progress` are coerced as numbers and `toggle` as a
 *   boolean, because the server reads the spec's `NUMERIC_VALUE_TYPES` and
 *   `BOOLEAN_VALUE_TYPES`;
 * - an `email` cell passes coercion and meets the record validator's
 *   `EMAIL_RE`, which takes `735431496@柴仟.com`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard, __testables } from './ImportWizard';

const { checkImportCell } = __testables;
const OFF = { keepUnknownOptions: false, requireValues: true };
const field = (type: string) => ({ name: 'f', label: 'F', type });

describe('checkImportCell: dates read by the server grammar (objectui#11889)', () => {
  it('marks the locale and prose spellings the server refuses', () => {
    for (const type of ['date', 'datetime']) {
      for (const cell of ['07/15/2026', 'July 15, 2026', '1/2/26']) {
        expect(checkImportCell(cell, field(type), OFF), `${type} ${cell}`).toEqual({ code: 'invalid_date', value: cell });
      }
    }
  });

  it('takes the ISO day, the export shape and the year-first date', () => {
    for (const type of ['date', 'datetime']) {
      for (const cell of ['2026-07-15', '2026-07-15 10:00:00', '2026-07-15T10:00:00Z', '2026/7/15']) {
        expect(checkImportCell(cell, field(type), OFF), `${type} ${cell}`).toBeUndefined();
      }
    }
  });
});

describe('checkImportCell: the spec numeric and boolean types (objectui#11889)', () => {
  it('reads rating, slider and progress as numbers', () => {
    for (const type of ['rating', 'slider', 'progress']) {
      expect(checkImportCell('abc', field(type), OFF), type).toEqual({ code: 'invalid_number', value: 'abc' });
      expect(checkImportCell('3', field(type), OFF), type).toBeUndefined();
      expect(checkImportCell('25%', field(type), OFF), type).toBeUndefined();
    }
  });

  it('reads toggle as a boolean', () => {
    expect(checkImportCell('maybe', field('toggle'), OFF)).toEqual({ code: 'invalid_boolean', value: 'maybe' });
    for (const cell of ['yes', 'Y', '是', 'off', '0']) {
      expect(checkImportCell(cell, field('toggle'), OFF), cell).toBeUndefined();
    }
  });
});

describe('checkImportCell: email by the record validator rule (objectui#11889)', () => {
  it('takes a non-ASCII domain on a plain email field', () => {
    expect(checkImportCell('735431496@柴仟.com', field('email'), OFF)).toBeUndefined();
  });

  it('still marks an address without a dotted domain', () => {
    expect(checkImportCell('a@b', field('email'), OFF)).toEqual({ code: 'invalid_email', value: 'a@b' });
  });
});

type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];

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

describe('ImportWizard preview: the import button follows the server verdict (objectui#11889)', () => {
  it('marks the US and prose dates and counts only the ISO row', async () => {
    const button = await openPreview(
      'Title\tDue\nA\t2026-07-15\nB\t07/15/2026\nC\tJuly 15, 2026\nD\t1/2/26',
      [TITLE, { name: 'due', label: 'Due', type: 'date' }],
    );
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'false');
    for (const row of [1, 2, 3]) expect(cell(row, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(1, 1).closest('td')).toHaveAttribute('title', '"07/15/2026" is not a valid date');
    expect(button).toHaveTextContent('Import 1 Row');
  });

  it('marks a bad progress, rating, slider and toggle cell and counts only the clean row', async () => {
    const button = await openPreview(
      'Title\tProgress\tDone\tStars\tLevel\nA\t3\tyes\t4\t10\nB\tabc\tyes\t4\t10\nC\t3\tmaybe\t4\t10\nD\t3\tyes\tfive\t10\nE\t3\tyes\t4\thigh',
      [
        TITLE,
        { name: 'progress', label: 'Progress', type: 'progress' },
        { name: 'done', label: 'Done', type: 'toggle' },
        { name: 'stars', label: 'Stars', type: 'rating' },
        { name: 'level', label: 'Level', type: 'slider' },
      ],
    );
    for (let col = 1; col <= 4; col++) expect(cell(0, col)).toHaveAttribute('aria-invalid', 'false');
    expect(cell(1, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(2, 2)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(3, 3)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(4, 4)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(2, 2).closest('td')).toHaveAttribute('title', '"maybe" is not a valid true/false value');
    expect(button).toHaveTextContent('Import 1 Row');
  });

  it('counts a non-ASCII email domain and still marks a bare host', async () => {
    const button = await openPreview(
      'Title\tEmail\nA\t735431496@柴仟.com\nB\ta@b',
      [TITLE, { name: 'email', label: 'Email', type: 'email' }],
    );
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'false');
    expect(cell(1, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(button).toHaveTextContent('Import 1 Row');
  });
});
