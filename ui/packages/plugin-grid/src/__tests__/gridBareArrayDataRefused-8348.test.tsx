/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8348 — `object-grid` honours ONLY the `data` spelling its published
 * row declares, and for this block that is the `ViewData` OBJECT.
 *
 * ## The ruling, and this block's half of it
 *
 * Decision batch #83 (2026-09-08), maintainer verbatim 「8348 以协议为准」 — the
 * CONTRACT decides. The card was filed on `object-calendar`, whose row is
 * `z.array(...)` and which was honouring the `{ provider, items }` object
 * anyway. THIS block is the same rule pointing the other way: its row is the
 * object arm, and `getDataConfig` was lifting a bare array into
 * `{ provider: 'value', items }` before the shared ladder ever saw it.
 *
 * MEASURED on the `@objectstack/spec` this repo resolves (17.4.0),
 * `ComponentPropsMap['object-grid'].data` is the `ViewData` union and its own
 * description names the refusal:
 *
 *     "Data source binding (ViewDataSchema — discriminated on `provider`…).
 *      Static inline rows live at `{ provider: 'value', items: [...] }`; the
 *      bare-array shortcut is refused — see migration
 *      `object-grid-data-view-data-converged`"
 *
 * The block's own registration publishes the same arm
 * (`{ name: 'data', type: 'object' }`), and `gridDataInputContract.test.ts` has
 * pinned that DECLARATION since objectui#5090 while explicitly leaving the
 * renderer's array tolerance alone ("NOT asserted away here… it stays as
 * back-compat"). That sentence is what this card retires: the declaration pin
 * next door says what may be PUBLISHED, and this file says what is HONOURED.
 *
 * ## ⭐ THE SECOND CARRIER IS CLOSED SINCE objectui#9571 — read this before the rows
 *
 * When this file was written the removal above was real at the LADDER and was
 * NOT, on its own, an end-to-end change for an authored node. `SchemaRenderer`
 * spreads every non-metadata node key as a React prop and
 * `plugin-grid/src/index.tsx` forwards `{...rest}`, so an authored `data` ARRAY
 * arrived TWICE: as `schema.data`, where `getDataConfig` used to lift it, AND
 * as the `data` PROP, which `ObjectGrid` lifts to `{ provider: 'value', items }`
 * at HIGHER priority than the ladder (`passedData`).
 *
 * MEASURED, not reasoned: the first version of this file asserted that a node
 * authored `data: [ …rows… ]` stops drawing and queries its object instead.
 * Rows 1-2 went RED — no query was issued and the rows were on screen — because
 * the props channel had lifted the array. This file therefore stated its
 * verdict per CARRIER, and row 3 recorded the surviving one.
 *
 * objectui#9571 (ruling objectui#8348 Q2-C, decision batch #136 item 3,
 * maintainer 「同意」) closed it: `SchemaRenderer` no longer spreads an authored
 * `data` as a prop for a block whose published row is the OBJECT arm, so on
 * this block the authored key now has exactly ONE carrier, `schema.data`, and
 * the ladder's verdict is end-to-end. Row 3 is that flip, and it is the row
 * that would have to be re-read first if either half ever moved again.
 *
 * ⛔ What did NOT change, and is rows 7-8: the `data` PROP itself. Option B —
 * gating the prop on the arm — was refused, because that prop is the channel a
 * host such as `plugin-list`'s `ListView` legitimately uses to hand down rows it
 * pre-fetched, and it reaches the component directly rather than through the
 * spread.
 *
 * ⇒ `object-calendar` is untouched by all of this: its row is the ARRAY arm, so
 * neither the ladder nor the spread refuses its bare array, and its off-arm
 * spelling had exactly ONE carrier anyway (`index.tsx`'s `resolveExternalData`
 * keeps `data` only when `Array.isArray`, so the config OBJECT never reaches the
 * props channel).
 *
 * The declared spellings for inline rows — `data: { provider: 'value', items }`
 * and the deprecated `staticData` array — are unchanged, and rows 4-5 hold them
 * still so this file cannot pass by refusing everything.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry, recordSourceDataArmForType } from '@object-ui/core';
import { ObjectGrid } from '../ObjectGrid';
// Registers `object-grid` and its `view:grid` alias.
import '../index';

/** The rows an author put in the metadata. */
const AUTHORED = [{ id: 'a1', name: 'Authored row' }];
/** The row only a real query can put on screen — the discriminator. */
const FETCHED = [{ id: 'q1', name: 'Fetched by the query' }];

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: FETCHED, total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  };
}

const BASE = { type: 'object-grid', objectName: 'account', columns: [{ field: 'name' }] };

function renderGrid(extra: Record<string, unknown>) {
  const adapter = makeAdapter();
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={{ ...BASE, ...extra } as any} />
    </SchemaRendererProvider>,
  );
  return adapter;
}

