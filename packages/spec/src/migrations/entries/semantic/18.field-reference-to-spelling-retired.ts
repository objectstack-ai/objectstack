// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #13700 (ui#6837 half 1) — the D3 entry of the `field-reference-to-alias`
// family (ruling B on #17152: one D3 entry per retirement family, even when D2
// is lossless). The rename is lossless for every row it can decide; it leaves
// the one row it cannot decide, and it cannot reach code.
export const entry: SemanticMigration = {
  id: 'field-reference-to-spelling-retired',
  surface: 'field.reference_to — the legacy runtime spelling of a lookup or master_detail target, '
    + 'on object fields and object-extension fields',
  replacement: '`reference` — the one spelling the field schema has ever accepted, and the one the '
    + 'wire serves.',
  reason: 'The D2 conversion `field-reference-to-alias` renames `reference_to` to `reference` in '
    + 'author sources and on every stored-row rehydration, so the wire only ever carries '
    + '`reference`; for a row with only the legacy spelling the rename is lossless. Two things are '
    + 'left. First, a row carrying BOTH spellings with DIFFERENT targets is left untouched, on '
    + 'purpose: the loader will not pick a target for the author, so that field keeps failing its '
    + 'parse until someone decides which object it points at. Second, code is out of reach: a '
    + 'plugin, script, custom renderer or external client that read `reference_to` off served '
    + 'field metadata worked only because a stored row happened to carry the legacy spelling, and '
    + 'it now reads nothing — the frontend fallback that tolerated the spelling is scheduled to '
    + 'go, after which a missed reader degrades a lookup to a picker with no target. The camelCase '
    + '`referenceTo` is a different surface (resolved action params) and is not part of this '
    + 'family.',
  acceptanceCriteria: 'No object or object-extension field carries `reference_to` in source or at '
    + 'rest — every stored field serves `reference`. Each field that had carried both spellings '
    + 'names one target, chosen by the author. No code outside the metadata reads `reference_to` '
    + 'from a field definition. Every lookup and master_detail field opens a picker scoped to the '
    + 'object its `reference` names, and saving a selection stores that object\'s record id.',
};
