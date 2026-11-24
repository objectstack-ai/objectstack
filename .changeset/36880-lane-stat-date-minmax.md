---
'@object-ui/plugin-list': patch
---

fix(plugin-list): the board's lane statistic picker offers a minimum and a maximum over date, date-time and time fields

Clause-②: no
Metadata-protocol: none

The 视图设置 「Column summary」 level on a kanban view now lists, for each function, the fields the aggregate × field-type table (`isAggregateCompatibleWithFieldType` in `@objectstack/spec/data`) accepts for that function, the same verdict `@objectstack/lint` gives `kanban.summary`. Before, every function offered the `sum` row's number fields. So `min` and `max` now also offer date, date-time and time fields, and `avg`, `min` and `max` offer a percent field. `sum` is unchanged. A formula or a true / false field is still offered under none. The board already computes a date's minimum or maximum in its lane read and draws it at the lane's foot through the date field's own cell renderer, in the face the field's `format` declares.
