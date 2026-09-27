// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20085 + #20230 — ADR-0049 enforce-or-remove, one family on two doors: the
// view item record (`viewItemBaseShape()`) and the flattened overlay
// (`flattenedViewOverlayFields()`), both in `ui/view.zod.ts`. Ruling B on
// #17152: every retirement family carries ONE D3 semantic entry beside its D2
// conversions, even when the D2 half is lossless. The D2 half is two entries,
// one per door, disjoint by `config`: `view-item-owner-hidden-removed` and
// `view-overlay-owner-hidden-removed`. This entry is what the strip cannot say:
// an author who wrote either key asked for an effect that never existed.
import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'view-owner-hidden-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'view.owner / view.hidden — on a view item record ({ name, object, viewKind, config }) and on a '
    + 'flattened view overlay (the lean PUT /api/v1/meta/view/:name body with no config)',
  replacement:
    'Nothing — delete both keys. There is no per-user view scope to name an owner in (per-user view '
    + 'scoping is a parked direction, ADR-0017, not a shipped mechanism), so a view is visible to everyone '
    + 'who can read its object. To take a view out of the switcher, delete the view item itself, or stop '
    + 'shipping it from source.',
  reason:
    'Both doors declared the pair, both accepted it, and the write door stored it verbatim — and nothing '
    + 'read either key on either door. The two switcher read paths filter on viewKind + object and sort on '
    + 'order, so a view saved with hidden: true stayed listed, and a view saved with an owner was listed for '
    + 'every user who can read the object: the owner half was a visibility claim nothing enforced, the '
    + 'security shape ADR-0049 is about. The paired D2 conversions delete the keys wherever the chain '
    + 'replays (sources on migrate, stored rows on every read, assembled artifacts at registration), which '
    + 'is lossless because neither key ever had an effect to lose. What they cannot restore is the intent: '
    + 'an author who hid a view, or marked it as one user\'s, still sees it listed for everyone, and that '
    + 'is now the declared behaviour rather than a silent one. Measured authors in this repository: zero '
    + '(no source, example or skill writes either key on either door; objectui at its pinned commit and '
    + 'at main writes neither; the HotCRM app writes neither). NOT MEASURED: authors outside this '
    + 'repository and production stored rows — the published schema accepted both keys until this '
    + 'release, and no deployment store is reachable from here.',
  acceptanceCriteria:
    'No view item record and no flattened view overlay you author or save carries owner or hidden. A '
    + 'save that still sends either is refused 422 INVALID_METADATA, with the issue located at the key and '
    + 'the retirement prescription as its message; delete the key and save again. Stored rows need no '
    + 'action: the paired conversions strip both keys on read, so a row is served, badged and re-saved '
    + 'without them (os migrate meta --stored --apply persists the stripped shape). Then check the '
    + 'intent: if a view was hidden or given an owner to keep it from some users, it has always been '
    + 'visible to them — restrict its object\'s read access, or delete the view.',
};
