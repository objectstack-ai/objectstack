/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7390 — WHICH HOST OWNS THE GALLERY'S ROWS, and therefore which
 * surface is able to bound them.
 *
 * The card asks whether `ObjectGallery`'s standalone fetch should be bounded by
 * PAGING (it is a card grid, "page-shaped", rendered under `ListView`'s paging
 * chrome) or by objectui#7210's platform row ceiling. The card states the
 * precondition itself: that fetch runs ONLY when the gallery owns its data. So
 * the two candidate answers are not both reachable, and which one is reachable
 * is a property of the host, not of the gallery. This file measures it.
 *
 * The reading, and it is the opposite of what "renders under `ListView`'s
 * paging chrome" suggests: THE TWO CONDITIONS ARE MUTUALLY EXCLUSIVE.
 *
 *   - Under `ListView` the gallery never queries. `ListView` fetches one page
 *     (`$top` = `pagination.pageSize`) and hands the rows down as the `data`
 *     PROP — `<SchemaRenderer schema={viewComponentSchema} … {...(ganttOwnsData
 *     ? {} : { data })} />`, and `SchemaRenderer` spreads caller props onto the
 *     component last — so `ObjectGallery`'s effect takes its `props.data`
 *     branch and returns before `dataSource.find`. `object-gallery` is
 *     registered as the component itself (no wrapper that drops props), which
 *     is what makes it the opposite of the `object-gantt` case pinned in
 *     `plugin-gantt/src/ObjectGantt.hostDataProp-7210.test.tsx`.
 *   - Standalone — a `{ type: 'object-gallery', objectName }` node an author
 *     writes into a page schema — the gallery owns the query, and there is no
 *     `ListView`, hence no paging chrome, above it. Every in-repo host
 *     (`ListView`, `plugin-view`'s `ObjectView`, `plugin-detail`'s mobile
 *     `RelatedList`) hands rows down, so this path is reached from AUTHORED
 *     METADATA only.
 *
 * ⇒ paging chrome is present exactly where the unbounded fetch is not, and the
 * unbounded fetch is exactly where no chrome is. What bound that authored path
 * should carry is objectui#7390's open ruling and is deliberately NOT pinned
 * here: this file asserts that the gallery ISSUES its own query there, never
 * what that query carries. A fix in either direction leaves every assertion
 * below true.
 *
 * ⛔ Do not "simplify" case 1 by dropping the call COUNT for a shape check. The
 * count is the whole measurement — a second call is precisely what a gallery
 * that owns its data looks like from here.
 *
 * REVERSE VERIFICATION — direction predicted before running: remove `{ data }`
 * from `ListView`'s child render (so the gallery stops being handed rows) and
 * case 1 goes RED on the call count (1 → 2, the second call carrying the
 * gallery's own `$expand` signature), while case 2 (a different host) and
 * case 3 (`ListView`'s own chrome, which does not depend on who draws the rows)
 * stay GREEN. Observed: 1 failed / 2 passed, as predicted.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import { ListView } from '../ListView';
// Registers `object-gallery` → the real `ObjectGallery`, the subject of both hosts.
import '../index';

/** More rows than the authored page, so "which query bounded this" is visible. */
const TOTAL = 40;
const PAGE_SIZE = 6;

const rows = Array.from({ length: TOTAL }, (_, i) => ({
  id: String(i + 1),
  name: `Row ${i + 1}`,
  owner: 'u1',
}));

const objectDef = {
  name: 'thing',
  label: 'Thing',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    // A lookup, so the gallery's own query carries the `$expand` that
    // objectui#7429 gated — the fingerprint separating it from the host's.
    owner: { name: 'owner', type: 'lookup', label: 'Owner', reference: 'user' },
  },
};

/** Honours `$top` so a bounded query and an unbounded one differ in the rows drawn. */
function makeAdapter() {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      const top = typeof params?.$top === 'number' ? params.$top : undefined;
      return { data: top === undefined ? rows : rows.slice(0, top), total: TOTAL };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as any;
}

/** Every issued query's params, in order. */
const issued = (adapter: any) =>
  adapter.find.mock.calls.map(([, params]: [string, any]) => params ?? {});

afterEach(() => cleanup());

describe('objectui#7390 — the host decides whether the gallery owns its rows', () => {
  it('under ListView the gallery draws the HOST page and issues NO query of its own', async () => {
    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter}>
        <ListView
          schema={{
            type: 'list-view',
            objectName: 'thing',
            viewType: 'gallery',
            columns: ['name'],
            pagination: { pageSize: PAGE_SIZE },
          } as any}
          dataSource={adapter}
        />
      </SchemaRendererProvider>,
    );

    // Settle on the drawn cards, not on the first query.
    await waitFor(() => expect(screen.getByText('Row 1')).toBeTruthy());
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());

    // ONE query, and it is the host's paged one. A gallery owning its data here
    // would show up as a second call — see the file header.
    expect(issued(adapter)).toHaveLength(1);
    expect(issued(adapter)[0].$top).toBe(PAGE_SIZE);

    // …and the cards drawn are that page, not the whole filtered set.
    expect(screen.getAllByText(/^Row \d+$/)).toHaveLength(PAGE_SIZE);
    expect(screen.queryByText(`Row ${TOTAL}`)).toBeNull();
  });

  it('CONTROL standalone: an authored `object-gallery` node owns the query itself', async () => {
    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter}>
        <SchemaRenderer
          schema={{
            type: 'object-gallery',
            objectName: 'thing',
            gallery: { titleField: 'name' },
          } as any}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(screen.getByText('Row 1')).toBeTruthy());

    // The gallery's own query, identified by the FLS-gated `$expand` it builds
    // (objectui#7429) — the host never sends that. This is what makes the
    // call-count assertion in case 1 a real reading rather than a probe that
    // could not have seen a gallery query in the first place.
    //
    // ⛔ Deliberately not asserted: what bound this query carries. That is
    // objectui#7390's open ruling — paging vs. the objectui#7210 ceiling — and
    // pinning today's answer here would fossilise the defect.
    expect(issued(adapter)).toHaveLength(1);
    expect(issued(adapter)[0].$expand).toEqual(['owner']);
    expect(issued(adapter)[0].$select).toBeUndefined();
  });

  it('the truncation disclosure lives on the SURFACE THAT BOUNDS — the host', async () => {
    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter}>
        <ListView
          schema={{
            type: 'list-view',
            objectName: 'thing',
            viewType: 'gallery',
            columns: ['name'],
            pagination: { pageSize: PAGE_SIZE },
          } as any}
          dataSource={adapter}
        />
      </SchemaRendererProvider>,
    );

    // `ListView` bounds the query, so `ListView` is where the "you are not
    // seeing all of it" sentence is. The authored standalone node in case 2 has
    // neither half — that pairing is the card's escalation ground.
    const warning = await screen.findByTestId('data-limit-warning');
    expect(warning.textContent).toContain(String(PAGE_SIZE));
  });
});
