// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-list-view-grouping-field-padded-refused',
  surface: 'list-view grouping level names — `grouping.fields[].field` '
    + '(`GroupingFieldSchema`, the rows inside `ListView.grouping.fields[]`) — '
    + 'values carrying leading or trailing whitespace',
  replacement: 'the field name written with no leading and no trailing whitespace — the '
    + 'same spelling the object declares and the server answers under. A padded value is '
    + 'RE-AUTHORED, never trimmed on the author\'s behalf: `\'  business_unit  \'` becomes '
    + '`\'business_unit\'`. The refusal names the offending spelling verbatim, so the '
    + 'whitespace an author cannot see in an editor is visible in the message.',
  reason:
    '#17360, ruling C on objectui#7347 (maintainer 「其他同意」, decision batch #110 item 5): '
    + 'refuse at the producer. `field` was a bare `z.string()`, so a padded grouping level '
    + 'was valid authored metadata all the way to the renderers. Measured on objectui '
    + '(M1-M11 with live controls): the projection harvester `collectGroupingFieldRefs` '
    + 'TRIMS the name when it builds `$select`, while THREE renderers bucket rows by the '
    + 'RAW name — plugin-grid `usableGroupingFields`, plugin-list '
    + '`ObjectGallery.groupedItems`, plugin-kanban `effectiveSwimlaneField`. The server '
    + 'therefore answers under `business_unit` while every per-row lookup asks for '
    + '`\'  business_unit  \'`, reads `undefined`, and the view collapses into ONE `(empty)` '
    + 'group (grid, gallery) or ONE `Uncategorized` lane (kanban) holding every record — a '
    + 'silent wrong answer that reads as a true statement about the data, which is why '
    + 'nothing weaker than a parse refusal is honest here. ⛔ NOT a `.trim()`: a trimming '
    + 'schema makes `\'  a  \'` and `\'a\'` silently equivalent, the consumer-tolerance '
    + 'direction AGENTS.md #0.1 refuses. objectui\'s harvester trim stays as '
    + 'defence-in-depth; nothing is removed there. The narrowing is non-padded ONLY and '
    + 'deliberately not the snake_case machine-name grammar `/^[a-z_][a-z0-9_]*$/` this '
    + 'package spells inline for object/field/tool NAMES: a grouping level is authored as '
    + 'a field REFERENCE and a dotted relationship path (`owner.name`) is an in-tree '
    + 'spelling of one. The blank name is unchanged here — it is already refused loudly '
    + 'one layer down by `compileListViewGroupQuery`\'s `grouping_field_blank`, and this '
    + 'narrowing exists for the SILENT case. Ships at once, no deprecation window '
    + '(2026-08-27 maintainer ruling 「短期不考虑渐进」).',
  acceptanceCriteria:
    'Every stored list view whose `grouping.fields[].field` carries leading or trailing '
    + 'whitespace is refused on its next authoring-path save, with a per-element issue at '
    + '`grouping.fields[N].field` naming the offending spelling and the trimmed name to '
    + 'write instead. Names with no padding parse byte-identically to before — nothing is '
    + 'normalised on the way through, and a dotted relationship path stays valid. Views '
    + 'with no `grouping` block are untouched. Every `grouping.fields[].field` spelling '
    + 'in this repo at the time of the change parses unchanged: 50 literal occurrences '
    + 'under a `grouping:` key across 19 files, harvested with the TypeScript parser and '
    + 'cross-checked against 906 shape-exact `{ field, order?, collapsed? }` literals in '
    + '`packages/**`. The single harvested spelling this refuses — `\' \'` at '
    + '`view-grouping-query.test.ts` — is a NEGATIVE fixture handed straight to '
    + '`compileListViewGroupQuery` with no parse on its path, pinning that same '
    + '`grouping_field_blank` refusal; the producer now refuses it one layer earlier for '
    + 'the same reason.',
};
