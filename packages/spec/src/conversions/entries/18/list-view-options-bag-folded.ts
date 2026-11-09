// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `list-view-options-bag-folded` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helper
// `LIST_VIEW_OPTIONS_BAG_KINDS` is read by this conversion alone). A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `listViewOptionsBagFolded` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict } from '../shared.js';

/**
 * The per-kind blocks the legacy list-overlay `options` bag could carry, as
 * the bag declared them when it closed (#25923): every list-view `type` that
 * also names a block on the list-view shape (`grid` names none). Spelled out
 * rather than derived, because this conversion replays a shape that is gone:
 * a kind added later never had a bag spelling to fold.
 */
const LIST_VIEW_OPTIONS_BAG_KINDS = ['kanban', 'calendar', 'gantt', 'timeline', 'map', 'gallery', 'chart', 'tree'] as const;

/**
 * The flattened list overlay's legacy `options` bag folds onto the top-level
 * per-kind blocks (protocol 18, #25923 — Prime Directive #12, one key per
 * concept; this supersedes ruling direction A on objectui#10380).
 *
 * Until this release the list overlay door accepted `options.KIND` beside the
 * top-level `KIND` block, judged key by key by the kind's own schema with
 * every key optional, and stored it. The bag was declared an UNDERLAY: where
 * both set a key, the top-level block wins. objectui's `ListView` read it that
 * way for kanban, calendar, gallery, timeline, gantt and map
 * (`{ ...options.KIND, ...KIND }`), so this fold is that same merge, written
 * once into the row:
 *
 * - `options.KIND` with no top-level `KIND` ⇒ it becomes `KIND`.
 * - Both present ⇒ `KIND = { ...options.KIND, ...KIND }`, the top-level value
 *   kept where both set a key.
 * - `chart` is the one kind the renderer did NOT merge: it read
 *   `chart || options.chart`, the block replacing the bag WHOLE. So a bag
 *   beside a top-level `chart` block is dropped (it never drew), and a bag
 *   with no block becomes the block. Merging it per key would draw keys the
 *   author never saw.
 * - A bag left empty is removed.
 *
 * **Retired from the load path** — the door refuses `options` by name with
 * the prescription (`LIST_OVERLAY_OPTIONS_REFUSED` in `ui/view.zod.ts`), so a
 * live author is taught the top-level spelling. The entry exists because a
 * STORED list overlay can carry the bag, and every read of a stored `view` row
 * replays the chain through `applyConversionsToStoredItem` as
 * `{ views: [row] }`; `os migrate meta` lists the edit for sources.
 *
 * **Left as stored, with a TODO** (no lossless rewrite): a bag that is not an
 * object; an `options.grid` (a grid has no block, and the door refused it
 * already); a bag key that is not a kind; an `options.KIND` that is not an
 * object, or whose top-level `KIND` is not one; and any bag on a FORM overlay
 * (`viewKind: 'form'`), whose blocks have no home on a form. The row keeps its
 * bag and is badged invalid until its owner decides. The fold also cannot
 * supply a key the block REQUIRES: the bag was judged with every key
 * optional, so a bag block can fold into a block still missing one (a
 * `gantt` with no `titleField`, say). That row is served badged invalid,
 * and the D3 entry `ui-list-view-options-bag-folded` names the remedy.
 *
 * ⚠️ Scoped to the FLATTENED spelling, as {@link viewOverlayOwnerHiddenRemoved}
 * is: a body with no `config` and no container slot. A view item record
 * (`config` present) has refused the bag since #20051 with its own
 * prescription, and the two authoring shapes never declared it.
 */
