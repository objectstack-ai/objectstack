/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10210, ruling B (comment 5824008636): a view row is a
 * personalization overlay when it carries `_isOverride`, and for no other
 * reason.
 *
 * The retired alternative was a SHAPE guess: a flat row (no nested `config`)
 * carrying `viewKind: 'list'`. The platform puts that `viewKind` on any write
 * addressed to a code-defined view (`viewIdentityPatch`, inherited from the
 * registry entry the row shadows), so two populations end up in that shape:
 *
 * - a view an "Edit view config → Save" stored before PR #10332, when the save
 *   wrote the flat panel draft. The guess read it as an overlay, so the view
 *   dropped out of `listViews()`, its tab was stamped read-only, and publishing
 *   made that permanent;
 * - a toolbar overlay written before the marker existed (objectui#4227, closed
 *   2026-08-15) and never touched since, carrying a frozen copy of the view.
 *
 * The card measured the two as structurally identical. The ruling takes the
 * marker as the only discriminant and accepts both consequences, pinned here
 * through a store that inherits identity the way the platform's write door
 * does:
 *
 * 1. the broken config-save row heals on read — it is a saved view again, and
 *    its edits are kept;
 * 2. the pre-marker overlay also reads as a plain row, so its frozen label,
 *    columns and filter cover the code definition again. No deployment is
 *    named as holding one.
 *
 * The control at the end is the same shape carrying the marker: it is still
 * excluded and still narrowed, so what moved is the shape guess and nothing
 * else.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter, narrowPersonalizationOverlay } from './index';

const OBJECT_NAME = 'crm_lead';
const VIEW_ID = 'crm_lead.all';

/** The code-defined view as the registry serves it, untouched. */
const REGISTRY: Record<string, Record<string, unknown>> = {
  [VIEW_ID]: {
    name: VIEW_ID,
    object: OBJECT_NAME,
    viewKind: 'list',
    label: 'Everything',
    config: { type: 'grid', columns: [{ field: 'name' }] },
  },
};

/**
 * What "Edit view config → Save" sent before PR #10332: the flat panel draft,
 * as captured from a live run against an `@objectstack` 17.4.0 backend and
 * recorded on objectui#10210. The label and the filter are the user's edits.
 */
const FLAT_CONFIG_SAVE = {
  label: 'Everything EDITED',
  type: 'grid',
  columns: [{ field: 'name' }, { field: 'status' }],
  filter: [{ field: 'status', operator: 'equals', value: 'open' }],
  name: VIEW_ID,
  isDefault: false,
  id: VIEW_ID,
};

/** The code-defined view as it stood when a pre-marker toolbar toggle copied it. */
const DEFINITION_AT_OVERLAY_TIME = {
  label: 'Everything',
  type: 'grid',
  columns: [{ field: 'name' }],
  filter: [{ field: 'status', operator: 'equals', value: 'open' }],
};

/** The same view after its code definition moved on. */
const DEFINITION_NOW = {
  label: 'Everything (active)',
  type: 'grid',
  columns: [{ field: 'name' }, { field: 'owner' }],
  filter: [{ field: 'status', operator: 'equals', value: 'qualified' }],
};

/**
 * What `updateViewConfig` stored before the marker existed (objectui#4227):
 * the whole active tab plus the one key the toggle changed, and no marker.
 * `updateViewConfig` stamped the marker from then on, and is retired since
 * objectui#12504, so this row can only be put in the store directly — it is the
 * state of an install that has carried it since.
 */
const PRE_MARKER_OVERLAY_WRITE = {
  ...DEFINITION_AT_OVERLAY_TIME,
  name: VIEW_ID,
  rowHeight: 'compact',
};

/**
 * A `sys_metadata`-shaped store standing in for the platform's `view` write
 * door in the one way this card depends on: a write addressed to a
 * code-defined view inherits `viewKind` / `object` / `label` from the registry
 * entry it shadows, when the body does not carry them.
 */
function makePlatformStore() {
  const rows = new Map<string, any>(Object.entries(REGISTRY).map(([k, v]) => [k, { ...v }]));
  const meta = {
    getItems: vi.fn(async () => ({ type: 'view', items: [...rows.values()] })),
    getItem: vi.fn(async (_type: string, name: string) => ({ type: 'view', name, item: rows.get(name) })),
    saveItem: vi.fn(async (_type: string, name: string, item: any) => {
      const baseline = REGISTRY[name];
      const stored = { ...item };
      for (const key of ['viewKind', 'object', 'label'] as const) {
        if (stored[key] === undefined && baseline?.[key] !== undefined) stored[key] = baseline[key];
      }
      rows.set(name, stored);
      return { success: true, item: stored };
    }),
  };
  return { meta, rows };
}

