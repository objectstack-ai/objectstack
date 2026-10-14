---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/plugin-security': minor
'@objectstack/metadata-protocol': patch
'@objectstack/cli': patch
---

fix(spec,objectql)!: a permission set whose body `packageId` disagrees with the package that ships it is refused at `defineStack` / `os validate` / `os build` and at package registration, and every reader takes a set's owner from its binding only (ADR-0086 D3)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (already-registered permission-set-package-id-binding-mismatch-refused) this change widens that entry, in this diff, to the build and registration doors: same key, same ruling, same remedy, no stored row rewritten -->

**BREAKING** (an accept-set narrowing on a published authoring surface), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0086 D3 declares `PermissionSetSchema.packageId` as the owning package of a package-shipped set, absent for an environment-authored one. The owner every reader uses is the binding: the package that ships the set or that it is saved into, served as `_packageId`. The metadata save, restore and publish doors already refuse a body `packageId` that disagrees with it. Package source and package registration did not: a set whose body named another package was registered under the package that shipped it, with no refusal and no warning, so an author, an AI build above all, never learned that the owner it wrote was not the owner it got.

**What is refused, and where.** One judge, `judgePermissionSetOwnerBinding` (new export of `@objectstack/spec/security`), serves every door:

- **The stack schema** (`ObjectStackDefinitionSchema`), so `defineStack`, `objectstack validate`, `objectstack build`, the lint scorer and an artifact load all refuse a set whose body `packageId` is not the id of the package that ships it: the stack's `manifest.id`, each `packages[]` body's own `id`, and `manifest.id` for a top-level set no body declares. A stack with no `manifest` ships its sets from no package, so any key there is refused, the empty string included. The issue sits at the set's `packageId` (`permissions.0.packageId`); `defineStack` throws `STACK_SCHEMA_INVALID` (422) carrying it.
- **Package registration** (`ObjectQL.registerApp`, the manifest and a nested plugin, for a manifest no schema parse judged) throws `400 VALIDATION_ERROR` with `issues[]` at `packageId` before the set is filed, the envelope the same seam throws for a view container whose `name` disagrees with its key.

The message prescribes first, names both values, and offers both remedies: drop the key, or ship the set from the package it names. No error code is minted.

**Readers.** `@objectstack/plugin-security`'s packaged-set lock (`classifyPackagedPermissionSet`) and `@objectstack/cli`'s permission-set name-collision report take a set's package from its binding only. A set filed into no package whose body named one is no longer locked as that package's, and a stack with no `manifest` declares no owner for the collision report.

**Unchanged.** A body `packageId` equal to the package that ships the set is accepted, and an absent one is accepted everywhere. A top-level copy of a set a `packages[]` body declares (an artifact built with both halves) is judged on its body, not against the artifact's own id. The metadata save, restore and publish doors answer in the same words as before (`@objectstack/metadata-protocol` now calls the shared judge). Stored `sys_metadata` rows are not rewritten.

## FROM → TO

| door | FROM | TO |
|:--|:--|:--|
| `defineStack` / `objectstack validate` / `objectstack build` | `defineStack({ manifest: { id: 'com.acme.crm', … }, permissions: [{ name: 'crm_member', packageId: 'com.acme.other', … }] })` accepted; the set was owned by `com.acme.crm` | refused at `permissions.0.packageId`, `STACK_SCHEMA_INVALID` 422 |
| `ObjectQL.registerApp` | the same manifest registered the set under `com.acme.crm`, silently | `400 VALIDATION_ERROR`, `issues[]` at `packageId`, nothing filed |
| an artifact built before this change | loaded, the set owned by the shipping package | refused at load; rebuild it without the key |

**Remedy, in one line.** Drop `packageId` from the permission set in your stack source (the package that ships a set is its owner), or move the set into the stack of the package it names, then build again.
