---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): Studio shows, keeps and authors the optional master of a controlled-by-parent object (#30974)

Clause-②: yes (widening)
Metadata-protocol: none

Since ADR-0055 §1 as amended (#30905, ruling A), a `controlled_by_parent` object's ONLY `master_detail` may be declared `required: false`: an optional master, whose records may name no master and are then visible only to their owner and to View All Records on the object. Studio still treated every master as required. It now follows the spec:

- **Display.** The package OWD overview names the master the spec's `controlledByParentMasterOf` names, so an optional master is shown as the master instead of "no master". An omitted `required` on the object's only `master_detail` is shown as the master too, the way the builder and stored data read it.
- **Save.** Switching an object to Controlled by parent (in the OWD overview or the object's Settings tab) still sets `required: true` on each `master_detail` that writes no `required`, and now keeps an explicit `required: false`. A Studio save no longer turns an optional master required.
- **Authoring.** On the object's only `master_detail`, the field inspector's Required box is no longer locked on: clearing it writes `required: false`, and the help text under it explains the optional master and who can see a record that names none. Beside another `master_detail` the lock stands, since the spec admits no optional master there.
- **New string.** `@object-ui/i18n`'s studio namespace gains `designer.field.requiredCbpOptionalMaster` (en, zh).
