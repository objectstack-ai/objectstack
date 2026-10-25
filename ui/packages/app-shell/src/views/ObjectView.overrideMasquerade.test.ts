/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4227 — personalizing a system (code-defined) view must never make
 * it look user-created.
 *
 * Toggling density / sort / hidden columns / column widths / inline edit on a
 * system view persists a row under the SAME `type='view'` namespace a saved
 * view lives in, keyed by the SAME id. Before this fix, `ObjectStackAdapter
 * .listViews()` returned that row indistinguishably from a real saved view,
 * so `ObjectView`'s `savedViews.find(sv => viewRowId(sv) === view.id)` matched
 * it, `isSystem`/`readonly` flipped to `false`, and the tab gained Rename /
 * Delete / Set-default / Pin against a view that lives in code —
 * `handleDeleteView` would call `dataSource.deleteView` on it.
 *
 * PR #4224 (objectui#4211) pinned "a genuine system view stays readonly" as a
 * control (`ObjectView.setDefaultViewIdentity.test.tsx`), but that fixture's
 * `savedViews` was always `[]` — it never exercised an override row, so it
 * passed straight through the bug this issue reports. This file is the
 * companion fixture that DOES include one, run through the REAL production
 * pipeline: the adapter's `listViews()` (the actual fix) feeding
 * `buildViewTabs` / `isSavedViewId` (the actual consumers), exactly as
 * `ObjectView`'s own effect normalizes them (mirrored from the `normalized`
 * map in `ObjectView.tsx`'s `listViews(objectName, { previewDrafts })` effect).
 *
 * objectui#10210, ruling B (comment 5824008636): only the `_isOverride` marker
 * makes a row an overlay. This file used to pin a second, shape-based layer as
 * well — an unmarked flat row with a server-backfilled `viewKind` excluded and
 * kept read-only. That guess is retired: "Edit view config → Save" wrote the
 * same shape before PR #10332, and the guess turned the user's own view
 * read-only for good once published. The case that pinned it is rewritten
 * below, through the same real pipeline, to pin the ruled behaviour — not
 * deleted.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { buildViewTabs } from './ObjectView';
import { viewRowId, isSavedViewId } from '../utils/viewIdentity';

const OBJECT_NAME = 'crm_lead';

const DEFINED_VIEWS = {
  'crm_lead.default': { name: 'crm_lead.default', label: 'All Leads', type: 'grid' },
};

const fallbackTab = () => ({ id: 'all', label: 'All records', type: 'grid', columns: [] });

/**
 * `ObjectView.tsx`'s own `savedViews` normalization (the `normalized` map in its
 * `listViews` effect), verbatim. objectui#11013 dropped its `objectName` stamp.
 */
function normalizeSavedViews(rows: any[]) {
  return rows.map((sv: any) => ({
    ...sv,
    id: viewRowId(sv),
  }));
}

function makeAdapterWithItems(items: any[]) {
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
  ds.client = { meta: { getItems: vi.fn(async () => ({ items })) } };
  return ds;
}

/** The five mutating handlers all short-circuit through this one guard (ObjectView.tsx). */
const isMutable = (savedViews: any[], vid: string) => isSavedViewId(savedViews, vid);
const isReadonlyTab = (savedViews: any[], vid: string) => !isMutable(savedViews, vid);

