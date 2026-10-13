---
'@objectstack/runtime': patch
---

fix(runtime): cloning a flow, and publishing a package's drafts, no longer fail on a `protection` block left in a row stored before the metadata save door refused it

Clause-②: no

Two runtime doors re-save a body the server builds from a stored row: the flow clone (`POST /api/v1/automation/:name/clone`), and the visibility flip of `POST /api/v1/packages/:id/publish-drafts`, which re-saves each of the package's apps still stored with `_unpublished: true`. The metadata save door now refuses a `protection` block with `400 VALIDATION_ERROR` (entry `23096-save-door-protection`). A row stored before that refusal can still carry a block, and both doors copied it into the body they saved.

**FROM.** A clone of such a flow answered `400 VALIDATION_ERROR` about a block the admin never sent. The flip of such an app was refused the same way: the publish still answered `200`, the app stayed `_unpublished`, and the refusal was reported only under `unhideError`.

**TO.** Both doors drop the `protection` block from the body they save, as the permission-set clone already does. The clone and the flip save, and the saved row carries no block. Nothing else in either body changes, and neither door states a `source`, so every other save-door check still applies. The block never bound anything: only a code package's loader translates `protection` into a lock, so dropping it changes no lock and no verdict.

**Unchanged.** A flow or an app with no block is saved exactly as before.