function makeAdapter(meta: any) {
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

/** An adapter whose `?preview=draft` metadata route answers with `items`. */
function makeDraftPreviewAdapter(items: any[]) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes('/meta/view') ? { items } : { success: true, data: {} };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { meta: { getItems: vi.fn(async () => ({ items: [] })) } };
  return ds;
}

/** The row the store holds for `VIEW_ID` after `body` lands on it. */
async function storedAfter(body: Record<string, unknown>) {
  const { meta, rows } = makePlatformStore();
  await meta.saveItem('view', VIEW_ID, body);
  return { ds: makeAdapter(meta), row: rows.get(VIEW_ID) };
}

describe('objectui#10210 ruling B — a view broken by an earlier config save heals on read', () => {
  it('listViews() returns it as a saved view, with the edits the save stored', async () => {
    const { ds, row } = await storedAfter(FLAT_CONFIG_SAVE);
    // Precondition — the row at rest is the flat, unmarked shape the card
    // measured: {label,type,columns,name,isDefault,id,viewKind,object}, plus
    // `filter` because this draft edited one.
    expect(Object.keys(row).sort()).toEqual(
      ['columns', 'filter', 'id', 'isDefault', 'label', 'name', 'object', 'type', 'viewKind'],
    );
    expect(row.viewKind).toBe('list');

    const views: any[] = await ds.listViews(OBJECT_NAME);
    // The tab's read-only stamp is `!saved`, and `saved` is found by this
    // name — so a view in this list is an editable tab again.
    const healed = views.find((v) => v.name === VIEW_ID);
    expect(healed).toBeDefined();
    expect(healed.label).toBe(FLAT_CONFIG_SAVE.label);
    expect(healed.columns).toEqual(FLAT_CONFIG_SAVE.columns);
    expect(healed.filter).toEqual(FLAT_CONFIG_SAVE.filter);
  });

  it('the draft-preview read — where the card saw the menu collapse to one entry — returns it too', async () => {
    const { row } = await storedAfter(FLAT_CONFIG_SAVE);
    const ds = makeDraftPreviewAdapter([{ ...row, _draft: true }]);
    const views: any[] = await ds.listViews(OBJECT_NAME, { previewDrafts: true });
    expect(views.map((v) => v.name)).toEqual([VIEW_ID]);
    expect(views[0]).toMatchObject({ label: FLAT_CONFIG_SAVE.label, _draft: true });
  });

  it('read as a patch it keeps every edit — nothing is narrowed away', async () => {
    const { row } = await storedAfter(FLAT_CONFIG_SAVE);
    const asPatch: any = narrowPersonalizationOverlay(row);
    expect(asPatch).toBe(row);
    const merged = { ...DEFINITION_NOW, ...asPatch };
    expect(merged.label).toBe(FLAT_CONFIG_SAVE.label);
    expect(merged.filter).toEqual(FLAT_CONFIG_SAVE.filter);
  });
});

describe('objectui#10210 ruling B — the accepted exposure: a pre-marker overlay never touched since', () => {
  it('reads back from listViews() as a plain row, carrying its frozen copy', async () => {
    const { ds, row } = await storedAfter(PRE_MARKER_OVERLAY_WRITE);
    expect(row.viewKind).toBe('list');
    const views: any[] = await ds.listViews(OBJECT_NAME);
    expect(views.find((v) => v.name === VIEW_ID)).toMatchObject({
      label: DEFINITION_AT_OVERLAY_TIME.label,
      columns: DEFINITION_AT_OVERLAY_TIME.columns,
      filter: DEFINITION_AT_OVERLAY_TIME.filter,
      rowHeight: 'compact',
    });
  });

  it('merged over the current code definition, its frozen label, columns and filter cover it again', async () => {
    const { row } = await storedAfter(PRE_MARKER_OVERLAY_WRITE);
    const merged = { ...DEFINITION_NOW, ...narrowPersonalizationOverlay(row) };
    expect(merged.label).toBe(DEFINITION_AT_OVERLAY_TIME.label);
    expect(merged.columns).toEqual(DEFINITION_AT_OVERLAY_TIME.columns);
    expect(merged.filter).toEqual(DEFINITION_AT_OVERLAY_TIME.filter);
  });
});

describe('objectui#10210 ruling B — control: the marker still classifies', () => {
  it('the same shape carrying `_isOverride` is excluded from listViews() and narrowed to its patch', async () => {
    const { ds, row } = await storedAfter({ ...PRE_MARKER_OVERLAY_WRITE, _isOverride: true });
    expect(await ds.listViews(OBJECT_NAME)).toEqual([]);
    const merged = { ...DEFINITION_NOW, ...narrowPersonalizationOverlay(row) };
    expect(merged.filter).toEqual(DEFINITION_NOW.filter);
    expect(merged.label).toBe(DEFINITION_NOW.label);
    expect(merged.rowHeight).toBe('compact');
  });
});
