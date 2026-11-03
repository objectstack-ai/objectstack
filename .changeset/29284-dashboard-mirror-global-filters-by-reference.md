---
'@object-ui/types': patch
---

fix(types)!: `DashboardComponentSchema` refuses a dashboard that declares two global filters under one key, as the spec does

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (already-registered ui-dashboard-global-filter-duplicate-name-refused) The refused shape is the one that entry already registers for `@objectstack/spec`'s `DashboardSchema`: a `globalFilters` array that declares one filter key twice. This change makes the published `@object-ui/types` mirror refuse the same shape, with the same issue, by taking the spec's slot by reference. No spec key, accepted value or stored shape moves, so the upgrade guide entry, its remedy and its stored-row behaviour are the ones already published; `objectstack migrate meta` has nothing new to rewrite. -->

**BREAKING** for a dashboard node whose `globalFilters` repeats a filter key.

- **Before.** `DashboardComponentSchema` (`@object-ui/types/zod`) rebuilt `globalFilters` as an array of `GlobalFilterSchema`. That kept every check on each filter and dropped the spec array's own refusal, so two filters under one key passed this validator while every spec door (`defineStack`, `os validate`, `os build`, the dashboard save door) refused the dashboard. A filter's key is its `name`, or its `field` when it has no `name`.
- **Now.** The mirror takes `@objectstack/spec`'s `globalFilters` slot by reference, so it refuses the pair with the spec's own issue, at the second declaration's `name` (or its `field`): `This dashboard declares the global filter 'X' twice in globalFilters: globalFilters[i] and globalFilters[j]. …`. Each element is still the exported `GlobalFilterSchema`, so nothing else about a filter is judged differently. The slot's description is now the spec's.
- **Not changed.** Distinct keys, and two filters with distinct names over the same `field`. The TypeScript type of `globalFilters` and the `DASHBOARD_SPEC_EXCLUDED` list are unchanged.
- **Fix.** Rename all but one of the colliding entries (and every widget `filterBindings` key that means a renamed one), or delete the copy. The upgrade guide entry is `ui-dashboard-global-filter-duplicate-name-refused`.

Also: the `ObjectFormSchema` key-taxonomy docblock no longer lists `drawerSide`/`drawerWidth` as spec-aligned form-view keys. The spec retired both on the form view; they are the React `ObjectForm` block's own props. Comment only.
