/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4211 — set-default on a saved view could fire NO write at all.
 *
 * The filer measured that the adapter cannot produce this: `updateView` has no
 * early return between its read and its `saveItem`, so every patch shape it is
 * handed becomes a write. The zero-write symptom is therefore above it, and the
 * card named two candidate routes out of `ObjectView`:
 *
 *   route 1 — `handleSetDefaultView`'s only early return, `if (!isSavedView(vid))`,
 *             toasts and returns without writing;
 *   route 2 — the same mismatch makes `saved` undefined when the tab items are
 *             built, so `readonly: isSystem` is set and `ViewTabBar` renders the
 *             set-default entry only under `onSetDefaultView && !isReadonly` —
 *             the entry is ABSENT rather than present-and-inert.
 *
 * WHICH ROUTE — settled here, statically, and it is route 2. Both routes consult
 * the SAME predicate over the SAME array (`readonly: !saved` in the switcher's
 * tab mapping and the `isSavedView` callback both ask `viewRowId(sv) === id`),
 * and all four render sites of the set-default entry are gated on `!isReadonly`
 * (two in `ViewTabBar.tsx`, two in `ManageViewsDialog.tsx`). So when the
 * ids diverge the entry is never rendered, and route 1's toast is unreachable
 * through the UI — there is no control left to click. Route 1 survives only as
 * the handler's own guard against a caller that ignores `readonly`; it is pinned
 * below as such, not as the QA repro.
 *
 * WHY THE IDS DIVERGED — measured, two shapes, both reproduced below. The tab
 * list spelled a tab's identity `{ id: <key>, ...body, ...override }`, with `id`
 * FIRST, so any `id` key inside the merged body or the stored override REPLACED
 * it. Both of those are stored metadata documents that really do carry one:
 *
 *   A. `persistViewPatch(viewDef.id, viewDef, patch)` WROTE the whole tab
 *      object — its `id` included — back through `updateViewConfig`, which
 *      stores it under `name: viewId`. `listViewOverrides` reads that row back
 *      and `loadViewOverrides` hands it to the tab list, where its `id` won.
 *      (objectui#5233 narrowed the overlay branch of that write to the patch,
 *      so no NEW overlay carries an `id` — every row written before it did,
 *      which is what this divergence is still about.)
 *   B. A duplicated view copies its source artifact's `id` verbatim into the
 *      view body; `MetadataProvider.applyViewItem` spreads that body into
 *      `objectDef.listViews[<key>]`, so the entry carries the foreign `id`.
 *
 * The overlay read never had this problem — its merge stamped `id` last — which
 * is precisely why the two sides could disagree: two copies of "what is this
 * tab's id", one of them clobberable. `viewEntry` now stamps identity last at
 * every site and `viewRowId` is the one spelling both sides ask, so the guard
 * and the menu agree by construction rather than by coincidence.
 *
 * REVERSE VERIFICATION — direction predicted before running, and it holds:
 * restoring `{ id: key, ...value, ...(override || {}) }` in `buildViewTabs`
 * turns the two divergence blocks RED with the zero-write signature quoted in
 * the failure message (`expected 'my_view' to be 'crm_lead.my_view'`, and
 * `isSavedViewId(...) expected false to be true`). The control block stays GREEN
 * under that revert — it must, because it pins behaviour this change does not
 * move.
 *
 * SCOPE NOTE on route 2's second link. `readonly ⇒ the entry is not rendered`
 * lives in `@object-ui/plugin-view` and is pinned there
 * (`ViewTabBar.setDefaultVisibility.test.tsx`). It is a FORWARD-direction control
 * in both worlds — it was already correct and this fix must not move it — so it
 * is deliberately not claimed as a red-first pin.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildViewTabs,
  setDefaultViewPatches,
  loadViewOverrides,
} from './ObjectView';
import { viewRowId, isSavedViewId, viewEntry } from '../utils/viewIdentity';
import { mergeViewsIntoObjects } from '../providers/MetadataProvider';

const OBJECT_NAME = 'crm_lead';

