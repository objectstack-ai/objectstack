/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13010 — `page:tabs` probes a related list's count from the record
 * the context NAMES (`recordId`, the route's id on a record page), not from the
 * id inside the loaded row. Keyed on the row, every probe waited for the record
 * read and went out a wave behind it.
 *
 * A list whose visibility the record decides keeps that wait: its gate (a
 * node-level `visibleWhen` in front of it, or the tab item's own) is probed
 * only once the row has landed.
 *
 * The record body is "not landed" here the way a record page has it while its
 * read is on the wire: `recordId` set, `data` undefined.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import { RelatedCountStore } from '../hooks/related-count-store';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

const RECORD_OBJECT = 'zz13010_env';
const PARENT_ID = 'ENV-13010';
const OPEN_CHILD = 'zz13010_member';
const GATED_CHILD = 'zz13010_domain';
const PRO_ONLY = "record.plan == 'pro'";

const TOTALS: Record<string, number> = { [OPEN_CHILD]: 2, [GATED_CHILD]: 3 };

const makeDS = () => ({
  find: vi.fn(async (object: string) => ({ data: [], total: TOTALS[object] ?? 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

const relatedList = (objectName: string, visibleWhen?: unknown) => ({
  type: 'record:related_list',
  ...(visibleWhen === undefined ? {} : { visibleWhen }),
  properties: { objectName, relationshipField: 'environment' },
});

const tabsSchema = (overview: Record<string, unknown>) => ({
  type: 'page:tabs',
  id: 'tabs-13010',
  items: [
    { label: 'Details', value: 'details', children: [{ type: 'element:text', properties: { content: 'DETAILS' } }] },
    { label: 'Overview', value: 'overview', ...overview },
  ],
});

function tree(ds: ReturnType<typeof makeDS>, data: Record<string, unknown> | undefined, overview: Record<string, unknown>) {
  return (
    <RecordContextProvider objectName={RECORD_OBJECT} recordId={PARENT_ID} data={data} dataSource={ds as any}>
      <SchemaRenderer schema={tabsSchema(overview) as any} />
    </RecordContextProvider>
  );
}

const probed = (ds: ReturnType<typeof makeDS>) =>
  Array.from(new Set(ds.find.mock.calls.map((c) => c[0] as string))).sort();

/** Let every pending effect and promise settle without the row arriving. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => RelatedCountStore._reset());
afterEach(() => {
  cleanup();
  RelatedCountStore._reset();
});

describe('page:tabs probes from the named record, not the loaded row (objectui#13010)', () => {
  it('probes an ungated list before the record body lands, scoped to recordId', async () => {
    const ds = makeDS();
    const { findByLabelText } = render(tree(ds, undefined, { children: [relatedList(OPEN_CHILD)] }));

    expect((await findByLabelText('2 items')).textContent).toBe('2');
    expect(ds.find).toHaveBeenCalledWith(OPEN_CHILD, expect.objectContaining({ $filter: { environment: PARENT_ID } }));
  });

  it('a list behind a node-level visibleWhen waits for the record body', async () => {
    const ds = makeDS();
    const overview = { children: [relatedList(GATED_CHILD, PRO_ONLY), relatedList(OPEN_CHILD)] };
    const { rerender, findByLabelText } = render(tree(ds, undefined, overview));
    await findByLabelText('2 items');
    await settle();
    expect(probed(ds)).toEqual([OPEN_CHILD]);

    rerender(tree(ds, { id: PARENT_ID, plan: 'pro' }, overview));
    expect((await findByLabelText('5 items')).textContent).toBe('5');
    expect(probed(ds)).toEqual([GATED_CHILD, OPEN_CHILD].sort());
  });

  it('a tab whose item-level visibleWhen decides it waits for the record body', async () => {
    const ds = makeDS();
    // A predicate that reads TRUE while the row is absent (`undefined != 'free'`)
    // and decides the tab only once it lands.
    const overview = { visibleWhen: "record.plan != 'free'", children: [relatedList(OPEN_CHILD)] };
    const { rerender } = render(tree(ds, undefined, overview));
    await settle();
    expect(ds.find).not.toHaveBeenCalled();

    rerender(tree(ds, { id: PARENT_ID, plan: 'pro' }, overview));
    await waitFor(() => expect(probed(ds)).toEqual([OPEN_CHILD]));
  });

  it('CONTROL: no record named, no probe', async () => {
    const ds = makeDS();
    render(
      <RecordContextProvider objectName={RECORD_OBJECT} recordId={null} data={undefined} dataSource={ds as any}>
        <SchemaRenderer schema={tabsSchema({ children: [relatedList(OPEN_CHILD)] }) as any} />
      </RecordContextProvider>,
    );
    await settle();
    expect(ds.find).not.toHaveBeenCalled();
  });
});
