---
'@objectstack/spec': minor
'@object-ui/types': minor
---

fix(spec)!: a dashboard global filter keyed `dateRange` beside a declared `dateRange` is refused at every door that parses it

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-ui/rules/dashboards.md` teaches `dateRange` as the reserved name of the built-in date range and no file under `skills/**` keys a `globalFilters` entry `dateRange`; every taught use stays true. `content/docs/ui/dashboards.mdx` gains one sentence naming the refusal.

**BREAKING** for a dashboard that declares `dateRange` and also keys a `globalFilters` entry `dateRange`.

- **Before.** The built-in date range is a filter the dashboard declares under the reserved key `dateRange`. A `globalFilters` entry keyed `dateRange` (its `name`, or its `field` when it has no `name`) beside it parsed, and the dashboard save door (`PUT /api/v1/meta/dashboard/X`) answered 200 in draft and in publish. The console builds the date range first and lets the later definition win, so the board drew the entry's control in place of the declared date range and every widget binding `dateRange` was filtered by the entry's field. The only trace was a browser console warning.
- **Now.** `DashboardSchema` refuses the entry, so every door that parses a dashboard refuses it: `defineStack`, `os validate`, `os build` and the dashboard save door (422 `INVALID_METADATA`). One issue per such entry, at its `name` (or its `field`, when it has no `name`): ``globalFilters[i] is keyed 'dateRange', the reserved name of the built-in date range this dashboard declares in `dateRange`. …``. The rule reads the sibling `dateRange`, so it sits on the dashboard object and is exported as `checkDashboardReservedDateRangeGlobalFilters`: a mirror that rebuilds the dashboard from `DashboardSchema.shape` drops it unless it chains the export, as `@object-ui/types`' `DashboardComponentSchema` now does, so the console's authoring door refuses the same dashboard. On `DashboardSchema` itself, zod 4 now throws on `.omit()` / `.pick()` / `.partial()` (an object carrying a refinement); no caller in this repository derives it that way.
- **Not changed.** On a dashboard that does not declare `dateRange`, an entry keyed `dateRange` is an ordinary filter and stays legal. A named entry whose `field` is `dateRange` is keyed by its name and stays legal.
- **The remedy.** Give the entry another `name` (and rename every widget `filterBindings.dateRange` key that means it), or delete it and keep the built-in `dateRange`.
- **Stored rows.** A stored dashboard carrying the pair still loads, with `_diagnostics` reading `valid: false` and carrying the refusal, and its next save (draft or publish) is refused until it is fixed. Nothing rewrites it: whether the entry was meant as the date range or as a filter of its own only the author knows. The upgrade guide entry is `ui-dashboard-global-filter-reserved-date-range-refused`.

<!-- adr-0087: registered ui-dashboard-global-filter-reserved-date-range-refused -->
