---
'@objectstack/skills': patch
---

docs(skills): the objectstack-ui report example declares its download in `exportOptions` under the base object's `allowExport`

Clause-②: no
Metadata-protocol: none

`rules/dashboards.md` 〈Report Configuration〉 taught a report's `dateRange` and not its `exportOptions`: the example now declares `exportOptions: { formats: ['csv', 'xlsx'] }` (optional `includeHeaders` / `fileNamePrefix`) and the note says who may download is the base object's permission-set `allowExport` and that a `joined` report takes neither key, paid for by folding the `dateGranularity` and `drilldown` restatements that the same file already teaches under Server-side date bucketing and Drilldown.
