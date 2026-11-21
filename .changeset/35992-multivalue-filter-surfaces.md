---
'@object-ui/fields': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(fields, console): condition editors offer a multiple: true field only what its evaluator answers

Clause-②: no
Metadata-protocol: none

A `select`, `lookup` or `user` field declared `multiple: true` holds a list, and the condition editors used to treat it as a single value: they offered Equals and Is any of on it. The engine refuses those operators on such a field with 400 `INVALID_FILTER`, a dataset filter answered them with 0, and a flow edge guard written as `record.attendees == 'u1'` is false for every record. Each editor now passes the field's `multiple` to the shared filter builder, which offers such a field Contains, Does not contain, Is empty and Is not empty, the operators a `multiselect` already got:

- the criteria editor (`@object-ui/fields` `FilterConditionField`, e.g. a sharing rule's criteria);
- the Studio filter editor for a dataset's scope and measure filters and a field's related-list filter. A stored `$eq` or `$in` on such a field now opens in Source instead of as an Equals row;
- the Studio flow edge rows. On a list-valued field they write Contains as CEL list membership, `record.attendees != null && 'u1' in record.attendees`, and Does not contain as `record.attendees == null || !('u1' in record.attendees)`. A guard spelled that way opens as a row again.

A single-value field of the same types keeps its operators. The Studio field list now carries the declared `multiple`, so the CEL condition builder also words and writes Is empty on such a field as an empty list, as the spec's 「is empty」 table says. No metadata key, value or default changes.
