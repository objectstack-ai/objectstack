// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #24640 (ADR-0049 enforce-or-remove; maintainer ruling C, record 6278975049,
// pulled into 18.0 by record 6279033298). `ListView.filterableFields` carried
// two meanings: the schema described it as the legacy shorthand for
// `userFilters.fields` (the quick-filter bar), and its one renderer, objectui's
// `ListView` (the `filterFields` memo), read it as the Filter panel's field
// whitelist. No quick filter ever came of it. The ruling is that the platform
// carries no per-view Filter-panel whitelist, so the key retires with no
// replacement key: a curated end-user filter bar is `userFilters`, and the
// Filter panel offers every field the user may read. Tombstoned with
// `retiredKey()` beside `searchableFields` on this shape. D2:
// `view-list-filterable-fields-removed`, a drop that never rewrites the key to
// `userFilters.fields`.
export const entry = 'ui/ListView:filterableFields';
