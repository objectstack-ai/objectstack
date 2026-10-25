/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page H1 and `record:details`' H1 dedupe render the SAME
 * `titleFormat` string, so the dedupe hides the row that matches the H1 and
 * no other (objectui#10447, with objectui#10446 folded in).
 *
 * ## The defect
 *
 * `page:header` rendered the legacy template with its own interpolation, while
 * the dedupe asks core's `formatTitleTemplate` what the H1 shows. The two
 * disagreed, so the dedupe reasoned about a heading the user never saw:
 *
 *   - THE CARD (#10447): `{account} - {deal_no}` with an expanded `account`.
 *     The H1 dropped the lookup and read `Q3-042`; core rendered the composite
 *     `Acme - Q3-042`, which no row equals, so nothing was hidden and the
 *     "Deal No" row printed `Q3-042` directly under an H1 reading `Q3-042`.
 *   - #10446: `{contract_no} - {name}` with a whitespace-only `name`. The H1's
 *     own separator cleanup read `HT-2026-003`; core counted the blank as a
 *     value and rendered `HT-2026-003 -`, again equal to no row, so the
 *     "Contract No" row printed under an H1 showing the same value.
 *
 * The H1 now renders through `formatTitleTemplate` too, and core judges a
 * whitespace-only placeholder empty. So each case asserts the H1 IS core's
 * string for that record before it asserts which row the body drops.
 *
 * The one thing the H1 adds is a select value's option label. It is applied to
 * the record before core renders it, and never changes WHICH placeholders
 * resolve, so the dedupe (which renders over the raw record) still decides
 * about the field the H1 shows. The last two cases pin that.
 *
 * ## The surface under test
 *
 * Each case renders the REAL `page:header` beside the REAL body under one
 * record context, as `record-details.titleFormatPlaceholderDedupe-10360.test.tsx`
 * does, and reads both the H1 the user sees and which row the body drops.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
// Registers `page:header` (and the rest of the atoms) on the shared registry.
import '@object-ui/components';
import { ComponentRegistry, formatTitleTemplate } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/**
 * Pinned rather than inherited, for the reason
 * `record-details.dedupeEmptinessTrims-8350.test.tsx` states: `DetailSection`
 * can also drop an EMPTY row through a viewport-dependent auto-hide. On the
 * desktop branch no fixture here reaches its 4-row minimum, so a row can only
 * be missing because the dedupe dropped it.
 */
const DESKTOP_WIDTH = 1280;

/** Render the header and the body under ONE record context; read both. */
function renderPage(
  record: any,
  schema: any,
  fields: string[],
): { h1: string | null | undefined; body: string } {
  const Header = ComponentRegistry.get('page:header');
  if (!Header) throw new Error('page:header not registered');
  const { container } = render(
    <ActionProvider>
      <RecordContextProvider
        objectName={schema.name}
        recordId={record.id}
        data={record}
        objectSchema={schema}
      >
        <div data-testid="page-header">
          <Header schema={{ type: 'page:header' }} />
        </div>
        <div data-testid="page-body">
          <RecordDetailsRenderer schema={{ fields } as never} />
        </div>
      </RecordContextProvider>
    </ActionProvider>,
  );
  const h1 = container.querySelector('[data-testid="page-header"] h1')?.textContent;
  const body = container.querySelector('[data-testid="page-body"]')?.textContent ?? '';
  return { h1, body };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DESKTOP_WIDTH });
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom
  // would resolve that to a REAL socket (objectui#6640). Its answer is
  // orthogonal to which heading renders and which row is hidden.
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

/**
 * No name pointer, so the template titles the H1. The type-aware derivation
 * lands on `deal_no` (the only text field); that only puts it on the dedupe's
 * candidate list, it does not change the heading.
 */
const dealSchema = {
  name: 'deal',
  label: 'Deal',
  titleFormat: '{account} - {deal_no}',
  fields: {
    account: { type: 'lookup', reference: 'account', label: 'Account' },
    deal_no: { type: 'text', label: 'Deal No' },
    amount: { type: 'number', label: 'Amount' },
  },
};
const DEAL_FIELDS = ['account', 'deal_no', 'amount'];

describe('page:header and record:details render one `titleFormat` string (#10447)', () => {
  it('THE CARD — the H1 is core\'s composite, so no row duplicates it and "Deal No" stays', () => {
    const record = { id: 'D1', account: { id: 'a1', name: 'Acme' }, deal_no: 'Q3-042', amount: 5 };

    const { h1, body } = renderPage(record, dealSchema, DEAL_FIELDS);

    expect(h1).toBe(formatTitleTemplate(dealSchema.titleFormat, record));
    expect(h1).toBe('Acme - Q3-042');
    // The H1 is no single field's value: the dedupe hides nothing, and the
    // body does not repeat the heading.
    expect(body).not.toContain(h1);
    expect(body).toContain('Deal No');
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });

  it('CONTROL — a lookup with no display name drops, the H1 collapses onto `deal_no`, and that row goes', () => {
    const record = { id: 'D2', account: { id: 'a1' }, deal_no: 'Q3-042', amount: 6 };

    const { h1, body } = renderPage(record, dealSchema, DEAL_FIELDS);

    expect(h1).toBe(formatTitleTemplate(dealSchema.titleFormat, record));
    expect(h1).toBe('Q3-042');
    expect(body).not.toContain('Q3-042');
    expect(body).not.toContain('Deal No');
    expect(body).toContain('Amount'); // CONTROL: the rows the H1 does not show stay
  });

  it('#10446 — a whitespace-only `name` drops with its separator in BOTH, so the "Contract No" row goes', () => {
    const schema = {
      name: 'contract',
      label: 'Contract',
      titleFormat: '{contract_no} - {name}',
      fields: {
        contract_no: { type: 'text', label: 'Contract No' },
        name: { type: 'text', label: 'Name' },
        amount: { type: 'number', label: 'Amount' },
      },
    };
    const record = { id: 'C3', contract_no: 'HT-2026-003', name: '   ', amount: 13 };

    const { h1, body } = renderPage(record, schema, ['contract_no', 'name', 'amount']);

    expect(h1).toBe(formatTitleTemplate(schema.titleFormat, record));
    expect(h1).toBe('HT-2026-003');
    expect(body).not.toContain('HT-2026-003');
    expect(body).not.toContain('Contract No');
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });
});

describe('a select token\'s option label does not move the dedupe off the field the H1 shows (#10447)', () => {
  const ticketSchema = {
    name: 'ticket',
    label: 'Ticket',
    titleFormat: '{ticket_no} - {status}',
    fields: {
      ticket_no: { type: 'text', label: 'Ticket No' },
      status: {
        type: 'select',
        label: 'Status',
        options: [{ value: 'in_progress', label: 'In Progress' }],
      },
      amount: { type: 'number', label: 'Amount' },
    },
  };
  const TICKET_FIELDS = ['ticket_no', 'status', 'amount'];

  it('the H1 collapses onto `status` and shows its LABEL; the Status row is the one that goes', () => {
    const record = { id: 'T1', ticket_no: '', status: 'in_progress', amount: 7 };

    const { h1, body } = renderPage(record, ticketSchema, TICKET_FIELDS);

    expect(h1).toBe('In Progress');
    expect(body).not.toContain('Status');
    expect(body).toContain('Ticket No'); // the row the H1 does not show stays
    expect(body).toContain('Amount'); // CONTROL: the body rendered at all
  });

  it('CONTROL — both placeholders resolve: a composite H1 with the label, and both rows stay', () => {
    const record = { id: 'T2', ticket_no: 'TK-9', status: 'in_progress', amount: 8 };

    const { h1, body } = renderPage(record, ticketSchema, TICKET_FIELDS);

    expect(h1).toBe('TK-9 - In Progress');
    expect(body).toContain('TK-9');
    expect(body).toContain('Status');
  });
});
