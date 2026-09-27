// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20085 (ADR-0049 enforce-or-remove; triage direction 「retire both keys」) —
// the D3 entry of the `view-item-owner-hidden-removed` family (ruling B on
// #17152: one D3 entry per retirement family, even when D2 is lossless).
// Registered keys: `owner` / `hidden` on `ui/ViewItem` and on the wire member
// `ui/ViewItemWire`. The delete changes no render and no listing; what it
// leaves is a visibility belief — views marked private or hidden were listed
// to everyone who could read the object.
export const entry: SemanticMigration = {
  id: 'view-item-owner-hidden-retired',
  surface: 'view.owner / view.hidden on the view item record — the per-user owner and the '
    + 'switcher-hidden flag',
  replacement: '(removed — no per-user view scope and no switcher filter exists.) A view is listed '
    + 'to everyone who can read its object. A view that must not be listed is deleted; per-user '
    + 'view scoping is a parked direction, not a shipped mechanism.',
  reason: 'The D2 conversion `view-item-owner-hidden-removed` deletes both keys from every view '
    + 'item RECORD — in `views` (stack sources and stored rows) and in the assembled-manifest view '
    + 'item channel (package export, environment artifacts) — and the delete is lossless: both '
    + 'switcher read paths filter on the view kind and object and sort on `order`, so '
    + '`hidden: true` hid nothing and no scope ever read `owner`. The judgment is about exposure. '
    + 'A view an author marked as one user\'s, or hid from the switcher, has always been listed to '
    + 'every user who can read the object — its name, its columns, its filters and its sort. '
    + 'Whether anything in such a view was meant to stay private, and whether it should now be '
    + 'deleted rather than kept, is the author\'s call. A flattened view overlay keeps its own '
    + '`owner` and `hidden`: those live on a different door that this retirement does not touch.',
  acceptanceCriteria: 'No view item record in `views` or in an assembled artifact carries `owner` or '
    + '`hidden`; the parse refuses both by name, and an artifact assembled before the upgrade '
    + 'registers without a refusal over them. For every view that had carried either key, the '
    + 'author has confirmed that everything it shows may be listed to all readers of its object, '
    + 'or has deleted it. The view switcher lists the same views as before the upgrade.',
};
