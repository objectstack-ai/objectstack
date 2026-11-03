// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `view-overlay-owner-hidden-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `viewOverlayOwnerHiddenRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, stripKeys } from '../shared.js';

/**
 * The flattened overlay's `owner` / `hidden` leave the authorable surface
 * (protocol 18, #20230 — ADR-0049 enforce-or-remove; triage direction, verbatim:
 * 「follow #20085's disposition for the same key pair」).
 *
 * The overlay door — the lean personalization PUT with no `config`, members 3
 * and 4 of the `view` union (`flattenedViewOverlayFields()` in
 * `ui/view.zod.ts`) — declared both keys separately from the view item's pair,
 * accepted them, and `saveMetaItem` stored them verbatim; nothing read either.
 * Writer census before removal: none in this framework or its examples, in
 * objectui at its pin and at `main`, or in the HotCRM app (cloud was not
 * reachable). The prescriptions are the view item's own texts.
 *
 * **Retired from the load path** — both keys are `retiredKey()` tombstones on
 * the overlay members, so a live author is refused at parse with the
 * prescription. The entry exists because a STORED overlay row can carry them:
 * the write door accepted and persisted both until this release, and every
 * read of a stored `view` row replays the chain through
 * `applyConversionsToStoredItem` as `{ views: [row] }` before it is served or
 * badged. It also lets `os migrate meta --from 17` list the edits for sources.
 * What the strip leaves depends on what else the row holds — two classes, both
 * pinned (`ui/view-overlay-owner-hidden-retirement.test.ts`, and the save door
 * in `@objectstack/metadata-protocol`'s `protocol.save-union-issues.test.ts`):
 *
 * - **Content-bearing** — any view key besides the identity the write path
 *   stamps (`name` / `object` / `viewKind` / `label`): served and badged valid
 *   without the two keys, a GET then a PUT of the whole row saves (if it was
 *   otherwise valid), and `os migrate meta --stored --apply` rewrites it.
 *   Without the strip it would be served with the retired key, badged
 *   invalid, and refused on the console's next read-merge-write of it.
 * - **Hide-only** — identity plus `owner` / `hidden` and nothing else, the
 *   shape the card measured (`{ object, viewKind, hidden: true }`): the strip
 *   leaves IDENTITY ONLY, which the `view` door's identity precondition
 *   refuses (#7741, "only identity fields"). The row is served without the
 *   keys but badged invalid (it was badged valid before this release); a
 *   whole-row re-save, or one that adds only identity (a rename is `label`),
 *   answers `422 INVALID_METADATA`; `--apply` reports it `failed` and leaves it
 *   as stored, and every read strips it again. A write that adds a real view
 *   key (a toolbar toggle) saves. Remedy: delete the row — it never changed
 *   what anyone saw — or add the personalization setting its author meant.
 *   Not convertible: which setting, if any, the author wanted is theirs to say.
 *
 * **Two collections, like the view item's entry.** `views` is the stack
 * collection and the stored-row seam's wrapping; `viewItems`
 * ({@link ASSEMBLED_VIEW_ITEMS_KEY}) is the assembled-manifest channel, whose
 * registration parse (`AssembledViewArtifactSchema`, built from the same
 * members) now refuses the keys too.
 *
 * ⚠️ Scoped to the FLATTENED spelling: a body with no `config` and no container
 * slot — the guard `mapViewPayloads` applies before its case 3, and the
 * `z.undefined()` guards the two overlay members declare. `viewKind` is NOT
 * required here, unlike `mapViewPayloads`' case 3: that walk needs the family
 * to pick a payload transform, while deleting these two keys needs none, and a
 * flat row stored before the #7741 binding carries no `viewKind` until the
 * write path heals it — then the save would refuse the key it still held. A
 * record (`config` present) is {@link viewItemOwnerHiddenRemoved}'s business,
 * so no row is judged by both. Deletion is the whole conversion and it is
 * lossless.
 */
const viewOverlayOwnerHiddenRemoved: MetadataConversion = {
  id: 'view-overlay-owner-hidden-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'view.owner / view.hidden — on a flattened view overlay ({ name, object, viewKind, …, no config })',
  summary:
    "flattened view overlay keys 'owner'/'hidden' removed (ADR-0049 — the view item's pair on "
    + 'the overlay door, retired the same way: declared, accepted by the write door and stored '
    + 'verbatim, read by nothing, so a '
    + '`hidden: true` overlay hid no view and an `owner` scoped none)',
  apply(stack, emit) {
    const stripFromOverlay = (view: Dict, path: string): Dict => {
      if (view.config !== undefined) return view;
      if (view.list !== undefined || view.form !== undefined) return view;
      if (view.listViews !== undefined || view.formViews !== undefined) return view;
      return stripKeys(view, ['owner', 'hidden'], emit, path);
    };
    return mapCollection(
      mapCollection(stack, 'views', stripFromOverlay),
      ASSEMBLED_VIEW_ITEMS_KEY,
      stripFromOverlay,
    );
  },
  fixture: {
    before: {
      // The assembled-manifest channel: an overlay a package export carried
      // before this release.
      viewItems: [
        { name: 'crm_deal.pipeline', object: 'crm_deal', viewKind: 'list', hidden: false, order: 1 },
      ],
      views: [
        // A bound overlay carrying both keys: both go, and the live
        // round-trip keys beside them (`isDefault`, `label`) are untouched.
        {
          name: 'crm_deal.all',
          object: 'crm_deal',
          viewKind: 'form',
          label: 'All deals',
          isDefault: true,
          owner: 'usr_7',
          hidden: true,
        },
        // An overlay that never authored either key rides through untouched.
        { name: 'crm_deal.by_stage', object: 'crm_deal', viewKind: 'list', order: 2 },
        // A container carries neither key and is not an overlay: untouched.
        { object: 'crm_deal', form: { type: 'simple' } },
      ],
    },
    after: {
      viewItems: [
        { name: 'crm_deal.pipeline', object: 'crm_deal', viewKind: 'list', order: 1 },
      ],
      views: [
        {
          name: 'crm_deal.all',
          object: 'crm_deal',
          viewKind: 'form',
          label: 'All deals',
          isDefault: true,
        },
        { name: 'crm_deal.by_stage', object: 'crm_deal', viewKind: 'list', order: 2 },
        { object: 'crm_deal', form: { type: 'simple' } },
      ],
    },
    // One notice per KEY removed: two on the `views` overlay, one on the
    // `viewItems` overlay.
    expectedNotices: 3,
  },
};

export { viewOverlayOwnerHiddenRemoved };
