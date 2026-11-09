// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `view-personal-declarations-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `personalViewDeclarationsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapViewPayloads } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * The two inert `personal` declarations leave the view (protocol 18, #29037 —
 * ADR-0049 enforce-or-remove; ruling of record 6570568131 on #28971, letter C:
 * personal named views are a user-owned record, not a view item, and they do
 * not reuse either key).
 *
 * - `scope: 'personal'` on a view item record or a flattened overlay
 *   (`ViewScopeSchema`, now `enumWithRetiredValues`): nothing ever restricted
 *   such an item to one user — both switcher read paths list every item bound
 *   to the object. The member is DELETED: the item lands on an absent
 *   `scope`, which is what the prescription tells an author to do by hand, and
 *   what every reader saw anyway. The conversion invents no `shared`.
 * - `sharing.type` on every list payload (`ViewSharingSchema`, now a
 *   `retiredKey()` tombstone with the `collaborative` default accepted as
 *   residue): its one reader was the console list toolbar's badge, which
 *   claimed "Personal view" for a view everyone could read. The KEY is deleted,
 *   both values; `sharing.lockedBy` stays, and a block left with no key stays
 *   as an empty block, the choice `navigation-mode-overlay-values-removed`
 *   makes for its own container.
 *
 * Reach — every carrier of either declaration:
 *
 * - `scope`: the `views` collection and the assembled-manifest `viewItems`
 *   channel ({@link ASSEMBLED_VIEW_ITEMS_KEY}), on a record (`config` present)
 *   or a flattened overlay; a container declares no `scope` and is skipped;
 * - `sharing.type`: every list payload {@link mapViewPayloads} reaches (a
 *   container's `list` / `listViews.*`, a list item's `config`, a flattened
 *   list overlay), the same three spellings in `viewItems`, and an object's
 *   `listViews.*`. No page block declares `sharing`.
 *
 * `PUT /meta/view` persisted both through 18.2.0, so a stored `view` row CAN
 * carry them, and every artifact a released toolchain built carries
 * `type: 'collaborative'` wherever a `sharing` block was authored. **Retired
 * from the load path from day one**: a live author meets the parse's
 * prescription, and this entry serves stored-row rehydration, assembled
 * artifacts and `os migrate meta`. Idempotent by construction: a converted
 * row carries neither declaration.
 *
 * The D3 entry `ui-view-personal-declarations-retired` carries what the edit
 * cannot decide: whether a view its author meant as personal should stay as a
 * view everyone sees, be deleted, or wait for the user-owned personal view.
 */
