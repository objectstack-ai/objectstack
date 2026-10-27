---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui gains an eval for a report's `dateRange` and `exportOptions`

Clause-②: no
Metadata-protocol: none

- **Before.** The skill taught a report's `dateRange` in `rules/dashboards.md`, but no eval checked that an agent authoring a report reaches for `dateRange` on a `type: 'date'` dataset dimension and for `exportOptions` with `csv` / `xlsx`. An agent could hand-roll a `runtimeFilter` window on the date column, invent a report permission key for export, declare a second preset table, or place either key on a `joined` container, and nothing scored that wrong.
- **Now.** A third eval file, `evals/report-period-export.json`, carries one report-authoring prompt whose assertions require `dateRange: { dimension, defaultRange }` and `exportOptions` with `'csv'` / `'xlsx'`, name the existing permission-set `allowExport` as the only export gate, and refuse a `joined` container, a `close_date` filter window, a `presets:` table and an invented permission key. `evals/README.md` lists the file.
- No schema, key or behaviour changes.
