/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The Import Wizard offers neither control opt-out (objectui#12985).
 *
 * Both import doors (`POST /api/v1/data/:object/import` and `/import/jobs`)
 * honour `runAutomations: false` and `treatAsHistorical: true` for the system
 * principal only, and refuse every other caller `403 PERMISSION_DENIED`
 * (objectstack-ai/objectstack#24348). A browser request is never the system
 * principal, so a wizard that offered either option turned a user's click into
 * a refusal of the whole import. The wizard therefore draws neither option and
 * its request carries neither opt-out. The default import, which runs
 * automations and walks the state machine, is unchanged: omitting both keys is
 * the server's declared default.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from './ImportWizard';
import type { ImportRecordsResult, ImportRequestOptions } from '@object-ui/types';

type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];

const FIELDS: WizardField[] = [{ name: 'title', label: 'Title', type: 'text' }];

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** Open the wizard over `dataSource`, paste two rows, go to the preview step. */
async function openPreview(dataSource: object, onComplete?: (r: unknown) => void) {
  render(
    <ImportWizard
      objectName="task"
      fields={FIELDS}
      dataSource={dataSource as never}
      open
      onOpenChange={() => {}}
      onComplete={onComplete as never}
    />,
  );
  pasteRows('Title\nA\nB');
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

describe('ImportWizard control opt-outs (objectui#12985)', () => {
  it('draws neither the run-automations nor the treat-as-historical option', async () => {
    await openPreview({});
    // CONTROL: the options panel and its other options are drawn.
    expect(screen.getByTestId('import-options')).toBeInTheDocument();
    expect(screen.getByTestId('import-opt-create-options')).toBeInTheDocument();

    expect(screen.queryByTestId('import-opt-run-automations')).toBeNull();
    expect(screen.queryByTestId('import-opt-treat-historical')).toBeNull();
    expect(screen.queryByText(/automations/i)).toBeNull();
    expect(screen.queryByText(/historical/i)).toBeNull();
  });

  it('a completed default import sends neither opt-out and still imports', async () => {
    const sent: ImportRequestOptions[] = [];
    const importRecords = vi.fn(async (_object: string, request: ImportRequestOptions): Promise<ImportRecordsResult> => {
      sent.push(request);
      return {
        object: 'task', dryRun: false, writeMode: 'insert', total: 2,
        ok: 2, errors: 0, created: 2, updated: 0, skipped: 0,
        results: [{ row: 1, ok: true, action: 'created' }, { row: 2, ok: true, action: 'created' }],
      } as ImportRecordsResult;
    });
    const onComplete = vi.fn();
    const run = await openPreview({ importRecords }, onComplete);
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());

    // The real import request (a dry-run pre-check, if any, carries dryRun).
    const real = sent.filter((r) => !r.dryRun);
    expect(real).toHaveLength(1);
    const request = real[0];
    expect(request).not.toHaveProperty('runAutomations');
    expect(request).not.toHaveProperty('treatAsHistorical');
    // CONTROL: the rest of the request is the default import's, unchanged.
    expect(request).toEqual({
      format: 'json',
      rows: [{ title: 'A' }, { title: 'B' }],
      writeMode: 'insert',
      createMissingOptions: false,
      skipBlankMatchKey: false,
    });

    // The default import still runs to completion.
    expect(onComplete.mock.calls[0][0]).toMatchObject({ totalRows: 2, importedRows: 2, skippedRows: 0, errors: [] });
  });
});
