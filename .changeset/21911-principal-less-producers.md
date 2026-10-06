---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
"@objectstack/core": patch
---

The platform's own `sys_metadata` reads and writes now carry the explicit system opt-in (`isSystem: true`) instead of reaching the data engine with no principal at all

Clause-②: no

- **What moved.** Each engine call in these functions now passes `context: { isSystem: true }`. Inside a repository transaction it passes `{ ...ctx, isSystem: true }`, so the transaction handle still rides along.
  - `@objectstack/metadata-protocol`: the overlay reads (`findServedOverlayRow`, `overlayLockLayerAt`), the list read (`readActiveOverlayRows`, and `readFlattenedMetaItems`' draft preview), the authoring gate's stored-collection fold (`foldStoredCollection`), the audit and commit trail writes (`recordMetadataAudit`, `persistPackageCommitRow`), and the package verbs' store calls (`publishPackageDrafts`, `resolveOverlayPackageBinding`, `storedFlowBindingAgrees`, `deletePackage`, `duplicatePackage`, `reassignOrphanedMetadata`).
  - `SysMetadataRepository`: `get`, `put`, `delete`, `promoteDraft`, `restoreVersion`, `listDrafts` and the two lineage counters.
  - `@objectstack/objectql`: `ObjectQLPlugin`'s authored action and hook reads, at boot and on resync.
  - `@objectstack/core`: the authored-translation read (`readAuthoredTranslationLayer`).
- **Why.** plugin-security passes an engine operation whose context has no user, no position, no permission set and no `isSystem` straight on to the next handler (ADR-0096's principal-less hand-off). These calls worked only because of that pass-through. They are platform plumbing: any door in front of them has already authorized the caller, and the protocol scopes its own rows by organization. So they now say so with the opt-in that already exists.
- **No gate verdict moves.** A system context skips the six gates the middleware still runs before that pass-through: package-managed, system-row, curated-capability, audience-anchor, engine-owned and delegated-administration. Four of them only act on other objects. The engine-owned gate never fires on a context with no user. The delegated-administration gate only acts on the RBAC link tables. So none of the six applies to the `sys_metadata` family. An instrumented run of the dogfood suite and a booted dev composition recorded no gate firing on any of these calls before the change. After the change it recorded no principal-less call from these functions.
- **One engine check also stands down under `isSystem`.** That is the referential-integrity check on a caller-supplied lookup. On these writes the only lookup it judged was `sys_metadata.organization_id`, which the repository fills from the door-derived organization. The instrumented runs recorded no refusal from it on any of these calls.
- ⛔ No new API, no export change, and no change to what any door authorizes.
