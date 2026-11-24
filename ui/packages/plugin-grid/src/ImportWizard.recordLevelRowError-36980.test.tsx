/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * A record-level row error shows no `_record:` prefix (objectstack#36980).
 *
 * The rule validator attributes an object-level rule that declares no field to
 * the `_record` sentinel, and the import row carries it as `field`. The wizard
 * prefixed every row error with the field's label, falling back to the API
 * name, so such a row read `Row 3: _record: <rule message>`. It now shows the
 * message alone, as a record form's banner does, on all three surfaces that
 * print row errors: the dry-run findings, the result screen and the failed-rows
 * download. A field-level error keeps its `label: message` form.
 *
 * Driven through the real wizard and a stubbed data source.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from './ImportWizard';
import type { ImportRecordsResult } from '@object-ui/types';

type WizardField = React.ComponentProps<typeof ImportWizard>['fields'][number];

const FIELDS: WizardField[] = [
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'status', label: 'Lead Status', type: 'text' },
];
const WAIT = { timeout: 6000 };
const RULE_MESSAGE = 'A disqualified lead needs a disqualification reason';
const FIELD_MESSAGE = 'must start with a capital letter';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

async function openPreview(dataSource: unknown) {
  render(<ImportWizard objectName="crm_lead" fields={FIELDS} dataSource={dataSource} open onOpenChange={() => {}} />);
  pasteRows('Title\tLead Status\nalpha\tOpen\nBeta\tDisqualified');
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  return screen.findByTestId('import-run-btn');
}

/** Row 1 refused on a field, row 2 by an object-level rule. */
function result(dryRun: boolean): ImportRecordsResult {
  return {
    object: 'crm_lead', dryRun, writeMode: 'insert', total: 2, ok: 0, errors: 2, created: 0, updated: 0, skipped: 0,
    results: [
      { row: 1, ok: false, action: 'failed', field: 'title', code: 'title_capitalised', error: FIELD_MESSAGE },
      { row: 2, ok: false, action: 'failed', field: '_record', code: 'disqualification_reason_required', error: RULE_MESSAGE },
    ],
  };
}

describe('ImportWizard: a record-level row error shows no `_record:` prefix (objectstack#36980)', () => {
  it('the dry-run findings: the record-level error is the message alone; the field-level one keeps its label', async () => {
    const importRecords = vi.fn().mockResolvedValue(result(true));
    await openPreview({ importRecords });
    fireEvent.click(screen.getByTestId('import-validate-btn'));
    await screen.findByTestId('import-validate-result');

    const rows = within(screen.getByTestId('import-findings')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      `Row 1: Title: ${FIELD_MESSAGE}`,
      `Row 2: ${RULE_MESSAGE}`,
    ]);
    expect(screen.getByTestId('import-findings')).not.toHaveTextContent('_record');
  });

  it('the result screen: the same two lines', async () => {
    const importRecords = vi.fn().mockResolvedValue(result(false));
    fireEvent.click(await openPreview({ importRecords }));
    await screen.findByTestId('import-close-btn', undefined, WAIT);

    expect(screen.getByText(`Row 1: Title: ${FIELD_MESSAGE}`)).toBeInTheDocument();
    expect(screen.getByText(`Row 2: ${RULE_MESSAGE}`)).toBeInTheDocument();
    expect(screen.queryByText(/_record/)).not.toBeInTheDocument();
  });

  it('the failed-rows download: the `_error` cell carries no `_record:`; a field error is prefixed by its label', async () => {
    const importRecords = vi.fn().mockResolvedValue(result(false));
    fireEvent.click(await openPreview({ importRecords }));
    await screen.findByTestId('import-close-btn', undefined, WAIT);

    const written: string[] = [];
    vi.stubGlobal('Blob', class {
      constructor(parts: unknown[]) { written.push(parts.map(String).join('')); }
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:36980');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('import-download-failed'));

    expect(written).toHaveLength(1);
    const csv = written[0]!.replace(/^﻿/, '');
    expect(csv).not.toContain('_record');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    expect(lines[0]).toBe('Title,Lead Status,_error');
    expect(lines[1]).toContain(`Title: ${FIELD_MESSAGE}`);
    expect(lines[1]).not.toContain('title:');
    expect(lines[2]?.endsWith(`,${RULE_MESSAGE}`)).toBe(true);
  });
});
