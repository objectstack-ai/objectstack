---
"@objectstack/spec": minor
---

feat(spec): declare `editMode?: 'modal' | 'page'` on the object document (#11408)

Accept-set **widening** — no existing document changes meaning and nothing is
removed. Maintainer ruling 2026-08-24 (declare, the #10144 declare-or-rule-out
family): objectui's shipped runtime reads `objectDef.editMode` (record-edit
routing: modal form vs a dedicated `/record/:id/edit` route) and its CHANGELOG
announces the key to authors, while the spec's strict parse rejected it with
`unrecognized_keys` — so an author following objectui's documentation was
refused by every spec-validating path and the key only worked through data
sources that skip validation.

The object document now declares it beside the other display hints
(`nameField`, `highlightFields`, `stageField`): an optional cross-renderer
edit-interaction intent — `'modal'` opens the edit form as a dialog over the
current view, `'page'` navigates to a dedicated full-page edit route, absent
lets the renderer pick its own default (objectui defaults to modal). Values
outside the enum are rejected as a located value error at `editMode`.

Consumer-side follow-up (not in this change): objectui retires its
`ObjectSchemaClientExtensions.editMode` client-extension member and lets the
spec derivation carry the key — its pinned rejection tests flip by design.
That retirement is **release-gated** on the `@objectstack/spec` release
containing this change (per the recorded ruling), not merely on this merge.
