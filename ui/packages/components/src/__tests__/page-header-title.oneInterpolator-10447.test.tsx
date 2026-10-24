/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page H1's `titleFormat` rung renders through core's
 * `formatTitleTemplate` — ONE interpolator (objectui#10447).
 *
 * ## The defect
 *
 * `PageHeaderRenderer` rendered the legacy template with its own `interpolate`
 * plus a separator cleanup, while `getRecordDisplayName`'s template rung,
 * `DetailView.resolveDisplayTitle` and `record:details`' H1 dedupe all call
 * `formatTitleTemplate`. The two implementations had different token rules.
 * The card's case: an expanded lookup token rendered as NOTHING in the header
 * and as the reference's display name in core, so
 * `titleFormat: '{account} - {deal_no}'` read `Q3-042` in the H1 while the
 * dedupe compared `Acme - Q3-042`.
 *
 * ## What is pinned
 *
 * - THE CARD: the H1 is exactly the string core renders for the same record.
 * - The same equality across the other token shapes the two implementations
 *   were measured to treat differently, plus the shapes they already agreed
 *   on as controls. Each expectation is core's own output, read at run time,
 *   so a change to core moves the H1 with it rather than reddening here.
 * - A template none of whose placeholders resolves is core's empty answer, so
 *   the H1 walks on to the next rung instead of showing the template's
 *   literal text.
 * - The option-label translation the H1 has always applied to a select token
 *   is KEPT, applied to the record before core renders it. So the H1 equals
 *   core over that labelled record, and deliberately differs from core over
 *   the raw record by exactly the label.
 *
 * Every fixture declares no name pointer and gives the template's fields
 * types the type-aware derivation cannot take (or none at all), so the
 * template is the rung that answers.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry, formatTitleTemplate } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Registers `page:header` at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010). This keeps the
// file in the light `dom` project instead of adding it to `heavyDomTests`.
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

