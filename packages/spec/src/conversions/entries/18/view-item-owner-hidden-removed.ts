// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `view-item-owner-hidden-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `viewItemOwnerHiddenRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * The view item's `owner` / `hidden` leave the authorable surface (protocol 18,
 * #20085 — ADR-0049 enforce-or-remove; triage direction, verbatim: 「retire both
 * keys」).
 *
 * Both were declared on the view-item identity layer (`viewItemBaseShape()` in
 * `ui/view.zod.ts`), accepted by the strict authoring door and by the wire
 * member `saveMetaItem` validates, stored verbatim — and read by nothing. The
 * measurement, with lit controls, is recorded beside the prescriptions
 * (`VIEW_ITEM_OWNER_RETIRED` / `VIEW_ITEM_HIDDEN_RETIRED`): no writer and no
 * reader in this framework, in objectui at its pin and at `main`, or in cloud;
 * both switcher read paths filter on `viewKind` + `object` and sort on `order`.
 * Per-user view scoping, which `owner` was to carry, is no view-item
 * mechanism: personal named views are a user-owned record (#28971, letter C;
 * the same ruling retired `scope: 'personal'` in
 * `view-personal-declarations-removed`).
 *
 * **Retired from the load path** — both keys are `retiredKey()` tombstones on
 * the shared shape, so a live author is refused at parse with the
 * prescription. The entry exists because a stored `view` row CAN carry them: the
 * `PUT /meta/view` door accepted and persisted both until this release, and
 * `applyConversionsToStoredItem` replays the chain over stored `view` rows as
 * `{ views: [row] }`. Without it such a row would fail its rehydration parse
 * forever over two keys that never had an effect. It also lets
 * `os migrate meta --from 17` list the mechanical edits for existing sources.
 *
 * **Two collections, because a ViewItem record travels in two.** `views` is the
 * stack collection and the stored-row seam's `{ views: [row] }` wrapping.
 * `viewItems` ({@link ASSEMBLED_VIEW_ITEMS_KEY}) is the assembled-manifest
 * channel — package export and environment artifacts carry tenant-authored
 * standalone ViewItems there, `applyArtifactForwardConversions` replays the
 * chain over it, and the registration loop then parses each entry against
 * `AssembledViewArtifactSchema`, whose ViewItem member carries these tombstones.
 * Walking `views` alone would leave an artifact assembled before this release
 * refused at registration (`INVALID_METADATA`, 422) over two keys that never
 * had an effect.
 *
 * ⚠️ Scoped to the ViewItem RECORD spelling — `viewKind` names the family and
 * `config` holds the payload, the discriminator {@link mapViewPayloads} uses for
 * its case 1 — and deliberately NOT walked through `mapViewPayloads`, whose
 * mapper sees a record's `config`, never the record's own top level. A
 * flattened overlay (no `config`) declares its `owner` / `hidden` on a different
 * door (`flattenedViewOverlayFields()`); [#20230] that door's pair is retired
 * too, and stripped by its own entry, {@link viewOverlayOwnerHiddenRemoved} —
 * the two are disjoint by `config`, so no row is judged by both. A container
 * carries neither key. Deletion is the whole conversion and it is lossless:
 * neither key ever changed what a view showed or to whom, so removing it
 * changes no render.
 */
const viewItemOwnerHiddenRemoved: MetadataConversion = {
  id: 'view-item-owner-hidden-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'view.owner / view.hidden — on the view item record ({ name, object, viewKind, config })',
  summary:
    "view item keys 'owner'/'hidden' removed (ADR-0049 — declared on the view item record "
    + 'and stored verbatim, read by nothing: no view switcher ever filtered on `hidden`, and no '
    + 'per-user scope ever read `owner`, so a view marked as one user\'s was listed for everyone)',
  apply(stack, emit) {
    const stripFromRecord = (view: Dict, path: string): Dict => {
      const kind = view.viewKind;
      if ((kind !== 'list' && kind !== 'form') || !isDict(view.config)) return view;
      return stripKeys(view, ['owner', 'hidden'], emit, path);
    };
    return mapCollection(
      mapCollection(stack, 'views', stripFromRecord),
      ASSEMBLED_VIEW_ITEMS_KEY,
      stripFromRecord,
    );
  },
  fixture: {
    before: {
      // The assembled-manifest channel: a standalone record a package export
      // carried before this release.
      viewItems: [
        {
          name: 'crm_lead.escalations',
          object: 'crm_lead',
          viewKind: 'list',
          hidden: false,
          config: { type: 'grid', columns: ['name'] },
        },
      ],
      views: [
        // A record carrying both keys: both go, and the live identity keys
        // beside them (`scope`, `label`) are untouched.
        {
          name: 'crm_lead.my_hot_leads',
          object: 'crm_lead',
          viewKind: 'list',
          label: 'My hot leads',
          // [#29037] A LIVE `scope` member: `personal` left the enum, and
          // `view-personal-declarations-removed` deletes it, so the bystander
          // is `shared` to keep the fixtures disjoint under whole-table replay.
          scope: 'shared',
          owner: 'usr_7',
          hidden: true,
          config: { type: 'grid', columns: ['name'] },
        },
        // A record that never authored either key rides through untouched.
        { name: 'crm_lead.intake', object: 'crm_lead', viewKind: 'form', config: { type: 'simple' } },
        // A FLATTENED OVERLAY (no `config`) rides through untouched. [#20230]
        // Its own `owner` / `hidden` are `view-overlay-owner-hidden-removed`'s
        // business, so this neighbour carries neither — the fixtures stay
        // disjoint when the whole table replays.
        { name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'list', isDefault: true },
      ],
    },
    after: {
      viewItems: [
        {
          name: 'crm_lead.escalations',
          object: 'crm_lead',
          viewKind: 'list',
          config: { type: 'grid', columns: ['name'] },
        },
      ],
      views: [
        {
          name: 'crm_lead.my_hot_leads',
          object: 'crm_lead',
          viewKind: 'list',
          label: 'My hot leads',
          scope: 'shared',
          config: { type: 'grid', columns: ['name'] },
        },
        { name: 'crm_lead.intake', object: 'crm_lead', viewKind: 'form', config: { type: 'simple' } },
        { name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'list', isDefault: true },
      ],
    },
    // `stripKeys` emits one notice per KEY removed: two on the `views` record,
    // one on the `viewItems` record.
    expectedNotices: 3,
  },
};

export { viewItemOwnerHiddenRemoved };
