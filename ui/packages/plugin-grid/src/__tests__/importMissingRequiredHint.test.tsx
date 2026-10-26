/**
 * Missing-required-field hint — mapping step (issue #2640).
 *
 * When a required object field has no column mapped, the Next button is
 * disabled. Without a hint the user faces a greyed-out button with no reason
 * and no way to know which field is missing. The mapping step must list every
 * unmapped required field (as `label (name)`) and clear the hint the moment the
 * column is supplied — the disable logic itself stays put.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '../ImportWizard';

// `status` is required but its label ("Lifecycle") differs from its api-name,
// so the hint must show both — that's exactly the value a user needs to fix it.
const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'status', label: 'Lifecycle', type: 'text', required: true },
];

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

// A data source offering none of the optional import capabilities. These cases
// never leave the mapping step, so nothing on it is ever called — but the wizard
// probes it for `listImportMappings` / `importRecords` / `listImportJobs` on
// render, and an empty object is the honest answer to all three: "a source that
// supports none of them". `ImportWizardProps.dataSource` is required, so it has
// to be passed rather than omitted (the omission was invisible until #4040 let
// `tsc` read this file).
const NO_CAPABILITY_DATA_SOURCE = {};

function renderWizard() {
  render(
    <ImportWizard
      objectName="account"
      fields={FIELDS}
      dataSource={NO_CAPABILITY_DATA_SOURCE}
      open
      onOpenChange={() => {}}
    />,
  );
}

describe('ImportWizard mapping step: missing required-field hint', () => {
  it('names each unmapped required field as `label (name)` and disables Next', async () => {
    renderWizard();
    // File omits the required `status` column — only `name` auto-maps.
    pasteRows('Name\nAcme');

    const hint = await screen.findByTestId('import-missing-required');
    expect(hint).toHaveTextContent('Lifecycle (status)');
    expect(screen.getByTestId('import-next-btn')).toBeDisabled();
  });

  it('clears the hint and enables Next once the required column is supplied', async () => {
    renderWizard();
    pasteRows('Name\nAcme');
    await screen.findByTestId('import-missing-required');
    expect(screen.getByTestId('import-next-btn')).toBeDisabled();

    // Go back and re-upload a file that now carries the required column; the
    // hint must react live to the new mapping, not require a remount.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    pasteRows('Name\tstatus\nAcme\tactive');

    await waitFor(() => {
      expect(screen.queryByTestId('import-missing-required')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('import-next-btn')).toBeEnabled();
  });
});
