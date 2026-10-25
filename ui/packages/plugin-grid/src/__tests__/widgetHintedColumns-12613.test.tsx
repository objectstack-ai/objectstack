/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12613 — a grid column whose field declares `widget: 'object-ref'`
 * or `widget: 'recipient-picker'` is drawn by the face registered under that
 * widget key, and that face gets the ROW, on EVERY column path `ObjectGrid`
 * can pick.
 *
 * The Sharing Rules list is the measured case: the platform's `sys_sharing_rule`
 * declares `object_name` with `widget: 'object-ref'` and `recipient_id` with
 * `widget: 'recipient-picker'` (`dependsOn: ['recipient_type', 'object_name']`),
 * and its list views name those columns as strings. The grid resolved each
 * column from `type` and `format` alone, so both drew through the text cell,
 * and no face — the console registers label faces under the two keys
 * (`@object-ui/app-shell`'s widget reference cells) — could reach them.
 *
 * ## What is probed, and why a probe
 *
 * This file pins the GRID's half of the contract: the key the column resolves
 * to, and the row handed over as `dependentValues` (the recipient face reads
 * the row's `recipient_type` from it). So the two keys are registered here with
 * a probe face that prints exactly those two facts. The label faces themselves
 * are pinned beside them in `@object-ui/app-shell`.
 *
 * The object here is NOT `sys_sharing_rule`, on purpose: the face is chosen by
 * the declared widget, so a neutral object declaring the same two hints is the
 * honest subject, and nothing in the grid may key on an object or field name.
 *
 * ## The control
 *
 * `note` is a plain `text` column holding the SAME strings the two hinted
 * columns hold (`sales_manager`, `crm_account`). It must still print them raw
 * through the text cell: the face is picked by the declaration, not by the
 * value. Each path is its own case (the paths are listed in
 * `formatHintedColumnRenderer-8920.test.tsx`).
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields, registerFieldRenderer, type CellRendererProps } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

/**
 * Prints which key drew the cell, the stored value, and the row's
 * `recipient_type` as the face received it (`-` for no row). `registerFieldRenderer`
 * has no inverse; this `.tsx` file runs in the isolated `dom` project, so the
 * probes do not outlive it.
 */
function probe(key: string): React.FC<CellRendererProps> {
  return ({ value, dependentValues }) => (
    <span data-testid="widget-probe">{`${key}|${String(value)}|${String(dependentValues?.recipient_type ?? '-')}`}</span>
  );
}
registerFieldRenderer('object-ref', probe('object-ref'));
registerFieldRenderer('recipient-picker', probe('recipient-picker'));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

// The record overlay's explain call is served from a double, as in
// `formatHintedColumnRenderer-8920.test.tsx`; nothing here reads it.
beforeEach(() => installRecordSecurityExplainDouble(vi));
afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

const RULE_SCHEMA = {
  name: 'access_rule',
  label: 'Access Rule',
  fields: {
    label: { type: 'text', label: 'Label' },
    object_name: { type: 'text', label: 'Object', widget: 'object-ref' },
    recipient_type: {
      type: 'select',
      label: 'Recipient Type',
      options: [
        { value: 'position', label: 'Position' },
        { value: 'team', label: 'Team' },
      ],
    },
    recipient_id: {
      type: 'text',
      label: 'Recipient',
      widget: 'recipient-picker',
      dependsOn: ['recipient_type', 'object_name'],
    },
    note: { type: 'text', label: 'Note' },
  },
};

const ROWS = [
  {
    id: 'r-1',
    label: 'Account managers',
    object_name: 'crm_account',
    recipient_type: 'position',
    recipient_id: 'sales_manager',
    note: 'sales_manager',
  },
  {
    id: 'r-2',
    label: 'EU team',
    object_name: 'crm_account',
    recipient_type: 'team',
    recipient_id: 'team_eu',
    note: 'crm_account',
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => RULE_SCHEMA),
  } as any;
}

const COLUMN_NAMES = ['label', 'object_name', 'recipient_type', 'recipient_id', 'note'];

function renderGrid(schemaOverrides: Record<string, unknown>, props: Record<string, unknown> = {}) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: 'access_rule', ...schemaOverrides } as never}
        dataSource={makeDataSource()}
        {...props}
      />
    </ActionProvider>,
  );
}

/** The probes drawn, in DOM order. */
const probes = () => screen.queryAllByTestId('widget-probe').map((el) => el.textContent);

/**
 * Both hinted columns drawn by their widget key's face on both rows, each with
 * its own row, and the control printing the same strings raw. `getAllByText`
 * counts TEXT nodes, so a probe (one text node holding the whole line) does not
 * count toward the raw-string tallies.
 */
async function expectWidgetFacesWithRow() {
  await waitFor(() => expect(probes()).toHaveLength(4));
  expect([...probes()].sort()).toEqual([
    'object-ref|crm_account|position',
    'object-ref|crm_account|team',
    'recipient-picker|sales_manager|position',
    'recipient-picker|team_eu|team',
  ]);
  // The control column: the same strings, undeclared, print raw — once each.
  expect(screen.getAllByText('sales_manager')).toHaveLength(1);
  expect(screen.getAllByText('crm_account')).toHaveLength(1);
}

describe('objectui#12613 — every ObjectGrid path draws a widget-hinted column with its key\'s face and the row', () => {
  it('A: object `columns`', async () => {
    renderGrid({
      columns: COLUMN_NAMES.map((field) => ({ field })),
      data: { provider: 'value', items: ROWS },
    });
    await waitFor(() => expect(screen.getByText('Account managers')).toBeInTheDocument());
    await expectWidgetFacesWithRow();
  });

  it('B: string `columns` — the shape the platform list views declare', async () => {
    renderGrid({
      columns: COLUMN_NAMES,
      data: { provider: 'value', items: ROWS },
    });
    await waitFor(() => expect(screen.getByText('Account managers')).toBeInTheDocument());
    await expectWidgetFacesWithRow();
  });

  it('C: inline-data projection (`fields`, no `columns`)', async () => {
    renderGrid({
      fields: COLUMN_NAMES,
      data: { provider: 'value', items: ROWS },
    });
    await waitFor(() => expect(screen.getByText('Account managers')).toBeInTheDocument());
    await expectWidgetFacesWithRow();
  });

  it('D: object-schema default columns (rows handed down, no projection)', async () => {
    renderGrid({}, { data: ROWS });
    await waitFor(() => expect(screen.getByText('Account managers')).toBeInTheDocument());
    await expectWidgetFacesWithRow();
  });
});