describe('a system view stays readonly even with a personalization row (objectui#4227)', () => {
  it.each([
    [
      'marked row (new writes, post-fix)',
      {
        name: 'crm_lead.default', object: 'crm_lead', type: 'grid',
        data: { provider: 'object', object: 'crm_lead' }, columns: ['name'],
        rowHeight: 40, _isOverride: true,
      },
    ],
  ])('%s: excluded from savedViews, tab stays readonly, guard refuses', async (_label, overrideRow) => {
    const ds = makeAdapterWithItems([overrideRow]);

    // The real fix: `listViews()` must not hand this row back as a saved view.
    const rawSavedViews = await ds.listViews(OBJECT_NAME);
    expect(rawSavedViews).toEqual([]);

    const savedViews = normalizeSavedViews(rawSavedViews);
    const tabs = buildViewTabs({
      definedViews: DEFINED_VIEWS,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: {},
      fallbackTab,
    });

    expect(tabs.map((t) => t.id)).toEqual(['crm_lead.default']);
    // Render-time gate (ObjectView.tsx: `isSystem = !saved`, `readonly: isSystem`).
    expect(isReadonlyTab(savedViews, 'crm_lead.default')).toBe(true);
    // The exact predicate all five mutating handlers (rename/delete/pin/
    // set-default/config) short-circuit on.
    expect(isMutable(savedViews, 'crm_lead.default')).toBe(false);
  });

  it('an UNMARKED flat row with a backfilled viewKind is a saved view: the tab is editable and shows its edits (objectui#10210 ruling B)', async () => {
    // This row was the second `it.each` case above, asserting the retired
    // shape guess: excluded, tab read-only, guard refusing. Rewritten, not
    // deleted. The fixture is now the row a pre-PR-#10332 config save left at
    // rest (the flat panel draft, `viewKind`/`object` inherited server-side),
    // which is the same shape as a pre-marker toolbar overlay; under ruling B
    // both read as the plain row they are stored as.
    const flatConfigSave = {
      label: 'All Leads EDITED', type: 'grid', columns: ['name', 'status'],
      name: 'crm_lead.default', isDefault: false, id: 'crm_lead.default',
      viewKind: 'list', object: 'crm_lead',
    };
    const ds = makeAdapterWithItems([flatConfigSave]);

    const rawSavedViews = await ds.listViews(OBJECT_NAME);
    expect(rawSavedViews.map((v: any) => v.name)).toEqual(['crm_lead.default']);

    const savedViews = normalizeSavedViews(rawSavedViews);
    const tabs = buildViewTabs({
      definedViews: DEFINED_VIEWS,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: {},
      fallbackTab,
    });

    expect(tabs.map((t) => t.id)).toEqual(['crm_lead.default']);
    // The edits the save stored are what the tab shows.
    expect(tabs[0].label).toBe('All Leads EDITED');
    expect(tabs[0].columns).toEqual(['name', 'status']);
    // Render-time gate (`isSystem = !saved`, `readonly: isSystem`) lifts, and
    // the predicate all five mutating handlers short-circuit on now admits it.
    expect(isReadonlyTab(savedViews, 'crm_lead.default')).toBe(false);
    expect(isMutable(savedViews, 'crm_lead.default')).toBe(true);
  });

  it('positive control: a genuinely created saved view stays fully manageable, even reusing a system-view-shaped label', async () => {
    // A real save (createView / the ADR-0034 seam) is always a nested
    // ViewItem record — the shape `listViews()` must keep letting through.
    const realSavedView = {
      name: 'crm_lead.my_pipeline', object: 'crm_lead', viewKind: 'list', label: 'My Pipeline',
      config: { type: 'kanban', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
    };
    const ds = makeAdapterWithItems([realSavedView]);

    const rawSavedViews = await ds.listViews(OBJECT_NAME);
    expect(rawSavedViews.map((v: any) => v.name)).toEqual(['crm_lead.my_pipeline']);

    const savedViews = normalizeSavedViews(rawSavedViews);
    const tabs = buildViewTabs({
      definedViews: DEFINED_VIEWS,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: {},
      fallbackTab,
    });

    expect(tabs.map((t) => t.id)).toEqual(['crm_lead.default', 'crm_lead.my_pipeline']);
    expect(isReadonlyTab(savedViews, 'crm_lead.my_pipeline')).toBe(false);
    expect(isMutable(savedViews, 'crm_lead.my_pipeline')).toBe(true);
    // The system view beside it is untouched.
    expect(isReadonlyTab(savedViews, 'crm_lead.default')).toBe(true);
  });

  it("PR #4224's own control still holds: no override row at all", () => {
    const tabs = buildViewTabs({
      definedViews: DEFINED_VIEWS,
      primary: undefined,
      primaryId: undefined,
      savedViews: [],
      viewOverrides: {},
      fallbackTab,
    });
    expect(tabs.map((t) => t.id)).toEqual(['crm_lead.default']);
    expect(isReadonlyTab([], 'crm_lead.default')).toBe(true);
  });
});