/** The auto-generated "all records" tab, which no case here should reach. */
const fallbackTab = () => ({ id: 'all', label: 'All records', type: 'grid', columns: [] });

/**
 * `ObjectView`'s overlay normalization (the `listViews` effect's `.map`),
 * verbatim. objectui#11013 dropped the `objectName` stamp it used to add.
 */
const normalizeSavedViews = (rows: any[]) =>
  rows.map((sv: any) => ({
    ...sv,
    id: viewRowId(sv),
  }));

/**
 * The tab's `readonly` flag, exactly as the switcher's tab mapping computes it:
 * `saved = savedViews.find(sv => viewRowId(sv) === view.id)`, `isSystem = !saved`.
 * Asserting `isSavedViewId` is asserting this same predicate — they are one
 * function now, which is the whole point of the fix.
 */
const isReadonlyTab = (savedViews: any[], tabId: string) => !isSavedViewId(savedViews, tabId);

// ─────────────────────────────────────────────────────────────────────────────

describe('the identity seam — ONE spelling for a view row id (#4211)', () => {
  it('reads `name`, and only `name` (objectui#11013)', () => {
    // The spec declares `name` on every `view` member and a top-level `id` /
    // `_id` on none. This read `name`, then `id`, then `_id` until
    // objectui#11013 aligned it to the declared spelling.
    expect(viewRowId({ name: 'crm_lead.my_view', id: 'other', _id: 'third' }))
      .toBe('crm_lead.my_view');
    expect(viewRowId({ id: 'other', _id: 'third' })).toBeUndefined();
    expect(viewRowId({ _id: 'third' })).toBeUndefined();
    expect(viewRowId({})).toBeUndefined();
    expect(viewRowId(null)).toBeUndefined();
  });

  it('an EMPTY name is no identity, and no undeclared spelling stands in for it', () => {
    // Before objectui#11013 a blank `name` fell through to the row's `id`.
    expect(viewRowId({ name: '', id: 'crm_lead.my_view' })).toBeUndefined();
  });

  it('is IDEMPOTENT across the overlay normalization — producer and readers agree', () => {
    // This is the property that lets one function serve both sides: the
    // normalization writes the answer onto `id` and leaves `name` in place, so
    // asking again returns the same string.
    for (const row of [
      { name: 'crm_lead.my_view', object: OBJECT_NAME },
      { name: 'crm_lead.my_view', id: 'my_view' },
      { id: 'my_view' },
      { _id: 'row-42' },
    ]) {
      const [normalized] = normalizeSavedViews([row]);
      expect(viewRowId(normalized)).toBe(viewRowId(row));
    }
  });

  it('viewEntry stamps `id` LAST — a merged body cannot rename the tab', () => {
    const entry = viewEntry('crm_lead.my_view', { id: 'legacy', label: 'My View' }, { id: 'x' });
    expect(entry.id).toBe('crm_lead.my_view');
    expect(entry.label).toBe('My View');
  });

  it('isSavedViewId is the predicate BOTH the guard and the readonly flag use', () => {
    const savedViews = normalizeSavedViews([{ name: 'crm_lead.my_view', object: OBJECT_NAME }]);
    expect(isSavedViewId(savedViews, 'crm_lead.my_view')).toBe(true);
    expect(isReadonlyTab(savedViews, 'crm_lead.my_view')).toBe(false);
    expect(isSavedViewId(savedViews, 'crm_lead.default')).toBe(false);
    expect(isReadonlyTab(savedViews, 'crm_lead.default')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('divergence A — a stored override row carrying a foreign `id` (#4211)', () => {
  /**
   * The row `persistViewPatch` → `updateViewConfig` USED TO leave behind: the
   * whole tab object, `id` included, stored under `name: <viewId>`. From
   * objectui#5233 an overlay was written as the patch alone, and since
   * objectui#12504 retired that write it is not written at all, so this is a row
   * already at rest rather than one a new write produces. Its `id` was written
   * under an earlier tab-id spelling (objectui#3770 re-keyed the default list),
   * so from then on the stored `id` and the row's `name` disagree — and the
   * stored one used to win.
   */
  const OVERRIDE_ROW = {
    id: 'my_view',
    name: 'crm_lead.my_view',
    object: OBJECT_NAME,
    rowHeight: 'short',
  };

  const OBJECT_DEF = {
    name: OBJECT_NAME,
    listViews: {
      'crm_lead.default': { name: 'crm_lead.default', label: 'All', type: 'grid' },
      'crm_lead.my_view': { name: 'crm_lead.my_view', label: 'My View', type: 'grid' },
    },
  };

  /** What the overlay read (`listViews` → savedViews) makes of the same row. */
  const savedViews = normalizeSavedViews([
    { name: 'crm_lead.my_view', object: OBJECT_NAME, label: 'My View', type: 'grid' },
  ]);

  /** Built through the REAL `loadViewOverrides`, not a hand-made map. */
  const overridesFor = async () =>
    loadViewOverrides(
      { listViewOverrides: vi.fn(async () => ({ 'crm_lead.my_view': OVERRIDE_ROW })) },
      OBJECT_NAME,
      Object.keys(OBJECT_DEF.listViews),
    );

  it('the override really does carry an `id` that is not the row key — the premise', () => {
    // Stated as an assertion so the two blocks below cannot pass vacuously on a
    // fixture that lost the `id` key.
    expect(OVERRIDE_ROW.id).not.toBe(OVERRIDE_ROW.name);
  });

  it('the tab id stays the metadata key — the override cannot rename it', async () => {
    const tabs = await buildViewTabs({
      definedViews: OBJECT_DEF.listViews,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: await overridesFor(),
      fallbackTab,
    });
    expect(tabs.map(t => t.id)).toEqual(['crm_lead.default', 'crm_lead.my_view']);
    // …and the override's personalization still applied — identity is the only
    // thing it lost.
    expect(tabs.find(t => t.id === 'crm_lead.my_view')?.rowHeight).toBe('short');
  });

  it('ROUTE 2: the saved view is not readonly, so the set-default entry renders', async () => {
    const tabs = await buildViewTabs({
      definedViews: OBJECT_DEF.listViews,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: await overridesFor(),
      fallbackTab,
    });
    const tab = tabs.find(t => t.label === 'My View')!;
    expect(isReadonlyTab(savedViews, tab.id)).toBe(false);
  });

  it('ROUTE 1: the handler guard admits the click instead of toasting and returning', async () => {
    const tabs = await buildViewTabs({
      definedViews: OBJECT_DEF.listViews,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: await overridesFor(),
      fallbackTab,
    });
    const tab = tabs.find(t => t.label === 'My View')!;
    expect(isSavedViewId(savedViews, tab.id)).toBe(true);
  });

  it('the write reaches the adapter with `{ isDefault: true }`', async () => {
    const tabs = await buildViewTabs({
      definedViews: OBJECT_DEF.listViews,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: await overridesFor(),
      fallbackTab,
    });
    const tab = tabs.find(t => t.label === 'My View')!;
    // Parameters spelled out to match the adapter call this stands in for: a
    // zero-arity `vi.fn` infers `Mock<() => …>`, and calling it with three
    // arguments is a compile error the untyped test tree could not report
    // (objectui#4040).
    const updateView = vi.fn(
      async (_objectName: string, _viewId: string, _patch: { isDefault: boolean }) => ({}),
    );
    for (const { viewId, patch } of setDefaultViewPatches(savedViews, tab.id)) {
      await updateView(OBJECT_NAME, viewId, patch);
    }
    expect(updateView).toHaveBeenCalledTimes(1);
    expect(updateView).toHaveBeenCalledWith(OBJECT_NAME, 'crm_lead.my_view', { isDefault: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('divergence B — a duplicated view whose `config` carries its source `id` (#4211)', () => {
  /**
   * Built through the REAL `MetadataProvider.mergeViewsIntoObjects`, so the
   * `objectDef.listViews` entry is the one the console actually receives:
   * `applyViewItem` spreads `view.config` into the entry, foreign `id` and all.
   * ObjectView's own overlay-side comment already anticipated this shape ("a
   * duplicate's `id` field … may have been copied verbatim from the source
   * artifact"); the metadata side had no such protection.
   */
  const [objectDef] = mergeViewsIntoObjects(
    [{ name: OBJECT_NAME, label: 'Lead', fields: { name: { type: 'text' } } }],
    [
      {
        name: 'crm_lead.default',
        object: OBJECT_NAME,
        viewKind: 'list',
        isDefault: true,
        label: 'All',
        config: { type: 'grid', columns: [{ field: 'name' }] },
      },
      {
        name: 'crm_lead.my_view',
        object: OBJECT_NAME,
        viewKind: 'list',
        label: 'My View',
        config: { id: 'crm_lead.default', type: 'grid', columns: [{ field: 'name' }] },
      },
    ],
  ) as any[];

  const savedViews = normalizeSavedViews([
    { name: 'crm_lead.my_view', object: OBJECT_NAME, label: 'My View', type: 'grid' },
  ]);

  const tabs = () =>
    buildViewTabs({
      definedViews: objectDef.listViews,
      primary: objectDef.list,
      primaryId: 'crm_lead.default',
      savedViews,
      viewOverrides: {},
      fallbackTab,
    });

  it('the merged metadata entry really carries the foreign `id` — the premise', () => {
    expect(objectDef.listViews['crm_lead.my_view'].id).toBe('crm_lead.default');
  });

  it('the duplicate does not steal its source’s identity — two distinct tabs', () => {
    // Pre-fix this produced THREE tabs: the source, a phantom `crm_lead.default`
    // duplicate (the copied id), and the overlay row pushed separately because
    // its key matched nothing.
    expect(tabs().map(t => t.id)).toEqual(['crm_lead.default', 'crm_lead.my_view']);
  });

  it('ROUTE 2 + ROUTE 1: the duplicate is recognised as saved, so the entry renders', () => {
    const tab = tabs().find(t => t.label === 'My View')!;
    expect(isReadonlyTab(savedViews, tab.id)).toBe(false);
    expect(isSavedViewId(savedViews, tab.id)).toBe(true);
  });

  it('the write reaches the adapter with `{ isDefault: true }`', async () => {
    const tab = tabs().find(t => t.label === 'My View')!;
    // Parameters spelled out to match the adapter call this stands in for: a
    // zero-arity `vi.fn` infers `Mock<() => …>`, and calling it with three
    // arguments is a compile error the untyped test tree could not report
    // (objectui#4040).
    const updateView = vi.fn(
      async (_objectName: string, _viewId: string, _patch: { isDefault: boolean }) => ({}),
    );
    for (const { viewId, patch } of setDefaultViewPatches(savedViews, tab.id)) {
      await updateView(OBJECT_NAME, viewId, patch);
    }
    expect(updateView).toHaveBeenCalledWith(OBJECT_NAME, 'crm_lead.my_view', { isDefault: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('controls — what must NOT change (#4211)', () => {
  const DEFINED = {
    'crm_lead.default': { name: 'crm_lead.default', label: 'All', type: 'grid' },
  };

  it('a genuine system view stays readonly — its missing menu entry is CORRECT', () => {
    const tabs = buildViewTabs({
      definedViews: DEFINED,
      primary: undefined,
      primaryId: undefined,
      savedViews: [],
      viewOverrides: {},
      fallbackTab,
    });
    expect(tabs.map(t => t.id)).toEqual(['crm_lead.default']);
    expect(isReadonlyTab([], 'crm_lead.default')).toBe(true);
    expect(isSavedViewId([], 'crm_lead.default')).toBe(false);
  });

  it('a matching id still set-defaults, and demotes the previous default', () => {
    const savedViews = normalizeSavedViews([
      { name: 'crm_lead.mine', object: OBJECT_NAME },
      { name: 'crm_lead.yours', object: OBJECT_NAME, isDefault: true },
      { name: 'crm_lead.theirs', object: OBJECT_NAME },
    ]);
    expect(setDefaultViewPatches(savedViews, 'crm_lead.mine')).toEqual([
      { viewId: 'crm_lead.yours', patch: { isDefault: false } },
      { viewId: 'crm_lead.mine', patch: { isDefault: true } },
    ]);
  });

  it('the set-default write list is NEVER empty — past the guard, a write is guaranteed', () => {
    // The filer's step "guard passes ⇒ a write is guaranteed", pinned. This is
    // what makes route 2 the only explanation for a zero-write click.
    expect(setDefaultViewPatches([], 'crm_lead.mine')).toEqual([
      { viewId: 'crm_lead.mine', patch: { isDefault: true } },
    ]);
  });

  it('rename / delete / pin / config — the guard’s other consumers accept the same ids', () => {
    // All five handlers short-circuit on `isSavedView(vid)`; they share one
    // predicate, so pinning it across the id shapes pins them together. Since
    // objectui#11013 the one id shape is the declared `name`: a row that
    // carries only a top-level `id` / `_id` is no saved view to any of them.
    const savedViews = normalizeSavedViews([
      { name: 'crm_lead.by_name', object: OBJECT_NAME },
      { id: 'by_id', object: OBJECT_NAME },
      { _id: 'by_underscore_id', object: OBJECT_NAME },
    ]);
    expect(isSavedViewId(savedViews, 'crm_lead.by_name')).toBe(true);
    expect(isReadonlyTab(savedViews, 'crm_lead.by_name')).toBe(false);
    for (const id of ['by_id', 'by_underscore_id']) {
      expect(isSavedViewId(savedViews, id)).toBe(false);
      expect(isReadonlyTab(savedViews, id)).toBe(true);
    }
    expect(isSavedViewId(savedViews, 'crm_lead.default')).toBe(false);
  });

  it('an overlay row with NO identifiable id is skipped, not pushed as a phantom tab', () => {
    // The adapter yields such a row for an aggregated container artifact, whose
    // unnamed default `list` body has no `name`. It stays unaddressable — every
    // mutating handler calls `updateView(objectName, vid, …)` and there is no
    // `vid` to pass — so dropping it is the honest outcome, and the metadata
    // view it belongs to remains readonly.
    const savedViews = normalizeSavedViews([{ label: 'All', type: 'grid' }]);
    const tabs = buildViewTabs({
      definedViews: DEFINED,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: {},
      fallbackTab,
    });
    expect(tabs.map(t => t.id)).toEqual(['crm_lead.default']);
    expect(isReadonlyTab(savedViews, 'crm_lead.default')).toBe(true);
  });

  it('the primary list is still promoted to the front and marked default', () => {
    const tabs = buildViewTabs({
      definedViews: {
        'crm_lead.recent': { name: 'crm_lead.recent', label: 'Recent', type: 'grid' },
        'crm_lead.default': { name: 'crm_lead.default', label: 'All', type: 'grid' },
      },
      primary: { name: 'crm_lead.default', type: 'grid' },
      primaryId: 'crm_lead.default',
      savedViews: [],
      viewOverrides: {},
      fallbackTab,
    });
    expect(tabs.map(t => t.id)).toEqual(['crm_lead.default', 'crm_lead.recent']);
    expect(tabs[0].isDefault).toBe(true);
  });

  it('an object declaring no views at all still gets the fallback tab', () => {
    const tabs = buildViewTabs({
      definedViews: {},
      primary: undefined,
      primaryId: undefined,
      savedViews: [],
      viewOverrides: {},
      fallbackTab,
    });
    expect(tabs.map(t => t.id)).toEqual(['all']);
  });

  it('a saved view that shadows a metadata view merges into it rather than duplicating', () => {
    const savedViews = normalizeSavedViews([
      { name: 'crm_lead.default', object: OBJECT_NAME, label: 'Renamed', isDefault: true },
    ]);
    const tabs = buildViewTabs({
      definedViews: DEFINED,
      primary: undefined,
      primaryId: undefined,
      savedViews,
      viewOverrides: {},
      fallbackTab,
    });
    expect(tabs.map(t => t.id)).toEqual(['crm_lead.default']);
    expect(tabs[0].label).toBe('Renamed');
  });
});
