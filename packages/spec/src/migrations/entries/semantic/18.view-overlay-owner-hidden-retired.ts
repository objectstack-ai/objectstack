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
    + 'The delete is lossless but does not always close the row: an overlay row that held nothing '
    + 'but its identity and these keys is left identity-only, a body the view door refuses, so '
    + 'that row needs its author (see the acceptance criteria). '
    + 'Measured writers in this repository and its sibling UI: zero (no source, example or skill, '
    + 'and objectui at its pinned commit and at main writes neither key on an overlay; the HotCRM '
    + 'app writes neither). NOT MEASURED: clients outside this repository, and production stored '
    + 'rows — the write door accepted and stored both until this release, and no deployment store '
    + 'is reachable from here.',
  acceptanceCriteria:
    'No flattened view overlay you save carries `owner` or `hidden`: the write door refuses either '
    + 'with 422 INVALID_METADATA, the issue located at the key and the retirement prescription as '
    + 'its message. A stored overlay row that held either is stripped of it on every read, and what '
    + 'follows depends on what else the row holds. (1) A row with any other view key (a column '
    + 'state, a sort, a default flag, an order) is served and badged valid without the keys, a GET '
    + 'then a PUT of the whole row answers 200 (if it was otherwise valid), and '
    + '`os migrate meta --stored --apply` rewrites it. (2) A hide-only row — nothing but its '
    + 'identity (name, object, viewKind, label) and `owner` / `hidden`, such as '
    + '`{ object, viewKind, hidden: true }` — is left with identity only, which the view door '
    + 'refuses ("only identity fields"): it is served badged invalid (it was badged valid before '
    + 'this release), a whole-row re-save or one that adds only identity answers 422 '
    + 'INVALID_METADATA, and `--apply` reports it `failed` and leaves it as stored. A write that '
    + 'adds a real view key, such as a toolbar toggle, saves. Resolve each such row: delete it (it '
    + 'never changed what anyone saw), or add the personalization setting its author meant and '
    + 'save that. For every view whose overlay had carried either key, its author has confirmed '
    + 'that the view may be listed to all readers of its object, or has deleted it. No switcher '
    + 'read path ever read either key, so which views the switcher lists does not change.',
};
