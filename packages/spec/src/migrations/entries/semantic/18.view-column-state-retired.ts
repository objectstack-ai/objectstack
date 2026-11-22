// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #36403 (ADR-0049 enforce-or-remove; the spec half of #35955) — the D3 entry of
// the `view-column-state-removed` family (ruling B on #17152: one D3 entry per
// retirement family, even when D2 is lossless). Registered keys: `columnState`
// on `ui/ViewItemWire` (the record door) and `ui/ViewMetadata` (the door the
// flattened overlay members are reached through). One family on both doors:
// the key retires from both at once, so one conversion and one D3 entry.
export const entry: SemanticMigration = {
  id: 'view-column-state-retired',
  surface:
    'view.columnState on a stored view row — the view item record and the flattened view overlay '
    + '(the lean PUT /api/v1/meta/view/:name body with no config) the console once wrote a column '
    + 'drag or resize onto',
  replacement:
    '(removed — no stored column layout exists.) Column widths live in each reader\'s browser, per view; '
    + 'a column order a reader wants kept is saved into the view itself (its `columns` order, or '
    + '`fieldOrder`) through the list\'s Save. A shipped default order is the order of `columns`, and a '
    + 'shipped default width is `width` on the column.',
  reason:
    'The D2 conversion `view-column-state-removed` deletes the key from every view item record and '
    + 'every flattened overlay (a view body with no container slot) — in `views` (stack sources, and '
    + 'every stored row, replayed on each read before it is served or badged) and in the '
    + 'assembled-manifest view item channel. The delete is lossless for what anyone sees: the '
    + 'maintainer ruled the stored layout is not carried forward (#35955, every reader goes back to '
    + 'the view\'s own columns and widths), and no reader applies it any more. The judgment left is '
    + 'about the rows it empties. An overlay row that held nothing but its identity and the key — the '
    + 'shape a column drag on a system view wrote before the overlay writer retired — is left '
    + 'identity-only, a body the view door refuses, so that row needs its owner (see the acceptance '
    + 'criteria). Measured writers in this repository, its console, the HotCRM app and the gallery at '
    + '`main` 97b9d1e6: zero. NOT MEASURED: clients outside this repository, and production stored '
    + 'rows — the write door accepted and stored the key until this release, and no deployment store '
    + 'is reachable from here.',
  acceptanceCriteria:
    'No view item record or flattened view overlay you save carries `columnState`: the write door '
    + 'refuses it with 422 INVALID_METADATA, the issue located at the key and the retirement '
    + 'prescription as its message. A stored row that held it is stripped of it on every read, and '
    + 'what follows depends on what else the row holds. (1) A record, or an overlay with any other '
    + 'view key (a sort, a default flag, an order), is served and badged valid without the key, a GET '
    + 'then a PUT of the whole row answers 200 (if it was otherwise valid), and '
    + '`os migrate meta --stored --apply` rewrites it. (2) A column-state-only overlay — nothing but '
    + 'its identity (name, object, viewKind, label) and `columnState` — is left with identity only, '
    + 'which the view door refuses ("only identity fields"): it is served badged invalid, `--apply` '
    + 'reports it `failed` and leaves it as stored, and every read strips it again. Delete each such '
    + 'row: it held only a column layout the ruling does not carry forward. No source you ship '
    + 'declares `columnState` on a view, a view item or a list view body.',
};
