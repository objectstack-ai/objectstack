---
'@objectstack/core': patch
'@objectstack/spec': patch
---

fix(core): a platform object exposing `delete` is no longer annotated `restore` / `purge`, and the spec and core texts no longer say the recycle bin does not exist

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: `skills/**` never names the effective `apiOperations` annotation, and `skills/objectstack-api/SKILL.md` already describes the recycle bin as taking business-object rows, so no skill text changes here.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, export, type or stored shape changes. The narrowing is in a computed annotation the server builds for `/auth/me/permissions` and `ISecurityService.getEffectiveObjectPermissions`, so there is nothing for a metadata migration to rewrite and no tombstone. -->

**BREAKING** only for a client that read `restore` or `purge` in the effective `apiOperations` of a platform object (`sys_`, `cloud_`, `ai_`). The recycle bin takes no object in those namespaces (ADR-0148 D5), so the bin's doors already refused there: a restore or purge of an entry answers `404`, and a list, an empty or a permanent delete answers `400`. Those answers are unchanged. Only the annotation stops offering two verbs no request could use.

A platform object that exposes `delete` is now always annotated, because it is served less than its derived closure. That is the same rule as an object whose external write gate is closed, and every other operation it lists is unchanged. A business object keeps `restore` and `purge` exactly as before.

The texts corrected are the strip-warning guidance for the legacy `apiMethods` values `restore` and `purge`, the `enable.trash` and `softDelete` tombstones, the note on why `undelete` is not a webhook trigger, and the external write gate's docblock in core. Each now says the recycle bin exists for business objects and why platform objects have none.
