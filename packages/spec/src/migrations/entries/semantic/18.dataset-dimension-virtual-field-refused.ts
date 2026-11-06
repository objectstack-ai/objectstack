// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The dimension-side sibling of `dataset-measure-aggregate-field-type-refused`:
// a group key over a field no driver stores. The narrowing itself registered
// `not-required (no-migration-prescription)` — no key is added, removed or
// re-shaped — so this entry carries no conversion and has no automatic
// rewrite: which stored field should carry the value is the author's call.
export const entry: SemanticMigration = {
  id: 'dataset-dimension-virtual-field-refused',
  surface: 'dataset and cube dimensions over a VIRTUAL field — `datasets[].dimensions[].field` '
    + '(`DatasetDimensionSchema`) and `analyticsCubes[].dimensions.KEY.sql` naming a field whose '
    + 'declared type is `formula` (`SEARCH_VIRTUAL_TYPES`, `isVirtualSearchField`), whatever its '
    + '`returnType`, on the base object or, for a dotted path, on the leaf\'s own object',
  replacement: 'store the value in a field of its own on the object (written by a hook or a flow '
    + 'when its source changes) and point the dimension at that field, or remove the dimension. '
    + 'There is no automatic rewrite: which stored field should carry the value, and what writes '
    + 'it, is the author\'s judgement. A stored field the formula already reads is a candidate only '
    + 'when grouping by it answers the same question the formula did',
  reason:
    'A dimension is a GROUP KEY: a dataset dimension compiles to a cube dimension whose `sql` is '
    + 'its `field`, and a query selecting it groups (or date-buckets) by that column. A `formula` '
    + 'is computed on read and never stored, so no driver materialises a column for it and there is '
    + 'nothing to group by. Before this narrowing the dataset compiled, registered and published, '
    + 'and its stored dimensions were served; only a query grouping by the formula dimension was '
    + 'refused — `400 INVALID_FIELD` at `groupBy.N`, in front of whoever opened the dashboard tile — '
    + 'and authoring reported nothing. The measure side already refused a total over a formula at '
    + 'both doors; this is the dimension half. ⚠️ The refusal is the WHOLE dataset, not the one '
    + 'member: a dataset carrying such a dimension no longer compiles, so its other, stored '
    + 'dimensions stop being served with it until the dimension moves',
  acceptanceCriteria:
    'Every dataset compiles and `os validate` / `os build` / `os lint` report no '
    + '`dimension-virtual-field-refused`. The two doors that refuse it, in their own words: the '
    + 'dataset compile (`registerDataset`, `queryDataset` and every door that compiles through '
    + 'them) answers `400 DATASET_INVALID` with "[dataset-compiler] dataset "NAME" dimension "DIM" (dimensions.N) '
    + 'groups by field "FIELD", which object "OBJECT" declares as `formula` — its value is computed '
    + 'on read and never stored, so no driver materialises a column to group by, and every query '
    + 'selecting this dimension is refused. Denormalise the value onto "OBJECT" (a stored field, '
    + 'written when the source changes) and point the dimension at that field."; the authoring '
    + 'rules — the three CLI commands and the runtime dataset save (`422`) — answer '
    + '`dimension-virtual-field-refused` (error) at `datasets[N].dimensions[M].field` or '
    + '`analyticsCubes[N].dimensions.KEY.sql` with "groups by field "FIELD" (`formula` on object "OBJECT"), a value '
    + 'computed on read and never stored, so no query can group by it" and the hint "Store the '
    + 'value in a stored field of "OBJECT" (written when its source changes) and point this '
    + 'dimension at that field, or remove the dimension." `os explain '
    + 'dimension-virtual-field-refused` gives the reasoning. A dimension over a stored field and a '
    + 'date or datetime dimension, with or without `dateGranularity`, are unchanged, as is every '
    + 'measure verdict. ⚠️ The compile does not judge a dotted dimension (it answers for the base '
    + 'object only); the lint rule and the query-time refusal still do, so sweep with `os validate`',
  relevantWhen: { kind: 'stack-declares', keys: ['datasets', 'analyticsCubes'] },
};