const personalViewDeclarationsRemoved: MetadataConversion = {
  id: 'view-personal-declarations-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface:
    "view.scope ('personal') — on a view item record or a flattened overlay / view.list.sharing.type / "
    + 'view.listViews.<key>.sharing.type / object.listViews.<key>.sharing.type',
  summary:
    "the two inert `personal` declarations removed: `scope: 'personal'` (nothing restricted a view item to one "
    + 'user) and `sharing.type` (it only drew a badge, and claimed "personal" for a view everyone could read). '
    + 'The `personal` member and the `type` key, whichever value it holds, are deleted; `sharing.lockedBy` is '
    + 'unchanged',
  apply(stack, emit) {
    const stripScope = (view: Dict, path: string): Dict => {
      if (view.scope !== 'personal') return view;
      if (view.list !== undefined || view.form !== undefined) return view;
      if (view.listViews !== undefined || view.formViews !== undefined) return view;
      emit({ from: 'personal', to: '(removed)', path: `${path}.scope` });
      const next: Dict = { ...view };
      delete next.scope;
      return next;
    };
    const convertList = (payload: Dict, path: string): Dict => {
      const sharing = payload.sharing;
      if (!isDict(sharing)) return payload;
      const stripped = stripKeys(sharing, ['type'], emit, `${path}.sharing`);
      return stripped === sharing ? payload : { ...payload, sharing: stripped };
    };

    let next = mapCollection(mapCollection(stack, 'views', stripScope), ASSEMBLED_VIEW_ITEMS_KEY, stripScope);
    next = mapViewPayloads(next, (payload, kind, path) => (kind === 'list' ? convertList(payload, path) : payload));
    next = mapCollection(next, ASSEMBLED_VIEW_ITEMS_KEY, (item, path) => {
      if (item.viewKind !== 'list') return item;
      if (isDict(item.config)) {
        const config = convertList(item.config, `${path}.config`);
        return config === item.config ? item : { ...item, config };
      }
      // A flattened list overlay — the body IS the payload. A present but
      // malformed `config` is neither shape and is left for the parse.
      return item.config === undefined ? convertList(item, path) : item;
    });
    return mapCollection(next, 'objects', (obj, path) => {
      const listViews = obj.listViews;
      if (!isDict(listViews)) return obj;
      let changed = false;
      const rebuilt: Dict = { ...listViews };
      for (const [name, entry] of Object.entries(listViews)) {
        if (!isDict(entry)) continue;
        const mapped = convertList(entry, `${path}.listViews.${name}`);
        if (mapped === entry) continue;
        rebuilt[name] = mapped;
        changed = true;
      }
      return changed ? { ...obj, listViews: rebuilt } : obj;
    });
  },
  fixture: {
    before: {
      // The assembled-manifest channel: a record a package export carried
      // before this release, with both declarations.
      viewItems: [
        {
          name: 'vpd_lead.mine',
          object: 'vpd_lead',
          viewKind: 'list',
          scope: 'personal',
          config: { type: 'grid', columns: ['name'], sharing: { type: 'personal', lockedBy: 'usr_7' } },
        },
      ],
      views: [
        // A record: the member and the key both go; `label` rides through.
        {
          name: 'vpd_lead.hot',
          object: 'vpd_lead',
          viewKind: 'list',
          label: 'Hot leads',
          scope: 'personal',
          config: { type: 'grid', columns: ['name'], sharing: { type: 'collaborative' } },
        },
        // A live `scope` member rides through by reference.
        { name: 'vpd_lead.team', object: 'vpd_lead', viewKind: 'list', scope: 'shared', config: { type: 'grid', columns: ['name'] } },
        // A flattened list overlay: its own `scope` and its `sharing.type`.
        { name: 'vpd_lead.board', object: 'vpd_lead', viewKind: 'list', scope: 'personal', sharing: { type: 'personal' } },
        // A container: `sharing.type` goes from each list payload, `lockedBy` stays.
        {
          object: 'vpd_lead',
          list: { type: 'grid', columns: ['name'], sharing: { type: 'personal', lockedBy: 'usr_9' } },
          listViews: { quiet: { type: 'grid', columns: ['name'], sharing: { lockedBy: 'usr_9' } } },
        },
      ],
      objects: [
        { name: 'vpd_lead', label: 'Lead', listViews: { mine: { type: 'grid', columns: ['name'], sharing: { type: 'collaborative' } } } },
      ],
    },
    after: {
      viewItems: [
        {
          name: 'vpd_lead.mine',
          object: 'vpd_lead',
          viewKind: 'list',
          config: { type: 'grid', columns: ['name'], sharing: { lockedBy: 'usr_7' } },
        },
      ],
      views: [
        {
          name: 'vpd_lead.hot',
          object: 'vpd_lead',
          viewKind: 'list',
          label: 'Hot leads',
          config: { type: 'grid', columns: ['name'], sharing: {} },
        },
        { name: 'vpd_lead.team', object: 'vpd_lead', viewKind: 'list', scope: 'shared', config: { type: 'grid', columns: ['name'] } },
        { name: 'vpd_lead.board', object: 'vpd_lead', viewKind: 'list', sharing: {} },
        {
          object: 'vpd_lead',
          list: { type: 'grid', columns: ['name'], sharing: { lockedBy: 'usr_9' } },
          listViews: { quiet: { type: 'grid', columns: ['name'], sharing: { lockedBy: 'usr_9' } } },
        },
      ],
      objects: [
        { name: 'vpd_lead', label: 'Lead', listViews: { mine: { type: 'grid', columns: ['name'], sharing: {} } } },
      ],
    },
    // One notice per declaration removed: `scope` + `sharing.type` on the
    // `viewItems` record, on the `views` record and on the overlay (six), the
    // container's `list` (one), the object's list view (one).
    expectedNotices: 8,
  },
};

export { personalViewDeclarationsRemoved };
