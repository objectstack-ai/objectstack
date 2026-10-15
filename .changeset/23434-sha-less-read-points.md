---
'@objectstack/spec': patch
---

The last live renderer line numbers leave the published spec source: `packages/spec/src` no longer cites an objectui `File.tsx:NNN` for a live read point.

Clause-②: no

- **Sha-less line citations.** Ten live read-point records named an objectui file by line, with no SHA. Each moves into the note of its liveness row as `objectui @SHA FILE#SYMBOL`, re-read at objectui `b9814b334`, and the source comment now names the row: `data/field.zod.ts` (`field.json`, rows `step` and `dimensions`), `ui/action.zod.ts` and `system/translation.zod.ts` (`action.json`, row `description`), `ui/bulk-action.zod.ts` (`view.json`, row `list.bulkActionDefs`), `ui/view.zod.ts` (`view.json`, rows `list.filter`, `list.sort` and `list.userFilters`) and `ui/i18n-label-resolver.ts` (`page.json`, row `regions`).
- **Two stale renderer claims are no longer stated.** For an action bound to an object, the console's description resolver no longer falls back from `objects.{object}._actions.{action}.description` to `globalActions.{action}.description`. objectui's bulk-param option type is no longer closed. The comments in `ui/action.zod.ts`, `system/translation.zod.ts` and `ui/bulk-action.zod.ts` said both. They now state only the contract, and the ledger records the current reading.
- **`liveness/view.json`, row `list.exportOptions`** names its reader by symbol instead of by line.
- **Unchanged on purpose.** Retirement history stays where it is: the `areas[].order` record in `ui/app.zod.ts` and the `widgets[].aria` record in `ui/dashboard.zod.ts`. Two citations with no ledger row also stay: the build-progress phase reading in `ai/build-progress.zod.ts`, and the "pin this view" trace on `ViewItemSchema` in `ui/view.zod.ts`.
- No schema, type, export, default, accept or refuse change. No `.describe()` text changed.