describe('object-grid refuses the bare-array `data` shorthand (objectui#8348)', () => {
  it('1. at the LADDER: a bare array under `data` is no longer a record source', async () => {
    // The component directly, with NO `data` prop — the only lens through which
    // the ladder's verdict is observable at all (see the two-carrier note above).
    const adapter = makeAdapter();
    render(
      <ObjectGrid
        schema={{ ...BASE, data: AUTHORED } as any}
        dataSource={adapter as any}
      />,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(screen.queryByText('Authored row')).toBeNull();
  });

  it('2. …and the ladder falls through to `objectName`, so the block queries', async () => {
    // Before this card `getDataConfig`'s `Array.isArray(schema.data)` head lifted
    // the array to `{ provider: 'value', items }` and this render issued ZERO
    // queries.
    const adapter = makeAdapter();
    render(
      <ObjectGrid
        schema={{ ...BASE, data: AUTHORED } as any}
        dataSource={adapter as any}
      />,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    expect(await screen.findByText('Fetched by the query')).toBeTruthy();
  });

  it('3. ⭐ through `SchemaRenderer` the array no longer draws either — the second carrier is closed (objectui#9571)', async () => {
    // The row that corrected this file's own first draft, now flipped by the
    // ruling's execution. Before objectui#9571 the authored key reached the
    // component twice and the props carrier won: the rows were on screen and
    // `find` was never called. Both halves move together here — no rows, and
    // the ladder falls through to `objectName`, so the block queries.
    const adapter = renderGrid({ data: AUTHORED });

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    expect(screen.queryByText('Authored row')).toBeNull();
    expect(await screen.findByText('Fetched by the query')).toBeTruthy();
  });

  it('4. ⛔ CONTROL: the DECLARED `{ provider: value, items }` form still draws, with no query', async () => {
    const adapter = renderGrid({ data: { provider: 'value', items: AUTHORED } });

    expect(await screen.findByText('Authored row')).toBeTruthy();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('5. ⛔ CONTROL: the deprecated `staticData` array still draws, with no query', async () => {
    // `staticData` is this block's DECLARED array-shaped door for inline rows
    // ("Deprecated bare-array static-rows shortcut the renderer still reads" on
    // the spec row). The ruling retires the array under `data`, not this key —
    // and without this control, rows 1-2 would also pass on a grid that had
    // simply stopped drawing inline rows at all.
    const adapter = renderGrid({ staticData: AUTHORED });

    expect(await screen.findByText('Authored row')).toBeTruthy();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('7. ⛔ MUST NOT CHANGE: a HOST handing rows down as a `data` PROP still draws them', async () => {
    // The leg option B would have deleted. `ListView` owns the fetch and passes
    // the window down; that prop reaches `ObjectGrid` directly and never goes
    // through the spread objectui#9571 narrowed.
    const adapter = makeAdapter();
    render(
      <ObjectGrid
        schema={{ ...BASE } as any}
        data={AUTHORED as any}
        dataSource={adapter as any}
      />,
    );

    expect(await screen.findByText('Authored row')).toBeTruthy();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('8. ⛔ MUST NOT CHANGE: the host prop still wins over an authored key', async () => {
    // Both carriers present at once, which is the only shape that can tell
    // "the authored key stopped being spread" from "the prop stopped working".
    const adapter = makeAdapter();
    render(
      <ObjectGrid
        schema={{ ...BASE, data: [{ id: 'z', name: 'Authored row' }] } as any}
        data={[{ id: 'h', name: 'Host row' }] as any}
        dataSource={adapter as any}
      />,
    );

    expect(await screen.findByText('Host row')).toBeTruthy();
    expect(screen.queryByText('Authored row')).toBeNull();
  });

  it('9. every KEY this plugin registers onto the grid renderer answers the SAME arm', () => {
    // The alias hazard `RecordSourceDataArm`'s docblock names, closed against
    // the REGISTRY and not against the table: one `register()` call produces a
    // namespaced key and (unless `skipFallback`) a bare one, and `SchemaRenderer`
    // looks the arm up with the raw `schema.type`. A key added without a row in
    // `recordSourceDataArmForType` turns this red instead of silently answering
    // `'undeclared'` and keeping the prop seat.
    const siblings = ComponentRegistry.getAllTypes().filter(
      (type) => ComponentRegistry.get(type) === ComponentRegistry.get('object-grid'),
    );

    expect(siblings).toEqual(
      expect.arrayContaining(['object-grid', 'plugin-grid:object-grid', 'view:grid']),
    );
    for (const type of siblings) {
      expect([type, recordSourceDataArmForType(type)]).toEqual([type, 'view-data']);
    }
  });

  it('10. ⛔ CONTROL: bare `grid` is NOT this renderer — `skipFallback` leaves it to the layout grid', () => {
    // MEASURED, and it is why row 9 reads the registry instead of a name list:
    // `plugin-grid` registers its `view` alias with `skipFallback: true`, so
    // `object-grid` is reachable as `view:grid` and never as bare `grid`, which
    // stays with `@object-ui/components`' layout container. An arm row for
    // `grid` would strip `data` from a block that declares no `data` row.
    expect(ComponentRegistry.get('grid')).not.toBe(ComponentRegistry.get('object-grid'));
    expect(recordSourceDataArmForType('grid')).toBe('undeclared');
  });

  it('6. the spec row is what all of the above is judged against — read, not restated', async () => {
    // Derived rather than asserted as a constant: a spec release that widened
    // `object-grid.data` to accept an array would turn this red, which is the
    // tripwire that says "re-derive the arm", not "delete this line".
    const { ComponentPropsMap } = await import('@objectstack/spec/ui');
    const row = ComponentPropsMap['object-grid'];

    expect(row.safeParse({ objectName: 'account', data: { provider: 'value', items: [] } }).success)
      .toBe(true);

    const refused = row.safeParse({ objectName: 'account', data: AUTHORED });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      const issue = refused.error.issues.find((i: any) => i.path[0] === 'data');
      expect(issue?.code).toBe('invalid_type');
      expect((issue as any)?.expected).toBe('object');
    }
  });
});
