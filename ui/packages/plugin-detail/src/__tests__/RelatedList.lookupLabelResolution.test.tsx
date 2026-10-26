/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3330 — the batch id → label map must resolve through the target
 * object's declared display name, not a hard-coded key chain.
 *
 * `sys_permission_set` declares `nameField: 'label'` while its `name` field
 * holds the API name (`ehr_production_planner`). The cell's own on-demand
 * fetch (`useLookupName`) already resolves through ADR-0079 and rendered the
 * display name — then this list's batch map landed with `name` and, injected
 * as `options` (which outrank the resolved name inside LookupCellRenderer),
 * flipped the whole column to API names. One resolver now serves both paths.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Both cases read resolved lookup labels in rendered cells.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer (the data-table), so
// we can render a column's cell directly and read the label it shows.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const junctionSchema = {
  name: 'sys_user_permission_set',
  fields: {
    permission_set_id: {
      type: 'lookup',
      label: 'Permission Set',
      reference: 'sys_permission_set',
    },
  },
};

// The target object declares its display name lives in `label` — `name` is
// the machine/API name, exactly the sys_permission_set shape.
const permissionSetSchema = {
  name: 'sys_permission_set',
  nameField: 'label',
  fields: {
    label: { type: 'text', label: 'Display Name' },
    name: { type: 'text', label: 'API Name' },
  },
};

const links = [{ id: 'l1', user_id: 'u_1', permission_set_id: 'ps_1' }];

const permissionSets = [
  { id: 'ps_1', name: 'ehr_production_planner', label: '排班员权限' },
];

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async (api: string) =>
    api === 'sys_permission_set' ? permissionSetSchema : junctionSchema,
  ),
  find: vi.fn(async (api: string, params: any) => {
    if (api === 'sys_permission_set') {
      const ids: string[] = params?.$filter?.id?.$in ?? [];
      return { data: permissionSets.filter((r) => ids.includes(r.id)) };
    }
    return { data: links, total: links.length };
  }),
});

const lookupColumn = () =>
  h.schema?.columns?.find((c: any) => c.accessorKey === 'permission_set_id');

/**
 * Has the batch id -> label map landed? Answered WITHOUT touching the DOM.
 *
 * This is the readiness signal the two cases below wait on, and it is
 * side-effect free on purpose (objectui#7756). `waitFor` re-runs its callback
 * on DOM MUTATIONS as well as on its interval, so a callback that renders
 * schedules its own next run — self-feeding. Measured here with the interval
 * pinned at the timeout, so the interval timer can never re-run the callback:
 * a rendering callback still reached 200 runs in 144ms, an inert one and one
 * rendering into a DETACHED container reached 1. Every run of the rendering
 * callback also leaked one node into `document.body` (growth == run count):
 * RTL's `unmount()` tears down the React root but leaves behind the container
 * div `render` appended. So the loop is unbounded ALLOCATION, and when the
 * lookup batch resolves slowly it exhausts the V8 heap and kills the whole
 * vitest worker — `Tests (2) / Errors 1 / tests 0ms`, nothing reported — which
 * fails the entire shard rather than one test.
 *
 * `col.cell(value)` only ALLOCATES a React element; nothing is mounted. The
 * junction field declares no `options` of its own, so `field.options` on that
 * element exists only once the batch map is folded in — that IS the readiness
 * fact, and it is a pure read.
 */
const batchLabelsLanded = (value: string): boolean =>
  Boolean((lookupColumn()?.cell?.(value) as any)?.props?.field?.options);

/**
 * Render the permission_set_id column's cell for `value`, return its text.
 * Called ONCE per case, after the wait above — never from inside a `waitFor`.
 */
const renderCellText = (value: string): string | undefined => {
  const col = lookupColumn();
  if (!col?.cell) return undefined;
  const { container, unmount } = render(<>{col.cell(value)}</>);
  const text = container.textContent ?? undefined;
  unmount();
  return text;
};

beforeEach(() => {
  h.schema = null;
});

describe('RelatedList batch lookup-label resolution (objectui#3330)', () => {
  it('resolves through the target object nameField, not the hard-coded chain', async () => {
    const dataSource = makeDataSource();
    render(
      <RelatedList
        title="Permission Sets"
        type="table"
        api="sys_user_permission_set"
        objectName="sys_user_permission_set"
        referenceField="user_id"
        parentId="u_1"
        columns={[{ accessorKey: 'permission_set_id', header: 'Permission Set' }]}
        dataSource={dataSource as any}
      />,
    );

    // Wait for the batch id → label fetch against the target object.
    await waitFor(() =>
      expect(dataSource.find).toHaveBeenCalledWith('sys_permission_set', expect.anything()),
    );

    // Wait for the map to land — side-effect free, so the predicate cannot
    // feed its own re-runs — then render the cell ONCE and read what it shows.
    await waitFor(() => expect(batchLabelsLanded('ps_1')).toBe(true));

    // The cell must show the declared display name — never flip to the API
    // name the legacy chain would have picked.
    expect(renderCellText('ps_1')).toBe('排班员权限');
  });

  it('falls back to the legacy chain when the target schema is unavailable', async () => {
    const dataSource = makeDataSource();
    (dataSource.getObjectSchema as any).mockImplementation(async (api: string) => {
      if (api === 'sys_permission_set') throw new Error('no schema');
      return junctionSchema;
    });
    render(
      <RelatedList
        title="Permission Sets"
        type="table"
        api="sys_user_permission_set"
        objectName="sys_user_permission_set"
        referenceField="user_id"
        parentId="u_1"
        columns={[{ accessorKey: 'permission_set_id', header: 'Permission Set' }]}
        dataSource={dataSource as any}
      />,
    );

    await waitFor(() =>
      expect(dataSource.find).toHaveBeenCalledWith('sys_permission_set', expect.anything()),
    );
    await waitFor(() => expect(batchLabelsLanded('ps_1')).toBe(true));

    // Non-regressive: without a schema the old `name`-first chain still applies.
    expect(renderCellText('ps_1')).toBe('ehr_production_planner');
  });
});
