---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui and objectui teach the report-index navigation item beside the named report

Clause-②: no
Metadata-protocol: none

- **Before.** The skills taught only the named report item, `{ type: 'report', reportName }`. Since PR #27566 a `type: 'report'` item with no `reportName` opens the app's report index (`/reports`), and the console no longer adds an index entry on its own, so an agent following the skills shipped an app with no report index entry.
- **Now.** The `objectstack-ui` navigation item table marks `reportName` optional and says what omitting it opens; `rules/navigation.md` shows the index entry beside the named one and says the console adds none itself; the `objectui` app-composition route table lists `{type:'report'}` → `/reports`. A new eval case (10 in `evals/views-apps-actions-pages.json`) asks for an app's report index entry and expects `{ type: 'report' }` with no `reportName`.
- No schema, key or behaviour changes.
