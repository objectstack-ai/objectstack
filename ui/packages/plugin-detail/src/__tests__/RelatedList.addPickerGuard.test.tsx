/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3838 — an `add` without `add.picker` must not take the whole
 * related list down.
 *
 * `add.picker` is REQUIRED by the spec (`RecordRelatedListProps.add`:
 * `safeParse({ add: { label: 'Add' } })` reports `invalid_type` on
 * `add.picker`), and `RelatedListProps` types it as required too — which is
 * exactly why the bare `add.picker.object` read behind a truthiness-only
 * `{add && dataSource && (` gate type-checked. Nothing on the render path
 * parses the schema (the sdui-parser manifest gate compares top-level key
 * names and coarse types only, `validateComponentProps` is advisory, and this
 * renderer did not check), so off-spec page metadata reached the read and threw
 * `TypeError: Cannot read properties of undefined (reading 'object')`, which
 * `SchemaRenderer` turned into a "Component 'record:related_list' failed to
 * render" card over the ENTIRE list — with no mention of `picker` anywhere in
 * the message.
 *
 * The fix tightens the gates to the resolved picker target (the same
 * `add?.picker?.object` the file already computes for the picker schema fetch),
 * so the bare read is gone rather than optional-chained: an `add` missing
 * `picker` withholds the Add affordance and names the missing key in the
 * console, while the list body renders as usual. It is not consumer-side
 * leniency (AGENTS.md #0.1) — off-spec `add` still does nothing, so no second
 * dialect appears; the producer-side fix is #3838's route (c), out of scope
 * here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

const junctionRows = [
  { id: 'ups_1', permission_set_id: 'ps_1' },
  { id: 'ups_2', permission_set_id: 'ps_2' },
];

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async () => ({
    name: 'sys_user_permission_set',
    fields: { permission_set_id: { type: 'text', label: 'Permission Set' } },
  })),
  find: vi.fn(async (api: string) =>
    api === 'sys_user_permission_set'
      ? { data: junctionRows, total: junctionRows.length }
      : { data: [], total: 0 },
  ),
});

/**
 * `add` is the only thing that varies across these cases; everything else is
 * the configuration a working assignment list uses (referenceField + parentId
 * present, so the unrelated "refusing to fetch all rows" hint stays silent and
 * the console spy sees only the diagnostic under test).
 */
const renderList = (ds: any, add?: any) =>
  render(
    <RelatedList
      title="Permission Sets"
      type="table"
      api="sys_user_permission_set"
      objectName="sys_user_permission_set"
      referenceField="user_id"
      parentId="u_1"
      columns={[{ accessorKey: 'permission_set_id', header: 'Permission Set' }]}
      dataSource={ds}
      add={add}
    />,
  );

/** The Add affordance, whatever label the metadata gave it. */
const queryAddButton = () =>
  screen.queryByRole('button', { name: /Assign position|Grant permission set|^Add$/ });

// Typed at the console method actually spied on, not left generic: bare
// `ReturnType<typeof vi.spyOn>` resolves the type parameters to their
// constraints, which erases the call signature and makes every `mock.calls`
// entry an implicit `any` — so `warnings()` below stringified an untyped bag
// and could not have caught being handed the wrong argument shape.
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const warnings = () => warn.mock.calls.map((c) => String(c[0])).join('\n');

describe('RelatedList — add without add.picker (#3838)', () => {
  it('renders the list body, withholds the Add affordance, and names add.picker.object', async () => {
    const ds = makeDataSource();

    // Pre-fix this render THREW the TypeError above (in the app: the red card
    // replacing the whole block). Reaching the assertions at all is the
    // no-crash half of the pin.
    renderList(ds, { label: 'Assign position' });

    // The list body is untouched: the parent-scoped fetch still runs and its
    // rows still reach the view (the count badge is fed by the same
    // `relatedData` the table renders from — the table itself is a `data-table`
    // delegated to SchemaRenderer/plugin-grid, out of this unit's scope).
    await waitFor(() =>
      expect(ds.find).toHaveBeenCalledWith('sys_user_permission_set', expect.objectContaining({
        $filter: { user_id: 'u_1' },
      })),
    );
    expect(screen.getByText('Permission Sets')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(`${junctionRows.length} records`)).toBeInTheDocument(),
    );

    // The unconfigured Add affordance does not render — clicking a button that
    // can never open a picker is worse than not offering it.
    expect(queryAddButton()).toBeNull();

    // …and the author is told WHICH key is missing, which the crash never did.
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warnings()).toContain('add.picker.object');
    expect(warnings()).toContain('sys_user_permission_set');
  });

  it('still renders the Add affordance and opens the picker for a spec-valid add', async () => {
    const ds = makeDataSource();
    renderList(ds, {
      picker: { object: 'sys_permission_set', labelField: 'label' },
      linkField: 'permission_set_id',
      label: 'Grant permission set',
    });

    const button = await waitFor(() => {
      const b = queryAddButton();
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(button);

    // Opening the dialog fetches the picker TARGET's schema — proof the gate
    // still passes the resolved `add.picker.object` through.
    await waitFor(() =>
      expect(ds.getObjectSchema).toHaveBeenCalledWith('sys_permission_set'),
    );
    expect(warnings()).not.toContain('add.picker.object');
  });

  it('leaves a list with no add untouched and silent', async () => {
    const ds = makeDataSource();
    renderList(ds, undefined);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(queryAddButton()).toBeNull();
    // No `add` is a legitimate configuration, not a misconfiguration.
    expect(warnings()).not.toContain('add.picker.object');
  });
});
