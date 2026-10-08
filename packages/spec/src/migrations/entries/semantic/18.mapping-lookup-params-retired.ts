// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove — the D3 entry of the
// `mapping-lookup-params-removed` family, which landed in commit 15d58dbf1:
// the import path never read the four lookup steering params, so they were
// retired and the conversion strips them. One D3 entry per retirement family,
// even when D2 is lossless (ruling B on #17152). The strip preserves observed
// import behaviour exactly; the judgment it leaves is whether the author's
// import was ever doing what the four keys said.
export const entry: SemanticMigration = {
  id: 'mapping-lookup-params-retired',
  surface: 'mapping.fieldMapping[].params.object / .fromField / .toField / .autoCreate — the '
    + 'per-entry reference-resolution keys of a lookup mapping',
  replacement: 'Nothing on the mapping. A `lookup` entry copies the cell through, and reference '
    + 'resolution runs afterwards off the TARGET field\'s own metadata: its `reference` names the '
    + 'object searched, and the cell is matched as a display value (a name, an email or a record '
    + 'id). Records a row points at must exist before the import runs.',
  reason: 'The D2 conversion `mapping-lookup-params-removed` deletes the four keys from every '
    + 'mapping entry\'s params, and the delete is lossless: the import path never read them, so '
    + 'stripping them changes no imported row. The judgment is about what the author believed. '
    + '`autoCreate` read as "create the referenced record when nothing matches", and nothing was '
    + 'ever created — an unresolved cell fails its row with `import_reference_not_found`, with or '
    + 'without the key. An import pipeline built on that belief has been losing those rows, and '
    + 'now needs the referenced records seeded first. `object`, `fromField` and `toField` read as '
    + 'the target and the matching columns, and were never consulted: where they named something '
    + 'OTHER than the target field\'s own `reference` or a column the resolver matches on, the rows '
    + 'were linked by the field\'s metadata, not by the mapping — and only the author knows which '
    + 'one they meant.',
  acceptanceCriteria: 'No mapping entry carries the four keys; the parse refuses them. For each '
    + 'mapping that carried them: the target field\'s `reference` names the object the author meant '
    + 'the rows to link to, and a dry run of a representative file resolves every reference cell '
    + '(no `import_reference_not_found` row) — or the missing referenced records are created by a '
    + 'step that runs before the import, since the import itself never creates them. Row counts '
    + 'and links match the pre-upgrade import of the same file.',
  relevantWhen: { kind: 'stack-declares', keys: ['mappings'] },
};