const listViewOptionsBagFolded: MetadataConversion = {
  id: 'list-view-options-bag-folded',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface: 'view.options.<kind> — on a flattened list view overlay ({ name, object, viewKind, …, no config })',
  summary:
    "flattened list overlay 'options.KIND' folded onto the top-level 'KIND' block (the top-level "
    + "value wins per key; for 'chart' the block wins whole), and the bag removed: the per-kind "
    + 'blocks are top-level keys of the view, their one spelling',
  apply(stack, emit, context) {
    const fold = (view: Dict, path: string): Dict => {
      if (!('options' in view)) return view;
      if (view.config !== undefined) return view;
      if (view.list !== undefined || view.form !== undefined) return view;
      if (view.listViews !== undefined || view.formViews !== undefined) return view;
      const bag = view.options;
      if (view.viewKind === 'form' || !isDict(bag)) {
        context?.reportTodo?.({
          path: `${path}.options`,
          from: JSON.stringify(bag),
          reason: view.viewKind === 'form'
            ? 'a form view overlay carries an `options` bag; its per-kind blocks belong to a list view and have no '
              + 'home on a form. Remove `options`, or save the body as a list view.'
            : 'the `options` bag is not an object, so there is no per-kind block to fold. Remove `options`.',
        });
        return view;
      }
      const next: Dict = { ...view };
      const rest: Dict = { ...bag };
      let changed = false;
      for (const kind of LIST_VIEW_OPTIONS_BAG_KINDS) {
        if (!(kind in rest)) continue;
        const under = rest[kind];
        const top = next[kind];
        if (!isDict(under) || (top !== undefined && !isDict(top))) continue;
        delete rest[kind];
        changed = true;
        if (top === undefined) {
          next[kind] = under;
          emit({ from: `options.${kind}`, to: kind, path: `${path}.options.${kind}` });
        } else if (kind === 'chart') {
          emit({ from: 'options.chart', to: '(removed: the top-level chart block replaces it whole)', path: `${path}.options.chart` });
        } else {
          next[kind] = { ...under, ...top };
          emit({ from: `options.${kind}`, to: `${kind} (top-level keys kept)`, path: `${path}.options.${kind}` });
        }
      }
      if (Object.keys(rest).length === 0) {
        delete next.options;
        if (!changed) emit({ from: 'options', to: '(removed: empty)', path: `${path}.options` });
        return next;
      }
      context?.reportTodo?.({
        path: `${path}.options`,
        from: JSON.stringify(rest),
        reason: `the bag keeps ${Object.keys(rest).map((k) => `\`${k}\``).join(', ')}, which has no top-level block `
          + 'to fold onto (a grid\'s settings are top-level keys of the view; a non-object block or one beside a '
          + 'non-object top-level block cannot be merged). Move what you meant to the view\'s own keys, then remove `options`.',
      });
      if (!changed) return view;
      next.options = rest;
      return next;
    };
    return mapCollection(
      mapCollection(stack, 'views', fold),
      ASSEMBLED_VIEW_ITEMS_KEY,
      fold,
    );
  },
  fixture: {
    before: {
      // The assembled-manifest channel: an overlay a package export carried.
      viewItems: [
        { name: 'crm_deal.map', object: 'crm_deal', viewKind: 'list', type: 'map', options: { map: { latitudeField: 'lat', longitudeField: 'lng' } } },
      ],
      views: [
        // Per key: the top-level `kanban` keeps `groupByField`, the bag adds
        // `titleField`; the bag's `groupByField` is the one that never drew.
        {
          name: 'crm_deal.board',
          object: 'crm_deal',
          viewKind: 'list',
          type: 'kanban',
          kanban: { groupByField: 'stage' },
          options: { kanban: { groupByField: 'owner', titleField: 'name' }, calendar: { startDateField: 'close_date' } },
        },
        // `chart` is replaced whole by its block, so the bag is dropped.
        {
          name: 'crm_deal.chart',
          object: 'crm_deal',
          viewKind: 'list',
          type: 'chart',
          chart: { dataset: 'deals', values: ['amount'] },
          options: { chart: { dataset: 'old_deals', values: ['amount'], dimensions: ['stage'] } },
        },
        // An empty bag is removed.
        { name: 'crm_deal.empty', object: 'crm_deal', viewKind: 'list', options: {} },
        // A record and a container are not flattened overlays: untouched.
        { name: 'crm_deal.rec', object: 'crm_deal', viewKind: 'list', config: { columns: ['name'] } },
        { object: 'crm_deal', list: { type: 'grid', columns: ['name'] } },
      ],
    },
    after: {
      viewItems: [
        { name: 'crm_deal.map', object: 'crm_deal', viewKind: 'list', type: 'map', map: { latitudeField: 'lat', longitudeField: 'lng' } },
      ],
      views: [
        {
          name: 'crm_deal.board',
          object: 'crm_deal',
          viewKind: 'list',
          type: 'kanban',
          kanban: { groupByField: 'stage', titleField: 'name' },
          calendar: { startDateField: 'close_date' },
        },
        {
          name: 'crm_deal.chart',
          object: 'crm_deal',
          viewKind: 'list',
          type: 'chart',
          chart: { dataset: 'deals', values: ['amount'] },
        },
        { name: 'crm_deal.empty', object: 'crm_deal', viewKind: 'list' },
        { name: 'crm_deal.rec', object: 'crm_deal', viewKind: 'list', config: { columns: ['name'] } },
        { object: 'crm_deal', list: { type: 'grid', columns: ['name'] } },
      ],
    },
    // One notice per folded block (map, kanban, calendar, chart) plus the
    // empty bag's removal.
    expectedNotices: 5,
  },
};

export { listViewOptionsBagFolded };
