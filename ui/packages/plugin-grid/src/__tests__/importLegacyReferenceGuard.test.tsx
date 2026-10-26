/**
 * Legacy-fallback relation guard — end-to-end through the wizard.
 *
 * When the data source has no `importRecords` (old client/server) the wizard
 * falls back to the per-row `create` loop, which stores raw cell text
 * verbatim. For relation fields (lookup / master_detail / user / reference /
 * tree) that corrupts data — text where a record ID belongs — so the fallback
 * must refuse to write anything and surface a clear error instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '../ImportWizard';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'account_id', label: 'Account', type: 'lookup' },
];

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

async function runWizardImport(tsv: string, dataSource: any, onComplete: (r: any) => void) {
  render(
    <ImportWizard
      objectName="task"
      fields={FIELDS}
      dataSource={dataSource}
      open
      onOpenChange={() => {}}
      onComplete={onComplete}
    />,
  );
  pasteRows(tsv);
  // Headers equal the field labels, so auto-mapping maps every column and
  // the wizard lands on the mapping step with Next enabled.
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  fireEvent.click(await screen.findByTestId('import-run-btn'));
}

describe('ImportWizard legacy fallback: relation columns', () => {
  it('blocks the import and writes nothing when a lookup column is mapped', async () => {
    const create = vi.fn();
    const onComplete = vi.fn();
    // No importRecords / createImportJob → wizard can only use the legacy path.
    await runWizardImport('Name\tAccount\nAcme\t大唐2026', { create }, onComplete);

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
    const result = onComplete.mock.calls[0][0];
    expect(result.importedRows).toBe(0);
    expect(result.skippedRows).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('account_id');
    // The blocked error names the offending field by label.
    expect(screen.getByText(/Import blocked: Account/)).toBeInTheDocument();
  });

  it('still imports normally when no relation column is mapped', async () => {
    const create = vi.fn().mockResolvedValue({ id: '1' });
    const onComplete = vi.fn();
    await runWizardImport('Name\nAcme', { create }, onComplete);

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('task', { name: 'Acme' });
    expect(onComplete.mock.calls[0][0].importedRows).toBe(1);
  });
});

describe('ImportWizard legacy fallback: downgrade is not silent (issue #2639)', () => {
  it('flags the result degraded and shows a downgrade notice on the scalar path', async () => {
    const create = vi.fn().mockResolvedValue({ id: '1' });
    const onComplete = vi.fn();
    // Scalar-only columns → the fallback runs (no importRecords) and succeeds,
    // but the user must be told the server import route was unavailable.
    await runWizardImport('Name\nAcme', { create }, onComplete);

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    // The result carries the downgrade flag...
    expect(onComplete.mock.calls[0][0].degraded).toBe(true);
    // ...and the completion screen surfaces it rather than reporting a clean win.
    expect(screen.getByTestId('import-degraded-notice')).toBeInTheDocument();
    expect(screen.getByText(/compatibility fallback/i)).toBeInTheDocument();
  });
});
