/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#3895 — the Add button and the picker dialog answer to the SAME gate.
 *
 * Three consumers sit on the `add` chain and one of them disagreed with the other
 * two about `dataSource`: the dialog required it (`add && pickerObject &&
 * dataSource`) and so did the callback (`handleAddRecords`: `if (!add ||
 * !dataSource || …) return`), while the BUTTON required only `add &&
 * pickerObject`. Where no `dataSource` reached the component the button therefore
 * rendered, its click set `pickerOpen`, and nothing existed to observe the flag —
 * a visible affordance with no reaction and no message.
 *
 * That host is real, not hypothetical: `renderers/record-related-list.tsx` passes
 * `dataSource={ctx?.dataSource}`, so any mount with no `RecordContext` bound —
 * the Studio designer preview, a context-free embed (the shape
 * `apps/console/src/__tests__/public-block-binding-reach.test.tsx` mounts) —
 * arrives with `undefined`. Which is why the first case below goes through the
 * RENDERER rather than the component: the gate is only worth pinning at the
 * mounting shape that produces the missing adapter.
 *
 * Direction 1 of the filing (withhold the affordance) over direction 2 (render it
 * disabled with a reason), settled by the triage seat: the same principle
 * objectui#3838 applied one condition earlier on this very chain — an affordance
 * is offered only where the capability behind it exists. Sibling pins for that
 * condition live in `RelatedList.addPickerGuard.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RelatedList } from '../RelatedList';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';

/**
 * Every mount below with no adapter takes the component's legacy raw-URL branch,
 * which calls `fetch`. Left real, jsdom dials the origin for a request the
 * subject of this file does not care about, and the console fills with
 * `ECONNREFUSED` from a test that passed. Stubbed so the mount is hermetic — the
 * rows are irrelevant here, the Add gate is not.
 */
let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ json: async () => [] }) as any) as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * `label` is authored rather than left to default, so the affordance has a name
 * that does not depend on an i18n provider being mounted: with none, the default
 * button renders the raw key `detail.add`, and a selector for /^Add$/ would then
 * find nothing in EITHER direction — the negative pins below would pass because
 * nothing matched, not because the gate closed.
 */
const ADD = {
  picker: { object: 'sys_permission_set', labelField: 'label' },
  label: 'Grant permission set',
};

const makeDS = () => ({
  find: vi.fn(async () => [{ id: 'ps_1', label: 'Admin' }]),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

/** The Add affordance, by its accessible name. */
const queryAddButton = () => screen.queryByRole('button', { name: 'Grant permission set' });

describe('record:related_list in a host with no dataSource (objectui#3895)', () => {
  it('withholds the Add button when no RecordContext supplies an adapter', async () => {
    // No `RecordContextProvider` — the designer-preview / bare-embed shape, where
    // `ctx?.dataSource` is `undefined`. Pre-fix the button rendered here and did
    // nothing at all when clicked.
    const { container } = render(
      <RecordRelatedListRenderer
        schema={{
          objectName: 'sys_user_permission_set',
          relationshipField: 'user_id',
          columns: ['permission_set_id'],
          add: ADD,
        } as any}
      />,
    );

    // The block itself still renders — only the unbacked affordance is withheld
    // (the list body is fine; this is not the "cannot render anything" case).
    await waitFor(() => expect(container.textContent).toContain('Sys User Permission Set'));
    expect(container.innerHTML).not.toContain('failed to render');
    expect(queryAddButton()).toBeNull();
  });

  it('still offers it once a RecordContext brings the adapter', async () => {
    // Same metadata, the runtime host: the affordance comes back. This is the
    // half that makes the gate a gate rather than a removal.
    const ds = makeDS();
    render(
      <RecordContextProvider objectName="sys_user" recordId="u_1" dataSource={ds as any}>
        <RecordRelatedListRenderer
          schema={{
            objectName: 'sys_user_permission_set',
            relationshipField: 'user_id',
            columns: ['permission_set_id'],
            add: ADD,
          } as any}
        />
      </RecordContextProvider>,
    );
    await waitFor(() => expect(queryAddButton()).not.toBeNull());
  });
});

describe('RelatedList — Add button vs picker dialog gate parity (objectui#3895)', () => {
  const renderList = (dataSource: any) =>
    render(
      <RelatedList
        title="Permission Sets"
        type="table"
        api="sys_user_permission_set"
        objectName="sys_user_permission_set"
        referenceField="user_id"
        parentId="u_1"
        columns={[{ accessorKey: 'permission_set_id', header: 'Permission Set' }]}
        dataSource={dataSource}
        add={ADD}
      />,
    );

  it('renders neither button nor dialog without a dataSource', async () => {
    const { container } = renderList(undefined);
    await waitFor(() => expect(screen.getByText('Permission Sets')).toBeInTheDocument());
    expect(queryAddButton()).toBeNull();
    // The dialog was already gated on `dataSource`; asserting it here is what
    // makes this a PARITY pin — the two must agree, in both directions, or the
    // click leads nowhere again.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the button with a dataSource, exactly as before', async () => {
    const ds = makeDS();
    renderList(ds as any);
    await waitFor(() => expect(queryAddButton()).not.toBeNull());
  });
});
