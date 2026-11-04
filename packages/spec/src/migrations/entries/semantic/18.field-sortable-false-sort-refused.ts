// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A sort over a field whose author declared `sortable: false` is refused at the
// Data API list door and on the stdio MCP `query_records`, with the
// `400 INVALID_SORT` a `formula` sort already gets. A structured TODO, not a D2
// conversion: whether a stored sort should move to another field, or the field
// should become sortable again, is a judgement about the view, not a rewrite.
export const entry: SemanticMigration = {
  id: 'field-sortable-false-sort-refused',
  surface:
    'a sort naming a field that declares `sortable: false`. Stored: a list view\'s `sort`; on a page, a '
    + 'block\'s own `sort` (`record:related_list`, `record:line_items`, `list-view` and the `object-grid`, '
    + '`object-calendar`, `object-gantt`, `object-map` and `object-timeline` blocks), every element '
    + '`dataSource.sort` and a related list\'s `parentDataSource.sort`, a list page\'s `interfaceConfig.sort` '
    + 'and an app page\'s `record.sort`. Requested: `GET /api/v1/data/:object?sort=`, '
    + '`POST /api/v1/data/:object/query` `orderBy`, the export route, the RPC dispatcher, the record-page '
    + '`related[].sort` and the MCP `query_records` `orderBy`',
  replacement:
    'drop the sort on that field or sort by another field; or, when the field should be sortable, '
    + 'remove `sortable: false` from the field. A field with no `sortable` key, or with '
    + '`sortable: true`, sorts as before',
  reason:
    'An author marks a field `sortable: false` when sorting it is meaningless or expensive (a long '
    + 'text, an unindexed column on a large table), and the field schema has always described the key '
    + 'that way. Nothing honoured it: the sortability projection served on `GET /api/v1/meta/object/NAME` '
    + 'reported the field `{ sortable: true }`, so the list header and the Sort picker offered it, and the '
    + 'Data API answered a sort on it 200, sorted by the column.\n\n'
    + 'The projection now reports `{ sortable: false, reason: \'author-declared\' }`, and the list door '
    + '(`assertSortFieldsExist`) refuses the sort with `400 INVALID_SORT` before any read, judged by that '
    + 'same projection, so what the grid does not offer the Data API does not perform. The stdio MCP '
    + '`query_records`, which hands `orderBy` straight to the engine, refuses it the same way. The engine '
    + 'door (`assertOrderByIsMaterializable`) is unchanged: it judges only whether a column is stored, so '
    + 'an in-process caller (a hook, a flow) keeps sorting by the stored column.\n\n'
    + 'STORED SURFACES that reach the door: a list view whose `sort` names such a field used to load '
    + 'sorted, and its first fetch now answers 400, and a `record:related_list` block\'s `sort` reaches '
    + 'the record-page read the same way. No mechanical rewrite exists in either direction: the platform '
    + 'cannot choose the field the author would sort by instead, and it must not silently drop the sort, '
    + 'which is the declared-but-inert shape this change ends. Every one of the stored surfaces above reaches '
    + 'the same list door. `os validate` and the publish door judge each of them against the same '
    + 'projection (`sort-field-unsortable`), so an affected view or page is refused when it is next '
    + 'validated or published, naming the field and its slot, instead of on its first fetch.',
  acceptanceCriteria:
    '`os validate` reports no `sort-field-unsortable` finding naming a field that "declares '
    + '`sortable: false`", which covers every stored surface: no list view `sort`, no page block '
    + '`sort` or `dataSource.sort`, no related-list `parentDataSource.sort`, no list page '
    + '`interfaceConfig.sort` and no app page `record.sort` names such a field. No client, script or '
    + 'agent sends one in `sort` / `$orderby` / `orderBy`. Reads complete with no `INVALID_SORT` naming a '
    + 'field that "declares `sortable: false`".',
};