/** Render the real `page:header` for one record and return its H1 text. */
function h1Of(objectSchema: any, record: any): string | null | undefined {
  const { container } = render(
    <ActionProvider>
      <RecordContextProvider
        objectName={objectSchema.name}
        recordId={record.id}
        data={record}
        objectSchema={objectSchema}
      >
        <PageHeader schema={{ type: 'page:header' }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
  return container.querySelector('h1')?.textContent;
}

afterEach(() => {
  cleanup();
});

/** Lookup-typed and number-typed fields: the derivation takes neither. */
const dealFields = {
  account: { type: 'lookup', reference: 'account', label: 'Account' },
  deal_no: { type: 'autonumber', label: 'Deal No' },
};

const deal = (titleFormat: unknown) => ({ name: 'deal', label: 'Deal', titleFormat, fields: dealFields });

describe('page:header H1 — the titleFormat rung renders what core renders (#10447)', () => {
  it('THE CARD — an expanded lookup token renders its display name, exactly as core does', () => {
    const titleFormat = '{account} - {deal_no}';
    const record = { id: 'rec-1', account: { id: 'a1', name: 'Acme' }, deal_no: 'Q3-042' };

    const h1 = h1Of(deal(titleFormat), record);

    expect(h1).toBe(formatTitleTemplate(titleFormat, record));
    expect(h1).toBe('Acme - Q3-042');
  });

  // [name, template, record]. Every template names only fields the fixture
  // leaves untyped or types out of the derivation, and every record resolves
  // at least one placeholder, so core's answer is non-empty and IS the H1.
  const shapes: Array<[string, unknown, Record<string, unknown>]> = [
    ['an expanded lookup with no display name drops with its separator', '{account} - {deal_no}', { account: { id: 'a1' }, deal_no: 'Q3-042' }],
    ['a whitespace-only value drops with its separator (#10446)', '{contract_no} - {code}', { contract_no: 'HT-2026-003', code: '   ' }],
    ['a comma left by an empty placeholder is stripped', '{deal_no}, {code}', { deal_no: 'Q3-042' }],
    ['a double-brace token', '{{deal_no}} - {{code}}', { deal_no: 'Q3-042', code: 'X9' }],
    ['a token with inner whitespace', '{ deal_no } - { code }', { deal_no: 'Q3-042', code: 'X9' }],
    ['a hyphenated key', '{deal-code} {deal_no}', { 'deal-code': 'EU', deal_no: 'Q3-042' }],
    ['the Expression envelope', { dialect: 'template', source: '{deal_no} - {code}' }, { deal_no: 'Q3-042', code: 'X9' }],
    ['CONTROL — a dotted path into an expanded lookup', '{account.name} - {deal_no}', { account: { id: 'a1', name: 'Acme' }, deal_no: 'Q3-042' }],
    ['CONTROL — a three-part template with its middle placeholder empty', '{deal_no} - {code} - {region}', { deal_no: 'Q3-042', region: 'EMEA' }],
    ['CONTROL — a literal prefix beside a resolved placeholder', 'Deal {deal_no}', { deal_no: 'Q3-042' }],
  ];

  for (const [name, titleFormat, values] of shapes) {
    it(name, () => {
      const record = { id: 'rec-2', ...values };
      const expected = formatTitleTemplate(titleFormat as never, record);
      // Guard the fixture, not the renderer: an empty core answer would mean
      // the H1 came from another rung and the equality below proved nothing.
      expect(expected).not.toBe('');
      expect(h1Of(deal(titleFormat), record)).toBe(expected);
    });
  }

  it('a template none of whose placeholders resolves declines, so its literal text is not the H1', () => {
    // Core's rule: no placeholder resolved ⇒ ''. The rung takes that answer
    // and the H1 walks on, here to the `${objectLabel} ${id}` floor, instead
    // of printing the template's literal prefix as if it were a title.
    const titleFormat = 'Session — {user_id}';
    const record = { id: 'rec-00000003' };
    expect(formatTitleTemplate(titleFormat, record)).toBe('');

    const h1 = h1Of(deal(titleFormat), record);

    expect(h1).not.toBe('Session');
    expect(h1).toBe('Deal rec-0000');
  });
});

describe('page:header H1 — a select token keeps its option label, applied before core renders (#10447)', () => {
  const statusOptions = [
    { value: 'in_progress', label: 'In Progress' },
    { value: 'won', label: 'Won' },
  ];
  const ticket = (fields: unknown) => ({
    name: 'ticket',
    label: 'Ticket',
    titleFormat: '{deal_no} · {status}',
    fields,
  });
  const recordFields = {
    deal_no: { type: 'autonumber', label: 'Deal No' },
    status: { type: 'select', label: 'Status', options: statusOptions },
  };

  it('the H1 is core over the record with the select value read as its label', () => {
    const record = { id: 'rec-4', deal_no: 'Q3-042', status: 'in_progress' };

    const h1 = h1Of(ticket(recordFields), record);

    expect(h1).toBe(formatTitleTemplate('{deal_no} · {status}', { ...record, status: 'In Progress' }));
    expect(h1).toBe('Q3-042 · In Progress');
    // Where it deliberately differs from core over the RAW record: the label.
    expect(formatTitleTemplate('{deal_no} · {status}', record)).toBe('Q3-042 · in_progress');
  });

  it('the array form of `fields` maps the same way', () => {
    const record = { id: 'rec-5', deal_no: 'Q3-042', status: 'won' };
    const arrayFields = Object.entries(recordFields).map(([name, def]) => ({ name, ...def }));

    expect(h1Of(ticket(arrayFields), record)).toBe('Q3-042 · Won');
  });

  it('a value no option declares renders raw', () => {
    const record = { id: 'rec-6', deal_no: 'Q3-042', status: 'archived' };

    expect(h1Of(ticket(recordFields), record)).toBe('Q3-042 · archived');
  });

  it('a blank select value is still empty, and drops with its separator', () => {
    const record = { id: 'rec-7', deal_no: 'Q3-042', status: '  ' };

    expect(h1Of(ticket(recordFields), record)).toBe('Q3-042');
  });
});
