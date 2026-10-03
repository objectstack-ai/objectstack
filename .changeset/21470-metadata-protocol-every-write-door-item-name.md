---
'@objectstack/metadata-protocol': minor
---

Every runtime door that writes a metadata row refuses a body whose own `name` disagrees with the row's name, for every metadata type

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at the runtime write doors over an existing key: no `name` key of any metadata schema is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. Which of the two names a divergent body meant (its own, or the one it was saved under) is authoring intent no conversion entry can decide. The at-rest census found no such row: 0 `sys_metadata` and 0 `sys_metadata_history` rows in the four bootable example apps, booted with their seeds; the hosted-tenant shape was not measured. New writes are refused with the remedy; a row stored before this change keeps its bytes and stays readable. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered); and the change narrows what runtime write doors accept, not a runtime interface or a type surface alone (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing at the runtime write doors, shipped as `minor` under the repo's launch-window convention for breaking changes, the grade the view-container half of this refusal takes in the same release.

**What was accepted before.** The runtime stores a metadata row under the name the request names and registers its body under the body's own `name`. These doors accepted a body whose `name` was not the row's, so the row answered under a name nobody saved it under, and under none by its own:

- `saveMetaItem`, which `PUT /api/v1/meta/:type/:name` and the dispatcher's metadata save both call, for every type but a view container (a dashboard saved as `dash_a` with `name: 'dash_b'` registered as `dash_b`; a record view saved as `crm_lead.mine` with `name: 'crm_lead.other'` registered as `crm_lead.other`);
- `rollbackMetaItem` and `revertCommit`, which wrote such a stored history version back as the active row without passing `saveMetaItem`;
- `publishMetaItem` and `publishPackageDrafts`, which promoted such a stored draft the same way.

**What is refused now.** Each of those bodies, with `VALIDATION_ERROR` / 400, before anything is stored or registered, through the judge the view-container refusal already used (`savedItemNameRefusal`, `@objectstack/metadata/view-container-name`). `rollbackMetaItem` and `publishMetaItem` throw it. `revertCommit` reports the item in `failed[]` with `code: 'VALIDATION_ERROR'`. `publishPackageDrafts` aborts the batch on it, as it does on any refused draft: nothing in the batch is published. A body with no `name` is accepted as before. A `name` the body carries is judged whatever its value; a `translation` saved with `name: ''`, which its schema accepts, is now refused instead of being registered under the empty string. A view at the save door is the exception: a missing or empty view `name` is still stamped with the save name. A `field` written through the `OS_METADATA_WRITABLE` operator hatch is accepted only without a body `name`: its row is named `object.field`, which the column `name` cannot spell, and registered it answered under the column name alone. Where the type's schema already refused such a body (an empty or non-string `name` on most types, any `name` on a `seed`, whose schema declares none), the answer is now this refusal (`VALIDATION_ERROR` / 400) instead of the schema's `INVALID_METADATA` / 422; nothing is stored either way.

**The fix.** Set the body's `name` to the name you save it under, or save the item under the body's own `name`; for a view or a `field`, dropping `name` works too. To bring back a version or a draft that carries another `name`, save the item again with that fix, and publish that save if it is a draft.
