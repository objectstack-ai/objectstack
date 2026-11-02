/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * A required field that carries a default is not demanded from the file.
 *
 * The create fills a declared `defaultValue` (static or an expression) and,
 * when none is declared, an option marked `default: true`, for a row that
 * leaves the field out or blank. So the mapping step does not hold Next for
 * such a field left unmapped, and the preview does not mark its blank cell.
 * A required field with no default still blocks. The wizard only asks whether
 * a default is declared: the expression below is never evaluated here.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from './ImportWizard';

type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];

const REVIEW_OPTIONS = [
  { label: 'To review', value: 'to_review' },
  { label: 'To confirm', value: 'to_confirm' },
];

/** A record-derived expression default, the shape the reported app declares. */
const EXPRESSION_DEFAULT = { dialect: 'cel', source: "record.source == 'self' ? 'to_review' : 'to_confirm'" };

const title: WizardField = { name: 'title', label: 'Title', type: 'text' };
const owner: WizardField = { name: 'owner_name', label: 'Owner', type: 'text', required: true };
const reviewStatus: WizardField = {
  name: 'review_status', label: 'Review status', type: 'select', required: true,
  defaultValue: EXPRESSION_DEFAULT, options: REVIEW_OPTIONS,
};
const priority: WizardField = {
  name: 'priority', label: 'Priority', type: 'select', required: true, defaultValue: 'normal',
  options: [{ label: 'Normal', value: 'normal' }, { label: 'High', value: 'high' }],
};
const stage: WizardField = {
  name: 'stage', label: 'Stage', type: 'select', required: true,
  options: [{ label: 'New', value: 'new', default: true }, { label: 'Done', value: 'done' }],
};

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

function renderWizard(fields: WizardField[]) {
  render(<ImportWizard objectName="duty" fields={fields} dataSource={{}} open onOpenChange={() => {}} />);
}

describe('ImportWizard mapping step: a required field with a default', () => {
  it('does not hold Next for an unmapped required field with an expression default', async () => {
    renderWizard([title, reviewStatus]);
    pasteRows('Title\nAlpha');
    const next = await screen.findByTestId('import-next-btn');
    await waitFor(() => expect(next).toBeEnabled());
    expect(screen.queryByTestId('import-missing-required')).not.toBeInTheDocument();
  });

  it('does not hold Next for a static default or an option marked default', async () => {
    renderWizard([title, priority, stage]);
    pasteRows('Title\nAlpha');
    const next = await screen.findByTestId('import-next-btn');
    await waitFor(() => expect(next).toBeEnabled());
    expect(screen.queryByTestId('import-missing-required')).not.toBeInTheDocument();
  });

  it('still names a required field with no default, and only that one', async () => {
    renderWizard([title, owner, reviewStatus, priority, stage]);
    pasteRows('Title\nAlpha');
    const hint = await screen.findByTestId('import-missing-required');
    expect(hint).toHaveTextContent('Owner (owner_name)');
    expect(hint).not.toHaveTextContent('review_status');
    expect(hint).not.toHaveTextContent('priority');
    expect(hint).not.toHaveTextContent('stage');
    expect(screen.getByTestId('import-next-btn')).toBeDisabled();
  });

  it('a null defaultValue declares no default', async () => {
    renderWizard([title, { ...owner, defaultValue: null }]);
    pasteRows('Title\nAlpha');
    expect(await screen.findByTestId('import-missing-required')).toHaveTextContent('Owner (owner_name)');
  });
});

describe('ImportWizard preview: a blank cell in a required field with a default', () => {
  const cell = (row: number, col: number) => screen.getByTestId(`import-preview-cell-${row}-${col}`);

  async function openPreview(fields: WizardField[], tsv: string) {
    renderWizard(fields);
    pasteRows(tsv);
    const next = await screen.findByTestId('import-next-btn');
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    return screen.findByTestId('import-run-btn');
  }

  it('leaves the blank cell of a defaulted required column unmarked and counts its row', async () => {
    const button = await openPreview([title, reviewStatus], 'Title\tReview status\nAlpha\t\nBeta\tTo confirm');
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'false');
    expect(button).toHaveTextContent('Import 2 Rows');
  });

  it('still marks the blank cell of a required column with no default', async () => {
    const button = await openPreview([title, owner], 'Title\tOwner\nAlpha\t\nBeta\tAda');
    expect(cell(0, 1)).toHaveAttribute('aria-invalid', 'true');
    expect(button).toHaveTextContent('Import 1 Row');
  });
});
