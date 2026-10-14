---
'@objectstack/metadata-protocol': minor
'@objectstack/plugin-security': minor
'@objectstack/spec': minor
---

fix(metadata-protocol)!: the metadata save, restore and publish doors refuse a permission set whose body `packageId` disagrees with the package it is saved into, and the audience-binding suggestion reader takes a set's owner from its binding only (ADR-0086 D3)

Clause-②: no (narrowing)

<!-- adr-0087: registered permission-set-package-id-binding-mismatch-refused -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0086 D3 declares `PermissionSetSchema.packageId` as the owning package of a package-shipped set, absent for an environment-authored one. The owner every reader uses is the package the set is saved into: the stored row's `package_id`, served as `_packageId`. A body `packageId` that named another package was accepted and then silently overridden, so an author, an AI build above all, never learned that the owner it wrote was not the owner it got.

**FROM.** A permission set saved and published into package `app.crm` with `packageId: 'app.other'` in its body answered `200` and `published`, and was owned by `app.crm` everywhere it was read. A set saved into no package with `packageId: 'app.other'` was stored as an environment-authored set, while the audience-binding suggestion reader offered it, accepted it and derived it into `everyone` as `app.other`'s.

**TO.**

- **`@objectstack/metadata-protocol`.** The save door (`PUT /api/v1/meta/permission/:name`, draft and publish mode, and every in-process caller) the restore doors (`POST /api/v1/meta/permission/:name/rollback` and a commit revert's restore limb) and the draft promotion (`POST /api/v1/meta/permission/:name/publish` and the package publish) refuse a permission set whose body `packageId` is not the package the row is written into, with `400 VALIDATION_ERROR`, the code and status the doors already answer for a body `name` that disagrees with its row. `issues[]` carries the key at `packageId`. A body `packageId` on a set saved into no package is refused too, the empty string included: a present key declares a package-shipped set. The message names both values and both remedies. The package judged is the one the write lands in: a draft saved without naming a package lands in the package of the item's active row, and is judged against it. A package publish that meets such a draft (one stored before this change) aborts the whole batch, `outcome: 'refused'`, with the draft in `failed[]` under `VALIDATION_ERROR`. A rollback to a stored version that carries such a body (one written before this change) is refused, and a commit revert reports it in `failed[]` under the same code; the remedy there is to save the set again with `packageId` dropped or set to its package, instead of restoring that version. Nothing is written, published or restored. Package duplication copies a set whose body names the source package as naming the target package. `os migrate meta --stored --apply` records a stored set it rewrites, and the door refuses, as that row's failure.
- **`@objectstack/plugin-security`.** The audience-binding suggestion reader takes a set's owner from its binding only, never from its body's `packageId`. A set bound to no package has no owner there, so no suggestion is created for it. An acceptance recorded under the package its body named is withheld from `everyone` at the next derivation. The withholding is reported at `warn`, naming the set and its reason. Accepting a pending suggestion of that kind is refused.
- **`@objectstack/spec`.** The `PermissionSetSchema.packageId` description states the refusal. The step-18 semantic migration entry `permission-set-package-id-binding-mismatch-refused` carries the upgrade sweep.

**Unchanged.** A body `packageId` equal to the package the set is saved into is accepted, and an absent one is accepted everywhere. Stored rows are not rewritten. A stored set whose body disagrees with its binding keeps loading and keeps reading as its binding, and is refused on its next save or publish, as is a restore of a stored version that carries one. An installed package's own sets are owned by the package that ships them, as before.

**Remedy, in one line.** Drop `packageId` from the permission set's body, or save the set into the package it names (`?package=<id>` on the REST door, `packageId` in process).
