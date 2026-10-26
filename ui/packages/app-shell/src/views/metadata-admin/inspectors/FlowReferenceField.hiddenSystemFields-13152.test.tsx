// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13152 — the flow reference picker's `object-field` suggestions
 * leave out the columns the platform injects and hides.
 *
 * Measured on the card: Automations, a Notify node, Recipients, "Record
 * field": the datalist held `__search|Search Index (__search)`. The Data rail
 * and the list filter already keep that column out (objectui#11780,
 * objectui#11810); `ReferenceCombobox` mapped every field `useObjectFields`
 * returned.
 *
 * Driven through the notify node's recipients editor (`FlowRecipientsField`),
 * the card's surface, with the REAL `useObjectFields` over a REAL
 * `MetadataClient`, whose transport serves the trigger object as the platform
 * does: `__search` and `organization_id` carry `system: true` AND
 * `hidden: true`.
 *
 * Pinned:
 *  - a Record field row suggests neither `__search` nor `organization_id`;
 *  - CONTROLS, the Data rail's predicate and not a wider one: an ordinary
 *    field, an author's own hidden field (`hidden` alone) and an injected field
 *    the platform does not hide (`system` alone, `created_by`) are still
 *    suggested;
 *  - CONTROL: a stored `record.__search` recipient still draws as written —
 *    the box takes any name, and only the suggestions changed.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const TICKET_FIELDS = {
  owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  requester_email: { type: 'email', label: 'Requester email' },
  // An author's own hidden field: the Data rail still lists it.
  internal_note: { type: 'textarea', label: 'Internal note', hidden: true },
  // Injected by the platform but NOT hidden.
  created_by: { type: 'lookup', label: 'Created by', reference: 'sys_user', system: true, readonly: true },
  // The platform's own bookkeeping columns: both marks.
  __search: { type: 'text', label: 'Search Index', hidden: true, readonly: true, system: true },
  organization_id: { type: 'lookup', label: 'Organization', reference: 'sys_organization', hidden: true, system: true },
};

const h = vi.hoisted(() => ({ client: undefined as unknown }));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The framework's `GET /meta/object/NAME` read; every other metadata list answers empty. */
const fetchImpl = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input));
  const item = u.pathname.match(/\/api\/v1\/meta\/object\/([^/]+)$/);
  if (item && decodeURIComponent(item[1]) === 'ticket') {
    return json(200, { type: 'object', name: 'ticket', item: { name: 'ticket', fields: TICKET_FIELDS } });
  }
  if (/\/api\/v1\/meta\/[^/]+$/.test(u.pathname)) return json(200, []);
  return json(404, { success: false, error: { code: 'not_found', message: 'Not found' } });
}) as typeof fetch;
h.client = new MetadataClient({ baseUrl: 'http://meta.test', fetch: fetchImpl });

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => h.client,
}));

import { FlowRecipientsField } from './FlowRecipientsField';

afterEach(cleanup);

/** A ticket-triggered flow with a notify node. */
const DRAFT = {
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-update', objectName: 'ticket' } },
    { id: 'tell', type: 'notify', label: 'Tell', config: {} },
  ],
  edges: [],
};
const CONTEXT = { draft: DRAFT, node: DRAFT.nodes[1] };

function mount(initial: unknown) {
  function Host() {
    const [value, setValue] = React.useState<unknown>(initial);
    return <FlowRecipientsField label="Recipients" value={value} onCommit={setValue} locale="en-US" context={CONTEXT} />;
  }
  render(<Host />);
}

const row = (i: number) => document.querySelector(`[data-recipient-row="${i}"]`) as HTMLElement;

/** The Record field row's suggestions, once the trigger object's fields have arrived. */
async function suggestions(): Promise<string[]> {
  const read = () => Array.from(document.querySelectorAll('datalist option')).map((o) => (o as HTMLOptionElement).value);
  await waitFor(() => expect(read()).toContain('owner'));
  return read();
}

describe('ReferenceCombobox — `object-field` suggestions leave out the platform’s hidden columns (objectui#13152)', () => {
  it('a Record field row suggests neither `__search` nor `organization_id`', async () => {
    mount(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    const offered = await suggestions();
    expect(offered).not.toContain('__search');
    expect(offered).not.toContain('organization_id');
  });

  it('CONTROL: an ordinary field, an author’s own hidden field and an injected field the platform does not hide are still suggested', async () => {
    mount(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    expect(await suggestions()).toEqual(['owner', 'requester_email', 'internal_note', 'created_by']);
  });

  it('CONTROL: a stored `record.__search` recipient still draws as written', async () => {
    mount({ dialect: 'cel', source: 'record.__search' });
    await suggestions();
    expect(within(row(0)).getByDisplayValue('__search')).toBeTruthy();
  });
});
