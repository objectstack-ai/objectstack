// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The grouping prop on the two object blocks whose renderers read a grouping
// config. Typed by reference to the list view's own GroupingConfigSchema, so
// every door that carries a grouping judges it with the one schema. Deliberately
// NOT a D2 conversion: a padded field name is refused with guidance naming the
// field, never trimmed in silence.
export const entry: SemanticMigration = {
  id: 'ui-object-block-grouping-config-typed',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'the grouping property of the object-grid and object-kanban page blocks '
    + "(ComponentPropsMap['object-grid' | 'object-kanban'].grouping), which was z.unknown and "
    + 'therefore accepted any value: a padded field name such as '
    + "{ fields: [{ field: '  business_unit  ' }] }, a number, a bare field-name string, an "
    + 'empty fields list, or keys the grouping config does not declare',
  replacement:
    'the grouping config a list view carries, `GroupingConfigSchema` from '
    + '`@objectstack/spec/ui`: `{ fields: [{ field, order?, collapsed? }, ...] }` with at least '
    + 'one entry, each `field` naming the record field exactly as it is stored, with no leading '
    + 'or trailing whitespace, `order` one of `asc` / `desc` and `collapsed` a boolean. A padded '
    + "name is rewritten unpadded (`'  business_unit  '` becomes `'business_unit'`); a bare "
    + "string `'business_unit'` becomes `{ fields: [{ field: 'business_unit' }] }`; an empty "
    + '`fields` list, a number, or any other value is deleted, since it never grouped anything. '
    + 'On `object-kanban`, `swimlaneField` still wins when both are authored, and deleting '
    + '`grouping` is the whole migration there when `swimlaneField` is set',
  reason:
    'Both blocks\' renderers read the list view\'s grouping shape and nothing else: the grid '
    + 'groups its rows by every `grouping.fields[i].field` (its server-side group header query '
    + 'and its row projection) and reads `order` and `collapsed` per level, and the kanban board '
    + 'takes `grouping.fields[0].field` as its swimlane field when no `swimlaneField` is '
    + 'authored, looking that raw name up on every card. The list view has refused a padded '
    + 'grouping field name since protocol 17.5, and a list view\'s `grouping` is a closed shape; '
    + 'these two doors declared the same prop as `z.unknown`, so the same value that list view '
    + 'refuses validated green here and rendered wrong with no error — the grid showed one '
    + '`(empty)` group holding every row, the board one swimlane holding every card. The prop is '
    + 'kept, not retired: the board\'s fallback is a live reader of the grouping config. '
    + 'The rewrite is left to the author on purpose: a trimming rule would make a padded and an '
    + 'unpadded name silently equivalent, which is the consumer tolerance the contract refuses, '
    + 'and a bare string, a number or an empty list has no mapping that says what grouping was '
    + 'meant. Metadata AT REST is left exactly as stored — `properties` on a page component is '
    + 'not parsed on the save path, so a stored page keeps loading and renders as it does today; '
    + 'the component-props gate reports such a value as an advisory `component-props-invalid` '
    + 'finding at the offending path on `os validate`, `os build` and `os lint`, a padded name '
    + 'with the received value and the unpadded name to write. ADR-0049 / ADR-0087.',
  acceptanceCriteria:
    'Every `object-grid` and `object-kanban` node in your pages either omits `grouping` or '
    + 'carries `{ fields: [...] }` with at least one entry whose `field` is the unpadded stored '
    + 'name. `os validate` reports no `component-props-invalid` finding under '
    + '`properties.grouping` for these blocks. A well-formed grouping parses byte-identically to '
    + 'before when `order` and `collapsed` are spelled out; a short entry `{ field }` parses clean '
    + 'and gains the list view\'s defaults (`order: asc`, `collapsed: false`), which is how the '
    + 'grid already read it. After the rewrite, a grid that showed one `(empty)` group shows one '
    + 'group per value of that field, and a board that showed one swimlane shows one swimlane per value — '
    + 'check that this is the grouping you meant.',
};
