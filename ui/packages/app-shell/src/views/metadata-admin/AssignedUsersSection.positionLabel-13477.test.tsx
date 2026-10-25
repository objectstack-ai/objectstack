/**
 * ObjectUI
 * Copyright (c) 2026 ObjectStack. Licensed under the MIT license.
 *
 * A holder's "via position" chip names the position by its label
 * (objectui#13477).
 *
 * The chip used to draw `sys_user_position.position` — the position's machine
 * name — while the section had already listed the registry's position
 * definitions, labels included, to find the positions that distribute the set.
 * `/meta/position` serves those labels in the caller's language
 * (objectstack#25701). This file holds that the chip reads the label from that
 * list with the name on its `title`, as `CitedItemChip` in `AccessExplainPanel`
 * does, and that a definition with no label still reads by its name.
 *
 * Everything between the server and the chip is real: a `MetadataProvider`
 * over an `ObjectStackAdapter` whose `fetch` is the only stub, so the label
 * reaches the section through the store's own `/meta/position` read.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { AssignedUsersSection } from './AssignedUsersSection';

vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: () => null,
}));

const SET = 'crm_sales_user';

/** The registry's position definitions as `/meta/position` serves them. */
const POSITIONS = [
  { name: 'sales_manager', label: 'Sales Manager', permissionSets: [SET] },
  // A definition with no label: its chip reads by its name.
  { name: 'field_rep', permissionSets: [SET] },
  { name: 'auditor', label: 'Auditor', permissionSets: ['crm_auditor'] },
];

const ROWS: Record<string, unknown[]> = {
  sys_user_permission_set: [],
  sys_user_position: [
    { id: 'up_1', user_id: 'u_manager', position: 'sales_manager' },
    { id: 'up_2', user_id: 'u_rep', position: 'field_rep' },
  ],
  sys_user: [
    { id: 'u_manager', name: 'Manager Mia', email: 'mia@example.com' },
    { id: 'u_rep', name: 'Rep Ray', email: 'ray@example.com' },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let seq = 0;

function makeAdapter() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/api/v1/discovery')) {
      return json(200, { success: true, data: { version: 'v0', routes: {}, capabilities: {} } });
    }
    if (url.pathname === '/api/v1/meta/position') {
      return json(200, { success: true, data: { type: 'position', items: structuredClone(POSITIONS) } });
    }
    const list = /^\/api\/v1\/meta\/([a-z_]+)$/.exec(url.pathname);
    if (list) return json(200, { success: true, data: { type: list[1], items: [] } });
    const data = /^\/api\/v1\/data\/([^/?]+)$/.exec(url.pathname);
    if (data) {
      const records = ROWS[data[1]] ?? [];
      return json(200, { object: data[1], records, total: records.length });
    }
    return json(404, { success: false, error: { message: `no route ${url.pathname}` } });
  });
  // A fresh origin per adapter: the adapter shares discovery per base URL.
  return new ObjectStackAdapter({ baseUrl: `http://position-label-${(seq += 1)}.test`, autoReconnect: false, fetch: fetchImpl });
}

function renderSection() {
  const adapter = makeAdapter();
  render(
    <AdapterCtx.Provider value={adapter as never}>
      <MetadataProvider adapter={adapter}>
        <AssignedUsersSection permissionSetName={SET} />
      </MetadataProvider>
    </AdapterCtx.Provider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AssignedUsersSection — a position chip reads the position's label (objectui#13477)", () => {
  it('shows the label from /meta/position, with the machine name on title', async () => {
    renderSection();

    const chip = await screen.findByText('via position Sales Manager');
    expect(chip).toHaveAttribute('title', 'sales_manager');
    expect(screen.queryByText('via position sales_manager')).toBeNull();
  });

  it('a definition with no label reads by its name, with no title', async () => {
    renderSection();

    const chip = await screen.findByText('via position field_rep');
    expect(chip).not.toHaveAttribute('title');
    // The labelled holder beside it still reads by its label.
    expect(screen.getByText('via position Sales Manager')).toBeTruthy();
  });
});
