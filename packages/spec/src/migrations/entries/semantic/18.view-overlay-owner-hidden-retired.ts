// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20230 (ADR-0049 enforce-or-remove; triage direction 「follow #20085's
// disposition for the same key pair」) — the D3 entry of the
// `view-overlay-owner-hidden-removed` family (ruling B on #17152: one D3 entry
// per retirement family, even when D2 is lossless). Registered keys: `owner` /
// `hidden` on `ui/ViewMetadata`, the door the two flattened overlay members are
// reached through. The same key pair on the view item RECORD is a separate
// family with its own conversion and its own D3 entry, disjoint from this one
// by `config`; the two share the prescription texts, not a conversion.
export const entry: SemanticMigration = {
  id: 'view-overlay-owner-hidden-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'view.owner / view.hidden on a flattened view overlay — the lean PUT /api/v1/meta/view/:name body '
    + 'with no config that the console saves for a view it personalizes',
  replacement:
    '(removed — no per-user view scope and no switcher filter exists.) A view is listed to everyone '
    + 'who can read its object. A view that must not be listed is deleted, or no longer shipped from '
    + 'source; per-user view scoping is a parked direction (ADR-0017), not a shipped mechanism.',
  reason:
    'The D2 conversion `view-overlay-owner-hidden-removed` deletes both keys from every flattened '
    + 'overlay (a view body with no `config` and no container slot) — in `views` (stack sources, and '
    + 'every stored row, replayed on each read before it is served or badged) and in the '
    + 'assembled-manifest view item channel — and the delete is lossless: both switcher read paths '
    + 'filter on the view kind and object and sort on `order`, so an overlay saved with '
    + '`hidden: true` hid nothing and no scope ever read `owner`. The judgment is about exposure, '
    + 'the same one the view item record\'s retirement leaves. A view someone hid or marked as one '
    + 'user\'s through its overlay has always been listed to every user who can read the object. '
    + 'Measured writers in this repository and its sibling UI: zero (no source, example or skill, '
    + 'and objectui at its pinned commit and at main writes neither key on an overlay; the HotCRM '
    + 'app writes neither). NOT MEASURED: clients outside this repository, and production stored '
    + 'rows — the write door accepted and stored both until this release, and no deployment store '
    + 'is reachable from here.',
  acceptanceCriteria:
    'No flattened view overlay you save carries `owner` or `hidden`: the write door refuses either '
    + 'with 422 INVALID_METADATA, the issue located at the key and the retirement prescription as '
    + 'its message. A stored overlay row that held either is served, badged and re-saved without '
    + 'it, so a GET then a PUT of that row answers 200; `os migrate meta --stored --apply` persists '
    + 'the stripped shape. For every view whose overlay had carried either key, its author has '
    + 'confirmed that the view may be listed to all readers of its object, or has deleted it. The '
    + 'view switcher lists the same views as before the upgrade.',
};
