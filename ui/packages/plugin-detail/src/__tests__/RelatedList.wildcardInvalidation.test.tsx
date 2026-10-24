/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RelatedList — the `'*'` wildcard on the legacy invalidation event
 * (objectui#3460).
 *
 * `notifyDataChanged` (the #2269 bus) still dispatches the pre-bus
 * `objectui:related-changed` window event for backward compatibility, and this
 * list is that event's remaining listener. The bus's own readers go through
 * `dataChangeMatches`, which treats `objectName: '*'` as "unknown scope —
 * everything is stale"; this listener predates that and compared the payload's
 * object name to its own, so a wildcard invalidation reached every bus reader
 * on the page EXCEPT the related lists.
 *
 * That is what made the record header's manual ⟳ (#3460) a half-refresh: it
 * publishes `'*'` precisely because a click means "someone else wrote data I
 * can't identify", the main record and the tab-count badges refetched, and the
 * child rows underneath them did not.
 *
 * Both directions are pinned, because the fix is a widening and the guard it
 * widens still has a job: `'*'` must be accepted, and a CONCRETE foreign object
 * name must still be ignored. Dropping the second assertion would let
 * "refetch on every event" pass as a fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

// Capture the schema RelatedList hands to SchemaRenderer (the data-table) so
// the rows a refetch produced are observable without rendering the grid.
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

const RELATED_OBJECT = 'mes_work_order_line';
const columns = [{ accessorKey: 'name', header: 'Name' }];

/** DataSource stub whose rows change per read, so a refetch is observable. */
function makeDataSource() {
  let generation = 0;
  const find = vi.fn(async () => {
    generation += 1;
    return { data: [{ id: `line-${generation}`, name: `Line ${generation}` }] };
  });
  return { find };
}

function renderRelated(dataSource: any) {
  return render(
    <RelatedList
      title="Lines"
      type="table"
      api={RELATED_OBJECT}
      objectName={RELATED_OBJECT}
      referenceField="work_order"
      parentId="WO-1"
      columns={columns}
      dataSource={dataSource as any}
    />,
  );
}

/** Dispatch the legacy event the bus emits for backward compatibility. */
function dispatchRelatedChanged(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent('objectui:related-changed', { detail }));
  });
}

beforeEach(() => {
  h.schema = null;
});

describe("RelatedList — legacy related-changed listener and '*' (objectui#3460)", () => {
  it("refetches on the '*' wildcard scope", async () => {
    const ds = makeDataSource();
    renderRelated(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));

    dispatchRelatedChanged({ objectName: '*' });

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    // The refetched rows actually reached the table — not just a call count.
    await waitFor(() => expect(h.schema?.data?.[0]?.id).toBe('line-2'));
  });

  it('still refetches on its own object name', async () => {
    const ds = makeDataSource();
    renderRelated(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));

    dispatchRelatedChanged({ objectName: RELATED_OBJECT });

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
  });

  it('still refetches on a scopeless event (no objectName in the detail)', async () => {
    const ds = makeDataSource();
    renderRelated(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));

    dispatchRelatedChanged({});

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
  });

  it('still IGNORES a concrete foreign object name', async () => {
    // The other half of the guard. A write to some unrelated object is not a
    // reason for this list to spend a round trip — widening `'*'` must not
    // widen this.
    const ds = makeDataSource();
    renderRelated(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    // The gate above settles the CALL; the closing assertion reads the VALUE
    // that call produces. Settle it here, before the foreign events go out, so
    // "still line-1" is a statement about the guard rather than about rows that
    // had not landed yet — measured red at that line under a 50ms fetch
    // deferral (objectui#7579).
    await waitFor(() => expect(h.schema?.data?.[0]?.id).toBe('line-1'));

    dispatchRelatedChanged({ objectName: 'crm_contact' });
    dispatchRelatedChanged({ objectName: 'mes_work_order' });
    dispatchRelatedChanged({ objectName: `${RELATED_OBJECT}_history` });

    // Give any (wrong) refetch several turns to show up before asserting none.
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(h.schema?.data?.[0]?.id).toBe('line-1');
  });
});
