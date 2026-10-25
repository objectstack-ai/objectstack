/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7903 — `ObjectGallery`'s DUPLICATE query is gated.
 *
 * It sat outside the set objectui#6482 converged (`ObjectKanban`, `ObjectView`,
 * `ObjectCalendar`, `ObjectTree`; `ObjectGantt` at objectui#7225 ask 2,
 * `ObjectTimeline` at objectui#7895) and nothing marked it a deliberate
 * exclusion. It held the object definition in a local `useState` and listed it
 * in the record-fetch effect's dependency array, so a mount issued TWO `find`
 * calls: one before the definition settled, with `buildExpandFields` seeing no
 * fields and therefore NO `$expand` at all, and one after.
 *
 * ⛔ A GREEN RUN WITH NO HOLD IS ZERO EVIDENCE HERE. This container settles the
 * metadata read and the record read close together, so several of the readings
 * below are invisible unperturbed — the lesson objectui#7466 paid for. The lever
 * is the METADATA fetch, so `getObjectSchema` is HELD and the writes into the
 * rendered card grid are counted per SINGLE mount. Measured on this component
 * with an instrumented renderer, `ObjectCalendar` as a positive control in the
 * same vitest run, holds 0/1/2/3/4/5/6/7/8/9/10/15/25/50/100 ms:
 *
 *   component       when     finds  expand sets        states  late  first paint
 *   ObjectGallery   before     2    [null, ['owner']]     2      3   flat 3-8ms
 *   ObjectGallery   after      1    [['owner']]           1      0   tracks hold
 *   ObjectCalendar  before     1    [['owner']]           1      -   tracks hold
 *   ObjectCalendar  after      1    [['owner']]           1      -   tracks hold
 *
 * ⭐ "First paint tracks the hold" is the signature that the gate is LIVE, and
 * it is what the ordering case below pins — not as a wall-clock threshold, which
 * would be a timing test, but as an ORDER: the definition resolves, then the
 * query goes out, then the card grid is written to, exactly once. Before the
 * gate that order was find, paint, definition, find, paint. Measured after the
 * gate: 9ms at a +3ms hold, 15ms at +10, 35ms at +25, 106ms at +100, against a
 * flat 3-8ms at every hold before it.
 *
 * ⚠️ This component's visible cost was a TWO-step paint, not the three-step one
 * `ObjectCalendar` (objectui#6453) and `ObjectTimeline` (objectui#7895) each
 * measured. Those make `loading` an unconditional early return, so the re-run's
 * `setLoading(true)` drops them back to their placeholder in between. Here the
 * early return is `loading && !items.length`, so once the raw rows are in state
 * the skeleton cannot come back — measured `skelAfter=false` at every hold. The
 * user saw raw foreign-key ids replaced IN PLACE by the expanded rows. Recorded
 * because objectui#6482's standard is that the cost is measured per component,
 * never inherited from a sibling with a matching shape.
 *
 * ⚠️ The gate is only safe because the resolution now SETTLES ON EVERY EXIT
 * (objectui#7232, via the shared `useSettledSchema`): the replaced effect
 * returned without settling on `!dataSource`, on a missing `getObjectSchema`, on
 * an absent object name and in its `catch`. That cost nothing while nothing
 * waited on it and would hold a gated query open FOREVER. The two middle cases
 * below are that trap, pinned: a gallery that never loads is the failure this
 * file exists to make impossible.
 *
 * ⛔ GATING IS NOT EXPANDING. objectui#7429 is the separate, non-overlapping
 * concern of whether the `$expand` set this query carries is FLS-gated, and
 * objectui#7390 is the unbounded fetch on this same component. This file asserts
 * only HOW MANY queries go out, WHEN, and whether the first one carries its
 * expansion.
 */

import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectGallery } from '../ObjectGallery';

/** Definition resolve / query / paint, interleaved in the order they happen. */
let sequence: string[] = [];

/** A definition with a lookup, so a gated query has a real `$expand` to carry. */
const OBJECT_SCHEMA = {
  name: 'visit',
  label: 'Visit',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    owner: { name: 'owner', type: 'lookup', label: 'Owner', reference: 'user' },
  },
};

const TITLE = 'Site visit';

/**
 * A FRESH array per response, as the wire produces, tagged with the query that
 * produced it. Returning one shared array would make `setFetchedData` a
 * reference-equal no-op and hide every extra delivery.
 */
const rowsFor = (tag: string) => [{ id: 'v1', name: TITLE, owner: `u1-${tag}` }];

function makeAdapter(getObjectSchema?: any) {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      const tag = Array.isArray(params?.$expand) && params.$expand.length > 0 ? 'expanded' : 'raw';
      sequence.push('find');
      return { records: rowsFor(tag) };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...(getObjectSchema === undefined ? {} : { getObjectSchema }),
  } as any;
}

/** The expand sets of every issued query, in order. */
function expandSets(adapter: any): Array<unknown> {
  return adapter.find.mock.calls.map(([, params]: [string, any]) => params?.$expand ?? null);
}

const gallerySchema: any = {
  type: 'object-gallery',
  objectName: 'visit',
  gallery: { titleField: 'name', visibleFields: ['owner'] },
};

/**
 * Every write into the rendered card grid, in order. `loading && !items.length`
 * is an early return above the grid, so an entry here is a real paint.
 */
