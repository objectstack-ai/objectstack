---
'@objectstack/spec': minor
---

fix(spec)!: a dashboard that declares two global filters under one name is refused at every door that parses it

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-ui/rules/dashboards.md` teaches a filter's `name` as "the stable key `filterBindings` references", defaulting to `field`, and no file under `skills/**` shows two filters under one key; every taught use stays true.

**BREAKING** for a dashboard whose `globalFilters` repeats a filter key.

- **Before.** `DashboardSchema` typed `globalFilters` as a plain array, so two entries under one key parsed and the dashboard save door (`PUT /api/v1/meta/dashboard/X`) answered 200. A filter's key is its `name`, or its `field` when it has no `name`: the key the filter bar draws its control under and the key a widget's `filterBindings` names. The board drew one control, and the value typed into it filtered the field of the other definition, so a tile read a number the author never asked for.
- **Now.** `DashboardSchema.globalFilters` refuses the pair, so every door that parses a dashboard refuses it: `defineStack`, `os validate`, `os build` and the dashboard save door (422 `INVALID_METADATA`). One issue per repeated key, at the second declaration's `name` (or its `field`, when that entry has no `name`), naming the key and every index: `This dashboard declares the global filter 'X' twice in globalFilters: globalFilters[i] and globalFilters[j]. …`. The rule sits on the array, so a mirror that spreads `DashboardSchema.shape` keeps it.
- **Not changed.** Distinct names, two filters with distinct names over the same `field`, and the same name on two different dashboards.
- **Fix.** Rename all but one of the colliding entries (and every widget `filterBindings` key that means a renamed one), or delete the copy.
- **Stored rows.** A stored dashboard that repeats a key still loads, with `_diagnostics` reading `valid: false` and carrying the refusal, and its next save (draft or publish) is refused until it is fixed. Nothing rewrites it: which definition keeps the name only the author knows. The upgrade guide entry is `ui-dashboard-global-filter-duplicate-name-refused`.

<!-- adr-0087: registered ui-dashboard-global-filter-duplicate-name-refused -->
