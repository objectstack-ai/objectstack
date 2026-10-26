/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * On a print page, `record:details` prints the record's own title field
 * (objectui#12787).
 *
 * Off a print page the block hides the row the page header's H1 already
 * shows: the declared name field, else the field a `titleFormat` collapses
 * onto, else the first title candidate holding a value. That dedupe rests on
 * the H1 being drawn. A page that declares `print` refuses `page:header`, so
 * on paper nothing drew the title, and a printed invoice carried no invoice
 * number. Under a `PrintPageProvider` (mounted by `PageRenderer` for such a
 * page) the block prints every field it declares, the title field included,
 * as it already does for collapsed sections (objectui#12717).
 *
 * Each rung of the ladder is pinned twice: on a print page the row and its
 * value render, and off one (CONTROL) the row stays hidden as before. The
 * header and the body agreeing off a print page is pinned elsewhere
 * (`record-details.headerDedupeAgreement-9436.test.tsx`, objectui#10360).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { ActionProvider, RecordContextProvider, PrintPageProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../renderers/record-details';

/** Rung 1: the object declares its name field. */
const declaredSchema = {
  name: 'invoice',
  label: 'Invoice',
  nameField: 'invoice_no',
  fields: {
    invoice_no: { type: 'text', label: 'Invoice Number' },
    status: { type: 'text', label: 'Status' },
    total: { type: 'number', label: 'Total' },
  },
};
const declaredRecord = { id: 'i1', invoice_no: 'INV-1010', status: 'sent', total: 120 };

/**
 * Rung 2: no declared pointer, and a `titleFormat` that collapses onto
 * `contract_no` (a blank `name`), the objectui#10360 fixture.
 */
const templateSchema = {
  name: 'contract',
  label: 'Contract',
  titleFormat: '{contract_no} - {name}',
  fields: {
    contract_no: { type: 'text', label: 'Contract No' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};
const templateRecord = { id: 'c1', contract_no: 'HT-2026-003', name: '', amount: 500 };

/** Rung 3: no pointer and no template; `name` is the first candidate. */
const candidateSchema = {
  name: 'ticket',
  label: 'Ticket',
  fields: {
    name: { type: 'text', label: 'Ticket Name' },
    priority: { type: 'text', label: 'Priority' },
    owner_email: { type: 'text', label: 'Owner Email' },
  },
};
const candidateRecord = { id: 't1', name: 'Printer jam', priority: 'high', owner_email: 'a@b.c' };

/**
 * Viewport pinned for the reason `record-details.dedupeEmptinessTrims-8350`
 * states: on the desktop branch no fixture reaches `DetailSection`'s 4-row
 * auto-hide minimum, so a row can only be missing because the dedupe dropped it.
 */
const DESKTOP_WIDTH = 1280;

function renderBody(
  record: { id: string } & Record<string, unknown>,
  schema: { name: string; fields: Record<string, unknown> },
  print: boolean,
): string {
  const body = (
    <RecordContextProvider
      objectName={schema.name}
      recordId={record.id}
      data={record}
      objectSchema={schema}
    >
      <RecordDetailsRenderer schema={{ fields: Object.keys(schema.fields) } as never} />
    </RecordContextProvider>
  );
  const { container } = render(
    <ActionProvider>
      {print ? <PrintPageProvider value={{ paperSize: 'A4' }}>{body}</PrintPageProvider> : body}
    </ActionProvider>,
  );
  return container.textContent ?? '';
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DESKTOP_WIDTH });
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom
  // would resolve that to a real socket (objectui#6640).
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('record:details on a print page prints the title field (objectui#12787)', () => {
  it('declared name field: the invoice number prints', () => {
    const text = renderBody(declaredRecord, declaredSchema, true);
    expect(text).toContain('Invoice Number');
    expect(text).toContain('INV-1010');
    expect(text).toContain('Status');
  });

  it('titleFormat: the row the template collapses onto prints', () => {
    const text = renderBody(templateRecord, templateSchema, true);
    expect(text).toContain('Contract No');
    expect(text).toContain('HT-2026-003');
  });

  it('candidate fallback: the first candidate with a value prints', () => {
    const text = renderBody(candidateRecord, candidateSchema, true);
    expect(text).toContain('Ticket Name');
    expect(text).toContain('Printer jam');
  });
});

describe('CONTROL: off a print page the H1 dedupe is unchanged (objectui#12787)', () => {
  it('declared name field: the row stays hidden', () => {
    const text = renderBody(declaredRecord, declaredSchema, false);
    expect(text).not.toContain('Invoice Number');
    expect(text).not.toContain('INV-1010');
    expect(text).toContain('Status');
  });

  it('titleFormat: the row stays hidden', () => {
    const text = renderBody(templateRecord, templateSchema, false);
    expect(text).not.toContain('Contract No');
    expect(text).not.toContain('HT-2026-003');
    expect(text).toContain('Amount');
  });

  it('candidate fallback: the row stays hidden', () => {
    const text = renderBody(candidateRecord, candidateSchema, false);
    expect(text).not.toContain('Ticket Name');
    expect(text).not.toContain('Printer jam');
    expect(text).toContain('Priority');
  });
});