function renderGallery(adapter: any, schema: any = gallerySchema, data?: any) {
  const onRender = () => {
    if ((document.body.textContent ?? '').includes(TITLE) && sequence[sequence.length - 1] !== 'paint') {
      sequence.push('paint');
    }
  };
  return render(
    <React.Profiler id="gallery" onRender={onRender}>
      <ObjectGallery schema={schema} dataSource={adapter} data={data} />
    </React.Profiler>,
  );
}

beforeEach(() => {
  sequence = [];
});
afterEach(() => cleanup());

describe('objectui#7903 — the gallery waits for the object definition instead of querying twice', () => {
  it('issues ONE query per load, and it already carries the expansion', async () => {
    const adapter = makeAdapter(vi.fn(async () => OBJECT_SCHEMA));

    renderGallery(adapter);

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

    // The old regime's signature was `[null, ['owner']]`. One expanded call.
    expect(expandSets(adapter)).toEqual([['owner']]);
    expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
  });

  it('never issues an UNEXPANDED query for an object that declares a lookup', async () => {
    const adapter = makeAdapter(vi.fn(async () => OBJECT_SCHEMA));

    renderGallery(adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // The discarded round trip — and the raw-id frame it painted — is the thing
    // gating removes. Not "fewer" unexpanded calls: none.
    for (const params of adapter.find.mock.calls.map(([, p]: [string, any]) => p)) {
      expect(params.$expand).toEqual(['owner']);
    }
  });

  it('still queries when the adapter exposes NO `getObjectSchema` — the gate is on SETTLED, not on truthy', async () => {
    // objectui#7232's trap: an exit that returns without settling would hold
    // this query open forever, and the gallery would never load.
    const adapter = makeAdapter(undefined);

    renderGallery(adapter);

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(adapter.find).toHaveBeenCalledTimes(1);
    // Nothing to derive an expand set from, so the query is unexpanded — the
    // same query this case produced before the gate.
    expect(expandSets(adapter)).toEqual([null]);
  });

  it('still queries when the definition read REJECTS', async () => {
    const adapter = makeAdapter(
      vi.fn(async () => {
        throw new Error('metadata endpoint down');
      }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderGallery(adapter);

      await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
      expect(adapter.find).toHaveBeenCalledTimes(1);
      expect(expandSets(adapter)).toEqual([null]);
      expect(String(error.mock.calls[0]?.[0] ?? '')).toContain('[useSettledSchema]');
    } finally {
      error.mockRestore();
    }
  });

  it('an AUTHORED `data` gallery paints without issuing any record query — and STILL reads the definition', async () => {
    const adapter = makeAdapter(vi.fn(async () => OBJECT_SCHEMA));

    renderGallery(adapter, gallerySchema, [{ id: 'a1', name: TITLE, owner: 'u9' }]);

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(adapter.find).not.toHaveBeenCalled();
    // ⛔ The metadata read is NOT disabled on this path, unlike the sibling
    // components' `hasInlineData ? undefined : dataSource`. `buildEnrichedField`
    // reads `objectDef.fields` for each visible field's type/options/currency,
    // and `getRecordDisplayName(objectDef, item)` resolves the card title under
    // ADR-0079 — on the authored path too, where no query is issued at all.
    // Taking the read away would be a second, unasked-for change riding on a
    // fetch-sequencing fix.
    expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
  });

  it('under a HELD definition read: ONE paint, and it arrives AFTER the definition', async () => {
    // ⛔ The hold is the whole instrument. Without it this container settles both
    // reads close together and the case is far weaker on the unfixed component.
    const HOLD_MS = 25;
    const adapter = makeAdapter(
      vi.fn(async () => {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        sequence.push('definition');
        return OBJECT_SCHEMA;
      }),
    );

    renderGallery(adapter);

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    // Leave the render MOUNTED and let anything still in flight land — the late
    // writes are only observable on a render that is still there to receive
    // them. Measured before the gate at this hold: 3 of them, and a second
    // painted state.
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOLD_MS + 150));
    });

    // The ORDER is the signature, not a wall-clock threshold. Before the gate:
    // find, paint, definition, find, paint.
    expect(sequence).toEqual(['definition', 'find', 'paint']);
    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(expandSets(adapter)).toEqual([['owner']]);
  });

  it('holds the LOADING placeholder across the gate window, never a false empty state', async () => {
    // ⚠️ This component's own departure. `loading` starts `false` here and was
    // only ever flipped inside the fetch, so a bare `return` at the gate would
    // show the empty state for the whole metadata read — a FALSE empty state
    // where the pre-gate component showed the placeholder. The two
    // siblings get this from their initial state (`ObjectCalendar` starts
    // `loading` at `true`, `ObjectTimeline` computes it in a lazy initializer);
    // this component states it in the gate branch instead.
    let releaseDefinition!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseDefinition = resolve;
    });
    const adapter = makeAdapter(
      vi.fn(async () => {
        await held;
        return OBJECT_SCHEMA;
      }),
    );

    renderGallery(adapter);

    await waitFor(() => expect(screen.getByText(/Loading Gallery/i)).toBeTruthy());
    // By the shared component's test id, not its copy (objectui#12217): the
    // copy is translated and selected by the query, so a text match would
    // go vacuous the moment either changed.
    expect(document.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(adapter.find).not.toHaveBeenCalled();

    await act(async () => {
      releaseDefinition();
      await held;
    });
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(expandSets(adapter)).toEqual([['owner']]);
  });
});
