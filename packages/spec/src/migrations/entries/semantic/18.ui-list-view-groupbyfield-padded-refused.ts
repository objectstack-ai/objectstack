// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The sibling axis of `ui-list-view-grouping-field-padded-refused` (#17360),
// which scoped this one out by name. Same defect, same refusal, one difference
// that changes the author's options: `kanban.groupByField` is REQUIRED, so a
// padded value there cannot be withdrawn by omitting the key.
export const entry: SemanticMigration = {
  id: 'ui-list-view-groupbyfield-padded-refused',
  surface: 'list-view group-by field names — `kanban.groupByField` (`KanbanConfigSchema`, '
    + 'REQUIRED), `gantt.groupByField` and `timeline.groupByField` (`GanttConfigSchema` / '
    + '`TimelineConfigSchema`, both optional) — values carrying leading or trailing whitespace',
  replacement: 'the field name written with no leading and no trailing whitespace — the same '
    + 'spelling the object declares and the server answers under. A padded value is RE-AUTHORED, '
    + 'never trimmed on the author\'s behalf: `\' stage\'` becomes `\'stage\'`. The refusal names '
    + 'the offending spelling verbatim, so the whitespace an author cannot see in an editor is '
    + 'visible in the message, next to the name to write instead.',
  reason:
    '#17499. All three keys were a bare `z.string()`, so a padded group-by name was valid '
    + 'authored metadata all the way to the renderers. The name is a LOOKUP KEY on every row, '
    + 'measured in objectui at `dda8f3815`: the kanban board resolves its lane as '
    + '`laneField = groupByField || groupField || detectStatusField(objectDef)` and buckets cards '
    + 'by `card[laneField]`; `ObjectGantt`\'s `groupByAccessor` splits the name on `.` and walks '
    + 'the backing record (`resolvePath(task.data, field)`); the timeline groups its rows the same '
    + 'way. The server answers under the unpadded name, so every per-row lookup reads `undefined` '
    + 'and the board collapses into one `Uncategorized` lane — the gantt and the timeline into one '
    + 'ungrouped bucket — holding every record. That is a silent wrong answer that reads as a true '
    + 'statement about the data: one giant bucket is indistinguishable from a dataset where the '
    + 'field genuinely is empty, which is why nothing weaker than a parse refusal is honest here. '
    + '`packages/lint`\'s `validate-list-view-field-refs` already grades this position `error` for '
    + 'the same consequence, but it only runs where an app is validated against its object '
    + 'definitions; the producer accepted the value regardless. ⛔ NOT a `.trim()`: a trimming '
    + 'schema makes `\' stage\'` and `\'stage\'` silently equivalent, the consumer-tolerance '
    + 'direction AGENTS.md #0.1 refuses — and on the REQUIRED kanban key the author cannot '
    + 'withdraw the value by omitting the key, so a normalising producer would be their only '
    + 'feedback channel and it would say nothing. The narrowing is non-padded ONLY and '
    + 'deliberately not the snake_case machine-name grammar `/^[a-z_][a-z0-9_]*$/` this package '
    + 'spells inline for object/field/tool NAMES: a `groupByField` is authored as a field '
    + 'REFERENCE and a dotted relationship path (`owner.name`) is an in-tree spelling of one. '
    + 'Ships at once, no deprecation window (2026-08-27 maintainer ruling 「短期不考虑渐进」).',
  acceptanceCriteria:
    'Measured against the shipped schemas, not restated from the card. Every stored view whose '
    + '`kanban.groupByField`, `gantt.groupByField` or `timeline.groupByField` carries leading or '
    + 'trailing whitespace is refused on its next authoring-path save, with a `custom` issue at '
    + 'that key\'s own path (`groupByField`, or `kanban.groupByField` when the view is parsed '
    + 'whole) naming the offending spelling verbatim and the trimmed name to write instead; a '
    + 'value that is nothing but whitespace is refused with the remedy "Name the field to group '
    + 'by" rather than a trimmed name, since there is none. Refused: leading, trailing and both; '
    + 'a tab, a newline and a non-breaking space in those positions; whitespace-only. NOT refused, '
    + 'on purpose: whitespace INSIDE the name (`\'Group by field\'` parses), and the EMPTY string '
    + '(unchanged on all three keys, this narrowing covers the silent case only). Nothing is '
    + 'normalised on the way through — an accepted name arrives byte-identical, `\'owner.name\'` '
    + 'included — so a consumer proves the migration by re-saving each view and seeing either a '
    + 'refusal naming the field or a value it can compare byte-for-byte with what it wrote. Every '
    + '`groupByField` spelling in the repo at the time of the change parses unchanged: 14 distinct '
    + 'literals harvested across every `.ts` / `.tsx` / `.mdx` / `.json` / `.mjs` outside '
    + '`node_modules`, zero of them padded, so no fixture had to be rewritten to keep the tree '
    + 'green.',
};
