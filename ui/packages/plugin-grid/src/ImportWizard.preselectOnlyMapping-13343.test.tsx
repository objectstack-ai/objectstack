/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * The import wizard preselects the object's only applicable saved mapping
 * (objectui#13343).
 *
 * The mapping step opened on "Map columns manually" even when the object
 * ships exactly one saved mapping, so a user who never opened that menu
 * imported without the mapping's rename and transforms (the shipped sample
 * template then lost two rows of three).
 *
 * These pins drive the real wizard:
 *   - one applicable mapping: the step opens with it applied, and the import
 *     request is byte-equal to the one a user's own pick of it sends;
 *   - none, or two applicable: nothing changes, the step opens on manual;
 *   - one applicable plus one whose mode the target refuses (listed disabled,
 *     objectui#12697): the applicable one is preselected;
 *   - a mapping fetched from the data source is preselected too;
 *   - the user can still switch to manual, and a re-fetched list or a
 *     re-render does not re-apply the mapping over that choice.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from './ImportWizard';
import type { SavedMapping } from './savedMapping';
import type { ImportRecordsResult, ImportRequestOptions } from '@object-ui/types';

beforeAll(() => {
  // Radix Select reads these on open; happy-dom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

type WizardProps = React.ComponentProps<typeof ImportWizard>;

const FIELDS: WizardProps['fields'] = [
  { name: 'company', label: 'Company', type: 'text', required: true },
  { name: 'lead_source', label: 'Lead source', type: 'text' },
];

const LEAD_IMPORT: SavedMapping = {
  name: 'crm_lead_import',
  label: 'Lead Import',
  targetObject: 'crm_lead',
  sourceFormat: 'json',
  fieldMapping: [
    { source: 'Company', target: 'company' },
    { source: 'Source', target: 'lead_source', transform: 'map', params: { valueMap: { LinkedIn: 'social' } } },
  ],
  mode: 'insert',
};
const LEAD_FEED: SavedMapping = { ...LEAD_IMPORT, name: 'crm_lead_feed', label: 'Lead feed' };
/** Writes in `update`, which a target offering insert + upsert refuses. */
const LEAD_UPDATER: SavedMapping = { ...LEAD_IMPORT, name: 'crm_lead_update', label: 'Lead update', mode: 'update', upsertKey: ['company'] };

const PASTED = 'Company\tSource\nAcme\tLinkedIn\nGlobex\tGoogle Ads';

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** A data source whose import door records every request and accepts it. */
function recordingDataSource(extra: object = {}) {
  const sent: ImportRequestOptions[] = [];
  const importRecords = vi.fn(async (_object: string, request: ImportRequestOptions): Promise<ImportRecordsResult> => {
    sent.push(request);
    return {
      object: 'crm_lead', dryRun: request.dryRun === true, writeMode: 'insert', total: 2,
      ok: 2, errors: 0, created: 2, updated: 0, skipped: 0,
      results: [{ row: 1, ok: true, action: 'created' }, { row: 2, ok: true, action: 'created' }],
    } as ImportRecordsResult;
  });
  return { sent, dataSource: { importRecords, ...extra } };
}

function wizard(props: Partial<WizardProps>) {
  return (
    <ImportWizard
      objectName="crm_lead"
      fields={FIELDS}
      dataSource={{} as never}
      open
      onOpenChange={() => {}}
      {...props}
    />
  );
}

/** The mapping step is up once its Next button is. */
async function toMappingStep() {
  pasteRows(PASTED);
  await screen.findByTestId('import-next-btn');
}

const summary = () => screen.queryByTestId('import-saved-mapping-summary');
const selectTrigger = () => screen.getByTestId('import-saved-mapping-select');

async function pick(optionTestId: string) {
  fireEvent.pointerDown(selectTrigger(), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByTestId(optionTestId));
}

async function pickManual() {
  fireEvent.pointerDown(selectTrigger(), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: '— Map columns manually —' }));
}

/** Preview, run the import, return the one real (non-dry-run) request. */
async function runImport(sent: ImportRequestOptions[], onComplete: ReturnType<typeof vi.fn>) {
  const next = screen.getByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  const run = await screen.findByTestId('import-run-btn');
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
  const real = sent.filter((r) => !r.dryRun);
  expect(real, 'exactly one import request').toHaveLength(1);
  return real[0];
}

describe('ImportWizard preselects the only applicable saved mapping (objectui#13343)', () => {
  it('ONE mapping: the step opens with it applied, the same request a pick of it sends', async () => {
    const preselected = recordingDataSource();
    const doneA = vi.fn();
    render(wizard({ dataSource: preselected.dataSource as never, savedMappings: [LEAD_IMPORT], onComplete: doneA }));
    await toMappingStep();

    expect(await screen.findByTestId('import-saved-mapping-summary'), 'the mapping is active without a pick').toBeInTheDocument();
    expect(selectTrigger()).toHaveTextContent('Lead Import');
    const requestA = await runImport(preselected.sent, doneA);
    expect(requestA).toHaveProperty('mappingName', 'crm_lead_import');
    cleanup();

    // CONTROL: the same mapping picked by hand (beside a second one, so nothing
    // is preselected) sends a byte-equal request — "applied exactly as a pick".
    const picked = recordingDataSource();
    const doneB = vi.fn();
    render(wizard({ dataSource: picked.dataSource as never, savedMappings: [LEAD_IMPORT, LEAD_FEED], onComplete: doneB }));
    await toMappingStep();
    expect(summary(), 'CONTROL: two mappings preselect nothing').not.toBeInTheDocument();
    await pick('import-saved-mapping-option-crm_lead_import');
    await screen.findByTestId('import-saved-mapping-summary');
    const requestB = await runImport(picked.sent, doneB);

    expect(requestA).toEqual(requestB);
  });

  it('NO mapping: nothing changes — no selector, no mapping applied', async () => {
    const { sent, dataSource } = recordingDataSource();
    const onComplete = vi.fn();
    render(wizard({ dataSource: dataSource as never, savedMappings: [], onComplete }));
    await toMappingStep();

    expect(screen.queryByTestId('import-saved-mapping-bar')).not.toBeInTheDocument();
    expect(summary()).not.toBeInTheDocument();
    const request = await runImport(sent, onComplete);
    expect(request, 'the manual path names no mapping').not.toHaveProperty('mappingName');
  });

  it('TWO applicable mappings: nothing changes — the step opens on manual mapping', async () => {
    render(wizard({ savedMappings: [LEAD_IMPORT, LEAD_FEED] }));
    await toMappingStep();

    await screen.findByTestId('import-saved-mapping-bar');
    expect(selectTrigger()).toHaveTextContent('— Map columns manually —');
    expect(summary()).not.toBeInTheDocument();
  });

  it('one applicable + one whose mode the target refuses: the applicable one is preselected', async () => {
    render(wizard({ writeModes: ['insert', 'upsert'], savedMappings: [LEAD_UPDATER, LEAD_IMPORT] }));
    await toMappingStep();

    expect(await screen.findByTestId('import-saved-mapping-summary')).toBeInTheDocument();
    expect(selectTrigger()).toHaveTextContent('Lead Import');
  });

  it('CONTROL: a single mapping whose mode the target refuses is never preselected', async () => {
    render(wizard({ writeModes: ['insert', 'upsert'], savedMappings: [LEAD_UPDATER] }));
    await toMappingStep();

    await screen.findByTestId('import-saved-mapping-bar');
    expect(selectTrigger()).toHaveTextContent('— Map columns manually —');
    expect(summary()).not.toBeInTheDocument();
  });

  it('a single mapping fetched from the data source is preselected', async () => {
    const listImportMappings = vi.fn(async () => [LEAD_IMPORT]);
    render(wizard({ dataSource: { listImportMappings } as never }));
    await toMappingStep();

    expect(await screen.findByTestId('import-saved-mapping-summary')).toBeInTheDocument();
    expect(listImportMappings).toHaveBeenCalledWith('crm_lead');
  });

  it('the user can switch to manual, and a re-fetched list or a re-render does not re-apply it', async () => {
    const { rerender } = render(wizard({ savedMappings: [LEAD_IMPORT] }));
    await toMappingStep();
    await screen.findByTestId('import-saved-mapping-summary');

    await pickManual();
    await waitFor(() => expect(summary()).not.toBeInTheDocument());
    expect(selectTrigger()).toHaveTextContent('— Map columns manually —');

    // A re-fetch hands the wizard a fresh list holding the same one mapping.
    rerender(wizard({ savedMappings: [{ ...LEAD_IMPORT }] }));
    rerender(wizard({ savedMappings: [{ ...LEAD_IMPORT }] }));
    await act(async () => { await Promise.resolve(); });

    expect(summary(), 'the user’s manual choice stands').not.toBeInTheDocument();
    expect(selectTrigger()).toHaveTextContent('— Map columns manually —');
  });
});
