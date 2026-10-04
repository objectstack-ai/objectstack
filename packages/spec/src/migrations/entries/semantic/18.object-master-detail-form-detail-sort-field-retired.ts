// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21589 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `object-master-detail-form-detail-sort-field-removed` family (one D3 entry
// per retirement family, even when D2 is lossless). Registered key:
// `ui/ObjectMasterDetailFormProps:details.sortField`. The strip changes
// nothing a user sees, because the console already ignored the authored
// value; what it leaves is the one judgment a delete cannot make — whether the
// child object carries the field the line order is kept in.
export const entry: SemanticMigration = {
  id: 'object-master-detail-form-detail-sort-field-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface: 'page.component.object-master-detail-form.details[].sortField — a detail entry\'s '
    + 'authored line-position field',
  replacement: 'Nothing on the entry: delete the key. The line grid stamps each line\'s position into '
    + 'the child object\'s own field, derived from the child object: its first field named '
    + '`position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`. To keep the line '
    + 'order a drag-reorder sets, give the child object one of those fields (under the name the '
    + 'deleted key named, when it is one of them).',
  reason: 'The D2 conversion `object-master-detail-form-detail-sort-field-removed` deletes '
    + '`sortField` from every `object-master-detail-form` detail entry, and the delete is lossless: '
    + 'the console stopped reading the authored override, and the line grid stamps the field it '
    + 'derives from the child object whatever the entry says. What the conversion cannot decide is '
    + 'where the line order lives. An entry whose key named a field the derivation does not pick — '
    + 'a name outside that list, or a second sort-named field after the first — saves its line '
    + 'order into the derived field instead, or nowhere when the child object has none. An entry '
    + 'that names `relationshipField` and at least one column and gives every column a `type` is '
    + 'kept exactly as authored: no child schema is loaded for it, so no line position is stamped '
    + 'and a drag-reorder is not saved, before and after the upgrade alike.',
  acceptanceCriteria: 'No `object-master-detail-form` detail entry carries `sortField`; the props '
    + 'lint reports one with the prescription. For each entry that had set it, the child object '
    + 'declares the field the line order is kept in under one of the derived names, and after a '
    + 'drag-reorder and save the lines reload in the order they were dragged into.',
};
