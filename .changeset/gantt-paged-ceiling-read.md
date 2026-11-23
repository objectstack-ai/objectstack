---
'@object-ui/plugin-gantt': patch
'@object-ui/core': patch
---

fix(gantt): a gantt opens on a host that sets a maximum page size, instead of showing the refusal

Clause-②: no
Metadata-protocol: none

The gantt read its whole filtered result set, up to its 10,000-row ceiling, as ONE read of 10,001 rows (the ceiling plus the probe row that makes a cut detectable). A host that sets a maximum page size (`OS_DATA_MAX_PAGE_SIZE`; the hosted plane sets 5,000) refuses any read over it before running the query, so on every such host the gantt drew "Query parameter 'top' asks for 10001 rows; this deployment's maximum page size is 5000…" in place of the chart, for an empty object as much as a full one.

The gantt now walks to its ceiling in steps of at most 2,001 rows, the one read the calendar, map, tree and timesheet already send: `$skip` moves by the rows that came back, and the walk stops at the first short answer or one row past the ceiling. The ceiling, the footnote that names a cut, and the rule that an authored `pagination.pageSize` or `limit` never reaches the read are unchanged; a result set that fits one step is still one read.
