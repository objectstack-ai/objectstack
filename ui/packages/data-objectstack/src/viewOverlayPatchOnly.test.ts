/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5233 — an overlay row is a PATCH, and only the keys it owns may
 * reach the view it is merged over.
 *
 * `ObjectView.persistViewPatch` USED TO send `{ ...baseViewDef, ...patch }` and
 * this adapter persists what it is given, so a row written by a column drag
 * carried the whole source view — `filter` included — as of that moment. The
 * display merge is `{ ...source, ...override }`, which handed that stale copy
 * authority over the source declaration it was copied from. The write half
 * landed (objectui#5233: the toolbar wrote the patch alone), and the toolbar's
 * write itself is retired since objectui#12504 (`persistViewPatch` and this
 * adapter's `updateViewConfig`), so a fat row is a LEGACY shape — which is
 * exactly what the fixtures below model, and why this read-side policy still
 * has work to do.
 *
 * {@link narrowPersonalizationOverlay} is the read-side half: the policy for
 * WHAT an overlay may contribute, owned by this package because this package
 * owns the row's shape (its retired writer stamped the marker `listViews()`
 * excludes rows by). The end-to-end pin — read, merge, admin edits the source
 * filter, user sees the new one — lives beside the consumer that does the
 * merging, `packages/app-shell/src/views/ObjectView.overlayPatchOnly.test.ts`.
 *
 * Deliberately NOT applied inside {@link ObjectStackAdapter.listViewOverrides}
 * or {@link ObjectStackAdapter.getView}: both answer with the stored DOCUMENT,
 * their equality is pinned in `listViewOverrides.test.ts` ("same key space,
 * same document"), and `InterfaceListPage` hydrates a hollow view out of it.
 * A row is narrowed where it is read AS A PATCH, not where it is read as a row
 * — and that boundary is pinned below.
 *
 * WHICH rows are narrowed is the `_isOverride` marker's call alone
 * (objectui#10210, ruling B, comment 5824008636). A flat row carrying an
 * inherited `viewKind` used to be narrowed by shape too; that guess is retired,
 * because an "Edit view config → Save" wrote the same shape and the guess
 * turned the user's own view read-only. The case below that pinned the
 * narrowing of a pre-marker row is rewritten to pin the ruled behaviour, not
 * deleted.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ObjectStackAdapter,
  VIEW_OVERLAY_OWNED_KEYS,
  narrowPersonalizationOverlay,
} from './index';

/** A stub metadata store keyed the way `sys_metadata` is: `type` + `name`. */
function makeMetaStore() {
  const rows = new Map<string, any>();
  const meta = {
    getItems: vi.fn(async (type: string) => ({
      type,
      items: [...rows.entries()].filter(([k]) => k.startsWith(`${type}::`)).map(([, v]) => v),
    })),
    getItem: vi.fn(async (type: string, name: string) => {
      const item = rows.get(`${type}::${name}`);
      if (!item) {
        const err: any = new Error(`Not found: ${type}/${name}`);
        err.status = 404;
        throw err;
      }
      return { type, name, item };
    }),
    saveItem: vi.fn(async (type: string, name: string, item: any) => {
      rows.set(`${type}::${name}`, { ...item });
      return { success: true, item: rows.get(`${type}::${name}`) };
    }),
  };
  return { meta, rows };
}

function makeDS(meta: any) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { meta };
  return ds;
}

/** What `persistViewPatch` USED TO send for a column drag: the whole tab + one
 *  key. Rows in this shape are still at rest on every install that predates the
 *  write-side narrowing, which is why this file keeps modelling them. */
const FAT_WRITE = {
  name: 'crm_lead.default',
  label: 'All Leads',
  type: 'grid',
  data: { provider: 'object', object: 'crm_lead' },
  columns: ['name', 'status'],
  filter: [{ field: 'status', operator: 'equals', value: 'open' }],
  isDefault: true,
  columnState: { order: ['status', 'name'] },
};

