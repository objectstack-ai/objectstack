---
'@objectstack/skills': patch
---

docs(skills): sixteen eval cases forbid the wrong code spelling, not a mention of its name

Clause-②: no
Metadata-protocol: none

A `must_not_contain` entry is matched as a literal substring, so a bare identifier also fails a correct answer that names it as the thing to avoid: `objectstack-ui` `analytics-inline-vs-dataset` case 5 failed an answer saying an ad-hoc react-page chart "doesn't need a `defineDataset`". Sixteen cases whose bundle or reference answer states such a negative now forbid the spelling a wrong answer writes: a call with its paren (`defineDataset(` in that case and `objectstack-data` `hooks-security-seeds-datasources` 4, `definePage(` in `record-page` 2, `getAppBundle(` / `loadAppBundle(` in `objectstack-i18n` `bundles-locales-coverage` 4), a key with its colon or dot (`categoryField:` in `analytics-inline-vs-dataset` 1; `sourceView:`, `disabledMessage:` / `disabledTooltip:` in `views-apps-actions-pages` 5 and 9; `readonlyWhen:`, `assigned_to:` in the data file's 5 and 8; `subDays:` in `objectstack-query` `filters-pagination-search` 6; `permissionSets:` / `permissionSets.` in the i18n file's 6; `pageName:` / `viewName:`, bare and JSON-quoted, in `objectui` `app-composition` 2 and 4) and a quoted literal (`type: 'record_detail'` in the views file's 4; `'admin_full_access'` and a quote-opened `@objectstack/adapter-` in `objectstack-platform` `config-plugins-ops` 7 and 4). Each of the sixteen has a new case hash, so `skill-evals --regrade` sets it apart from a round recorded before this change: compare it across rounds only after a re-run. No prompt, reference answer, `must_contain` entry or skill text changes.