describe('narrowPersonalizationOverlay — what an overlay may contribute', () => {
  it('keeps the five keys the toolbar owns and drops the copied view body', () => {
    const narrowed: any = narrowPersonalizationOverlay({
      ...FAT_WRITE,
      object: 'crm_lead',
      viewKind: 'list',
      sort: [{ field: 'created_at', order: 'desc' }],
      hiddenFields: ['owner'],
      rowHeight: 'compact',
      inlineEdit: true,
      _isOverride: true,
    });

    expect(narrowed).toEqual({
      name: 'crm_lead.default',
      object: 'crm_lead',
      viewKind: 'list',
      _isOverride: true,
      rowHeight: 'compact',
      sort: [{ field: 'created_at', order: 'desc' }],
      hiddenFields: ['owner'],
      columnState: { order: ['status', 'name'] },
      inlineEdit: true,
    });
    // Named individually as well as by the shape above: these four are the
    // ones that silently outranked the source view.
    for (const key of ['filter', 'columns', 'label', 'isDefault']) {
      expect(key in narrowed, `an overlay must not carry \`${key}\``).toBe(false);
    }
  });

  it('omits an owned key the row does not carry rather than writing it as undefined', () => {
    // `{ ...source, ...override }` treats a present-but-undefined key as an
    // override that blanks the source — the same trap `buildViewTabs` strips
    // for saved views ("Drop undefined fields so a partial overlay does not
    // stomp isDefault/columns").
    const narrowed: any = narrowPersonalizationOverlay({
      name: 'crm_lead.default', object: 'crm_lead', viewKind: 'list',
      // A base key rides along deliberately: without one this fixture's key
      // set is already the narrowed one, and the assertion below would hold
      // just as well against a narrowing that never ran (measured — it stayed
      // green under the ablation leg that makes the policy inert).
      filter: [{ field: 'status', operator: 'equals', value: 'open' }],
      rowHeight: 'compact', _isOverride: true,
    });
    expect(Object.keys(narrowed).sort()).toEqual(
      ['_isOverride', 'name', 'object', 'rowHeight', 'viewKind'],
    );
  });

  it('leaves a PRE-MARKER row whole — flat body plus an inherited `viewKind`, no marker (objectui#10210 ruling B)', () => {
    // This case used to pin objectui#4227's best-effort signature, which
    // narrowed this row as an override on a system view. Ruling B retires it:
    // only the marker makes a row an overlay. For this row that is the one
    // exposure the ruling accepts — an overlay written before the marker and
    // never touched since keeps its frozen copy, so its `filter` reaches the
    // merge. Same predicate `listViews()` classifies by, so the row is a plain
    // row for both readers.
    const preMarkerRow = { ...FAT_WRITE, object: 'crm_lead', viewKind: 'list' };
    const read: any = narrowPersonalizationOverlay(preMarkerRow);
    expect(read).toBe(preMarkerRow);
    expect(read.filter).toEqual(FAT_WRITE.filter);
  });

  it("returns a saved view's own body BY REFERENCE — untouched", () => {
    // The runtime "Add View" shape (app-shell's `viewEnvelope`): nested
    // `config`, no marker. The row IS the view; every key on it is an opinion
    // its author expressed.
    const savedRow = {
      name: 'crm_lead.my_pipeline',
      object: 'crm_lead',
      viewKind: 'list',
      label: 'My Pipeline',
      config: { type: 'kanban', columns: ['name'] },
    };
    expect(narrowPersonalizationOverlay(savedRow)).toBe(savedRow);
  });

  it('leaves a flat row with no marker and no inherited viewKind alone', () => {
    const legacyBareSpec = { name: 'crm_lead.mine', object: 'crm_lead', type: 'grid', columns: ['name'] };
    expect(narrowPersonalizationOverlay(legacyBareSpec)).toBe(legacyBareSpec);
  });

  it('leaves a `{ list: … }` container, non-objects and arrays alone', () => {
    const container = { list: { type: 'grid', columns: ['name'] }, object: 'crm_lead' };
    expect(narrowPersonalizationOverlay(container)).toBe(container);
    expect(narrowPersonalizationOverlay(null)).toBe(null);
    expect(narrowPersonalizationOverlay(undefined)).toBe(undefined);
    const arr = [{ _isOverride: true }];
    expect(narrowPersonalizationOverlay(arr)).toBe(arr);
  });

  it('the owned-key list is the five the retired toolbar write wrote, and is frozen', () => {
    expect([...VIEW_OVERLAY_OWNED_KEYS]).toEqual(
      ['rowHeight', 'sort', 'hiddenFields', 'columnState', 'inlineEdit'],
    );
    expect(Object.isFrozen(VIEW_OVERLAY_OWNED_KEYS)).toBe(true);
  });
});

describe('narrowPersonalizationOverlay — the round trip it is defined against', () => {
  it('a fat overlay row at rest comes back narrowed to its patch', async () => {
    const { meta, rows } = makeMetaStore();
    const ds = makeDS(meta);

    // The row the retired `updateViewConfig` (objectui#12504) stored for this
    // write: the body, with `object`, `name` and the marker stamped on it.
    rows.set('view::crm_lead.default', { ...FAT_WRITE, object: 'crm_lead', _isOverride: true });

    const stored = (await ds.listViewOverrides('crm_lead'))['crm_lead.default'];
    // The document readers still get the document — this is the boundary, and
    // the reason the narrowing is not applied inside the adapter's reads.
    expect(stored.filter).toEqual(FAT_WRITE.filter);
    expect(stored.columns).toEqual(FAT_WRITE.columns);
    expect(await ds.getView('crm_lead', 'crm_lead.default')).toEqual(stored);

    // Read AS A PATCH, the same row contributes only what the user changed.
    const asPatch: any = narrowPersonalizationOverlay(stored);
    expect(asPatch.columnState).toEqual({ order: ['status', 'name'] });
    expect('filter' in asPatch).toBe(false);
  });
});
